import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {engineFixture} from './helpers/bettingFixture.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {createRefreshQueue,markBettingDirty} from '../betting/refreshQueue.js';
import {pollSchedules} from '../discordbot/schedulePoller.js';
import {parseScheduleMessage} from '../betting/scheduleParser.js';

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
