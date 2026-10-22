import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {preseasonFixture} from './helpers/bettingFixture.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {createAdminRosterRouter} from '../routes/rosterRoutes.js';
import {mutationRefresh} from '../betting/runtime.js';
import TeamRosterStore from '../config/teamRosterStore.js';

const now=new Date('2026-10-15T12:00:00Z'),effectiveAtUtc='2026-10-14T12:00:00.000Z';
function fixture() {
  const f=preseasonFixture([4]),audit=[];let refreshes=0;
  f.league.pragma('foreign_keys=ON');
  f.league.exec(`CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT NOT NULL,LastDateChanged TEXT);
    INSERT INTO PlayerInfo(PlayerId,PlayerName) SELECT DISTINCT PlayerId,'Player '||PlayerId FROM SeasonTeamPlayers;
    ALTER TABLE SeasonTeams ADD COLUMN CaptainId INTEGER;
    ALTER TABLE SeasonTeams ADD COLUMN UpdatedAt TEXT;
    ALTER TABLE LeagueSeasons ADD COLUMN EndedAt TEXT;
    UPDATE SeasonTeams SET CaptainId=(SELECT MIN(PlayerId) FROM SeasonTeamPlayers p WHERE p.TeamSubmissionId=SeasonTeams.TeamSubmissionId);
    UPDATE LeagueSeasons SET Status='active' WHERE SeasonId=2;
    CREATE TABLE TeamRosterPlayers(TeamSubmissionId INTEGER REFERENCES SeasonTeams(TeamSubmissionId),PlayerId INTEGER REFERENCES PlayerInfo(PlayerId),
      Slot INTEGER,FinalizedAt TEXT,PRIMARY KEY(TeamSubmissionId,PlayerId),UNIQUE(TeamSubmissionId,Slot));
    INSERT INTO TeamRosterPlayers SELECT TeamSubmissionId,PlayerId,Slot,'2026-10-13T01:00:00.000Z' FROM SeasonTeamPlayers;
    CREATE TABLE TeamRosterPeriods(TeamSubmissionId INTEGER PRIMARY KEY,EffectiveFrom TEXT,EffectiveTo TEXT,FromEstimated INTEGER);
    INSERT INTO TeamRosterPeriods SELECT TeamSubmissionId,'2026-10-13T01:00:00.000Z',NULL,0 FROM SeasonTeams;
    CREATE TABLE MatchLeague(MatchId INTEGER,LeagueId INTEGER,DatePlayed TEXT);
    CREATE TABLE LeagueRosterEntries(EntryId INTEGER PRIMARY KEY,LeagueId INTEGER,TeamSubmissionId INTEGER,TeamId INTEGER,GroupId INTEGER,DisplayName TEXT);
    INSERT INTO LeagueRosterEntries SELECT TeamSubmissionId,CASE WHEN SeasonId=2 THEN 200 ELSE 100 END,TeamSubmissionId,ExternalTeamId,GroupId,TeamName FROM SeasonTeams;`);
  const schedules=new ScheduleStore(f.league,{audit:(...entry)=>audit.push(entry),changed:()=>refreshes++});
  return {...f,schedules,audit,refreshes:()=>refreshes};
}
const replace=(f,body={})=>f.schedules.changeRoster(2,{playerId:210,fromTeamKey:21,replacementPlayerId:999,
  replacementPlayerName:'Newcomer',effectiveAtUtc,reason:'Permanent replacement',...body},'99',now);

