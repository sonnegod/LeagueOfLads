import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {engineFixture} from './helpers/bettingFixture.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {createRefreshQueue,markBettingDirty} from '../betting/refreshQueue.js';
import {pollSchedules} from '../discordbot/schedulePoller.js';
import {parseScheduleMessage} from '../betting/scheduleParser.js';
import {runBetting} from '../betting/engine.js';
import {WORKER_BUSY_EXIT_CODE} from '../betting/workerLock.js';

const instant=new Date('2026-10-13T12:00:00.000Z');
const season={SeasonId:1,CreatedAt:'2026-10-01T00:00:00.000Z'};
const state=f=>f.league.prepare('SELECT * FROM BettingRefreshState WHERE Id=1').get();
function queueFixture() {
  const f=engineFixture(),timers=new Map(),children=[];let time=instant.getTime();
  const queue=createRefreshQueue({db:f.league,now:()=>new Date(time),maxFailures:3,
    setTimer(fn,delay){const timer={fn,delay,unref(){}};timers.set(timer,timer);return timer;},clearTimer(timer){timers.delete(timer);},
    launch(){const child=new EventEmitter();child.revision=state(f).RequestedRevision;children.push(child);return child;}});
  const fire=()=>{assert.equal(timers.size,1);const timer=[...timers.values()][0];timers.delete(timer);time+=timer.delay;timer.fn();return children.at(-1);};
  const complete=child=>{f.league.prepare('UPDATE BettingRefreshState SET CompletedRevision=? WHERE Id=1').run(child.revision);child.emit('close',0);};
  return {...f,queue,timers,children,fire,complete,close(){queue.dispose();f.close();}};
}

test('refreshes debounce, serialize newer revisions and resume durable pending work after restart',()=>{
  const f=queueFixture();try {
    f.queue.request();f.queue.request();assert.equal(f.timers.size,1);assert.equal(state(f).RequestedRevision,2);
    const first=f.fire();assert.equal(first.revision,2);f.queue.request();assert.equal(f.timers.size,0);assert.equal(f.children.length,1);
    f.complete(first);assert.equal(f.timers.size,1);assert.equal(state(f).CompletedRevision,2);
    const second=f.fire();assert.equal(second.revision,3);f.complete(second);assert.equal(f.timers.size,0);
    markBettingDirty(f.league,instant);f.queue.resume();assert.equal(f.timers.size,1);f.complete(f.fire());
    assert.equal(state(f).RequestedRevision,state(f).CompletedRevision);
  }finally{f.close();}
});

test('failed children retry with backoff once per process result, keep quotes held, and expose exhaustion without exception text',()=>{
  const f=queueFixture();try {
    f.queue.request();const child=f.fire();child.emit('error',new Error('PRIVATE token or source detail'));child.emit('close',1);
    assert.equal(state(f).ConsecutiveFailures,1);assert.equal([...f.timers.values()][0].delay,5000);
    assert.ok(state(f).RequestedRevision>state(f).CompletedRevision);assert.equal(state(f).LastErrorCode,'refresh_failed');
    f.fire().emit('close',1);assert.equal([...f.timers.values()][0].delay,10000);
    f.fire().emit('close',1);assert.equal(f.timers.size,0);assert.equal(state(f).LastErrorCode,'refresh_retry_exhausted');
    assert.equal(state(f).ConsecutiveFailures,3);assert.equal(JSON.stringify(state(f)).includes('PRIVATE'),false);
    f.queue.request();assert.equal(state(f).LastErrorCode,null);f.complete(f.fire());assert.equal(state(f).ConsecutiveFailures,0);
  }finally{f.close();}
});

test('competing workers defer without exhausting automatic retries and newer pending revisions remain queued',()=>{
  const f=queueFixture();try {
    f.queue.request();
    for(let i=0;i<8;i++) {
      f.fire().emit('close',WORKER_BUSY_EXIT_CODE);
      assert.equal(state(f).ConsecutiveFailures,0);assert.equal(state(f).LastErrorCode,null);
      assert.equal([...f.timers.values()][0].delay,30000);
      assert.ok(state(f).RequestedRevision>state(f).CompletedRevision);
    }
    markBettingDirty(f.league,instant);f.complete(f.fire());assert.equal(f.timers.size,0);
    assert.equal(state(f).RequestedRevision,state(f).CompletedRevision);
  }finally{f.close();}
});

function message(id,content='1011111 vs 1022222 Saturday 9est',extra={}) {
  return {id:String(id),content,createdAt:new Date(instant),editedAt:null,author:{bot:false},mentions:{roles:new Map()},...extra};
}
function pollFixture(messages) {
  const f=engineFixture(),posts=new Map(messages.map(m=>[m.id,m])),errors=new Map(),calls=[];
  const store=new ScheduleStore(f.league,{changed:()=>markBettingDirty(f.league,instant)});
  const channel={messages:{async fetch(options){calls.push(options);
    if(typeof options==='string') {if(errors.has(options))throw errors.get(options);if(!posts.has(options))throw {code:10008};return posts.get(options);}
    return new Map([...posts.values()].filter(m=>!options.before||BigInt(m.id)<BigInt(options.before))
      .sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1).slice(0,options.limit).map(m=>[m.id,m]));
  }}};
  const poll=options=>pollSchedules({store,channel,channelId:'99',season,now:()=>new Date(instant),...options});
  return {...f,store,posts,errors,calls,channel,poll};
}

