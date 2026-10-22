import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { gzipSync } from 'node:zlib';
import { PRIVATE_EXPORT_TABLES, sanitizeCollaboratorCopy, verifyCollaboratorCopy, collaboratorHistoryCounts } from '../config/collaboratorExport.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
    CREATE TABLE LeagueSeasons(SeasonId INTEGER PRIMARY KEY,SignupTitle TEXT,SignupDescription TEXT);
    CREATE TABLE SeasonTeams(TeamSubmissionId INTEGER PRIMARY KEY,ManualAverageMMR INTEGER);
    CREATE TABLE SeasonTeamPlayers(PlayerId INTEGER,MMR INTEGER NOT NULL,ScreenshotData BLOB NOT NULL);
    CREATE TABLE TeamRosterPlayers(PlayerId INTEGER REFERENCES PlayerInfo(PlayerId),TeamSubmissionId INTEGER REFERENCES SeasonTeams(TeamSubmissionId));
    CREATE TABLE MatchTeam(MatchId INTEGER PRIMARY KEY);
    CREATE TABLE MatchSourceResponses(MatchId INTEGER REFERENCES MatchTeam(MatchId),Encoding TEXT,GameplayData BLOB);
    CREATE TABLE MatchPlayerAbilityUpgrades(MatchId INTEGER,UpgradeIndex INTEGER,AbilityId INTEGER);
    CREATE TABLE FutureCache(PayloadJson TEXT);
    INSERT INTO PlayerInfo VALUES(1,'Historical player');
    INSERT INTO LeagueSeasons VALUES(1,'Private title','Private description');
    INSERT INTO SeasonTeams VALUES(1,7000);
    INSERT INTO TeamRosterPlayers VALUES(1,1);
    INSERT INTO MatchTeam VALUES(10);
    INSERT INTO MatchPlayerAbilityUpgrades VALUES(10,0,5040),(10,1,5041);`);
  for (const table of PRIVATE_EXPORT_TABLES) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)) {
    db.exec(`CREATE TABLE "${table}"(PrivateInput TEXT);INSERT INTO "${table}" VALUES('PRIVATE_SIGNUP_SENTINEL');`);
  }
  db.prepare('INSERT INTO SeasonTeamPlayers VALUES(1,7000,?)').run(Buffer.from('PRIVATE_SCREENSHOT_SENTINEL'));
  db.prepare('INSERT INTO MatchSourceResponses VALUES(10,?,?)').run('gzip', gzipSync(JSON.stringify({ match_id: 10,
    players: [{ account_id: 1, ability_upgrades_arr: [5040,5041], purchase_log: [{ time: -60, key: 'tango' }] }] })));
  return db;
}

test('collaborator sanitization clears private signup inputs, cached values and permissions while preserving public history and rosters', () => {
  const db = fixture();
  try {
    const before = collaboratorHistoryCounts(db);
    sanitizeCollaboratorCopy(db); db.exec('VACUUM');
    const result = verifyCollaboratorCopy(db);
    assert.equal(result.archives, 1);
    assert.deepEqual(collaboratorHistoryCounts(db), before);
    assert.deepEqual(db.prepare('SELECT * FROM SeasonTeams').get(), { TeamSubmissionId: 1, ManualAverageMMR: null });
    assert.deepEqual(db.prepare('SELECT * FROM LeagueSeasons').get(), { SeasonId: 1, SignupTitle: null, SignupDescription: null });
    for (const table of PRIVATE_EXPORT_TABLES) assert.equal(db.prepare(`SELECT COUNT(*) FROM "${table}"`).pluck().get(), 0, table);
    const exported = db.serialize();
    assert.equal(exported.includes(Buffer.from('PRIVATE_SCREENSHOT_SENTINEL')), false, 'deleted screenshot bytes must not remain in the file');
    assert.equal(exported.includes(Buffer.from('PRIVATE_SIGNUP_SENTINEL')), false);
  } finally { db.close(); }
});

test('an unrecognized cache or column containing MMR blocks publication rather than leaking it', () => {
  const db = fixture();
  try {
    sanitizeCollaboratorCopy(db); db.exec('VACUUM');
    db.prepare('INSERT INTO FutureCache VALUES(?)').run(JSON.stringify({ snapshot: JSON.stringify({ roster: [{ SignupMMR: 7000 }] }) }));
    assert.throws(() => verifyCollaboratorCopy(db), /Private field found/);
    db.exec('DELETE FROM FutureCache; CREATE TABLE FutureRatings(ConfirmedMMR INTEGER);INSERT INTO FutureRatings VALUES(7000);VACUUM');
    assert.throws(() => verifyCollaboratorCopy(db), /Private column still contains data: FutureRatings.ConfirmedMMR/);
  } finally { db.close(); }
});

test('compressed match archives are checked recursively for private profile and screenshot fields', () => {
  const db = fixture();
  try {
    sanitizeCollaboratorCopy(db);
    db.prepare('UPDATE MatchSourceResponses SET GameplayData=?').run(gzipSync(JSON.stringify({ players: [{ rank_tier: 80 }] })));
    db.exec('VACUUM');
    assert.throws(() => verifyCollaboratorCopy(db), /match:10.players.0.rank_tier/);
  } finally { db.close(); }
});
