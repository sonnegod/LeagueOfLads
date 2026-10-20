import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import SeasonStore from '../config/seasonStore.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {currentPendingSlots} from '../config/pendingRosterSlots.js';
import {getLeagueRegisteredTeams} from '../config/leagueParticipants.js';
import {groupTeamKey,leagueGroupBoardRevision,saveLeagueGroupBoard} from '../config/leagueGroupBoard.js';

const roster=(name,first)=>({teamName:name,captainSlot:0,players:Array.from({length:5},(_,slot)=>({
  playerId:first+slot,playerName:`Player ${first+slot}`,mmr:6500,
}))});
const signupTables=['SeasonTeams','SeasonTeamPlayers','TeamRosterPlayers','TeamRosterPeriods','SignupMMRs',
  'SeasonPendingRosterSlots','TeamRosterMembershipHistory'];

function fixture() {
  const db=new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql',import.meta.url),'utf8'));
  const audits=[],store=new SeasonStore(db,(...entry)=>audits.push(entry));
  const season=store.create('Removal season');
  store.saveSignup(season.SeasonId,'Signups','Register');
  store.setSignupStatus(season.SeasonId,true);store.setSignupStatus(season.SeasonId,false);
  const group=store.addGroup(season.SeasonId,'A');
  const teams=['Alpha','Beta','Removed team'].map((name,index)=>store.addRosterTeam(season.SeasonId,roster(name,1+index*5)));
  for(const team of teams)store.assignTeam(season.SeasonId,team.TeamSubmissionId,group.GroupId);
  store.start(season.SeasonId,12345);
  const schedules=new ScheduleStore(db);
  const readBoard=()=>{
    const registered=getLeagueRegisteredTeams(db,12345);
    const groups=db.prepare('SELECT * FROM GroupNames WHERE LeagueId=12345 ORDER BY GroupId').all()
      .map(g=>({...g,teams:registered.filter(t=>t.GroupId===g.GroupId)}));
    const board={league:{LeagueId:12345,LeagueName:'Removal season'},groups,availableTeams:[],unregisteredTeams:store.unregisteredTeams(12345)};
    return {...board,revision:leagueGroupBoardRevision(board)};
  };
  const draft=()=>{
    const board=readBoard();
    return {leagueId:12345,revision:board.revision,groups:board.groups.map(g=>({id:g.GroupId,name:g.GroupName})),
      teams:[...board.groups.flatMap(g=>g.teams.map(t=>({key:groupTeamKey(t),name:t.TeamName,teamId:t.TeamId,groupId:g.GroupId}))),
        ...board.unregisteredTeams.map(t=>({key:`submission:${t.TeamSubmissionId}`,name:t.TeamName,teamId:t.TeamId,groupId:null}))]};
  };
  const markPending=team=>{
    db.prepare('DELETE FROM TeamRosterPlayers WHERE TeamSubmissionId=? AND Slot=4').run(team.TeamSubmissionId);
    db.prepare(`INSERT INTO SeasonPendingRosterSlots(TeamSubmissionId,Slot,EstimatedMMR,CreatedAtUtc,UpdatedAtUtc)
      VALUES(?,4,6500,'2026-10-18T12:00:00Z','2026-10-18T12:00:00Z')`).run(team.TeamSubmissionId);
  };
  const scheduleRemoved=()=>schedules.save(season.SeasonId,{team1Key:teams[0].TeamSubmissionId,team2Key:teams[2].TeamSubmissionId,
    stage:'regular',bestOf:2,scheduledStartUtc:new Date(Date.now()+7*86400000).toISOString()});
  return {db,store,season,teams,schedules,readBoard,draft,markPending,audits,
    scheduleRemoved,options:{readBoard,rebuild:()=>{},audit:(...entry)=>audits.push(entry)},close:()=>db.close()};
}

