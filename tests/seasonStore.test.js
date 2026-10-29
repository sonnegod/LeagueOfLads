import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import AdjustedPlayersStore from '../config/adjustedPlayersStore.js';
import SeasonStore from '../config/seasonStore.js';
import PlayerAwardsStore from '../config/playerAwards.js';
import { CHAMPIONSHIP_ROSTER_PLAYERS_SQL } from '../config/championshipRoster.js';
import { ScheduleStore } from '../betting/scheduleStore.js';
import { currentSeasonRoster } from '../betting/rosterMembership.js';

const screenshot = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;

const rosterInput = (name, first=1) => ({teamName:name,captainSlot:2,players:Array.from({length:5},(_,i)=>({
  playerId:first+i,playerName:`Player ${first+i}`,mmr:6000+i*100,
}))});

test('admins create complete teams after signup with optional images, frozen MMRs, and unassigned active roster history',()=>{
  const db=database();try {
    const audit=[],store=new SeasonStore(db,(...entry)=>audit.push(entry)),season=store.create('Late teams');
    store.saveSignup(season.SeasonId,'Signup','Register');store.setSignupStatus(season.SeasonId,true);
    assert.throws(()=>store.addRosterTeam(season.SeasonId,rosterInput('Too early')),/after signups close/);
    assert.throws(()=>store.saveTeam(season.SeasonId,1,rosterInput('Public still needs images')),/profile URL|screenshot/);
    store.setSignupStatus(season.SeasonId,false);
    db.exec("INSERT INTO PlayerInfo VALUES(1,'Existing name'); INSERT INTO AdjustedPlayers(PlayerId,AdjustedMMR,CreatedAt,UpdatedAt) VALUES(1,6900,'2026-01-01','2026-01-01')");
    const first=store.addRosterTeam(season.SeasonId,rosterInput('First team'));
    assert.equal(first.GroupId,null);assert.equal(first.CaptainId,3);assert.equal(first.IsManual,0);
    assert.equal(first.players[0].PlayerName,'Existing name');assert.equal(first.players[0].MMR,6900);
    assert.equal(first.players[0].DotaProfileUrl,'https://www.dotabuff.com/esports/players/1');
    assert.ok(first.players.every(p=>p.HasScreenshot===0));assert.equal(store.screenshot(first.TeamSubmissionId,1),null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SignupMMRs').get().n,0);
    const group=store.addGroup(season.SeasonId,'A');store.assignTeam(season.SeasonId,first.TeamSubmissionId,group.GroupId);
    store.start(season.SeasonId,12345);
    new ScheduleStore(db);
    const before=JSON.stringify(store.rosters.forSubmission(first.TeamSubmissionId));
    const input=rosterInput('Late team',6);input.players[0].screenshot=screenshot;
    const late=store.addRosterTeam(season.SeasonId,input);
    assert.equal(late.GroupId,null);assert.equal(late.ExternalTeamId,null);
    assert.equal(late.players[0].HasScreenshot,1);assert.equal(late.players[1].HasScreenshot,0);
    assert.equal(store.screenshot(late.TeamSubmissionId,6).ScreenshotMime,'image/png');
    assert.equal(store.rosters.forSubmission(late.TeamSubmissionId).players.length,5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SignupMMRs WHERE TeamSubmissionId=?').get(late.TeamSubmissionId).n,5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM TeamRosterMembershipHistory WHERE TeamSubmissionId=?').get(late.TeamSubmissionId).n,5);
    assert.deepEqual(store.unregisteredTeams(12345).map(t=>t.TeamSubmissionId),[late.TeamSubmissionId]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM LeagueRosterEntries WHERE TeamSubmissionId=?').get(late.TeamSubmissionId).n,0);
    assert.equal(JSON.stringify(store.rosters.forSubmission(first.TeamSubmissionId)),before);
    assert.equal(currentSeasonRoster(db,season.SeasonId,'active').length,10);
    new SeasonStore(db);assert.equal(store.rosters.forSubmission(late.TeamSubmissionId).players.length,5);
    assert.equal(audit.filter(([type])=>type==='Roster Team Added').length,2);
  }finally{db.close();}
});

test('invalid admin teams and failed audits roll back player, roster and team writes',()=>{
  const db=database();try {
    const store=new SeasonStore(db),season=store.create('Validation');
    store.saveSignup(season.SeasonId,'Signup','Register');store.setSignupStatus(season.SeasonId,true);store.setSignupStatus(season.SeasonId,false);
    for(const mutate of [i=>{i.players.pop();},i=>{i.players[4].playerId=1;},i=>{i.players[4].mmr=5500;},
      i=>{i.players[4].playerName='';},i=>{i.captainSlot=6;},i=>{i.players[4].screenshot='data:image/png;base64,YmFk';}]) {
      const input=rosterInput('Invalid');mutate(input);assert.throws(()=>store.addRosterTeam(season.SeasonId,input));
      assert.equal(db.prepare('SELECT COUNT(*) n FROM PlayerInfo').get().n,0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM SeasonTeams').get().n,0);
    }
    store.audit=()=>{throw Error('Audit failure');};assert.throws(()=>store.addRosterTeam(season.SeasonId,rosterInput('Rollback')),/Audit failure/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SeasonTeamPlayers').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM PlayerInfo').get().n,0);
    store.audit=()=>{};store.addRosterTeam(season.SeasonId,rosterInput('Existing'));
    assert.throws(()=>store.addRosterTeam(season.SeasonId,rosterInput('EXISTING',6)),/already exists/);
  }finally{db.close();}
});

for (const confirmBeforeStart of [false,true]) test(`TBD confirmation ${confirmBeforeStart?'before':'after'} league start preserves original submissions and freezes actual player MMR`,()=>{
  const db=database();try {
    const store=new SeasonStore(db),season=store.create('Pending roster season');
    store.saveSignup(season.SeasonId,'Signups','Register your team');store.setSignupStatus(season.SeasonId,true);
    const submit=(name,first)=>store.saveTeam(season.SeasonId,first,{teamName:name,players:Array.from({length:5},(_,i)=>({
      playerId:first+i,playerName:`Player ${first+i}`,mmr:6000,dotaProfileUrl:`https://www.dotabuff.com/players/${first+i}`,screenshot,
    }))});
    const a=submit('A',1),b=submit('B',6);
    store.setSignupStatus(season.SeasonId,false);
    db.prepare('UPDATE SeasonTeamPlayers SET PlayerId=1 WHERE TeamSubmissionId=? AND Slot=0').run(b.TeamSubmissionId);
    const schedules=new ScheduleStore(db),at=new Date(Date.now()-1000);
    schedules.setPendingSlot(season.SeasonId,{teamKey:b.TeamSubmissionId,slot:0,estimatedMMR:7000,expectedPlayerId:1},'50',at);
    assert.equal(store.teams(season.SeasonId).find(t=>t.TeamSubmissionId===b.TeamSubmissionId).AverageMMR,6200);
    const boardPlayers=store.groupTeamPlayers(season.SeasonId,b.TeamSubmissionId);
    assert.equal(boardPlayers.length,5);
    assert.deepEqual(boardPlayers[0],{PlayerId:null,PlayerName:'Player TBD',Slot:0,MMR:7000,Pending:true});
    assert.equal(boardPlayers.some(p=>p.PlayerId===1),false,'group cards do not show the old placeholder identity');
    db.exec("INSERT INTO PlayerInfo VALUES(11,'Actual fifth player')");
    if(confirmBeforeStart)schedules.confirmPendingSlot(season.SeasonId,{teamKey:b.TeamSubmissionId,slot:0,playerId:11,mmr:6900},'50',new Date(at.getTime()+500));
    if(confirmBeforeStart)assert.deepEqual(store.groupTeamPlayers(season.SeasonId,b.TeamSubmissionId)[0],
      {PlayerId:11,PlayerName:'Actual fifth player',Slot:0,MMR:6900,Pending:false});
    store.addGroup(season.SeasonId,'A');store.randomize(season.SeasonId);
    store.start(season.SeasonId,12345);
    assert.equal(store.rosters.forSubmission(b.TeamSubmissionId).players.length,confirmBeforeStart?5:4);
    assert.deepEqual(store.rosters.forSubmission(b.TeamSubmissionId).pendingSlots,confirmBeforeStart?[]:[{Slot:0}]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SignupMMRs').get().n,confirmBeforeStart?10:9);
    assert.equal(db.prepare('SELECT PlayerId FROM SeasonTeamPlayers WHERE TeamSubmissionId=? AND Slot=0').get(b.TeamSubmissionId).PlayerId,1);
    const later=new Date(Date.now()+1000); // SeasonStore's effective start uses the real clock.
    if(!confirmBeforeStart)schedules.confirmPendingSlot(season.SeasonId,{teamKey:b.TeamSubmissionId,slot:0,playerId:11,mmr:6900},'50',later);
    assert.equal(store.rosters.forSubmission(b.TeamSubmissionId).players.length,5);
    assert.equal(db.prepare('SELECT SignupMMR FROM SignupMMRs WHERE TeamSubmissionId=? AND PlayerId=11').get(b.TeamSubmissionId).SignupMMR,6900);
    assert.equal(currentSeasonRoster(db,season.SeasonId,'active').filter(p=>p.PlayerId===1).length,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM SeasonRosterChanges').get().n,0);
    assert.ok(store.rosters.forSubmission(a.TeamSubmissionId).players.some(p=>p.PlayerId===1));
  }finally{db.close();}
});

test('compact group rosters return only player names and signup MMRs within the requested season',()=>{
  const db=database();try {
    const store=new SeasonStore(db),season=store.create('Group board season');
    store.saveSignup(season.SeasonId,'Signups','Register your team');store.setSignupStatus(season.SeasonId,true);
    const team=store.saveTeam(season.SeasonId,1,{teamName:'Team A',players:Array.from({length:5},(_,i)=>({
      playerId:i+1,playerName:`Player ${i+1}`,mmr:6000+i*100,dotaProfileUrl:`https://www.dotabuff.com/players/${i+1}`,screenshot,
    }))});
    store.setSignupStatus(season.SeasonId,false);
    const players=store.groupTeamPlayers(season.SeasonId,team.TeamSubmissionId);
    assert.deepEqual(players.map(p=>p.MMR),[6000,6100,6200,6300,6400]);
    assert.deepEqual(Object.keys(players[0]).sort(),['MMR','Pending','PlayerId','PlayerName','Slot']);
    db.prepare('UPDATE PlayerInfo SET PlayerName=? WHERE PlayerId=1').run('Updated name');
    assert.equal(store.groupTeamPlayers(season.SeasonId,team.TeamSubmissionId)[0].PlayerName,'Updated name');
    assert.throws(()=>store.groupTeamPlayers(season.SeasonId+1,team.TeamSubmissionId),/unavailable/);
    assert.throws(()=>store.groupTeamPlayers(season.SeasonId,999999),/unavailable/);
    const manual=store.addManualTeam(season.SeasonId,'Manual team',6500);
    assert.deepEqual(store.groupTeamPlayers(season.SeasonId,manual.TeamSubmissionId),[]);
    db.prepare("UPDATE LeagueSeasons SET Status='ended' WHERE SeasonId=?").run(season.SeasonId);
    assert.throws(()=>store.groupTeamPlayers(season.SeasonId,team.TeamSubmissionId),/unavailable/);
  }finally{db.close();}
});

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName STRING (40) NOT NULL);
    CREATE TABLE LeagueInfo (LeagueId INTEGER PRIMARY KEY, LeagueName TEXT NOT NULL, Active INTEGER NOT NULL);
    CREATE TABLE GroupNames (LeagueId INTEGER, GroupId INTEGER, GroupName TEXT, UNIQUE(LeagueId, GroupId));
    CREATE TABLE LeagueRules (LeagueId INTEGER PRIMARY KEY, UpperBracketTeams INTEGER, LowerBracketTeams INTEGER,
      EliminatedTeams INTEGER, HasTiebreaker INTEGER, TiebreakerPosition INTEGER);
    CREATE TABLE LeagueRosterEntries (EntryId INTEGER PRIMARY KEY AUTOINCREMENT, LeagueId INTEGER,
      GroupId INTEGER, DisplayName TEXT, SortOrder INTEGER, TeamId INTEGER, TeamSubmissionId INTEGER);
    CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
    CREATE TABLE MatchLeague (MatchId INTEGER PRIMARY KEY, LeagueId INTEGER, DatePlayed TEXT);
    CREATE TABLE TeamInfo (TeamId INTEGER PRIMARY KEY, TeamName TEXT);
    CREATE TABLE HeroInfo (HeroId INTEGER PRIMARY KEY, HeroName STRING (40));
    CREATE TABLE LeagueTeamNames (LeagueId INTEGER, TeamId INTEGER, DisplayName TEXT);
    CREATE TABLE LeagueStageBoundaries (LeagueId INTEGER PRIMARY KEY, GroupEndMatchId INTEGER, TieBreakerEndMatchId INTEGER);
    CREATE TABLE SeriesInfo (SeriesId INTEGER PRIMARY KEY, Team1 INTEGER, Team2 INTEGER);
    CREATE TABLE SeriesMatch (SeriesId INTEGER, MatchId INTEGER);
    CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, HeroId INTEGER,
      Kills INTEGER, Deaths INTEGER, Assists INTEGER, Healing INTEGER, TowerDamage INTEGER,
      GPM INTEGER, Lasthits INTEGER, HeroDamage INTEGER);
    CREATE TABLE MatchTeamPlayer (MatchId INTEGER, PlayerId INTEGER, TeamId INTEGER);`);
  new AdjustedPlayersStore(db);
  return db;
}

test('season signup, group assignment, MMR snapshot, and champion follow the lifecycle', () => {
  const db = database();
  try {
    const audit = [];
    const store = new SeasonStore(db, (type, message) => audit.push([type, message]));
    const season = store.create('Lads Season');
    assert.throws(() => store.create('Second league'), { status: 409 });
    store.saveSignup(season.SeasonId, 'Season signup', 'Bring your team');
    store.setSignupStatus(season.SeasonId, true);
    assert.equal(store.publicHome().signup.teamCount, 0);
    db.prepare('INSERT INTO PlayerInfo (PlayerId, PlayerName) VALUES (?, ?)').run(1, 'Captain');
    db.prepare(`INSERT INTO AdjustedPlayers (PlayerId, AdjustedMMR, CreatedAt, UpdatedAt)
      VALUES (1, 7000, 'now', 'now')`).run();
    const players = Array.from({ length: 5 }, (_, index) => ({
      playerId: index + 1, playerName: index ? `Player ${index + 1}` : 'Captain',
      mmr: 6000, dotaProfileUrl: 'https://www.dotabuff.com/players/1', screenshot,
    }));
    const team = store.saveTeam(season.SeasonId, 1, { teamName: 'The Lads', players });
    assert.equal(store.publicHome().signup.teamCount, 1);
    assert.equal(store.teams(season.SeasonId, true)[0].CaptainName, 'Captain');
    assert.equal(team.players[0].MMR, 7000);
    assert.equal('ScreenshotData' in team.players[0], false);
    assert.equal(store.screenshot(team.TeamSubmissionId, 1).ScreenshotMime, 'image/png');
    assert.throws(() => store.saveTeam(season.SeasonId, 99, { teamName: 'Other', players }),
      { status: 400 });
    store.setSignupStatus(season.SeasonId, false);
    assert.equal(store.publicHome().signup, null);
    db.prepare('UPDATE AdjustedPlayers SET AdjustedMMR = 8000 WHERE PlayerId = 1').run();
    assert.equal(store.getTeam(team.TeamSubmissionId).players[0].MMR, 7000);
    const manual = store.addManualTeam(season.SeasonId, 'Manual', 6200);
    store.addGroup(season.SeasonId, 'A');
    store.addGroup(season.SeasonId, 'B');
    store.saveRules(season.SeasonId, { UpperBracketTeams: 1, LowerBracketTeams: 1,
      EliminatedTeams: 0, HasTiebreaker: false });
    const result = store.randomize(season.SeasonId);
    assert.deepEqual(result.groups.map(group => group.teams.length), [1, 1]);
    const boardTeams = store.teams(season.SeasonId);
    assert.deepEqual(store.groupSummary(season.SeasonId, boardTeams), store.groupSummary(season.SeasonId));
    const started = store.start(season.SeasonId, 12345);
    assert.equal(started.Status, 'active');
    const roster = store.rosters.forSubmission(team.TeamSubmissionId);
    assert.equal(roster.TeamId, null);
    assert.deepEqual(roster.players.map(player => player.PlayerId), [1, 2, 3, 4, 5]);
    assert.equal(roster.EffectiveFrom, started.UpdatedAt);
    assert.equal(roster.FromEstimated, 0);
    assert.equal(roster.EffectiveTo, null);
    assert.equal(store.teams(season.SeasonId, true).length, 2);
    assert.throws(() => store.saveTeam(season.SeasonId, null, { teamName: 'Changed', players }, true,
      team.TeamSubmissionId), { status: 409 });
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM SignupMMRs').get().Count, 5);
    assert.equal(db.prepare('SELECT SignupMMR FROM SignupMMRs WHERE PlayerId = 1').get().SignupMMR, 7000);
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM LeagueRosterEntries').get().Count, 2);
    assert.equal(db.prepare('SELECT UpperBracketTeams FROM LeagueRules WHERE LeagueId = 12345').get().UpperBracketTeams, 1);
    assert.throws(() => store.create('Another'), { status: 409 });
    db.exec(`INSERT INTO TeamInfo VALUES (111, 'The Lads'), (222, 'Manual');
      INSERT INTO MatchTeam VALUES (1, 111, 222, 111);
      INSERT INTO MatchTeam VALUES (2, 111, 222, 111);
      INSERT INTO MatchTeam VALUES (3, 222, 111, 111);
      INSERT INTO MatchLeague (MatchId, LeagueId) VALUES (1, 12345), (2, 12345), (3, 12345);
      INSERT INTO LeagueStageBoundaries VALUES (12345, 1, 1);
      INSERT INTO SeriesInfo VALUES (1, 111, 222);
      INSERT INTO SeriesMatch VALUES (1, 2), (1, 3);
      INSERT INTO HeroInfo VALUES (1, 'Axe'), (2, 'Crystal Maiden');
      INSERT INTO MatchPlayer (MatchId, PlayerId, HeroId, Kills, Deaths, Assists)
        VALUES (1, 1, 1, 4, 2, 8), (2, 1, 2, 6, 1, 11),
        (3, 1, 2, 3, 0, 9), (2, 2, 1, 2, 3, 12),
        (1, 3, 1, 1, 1, 14), (3, 3, 2, 2, 2, 10);
      UPDATE MatchPlayer SET Healing = 1200, GPM = 450 WHERE MatchId = 2 AND PlayerId = 1;
      UPDATE MatchPlayer SET TowerDamage = 2800, GPM = 500 WHERE MatchId = 3 AND PlayerId = 3;
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 111), (2, 1, 111), (3, 1, 111),
        (2, 2, 111), (1, 3, 111), (3, 3, 111);`);
    const ended = store.end(season.SeasonId, 111);
    assert.equal(ended.Status, 'ended');
    assert.deepEqual(store.championshipRoster(season.SeasonId, 111), { editable: false, source: 'signup' });
    assert.throws(() => store.correctChampion(season.SeasonId, 111, [1, 2, 3, 4, 5]), { status: 409 });
    assert.equal(store.rosters.forSubmission(team.TeamSubmissionId).EffectiveTo, ended.EndedAt);
    assert.equal(store.publicHome().champion.teamName, 'The Lads');
    assert.deepEqual(store.publicHome().champion.groupGames, { wins: 1, losses: 0 });
    assert.deepEqual(store.publicHome().champion.playoffGames, { wins: 2, losses: 0 });
    assert.deepEqual(store.publicHome().champion.playoffSeries, { wins: 1, losses: 0 });
    assert.deepEqual(store.publicHome().champion.players.map(player => player.playerId), [1, 3]);
    assert.deepEqual(store.publicHome().champion.players[0], {
      playerId: 1, playerName: 'Captain', games: 3, wins: 3, playoffWins: 2,
      signatureHero: { heroId: 2, heroName: 'Crystal Maiden', games: 2, wins: 2 },
      spotlight: { label: 'Keeping the team alive', value: 1200, unit: 'healing in one match',
        matchId: 2, stage: 'Playoffs', opponentName: 'Manual' },
    });
    assert.deepEqual(store.publicHome().champion.players[1].spotlight,
      { label: 'Siege work', value: 2800, unit: 'tower damage in one match',
        matchId: 3, stage: 'Playoffs', opponentName: 'Manual' });
    db.prepare('UPDATE LeagueStageBoundaries SET TieBreakerEndMatchId = NULL WHERE LeagueId = 12345').run();
    assert.equal(store.publicHome().champion.players[0].spotlight.stage, 'Playoffs');
    db.exec('UPDATE PlayerInfo SET PlayerName=0 WHERE PlayerId=1; UPDATE PlayerInfo SET PlayerName=12345 WHERE PlayerId=3;');
    assert.equal(store.publicHome().champion.players.find(p=>p.playerId===1).playerName,'0');
    assert.equal(store.publicHome().champion.players.find(p=>p.playerId===3).playerName,'12345');
    assert.ok(audit.some(([type]) => type === 'League Ended'));
    const nextSeason = store.create('Next Season');
    assert.equal(nextSeason.Status, 'draft');
    store.saveSignup(nextSeason.SeasonId, 'Next season signup', 'Bring your team');
    store.setSignupStatus(nextSeason.SeasonId, true);
    assert.equal(store.publicHome().signup.teamCount, 0, 'previous-season teams are not counted');
    assert.equal(manual.IsManual, 1);
  } finally { db.close(); }
});

test('signup uploads five players separately and publishes only a complete team', () => {
  const db = database();
  try {
    const store = new SeasonStore(db);
    const season = store.create('Draft upload season');
    store.saveSignup(season.SeasonId, 'Sign up', 'Five players');
    store.setSignupStatus(season.SeasonId, true);
    db.prepare('INSERT INTO PlayerInfo (PlayerId, PlayerName) VALUES (?, ?)').run(1, 'Captain');
    for (let playerId = 2; playerId <= 4; playerId++) {
      db.prepare('INSERT INTO PlayerInfo (PlayerId, PlayerName) VALUES (?, ?)')
        .run(playerId, `Existing ${playerId}`);
    }
    const draftId = store.startSignupDraft(season.SeasonId, 1);
    const player = playerId => ({ playerId, playerName: playerId === 5 ? 'New Player' : `Existing ${playerId}`,
      mmr: 6000, dotaProfileUrl: 'https://www.dotabuff.com/players/1', screenshot });
    store.saveSignupDraftPlayer(season.SeasonId, 1, draftId, 0, { ...player(1), playerName: '' });
    assert.equal(store.teams(season.SeasonId).length, 0);
    assert.equal(store.publicHome().signup.teamCount, 0, 'incomplete drafts do not count as submitted teams');
    assert.throws(() => store.submitSignupDraft(season.SeasonId, 1, draftId, 'The Team'),
      { status: 400 });
    assert.throws(() => store.saveSignupDraftPlayer(season.SeasonId, 2, draftId, 1, player(2)),
      { status: 404 });
    assert.throws(() => store.saveSignupDraftPlayer(season.SeasonId, 1, draftId, 1, player(1)),
      { status: 400 });
    for (let slot = 1; slot < 5; slot++) {
      store.saveSignupDraftPlayer(season.SeasonId, 1, draftId, slot, player(slot + 1));
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM PlayerInfo WHERE PlayerId = 5').get().Count, 0);
    assert.equal(store.teams(season.SeasonId).length, 0);
    const team = store.submitSignupDraft(season.SeasonId, 1, draftId, 'The Team');
    assert.equal(store.publicHome().signup.teamCount, 1);
    assert.equal(team.players.length, 5);
    assert.equal(db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId = 5').get().PlayerName, 'New Player');
    assert.equal(store.screenshot(team.TeamSubmissionId, 5).ScreenshotMime, 'image/png');
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM SeasonSignupDrafts').get().Count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM SeasonSignupDraftPlayers').get().Count, 0);
    store.removeTeam(season.SeasonId, team.TeamSubmissionId);
    assert.equal(store.publicHome().signup.teamCount, 0, 'removed submissions no longer count');
  } finally { db.close(); }
});

test('signup stores the actual image MIME type when screenshots have a different upload label', () => {
  const db = database();
  try {
    const store = new SeasonStore(db);
    const season = store.create('Image format season');
    store.saveSignup(season.SeasonId, 'Sign up', 'Five players');
    store.setSignupStatus(season.SeasonId, true);
    const draftId = store.startSignupDraft(season.SeasonId, 1);
    const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
    store.saveSignupDraftPlayer(season.SeasonId, 1, draftId, 0, {
      playerId: 1, playerName: 'Captain', mmr: 6000,
      dotaProfileUrl: 'https://www.dotabuff.com/players/1',
      screenshot: `data:image/webp;base64,${pngBytes.toString('base64')}`,
    });
    const saved = db.prepare('SELECT ScreenshotMime, ScreenshotData FROM SeasonSignupDraftPlayers WHERE DraftId = ?').get(draftId);
    assert.equal(saved.ScreenshotMime, 'image/png');
    assert.deepEqual(saved.ScreenshotData, pngBytes);
    const jpeg = store.decodeScreenshot(`data:image/webp;base64,${Buffer.from('ffd8ffe0', 'hex').toString('base64')}`);
    assert.equal(jpeg.ScreenshotMime, 'image/jpeg');
    const webp = Buffer.from('524946460400000057454250', 'hex');
    assert.equal(store.decodeScreenshot(`data:image/webp;base64,${webp.toString('base64')}`).ScreenshotMime, 'image/webp');
    for (const bytes of [Buffer.from('<html>not an image</html>'), Buffer.from('RIFF0000WAVE'), Buffer.from('ffd8', 'hex')]) {
      assert.throws(() => store.decodeScreenshot(`data:image/webp;base64,${bytes.toString('base64')}`), { status: 400 });
    }
  } finally { db.close(); }
});

test('signup draft rejects screenshots over 2 MiB without publishing any players', () => {
  const db = database();
  try {
    const store = new SeasonStore(db);
    const season = store.create('Screenshot limit season');
    store.saveSignup(season.SeasonId, 'Sign up', 'Five players');
    store.setSignupStatus(season.SeasonId, true);
    const draftId = store.startSignupDraft(season.SeasonId, 1);
    const oversized = `data:image/png;base64,${Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2 * 1024 * 1024),
    ]).toString('base64')}`;
    assert.throws(() => store.saveSignupDraftPlayer(season.SeasonId, 1, draftId, 0, {
      playerId: 1, playerName: 'Captain', mmr: 6000,
      dotaProfileUrl: 'https://www.dotabuff.com/players/1', screenshot: oversized,
    }), { status: 400 });
    assert.equal(db.prepare('SELECT COUNT(*) AS Count FROM SeasonSignupDraftPlayers').get().Count, 0);
    assert.equal(store.teams(season.SeasonId).length, 0);
  } finally { db.close(); }
});

test('an existing active league is adopted without creating a second current season', () => {
  const db = database();
  try {
    db.prepare("INSERT INTO LeagueInfo VALUES (999, 'Legacy league', 1)").run();
    const store = new SeasonStore(db);
    assert.equal(store.current().ExternalLeagueId, 999);
    assert.equal(store.current().Status, 'active');
    assert.equal(new SeasonStore(db).current().SeasonId, store.current().SeasonId);
    assert.throws(() => store.create('New season'), { status: 409 });
  } finally { db.close(); }
});

test('an optional League ID can be saved with the draft and used when starting', () => {
  const db = database();
  try {
    db.prepare("INSERT INTO LeagueInfo VALUES (77, 'Previous league', 0)").run();
    const store = new SeasonStore(db);
    assert.throws(() => store.create('New season', 77), { status: 409 });
    assert.throws(() => store.create('New season', 0), { status: 400 });
    const draft = store.create('New season', 12345);
    assert.equal(draft.ExternalLeagueId, 12345);
    store.saveSignup(draft.SeasonId, 'Join us', 'Five players per team');
    store.setSignupStatus(draft.SeasonId, true);
    store.setSignupStatus(draft.SeasonId, false);
    const team = store.addManualTeam(draft.SeasonId, 'Team One', 6000);
    const group = store.addGroup(draft.SeasonId, 'Group A');
    store.assignTeam(draft.SeasonId, team.TeamSubmissionId, group.GroupId);
    assert.equal(store.start(draft.SeasonId).ExternalLeagueId, 12345);
    assert.equal(db.prepare('SELECT Active FROM LeagueInfo WHERE LeagueId = 12345').get().Active, 1);
  } finally { db.close(); }
});

test('legacy league champions import on startup and preserve subsequent admin corrections', () => {
  const db = database();
  try {
    db.exec(`INSERT INTO LeagueInfo VALUES (77, 'Old league', 0);
      INSERT INTO TeamInfo VALUES (1, 'Winners'), (2, 'Others');
      INSERT INTO MatchTeam VALUES (4, 1, 2, 1);
      INSERT INTO MatchLeague (MatchId, LeagueId) VALUES (4, 77);`);
    const store = new SeasonStore(db);
    const completed = store.lastEnded();
    assert.equal(completed.ExternalLeagueId, 77);
    assert.equal(completed.ChampionTeamId, 1);
    assert.equal(store.publicHome().champion.teamName, 'Winners');
    store.correctChampion(completed.SeasonId, 2);
    assert.equal(new SeasonStore(db).lastEnded().SeasonId, completed.SeasonId);
    assert.equal(store.get(completed.SeasonId).ChampionTeamId, 2);
  } finally { db.close(); }
});

test('champion corrections use season-specific teams and names while preserving other seasons', () => {
  const db = database();
  try {
    const audit = [];
    const store = new SeasonStore(db, (type, message) => audit.push([type, message]));
    db.exec(`INSERT INTO LeagueSeasons
      (SeasonId, LeagueName, Status, ExternalLeagueId, ChampionTeamId, CreatedAt, UpdatedAt, EndedAt) VALUES
      (1, 'Season 19', 'ended', 119, 10, 'old', 'old', '2025-01-01'),
      (2, 'Season 20', 'ended', 120, 10, 'old', 'old', '2025-06-01'),
      (3, 'Current test', 'active', 999, NULL, 'now', 'now', NULL);
      INSERT INTO TeamInfo VALUES (10, 'Current global name'), (20, 'Other global name'), (30, 'New team');
      INSERT INTO MatchTeam VALUES (1, 10, 20, 10), (2, 10, 30, 30);
      INSERT INTO MatchLeague VALUES (1, 119, '2025-01-01'), (2, 120, '2025-06-01');
      INSERT INTO LeagueTeamNames VALUES (119, 10, 'Old name'), (120, 10, 'New name');
      INSERT INTO SeasonTeams (SeasonId, TeamName, ExternalTeamId, SubmittedAt, UpdatedAt)
        VALUES (1, 'Submitted name', 20, 'old', 'old');
      INSERT INTO LeagueRosterEntries (LeagueId, TeamId, DisplayName, SortOrder)
        VALUES (120, 30, 'Roster name', 0);`);
    assert.deepEqual(store.completedChampions().map(season => season.SeasonId), [2, 1]);
    assert.deepEqual(store.championTeams(1), [
      { TeamId: 10, TeamName: 'Old name' }, { TeamId: 20, TeamName: 'Submitted name' },
    ]);
    assert.deepEqual(store.championTeams(2), [
      { TeamId: 10, TeamName: 'New name' }, { TeamId: 30, TeamName: 'Roster name' },
    ]);
    assert.throws(() => store.correctChampion(1, 30), { status: 409 });
    assert.throws(() => store.correctChampion(3, 10), { status: 409 });
    assert.throws(() => store.correctChampion(444, 10), { status: 404 });
    const current = store.get(3);
    const other = store.get(2);
    const updated = store.correctChampion(1, 20);
    assert.equal(updated.ChampionTeamId, 20);
    assert.equal(updated.Status, 'ended');
    assert.equal(updated.EndedAt, '2025-01-01');
    assert.deepEqual(store.get(3), current);
    assert.deepEqual(store.get(2), other);
    assert.deepEqual(audit, [['Champion Corrected',
      'Changed Season 19 (league 119) champion from Old name (10) to Submitted name (20)']]);
    store.correctChampion(1, 20);
    assert.equal(audit.length, 1);
  } finally { db.close(); }
});

test('admins confirm exactly five legacy championship players scoped to the season and team', () => {
  const db = database();
  try {
    const audit = [];
    const store = new SeasonStore(db, (type, message) => audit.push([type, message]));
    db.exec(`INSERT INTO LeagueInfo VALUES (119, 'Old season', 0), (120, 'Other season', 0);
      INSERT INTO LeagueSeasons
        (SeasonId, LeagueName, Status, ExternalLeagueId, ChampionTeamId, CreatedAt, UpdatedAt, EndedAt) VALUES
        (1, 'Old season', 'ended', 119, 20, 'old', 'old', '2025-01-01'),
        (2, 'Other season', 'ended', 120, 10, 'old', 'old', '2025-06-01');
      INSERT INTO TeamInfo VALUES (10, 'Chosen team'), (20, 'Opponents');
      INSERT INTO HeroInfo VALUES (1, 'Axe');`);
    for (let id = 1; id <= 8; id++) db.prepare('INSERT INTO PlayerInfo VALUES (?, ?)').run(id, `Player ${id}`);
    for (let match = 1; match <= 4; match++) {
      db.prepare('INSERT INTO MatchTeam VALUES (?, 10, 20, 10)').run(match);
      db.prepare('INSERT INTO MatchLeague VALUES (?, 119, NULL)').run(match);
      for (let player = 1; player <= 7; player++) {
        if (player === 6 && match > 1) continue;
        db.prepare('INSERT INTO MatchPlayer (MatchId, PlayerId, HeroId) VALUES (?, ?, 1)').run(match, player);
        db.prepare('INSERT INTO MatchTeamPlayer VALUES (?, ?, ?)').run(match, player, player === 7 ? 20 : 10);
      }
    }
    db.exec(`INSERT INTO MatchTeam VALUES (5, 10, 20, 10);
      INSERT INTO MatchLeague VALUES (5, 120, NULL);
      INSERT INTO MatchPlayer (MatchId, PlayerId, HeroId) VALUES (5, 8, 1);
      INSERT INTO MatchTeamPlayer VALUES (5, 8, 10);
      INSERT INTO MatchTeamPlayer VALUES (1, 1, 10), (1, 7, 10);
      INSERT INTO MatchPlayer (MatchId, PlayerId, HeroId) VALUES (1, 1, 1);`);
    const initial = store.championshipRoster(1, 10);
    assert.equal(initial.source, 'inferred');
    assert.deepEqual(initial.selectedPlayerIds, [1, 2, 3, 4, 5]);
    assert.deepEqual(initial.players.map(player => player.PlayerId), [1, 2, 3, 4, 5, 6]);
    assert.equal(initial.players[0].Games, 4); // Duplicate imports count once; conflicting sides are excluded.
    // Real warehouse regression: repeated unindexed MatchPlayer scans block the API event loop.
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${CHAMPIONSHIP_ROSTER_PLAYERS_SQL}`)
      .all(10, 119, 10, 10).map(step => step.detail).join('\n');
    assert.match(plan, /SEARCH ml USING COVERING INDEX .*\(LeagueId=\?\)/);
    assert.match(plan, /SEARCH p USING COVERING INDEX .*\(MatchId=\?/);
    assert.match(plan, /SEARCH mp(?: EXISTS)? USING COVERING INDEX .*\(MatchId=\? AND PlayerId=\?\)/);
    assert.doesNotMatch(plan, /SCAN (?:ml|mp|p)\b/);
    for (const invalid of [[], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 4],
      [1, 2, 3, 4, 7], [1, 2, 3, 4, 8], [1, 2, 3, 4, '6'], null]) {
      assert.throws(() => store.correctChampion(1, 10, invalid), { status: 400 });
      assert.equal(store.get(1).ChampionTeamId, 20);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM ChampionshipRosterPlayers').get().n, 0);
    }
    const awards = new PlayerAwardsStore(db);
    assert.equal(awards.forPlayer(6).awards.some(a => a.type === 'champion'), false);
    const other = store.get(2);
    const chosen = [1, 2, 3, 4, 6];
    store.correctChampion(1, 10, chosen);
    assert.deepEqual(store.get(2), other);
    assert.equal(store.get(1).EndedAt, '2025-01-01');
    assert.deepEqual(store.championshipRoster(1, 10).selectedPlayerIds, chosen);
    assert.equal(store.championshipRoster(1, 10).source, 'admin');
    const title = awards.forPlayer(6).awards.find(a => a.type === 'champion');
    assert.equal(title.rosterSource, 'admin');
    assert.equal(title.games, 1);
    assert.equal(title.teamGames, 4);
    assert.equal(awards.forPlayer(5).awards.some(a => a.type === 'champion'), false);
    assert.equal(awards.withChampionships([{ PlayerId: 6 }])[0].championships.length, 1);
    assert.equal(audit.filter(([type]) => type === 'Championship Roster Changed').length, 1);
    store.correctChampion(1, 10, [...chosen].reverse());
    assert.equal(audit.length, 2); // One roster change and one champion correction; no duplicate writes.
    store.correctChampion(1, 20);
    assert.equal(awards.forPlayer(6).awards.some(a => a.type === 'champion'), false);
    store.correctChampion(1, 10);
    assert.equal(awards.forPlayer(6).awards.some(a => a.type === 'champion'), true);
    assert.deepEqual(new SeasonStore(db).championshipRoster(1, 10).selectedPlayerIds, chosen);
    // Confirmed membership survives a later correction to historical match data.
    db.prepare('DELETE FROM MatchTeamPlayer WHERE PlayerId = 6').run();
    assert.equal(store.championshipRoster(1, 10).players.find(p => p.PlayerId === 6).Games, 0);
    assert.equal(awards.forPlayer(6).awards.find(a => a.type === 'champion').games, 0);
  } finally { db.close(); }
});