test('Discord catch-up cannot jump a history gap and handles snowflake digit boundaries and posts arriving during backfill',async()=>{
  const f=pollFixture([98,99,100,101,102].map(id=>message(id)));try {
    assert.equal((await f.poll({maxPages:1,pageSize:2})).catchupComplete,false);
    let cursor=f.league.prepare('SELECT * FROM DiscordScheduleCursors').get();assert.equal(cursor.LastMessageId,null);assert.equal(cursor.NewestBoundary,'102');assert.equal(cursor.BackfillBefore,'101');
    f.posts.set('103',message(103));await f.poll({maxPages:1,pageSize:2});
    assert.equal((await f.poll({maxPages:1,pageSize:2})).catchupComplete,true);
    assert.equal(f.league.prepare('SELECT LastMessageId FROM DiscordScheduleCursors').get().LastMessageId,'102');assert.equal(f.store.list(1).length,5);
    await f.poll({maxPages:1,pageSize:2});assert.equal(f.store.list(1).length,6);
    assert.equal(f.league.prepare('SELECT LastMessageId FROM DiscordScheduleCursors').get().LastMessageId,'103');
    const revision=state(f).RequestedRevision;assert.equal((await f.poll({maxPages:1,pageSize:2})).changed,0);assert.equal(state(f).RequestedRevision,revision);
  }finally{f.close();}
});

test('tracked role-free edits enter review; permission failures cannot masquerade as deletions and real deletions dirty affected quotes',async()=>{
  const f=pollFixture([message(100),message(101)]);try {
    await f.poll();const original=f.league.prepare("SELECT EventId FROM ScheduleMessages WHERE MessageId='101'").get().EventId;
    f.posts.set('101',message(101,'Sunday 9pm',{editedAt:new Date('2026-10-13T13:00:00Z')}));
    await f.poll();assert.equal(f.store.get(original).Status,'needs_review');assert.equal(f.league.prepare("SELECT ParseStatus FROM ScheduleMessages WHERE MessageId='101'").get().ParseStatus,'needs_review');
    const revision=state(f).RequestedRevision;await f.poll();assert.equal(state(f).RequestedRevision,revision);
    f.posts.delete('100');f.errors.set('100',{code:50013});
    await assert.rejects(f.poll(),error=>error.code===50013);assert.equal(f.league.prepare("SELECT Deleted FROM ScheduleMessages WHERE MessageId='100'").get().Deleted,0);
    assert.equal(f.league.prepare('SELECT COUNT(*) AS n FROM DiscordSchedulePollLocks').get().n,0);
    f.errors.delete('100');await f.poll();assert.equal(f.league.prepare("SELECT Deleted FROM ScheduleMessages WHERE MessageId='100'").get().Deleted,1);
    assert.ok(state(f).RequestedRevision>revision);
    const afterDeletion=state(f).RequestedRevision;await f.poll();assert.equal(state(f).RequestedRevision,afterDeletion);
  }finally{f.close();}
});

test('Discord polling leases prevent overlapping runs and reject a lease lost during an awaited fetch',async()=>{
  const f=pollFixture([message(100)]);try {
    const original=f.channel.messages.fetch;let release,started;
    const ready=new Promise(resolve=>{started=resolve;});
    f.channel.messages.fetch=async options=>{started();await new Promise(resolve=>{release=resolve;});return original(options);};
    const first=f.poll();await ready;assert.equal((await f.poll()).skipped,'poll_in_progress');release();await first;
    f.channel.messages.fetch=async options=>{const result=await original(options);f.league.prepare("UPDATE DiscordSchedulePollLocks SET Owner='other-owner'").run();return result;};
    await assert.rejects(f.poll(),{code:'DISCORD_POLL_LEASE_LOST'});
    assert.equal(f.league.prepare('SELECT Owner FROM DiscordSchedulePollLocks').get().Owner,'other-owner');
  }finally{f.close();}
});

test('Discord ignores bots and old/unrelated posts; explicit BO3 tiebreakers keep their separate stage',async()=>{
  const f=pollFixture([message(100,'hello'),message(101,undefined,{author:{bot:true}}),message(102,undefined,{createdAt:new Date('2026-09-01T12:00:00Z')}),
    message(103,'1011111 vs 1022222 Saturday 9est tiebreaker BO3')]);try {
    await f.poll();assert.equal(f.store.list(1).length,1);assert.equal(f.store.list(1)[0].Stage,'tiebreaker');assert.equal(f.store.list(1)[0].BestOf,3);
    assert.equal(parseScheduleMessage({content:'1011111 vs 1022222 Saturday 9est playoff BO3',authoredAt:instant.toISOString()},f.store.teams(1)).stage,'playoff');
    assert.equal(f.league.prepare('SELECT COUNT(*) AS n FROM ScheduleMessages').get().n,1);
  }finally{f.close();}
});