test('group removal deletes the signup and its TBD slot, then betting finalizes with the remaining rosters',()=>{
  const f=fixture();try {
    const removed=f.teams[2],remaining=f.teams[1];
    f.markPending(removed);f.markPending(remaining);
    f.store.schedule.saveSettings(f.season.SeasonId,{startDate:'2026-10-26',seriesPerWindow:3,weeksPerWindow:2});
    f.store.schedule.generate(f.season.SeasonId);
    const input=f.draft(),entry=f.db.prepare('SELECT EntryId FROM LeagueRosterEntries WHERE TeamSubmissionId=?').get(removed.TeamSubmissionId);
    input.teams=input.teams.filter(t=>t.key!==`entry:${entry.EntryId}`);
    saveLeagueGroupBoard(f.db,input,f.options);
    assert.equal(f.store.getTeam(removed.TeamSubmissionId),null);
    for(const table of signupTables)assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE TeamSubmissionId=?`).get(removed.TeamSubmissionId).n,0,table);
    assert.equal(f.store.teams(f.season.SeasonId).length,2);
    assert.equal(f.schedules.teams(f.season.SeasonId).length,2);
    assert.deepEqual(currentPendingSlots(f.db,f.season.SeasonId).map(p=>p.TeamSubmissionId),[remaining.TeamSubmissionId]);
    const setup=JSON.parse(f.schedules.finalizeSetup(f.season.SeasonId,6).SetupJson);
    assert.equal(setup.teams.length,2);assert.equal(setup.roster.length,9);assert.equal(setup.pendingSlots.length,1);
    assert.equal(setup.roster.some(p=>p.TeamSubmissionId===removed.TeamSubmissionId),false);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM PlayerInfo').get().n,15,'player identities remain available');
    assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  }finally{f.close();}
});

test('unregistered teams can be deleted from the group draft without blocking betting setup',()=>{
  const f=fixture();try {
    const late=f.store.addRosterTeam(f.season.SeasonId,roster('Late team',16));f.markPending(late);
    assert.throws(()=>f.schedules.finalizeSetup(f.season.SeasonId,6),/Assign all teams/);
    const input=f.draft();input.teams=input.teams.filter(t=>t.key!==`submission:${late.TeamSubmissionId}`);
    saveLeagueGroupBoard(f.db,input,f.options);
    assert.equal(f.store.getTeam(late.TeamSubmissionId),null);
    assert.deepEqual(f.store.unregisteredTeams(12345),[]);
    assert.deepEqual(currentPendingSlots(f.db,f.season.SeasonId),[]);
    assert.doesNotThrow(()=>f.schedules.finalizeSetup(f.season.SeasonId,6));
  }finally{f.close();}
});

test('unassigned signups with a team ID can be removed through signup actions or the group draft',()=>{
  for(const action of ['signup','groups']) {
    const f=fixture();try {
      const team=f.store.addRosterTeam(f.season.SeasonId,roster('Unassigned signup with ID',16));f.markPending(team);
      f.db.prepare('INSERT INTO TeamInfo(TeamId,TeamName) VALUES(7777,?)').run('Existing Dota team');
      f.db.prepare('UPDATE SeasonTeams SET ExternalTeamId=7777 WHERE TeamSubmissionId=?').run(team.TeamSubmissionId);
      assert.ok(f.store.unregisteredTeams(12345).some(t=>t.TeamSubmissionId===team.TeamSubmissionId&&t.TeamId===7777));
      if(action==='signup')f.store.removeTeam(f.season.SeasonId,team.TeamSubmissionId);
      else {
        const input=f.draft();input.teams=input.teams.filter(t=>t.key!==`submission:${team.TeamSubmissionId}`);
        saveLeagueGroupBoard(f.db,input,f.options);
      }
      assert.equal(f.store.getTeam(team.TeamSubmissionId),null,action);
      assert.deepEqual(currentPendingSlots(f.db,f.season.SeasonId),[]);
      assert.equal(f.db.prepare('SELECT TeamName FROM TeamInfo WHERE TeamId=7777').get().TeamName,'Existing Dota team');
      assert.doesNotThrow(()=>f.schedules.finalizeSetup(f.season.SeasonId,6));
      assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
    }finally{f.close();}
  }
});

test('removing an unassigned signup with a team ID preserves recorded matches',()=>{
  const f=fixture();try {
    const team=f.store.addRosterTeam(f.season.SeasonId,roster('Already played',16));
    f.db.prepare('UPDATE SeasonTeams SET ExternalTeamId=7777 WHERE TeamSubmissionId=?').run(team.TeamSubmissionId);
    f.db.exec(`INSERT INTO MatchTeam(MatchId,TeamRad,TeamDire,WinnerId,SeriesId) VALUES(1,7777,8888,7777,0);
      INSERT INTO MatchLeague(MatchId,LeagueId) VALUES(1,12345)`);
    assert.throws(()=>f.store.removeTeam(f.season.SeasonId,team.TeamSubmissionId),/played matches|recorded fixtures/);
    assert.ok(f.store.getTeam(team.TeamSubmissionId));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,1);
  }finally{f.close();}
});

test('signup removal deletes assigned and unassigned teams without team IDs after league start',()=>{
  const f=fixture();try {
    const assigned=f.teams[2];f.markPending(assigned);
    const unregistered=f.store.addRosterTeam(f.season.SeasonId,roster('Unassigned signup',16));f.markPending(unregistered);
    for(const team of [assigned,unregistered]) {
      assert.equal(f.store.removeTeam(f.season.SeasonId,team.TeamSubmissionId).TeamSubmissionId,team.TeamSubmissionId);
      assert.equal(f.store.getTeam(team.TeamSubmissionId),null);
      for(const table of signupTables)assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE TeamSubmissionId=?`).get(team.TeamSubmissionId).n,0,table);
    }
    assert.equal(f.store.teams(f.season.SeasonId).length,2);
    assert.deepEqual(f.store.unregisteredTeams(12345),[]);
    assert.deepEqual(currentPendingSlots(f.db,f.season.SeasonId),[]);
    assert.doesNotThrow(()=>f.schedules.finalizeSetup(f.season.SeasonId,6));
    assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  }finally{f.close();}
});