test('a replacement can be a new account, preserves past membership and original signup, and appears on the public roster',()=>{
  const f=fixture();try {
    replace(f);
    assert.equal(f.league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=999').get().PlayerName,'Newcomer');
    assert.equal(f.league.prepare('SELECT PlayerId FROM TeamRosterPlayers WHERE TeamSubmissionId=21 AND Slot=0').get().PlayerId,999);
    assert.equal(f.league.prepare('SELECT PlayerId FROM SeasonTeamPlayers WHERE TeamSubmissionId=21 AND Slot=0').get().PlayerId,210);
    assert.equal(f.league.prepare('SELECT EffectiveToUtc FROM TeamRosterMembershipHistory WHERE TeamSubmissionId=21 AND PlayerId=210').get().EffectiveToUtc,effectiveAtUtc);
    assert.equal(f.league.prepare('SELECT EffectiveFromUtc FROM TeamRosterMembershipHistory WHERE TeamSubmissionId=21 AND PlayerId=999').get().EffectiveFromUtc,effectiveAtUtc);
    assert.equal(f.league.prepare('SELECT COUNT(*) n FROM TeamRosterPlayers WHERE TeamSubmissionId=21').get().n,5);
    assert.equal(new TeamRosterStore(f.league).forSubmission(21).players.find(p=>p.PlayerId===999).PlayerName,'Newcomer');
    assert.equal(f.refreshes(),1);assert.equal(f.audit.at(-1)[0],'Roster Changed');
  }finally{f.close();}
});

test('new roster accounts work without a name, new additions work, and existing names are preserved',()=>{
  const f=fixture();try {
    replace(f,{replacementPlayerName:''});
    assert.equal(f.league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=999').get().PlayerName,'Player 999');
    f.schedules.changeRoster(2,{playerId:220,fromTeamKey:22,effectiveAtUtc,reason:'Vacancy'},'99',now);
    f.schedules.changeRoster(2,{playerId:888,toTeamKey:22,slot:0,playerName:'Brand new',effectiveAtUtc,reason:'New player'},'99',now);
    assert.equal(f.league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=888').get().PlayerName,'Brand new');
    f.league.exec("INSERT INTO PlayerInfo(PlayerId,PlayerName) VALUES(777,'Existing name')");
    replace(f,{playerId:999,replacementPlayerId:777,replacementPlayerName:'Do not rename',effectiveAtUtc:'2026-10-15T01:00:00.000Z'});
    assert.equal(f.league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=777').get().PlayerName,'Existing name');
  }finally{f.close();}
});

test('failed replacements roll back player creation and roster changes and still reject occupied players and slots',()=>{
  const f=fixture();try {
    const before=f.league.prepare('SELECT * FROM TeamRosterPlayers ORDER BY TeamSubmissionId,Slot').all();
    for(const body of [{replacementPlayerId:220},{replacementPlayerId:'bad'},{replacementPlayerId:210},
      {replacementPlayerName:'x'.repeat(41)},{toTeamKey:22,slot:0}]) {
      assert.throws(()=>replace(f,body));
      assert.deepEqual(f.league.prepare('SELECT * FROM TeamRosterPlayers ORDER BY TeamSubmissionId,Slot').all(),before);
      assert.equal(f.league.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId=999').get(),undefined);
    }
    f.schedules.audit=()=>{throw Error('Audit failure');};
    assert.throws(()=>replace(f),/Audit failure/);
    assert.equal(f.league.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId=999').get(),undefined);
    assert.equal(f.league.prepare('SELECT COUNT(*) n FROM SeasonRosterChanges').get().n,0);
    assert.deepEqual(f.league.prepare('SELECT * FROM TeamRosterPlayers ORDER BY TeamSubmissionId,Slot').all(),before);
  }finally{f.close();}
});

test('changing the captain updates public metadata without changing players, betting setup, history or pricing',()=>{
  const f=fixture();try {
    const before={setup:f.schedules.setup(2),roster:f.league.prepare('SELECT * FROM TeamRosterPlayers').all(),
      history:f.league.prepare('SELECT * FROM TeamRosterMembershipHistory').all()};
    const saved=f.schedules.changeCaptain(2,{teamKey:21,captainId:211,expectedCaptainId:210},'99',now);
    assert.equal(saved.captainId,211);
    assert.equal(new TeamRosterStore(f.league).forSubmission(21).CaptainId,211);
    assert.equal(new TeamRosterStore(f.league).forSubmission(21).CaptainName,'Player 211');
    assert.deepEqual(f.schedules.setup(2),before.setup);
    assert.deepEqual(f.league.prepare('SELECT * FROM TeamRosterPlayers').all(),before.roster);
    assert.deepEqual(f.league.prepare('SELECT * FROM TeamRosterMembershipHistory').all(),before.history);
    assert.equal(f.league.prepare('SELECT COUNT(*) n FROM SeasonRosterChanges').get().n,0);
    assert.equal(f.refreshes(),0);assert.equal(f.audit.at(-1)[0],'Team Captain Changed');
    assert.equal(f.schedules.teamCaptains(2).find(t=>t.teamKey===21).captainId,211);
    const count=f.audit.length;
    f.schedules.changeCaptain(2,{teamKey:21,captainId:211,expectedCaptainId:211},'99',now);
    assert.equal(f.audit.length,count);
  }finally{f.close();}
});

test('captains must be confirmed current teammates and stale or ended-season edits cannot overwrite the saved captain',()=>{
  const f=fixture();try {
    const change=body=>f.schedules.changeCaptain(2,{teamKey:21,captainId:211,expectedCaptainId:210,...body},'99',now);
    for(const body of [{captainId:220},{teamKey:11},{captainId:999},{expectedCaptainId:undefined}])assert.throws(()=>change(body));
    f.league.prepare('INSERT INTO SeasonPendingRosterSlots(TeamSubmissionId,Slot,EstimatedMMR,CreatedAtUtc,UpdatedAtUtc) VALUES(21,1,6000,?,?)')
      .run(now.toISOString(),now.toISOString());
    assert.throws(()=>change({}),/confirmed/);
    f.league.exec('DELETE FROM SeasonPendingRosterSlots');
    change({});assert.throws(()=>change({captainId:212}),/captain changed/i);
    f.league.exec("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=2");
    assert.throws(()=>change({captainId:212,expectedCaptainId:211}),/current season/);
    assert.equal(f.league.prepare('SELECT CaptainId FROM SeasonTeams WHERE TeamSubmissionId=21').get().CaptainId,211);
  }finally{f.close();}
});

test('roster API exposes current captains, accepts a new replacement, and saves captain metadata without queuing pricing',async()=>{
  const f=fixture();let server;
  try {
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'76561197960265827'};req.isAuthenticated=()=>true;next();});
    app.use('/rosters',createAdminRosterRouter({league:f.league,schedules:f.schedules}));
    server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
    const base=`http://127.0.0.1:${server.address().port}/rosters`;
    const status=await(await fetch(base+'/status?seasonId=2')).json();
    assert.equal(status.captains.find(t=>t.teamKey===21).captainId,210);
    const response=await fetch(base+'/seasons/2/roster-changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      playerId:210,fromTeamKey:21,replacementPlayerId:999,replacementPlayerName:'New player',effectiveAtUtc,reason:'Replacement'})});
    assert.equal(response.status,200);
    const put=body=>fetch(base+'/seasons/2/captain',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await put({teamKey:21,captainId:999,expectedCaptainId:210})).status,200);
    assert.equal((await put({teamKey:21,captainId:211,expectedCaptainId:210})).status,409);
    const updated=await(await fetch(base+'/status?seasonId=2')).json();
    assert.equal(updated.captains.find(t=>t.teamKey===21).captainName,'New player');
    let continued=false;
    mutationRefresh({method:'PUT',path:'/rosters/seasons/2/captain'},{once:()=>{throw Error('Captain metadata must not trigger pricing');}},()=>{continued=true;});
    assert.equal(continued,true);
  }finally{if(server)await new Promise(done=>server.close(done));f.close();}
});