test('Discord reparses a previously rejected numeric timestamp after a parser update without creating duplicate fixtures',async()=>{
  const post=message(100,"1. **<@&111111111111111111>** vs **<@&222222222222222222>** Sunday, October 25th, 8pm EDT (10/25/2026 8:00 PM)",
    {mentions:{roles:new Map([['111111111111111111',{name:'A'}],['222222222222222222',{name:'B'}]])}});
  const f=pollFixture([post]);try {
    // Store the unchanged post, then recreate its pre-fix parser failure below
    // the Discord cursor to exercise reconciliation rather than new-post fetches.
    await f.poll();
    f.league.exec(`DELETE FROM ScheduleEventRevisions;DELETE FROM ScheduledEvents;
      UPDATE ScheduleMessages SET EventId=NULL,ParseStatus='needs_review',IssueCode='conflicting_times',ParserVersion=6;`);
    const result=await f.poll();assert.equal(result.changed,1);
    const row=f.league.prepare("SELECT * FROM ScheduleMessages WHERE MessageId='100'").get();
    assert.equal(row.ParseStatus,'parsed');assert.equal(row.IssueCode,null);
    const events=f.store.list(1);assert.equal(events.length,1);
    assert.equal(events[0].ScheduledStartUtc,'2026-10-26T00:00:00.000Z');
    assert.equal(row.EventId,events[0].EventId);
    assert.equal((await f.poll()).changed,0);assert.equal(f.store.list(1).length,1);
  }finally{f.close();}
});

test('role-tagged post with an unverifiable month uses its weekday, publishes markets and preserves admin corrections',async()=>{
  const postedAt=new Date('2026-10-20T12:00:00.000Z');
  const roles=new Map([['111111111111111111',{name:'6 OR 7'}],['222222222222222222',{name:"This Cowboy Wasn't Made For Modern Love"}]]);
  const f=pollFixture([message(100,'<@&111111111111111111> vs <@&222222222222222222> weds oc 21st 9 est',
    {createdAt:postedAt,mentions:{roles}})]);
  try {
    for(const [key,name] of [[11,'6 OR 7'],[12,"This Cowboy Wasn't Made For Modern Love"]]) {
      f.league.prepare('UPDATE SeasonTeams SET TeamName=? WHERE TeamSubmissionId=?').run(name,key);
      f.analytics.prepare('UPDATE TeamFacts SET TeamName=? WHERE TeamSubmissionId=?').run(name,key);
    }
    f.analytics.prepare('UPDATE AnalyticsRuns SET AsOfUtc=?').run(postedAt.toISOString());
    f.analytics.prepare('UPDATE SourceSnapshots SET LastSuccessAtUtc=?').run(postedAt.toISOString());
    const imported=await f.poll({now:()=>postedAt});assert.equal(imported.changed,1);
    const post=f.league.prepare("SELECT * FROM ScheduleMessages WHERE MessageId='100'").get();
    assert.equal(post.ParseStatus,'parsed');assert.equal(post.IssueCode,null);
    assert.ok(JSON.parse(post.AssumptionsJson).includes('Next weekday occurrence'));
    const event=f.store.get(post.EventId);
    assert.equal(event.ScheduledStartUtc,'2026-10-22T01:00:00.000Z');
    assert.equal(event.Team1Key,11);assert.equal(event.Team2Key,12);assert.equal(event.Stage,'regular');assert.equal(event.BestOf,2);
    assert.ok(state(f).RequestedRevision>state(f).CompletedRevision);
    runBetting({...f,now:postedAt,simulations:50});
    const markets=f.betting.prepare("SELECT MarketType FROM BettingMarkets WHERE EventId=? AND Status='open'").all(event.EventId);
    assert.ok(markets.some(m=>m.MarketType==='series_winner'));assert.ok(markets.some(m=>m.MarketType==='exact_score'));
    const revision=state(f).RequestedRevision;await f.poll({now:()=>postedAt});
    assert.equal(state(f).RequestedRevision,revision);assert.equal(f.store.list(1).length,1);
    const correctedStart='2026-10-23T01:00:00.000Z';
    f.store.save(1,{eventId:event.EventId,revision:event.Revision,team1Key:11,team2Key:12,stage:'regular',bestOf:2,
      scheduledStartUtc:correctedStart},'admin',postedAt);
    await f.poll({now:()=>postedAt});
    assert.equal(f.store.get(event.EventId).ScheduledStartUtc,correctedStart);
  }finally{f.close();}
});