test('signup removal rejects linked teams and completed seasons without deleting their data',()=>{
  const f=fixture();try {
    const team=f.teams[2];
    f.db.prepare('UPDATE SeasonTeams SET ExternalTeamId=999 WHERE TeamSubmissionId=?').run(team.TeamSubmissionId);
    assert.throws(()=>f.store.removeTeam(f.season.SeasonId,team.TeamSubmissionId),/played matches|recorded fixtures/);
    f.db.prepare('UPDATE SeasonTeams SET ExternalTeamId=NULL WHERE TeamSubmissionId=?').run(team.TeamSubmissionId);
    assert.throws(()=>f.store.removeTeam(f.season.SeasonId+1,team.TeamSubmissionId),{status:404});
    f.db.prepare("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=?").run(f.season.SeasonId);
    assert.throws(()=>f.store.removeTeam(f.season.SeasonId,team.TeamSubmissionId),{status:409});
    assert.equal(f.store.getTeam(team.TeamSubmissionId).players.length,5);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM LeagueRosterEntries WHERE TeamSubmissionId=?').get(team.TeamSubmissionId).n,1);
  }finally{f.close();}
});

test('a failed group save restores the deleted signup, roster, pending slots and matchup suggestions',()=>{
  const f=fixture();try {
    const removed=f.teams[2];f.markPending(removed);f.scheduleRemoved();
    f.store.schedule.saveSettings(f.season.SeasonId,{startDate:'2026-10-26',seriesPerWindow:3,weeksPerWindow:2});
    f.store.schedule.generate(f.season.SeasonId);
    const tables=[...signupTables,'LeagueRosterEntries','SeasonMatchups','ScheduledEvents','ScheduleEventRevisions'];
    const snapshot=()=>JSON.stringify(tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all()));
    const before=snapshot(),input=f.draft(),entry=f.db.prepare('SELECT EntryId FROM LeagueRosterEntries WHERE TeamSubmissionId=?').get(removed.TeamSubmissionId);
    input.teams=input.teams.filter(t=>t.key!==`entry:${entry.EntryId}`);
    assert.throws(()=>saveLeagueGroupBoard(f.db,input,{...f.options,audit:()=>{throw Error('Audit failure');}}),/Audit failure/);
    assert.equal(snapshot(),before);
    assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  }finally{f.close();}
});

test('team deletion cancels its unplayed fixtures and preserves their revision history',()=>{
  const f=fixture();try {
    const event=f.scheduleRemoved(),input=f.draft();
    const entry=f.db.prepare('SELECT EntryId FROM LeagueRosterEntries WHERE TeamSubmissionId=?').get(f.teams[2].TeamSubmissionId);
    input.teams=input.teams.filter(t=>t.key!==`entry:${entry.EntryId}`);
    saveLeagueGroupBoard(f.db,input,f.options);
    const cancelled=f.schedules.get(event.EventId);
    assert.equal(cancelled.Status,'cancelled');assert.equal(cancelled.Revision,event.Revision+1);
    const revisions=f.db.prepare('SELECT * FROM ScheduleEventRevisions WHERE EventId=? ORDER BY Revision').all(event.EventId);
    assert.equal(revisions.length,2);assert.equal(revisions[1].Reason,'team_removed');
    assert.equal(JSON.parse(revisions[1].SnapshotJson).Status,'cancelled');
  }finally{f.close();}
});

test('recorded fixtures protect a team from deletion and from automatic leftover cleanup',()=>{
  const f=fixture();try {
    const event=f.scheduleRemoved();
    f.db.prepare("UPDATE ScheduledEvents SET Status='completed',StartedAtUtc=? WHERE EventId=?").run(new Date().toISOString(),event.EventId);
    const before=f.readBoard().revision,input=f.draft();
    const entry=f.db.prepare('SELECT EntryId FROM LeagueRosterEntries WHERE TeamSubmissionId=?').get(f.teams[2].TeamSubmissionId);
    input.teams=input.teams.filter(t=>t.key!==`entry:${entry.EntryId}`);
    assert.throws(()=>saveLeagueGroupBoard(f.db,input,f.options),/recorded fixtures/);
    assert.equal(f.readBoard().revision,before);
    f.db.prepare('DELETE FROM LeagueRosterEntries WHERE EntryId=?').run(entry.EntryId);
    new SeasonStore(f.db);
    assert.ok(f.store.getTeam(f.teams[2].TeamSubmissionId));
    assert.equal(f.schedules.get(event.EventId).Status,'completed');
  }finally{f.close();}
});

test('leftover cleanup preserves linked teams and completed-season signups',()=>{
  for(const kind of ['linked','ended']) {
    const f=fixture();try {
      const removed=f.teams[2];
      f.db.prepare('DELETE FROM LeagueRosterEntries WHERE TeamSubmissionId=?').run(removed.TeamSubmissionId);
      if(kind==='linked')f.db.prepare('UPDATE SeasonTeams SET ExternalTeamId=999 WHERE TeamSubmissionId=?').run(removed.TeamSubmissionId);
      else f.db.prepare("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=?").run(f.season.SeasonId);
      new SeasonStore(f.db);
      assert.ok(f.store.getTeam(removed.TeamSubmissionId),kind);
    }finally{f.close();}
  }
});

test('startup repairs signup leftovers from old group removals while preserving genuinely unassigned teams',()=>{
  const f=fixture();try {
    const removed=f.teams[2];f.markPending(removed);
    const late=f.store.addRosterTeam(f.season.SeasonId,roster('Awaiting assignment',16));
    f.db.prepare('DELETE FROM LeagueRosterEntries WHERE TeamSubmissionId=?').run(removed.TeamSubmissionId);
    assert.throws(()=>f.schedules.finalizeSetup(f.season.SeasonId,6),/Assign all teams/);
    new SeasonStore(f.db,(...entry)=>f.audits.push(entry));
    assert.equal(f.store.getTeam(removed.TeamSubmissionId),null);
    assert.equal(f.store.getTeam(late.TeamSubmissionId).GroupId,null);
    assert.deepEqual(currentPendingSlots(f.db,f.season.SeasonId),[]);
    assert.deepEqual(f.store.unregisteredTeams(12345).map(t=>t.TeamSubmissionId),[late.TeamSubmissionId]);
    const input=f.draft();input.teams=input.teams.filter(t=>t.key!==`submission:${late.TeamSubmissionId}`);
    saveLeagueGroupBoard(f.db,input,f.options);
    assert.doesNotThrow(()=>f.schedules.finalizeSetup(f.season.SeasonId,6));
    new SeasonStore(f.db);
    assert.equal(f.store.teams(f.season.SeasonId).length,2,'repair remains idempotent');
  }finally{f.close();}
});
