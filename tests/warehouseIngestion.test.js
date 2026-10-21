import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { ensureWarehouseSchema, warehouseNeedsMigration, WAREHOUSE_CHILDREN } from '../config/warehouseSchema.js';
import { initializeWarehouse, ingestWarehouseMatch, readGameplaySnapshot } from '../config/warehouseIngestion.js';
import { captureWarehouseBaseline, compareWarehouseBaseline, validateWarehouse } from '../config/warehouseValidation.js';
import { deleteMatchRecords, findOrphanMatchRecords, cleanupOrphanMatchRecords } from '../config/matchMaintenance.js';
import { planWarehouseCollection } from '../config/warehouseCollection.js';
import { syncWarehousePatches } from '../config/warehousePatches.js';
import { backfillAbilityUpgrades } from '../config/warehouseAbilityUpgrades.js';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

function fixture({ migrate = true } = {}) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../scripts/db/ladsData.schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO LeagueInfo VALUES (20,'Season 20',0);
    INSERT INTO TeamInfo (TeamId,TeamName) VALUES (100,'Alpha'),(200,'Beta');
    INSERT INTO MatchTeam (MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration) VALUES (1,100,200,200,0,2100);
    INSERT INTO MatchLeague VALUES (1,20,'2025-05-23');`);
  for (let id = 1; id <= 10; id++) {
    db.prepare('INSERT INTO HeroInfo VALUES (?,?)').run(id, `Hero ${id}`);
    db.prepare('INSERT INTO PlayerInfo (PlayerId,PlayerName) VALUES (?,?)').run(id, `Player ${id}`);
    db.prepare(`INSERT INTO MatchPlayer (MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM)
      VALUES (1,?,?,3,2,4,100,500,600)`).run(id, id);
    db.prepare('INSERT INTO MatchTeamPlayer (MatchId,PlayerId,TeamId) VALUES (1,?,?)').run(id, id <= 5 ? 100 : 200);
  }
  if (migrate) initializeWarehouse(db);
  return db;
}

function payload() {
  return { match_id: 1, start_time: Date.parse('2025-05-22T23:00:00Z') / 1000, duration: 2100, version: 22, patch: 99999,
    radiant_win: true, radiant_team_id: 100, dire_team_id: 200, radiant_score: 20, dire_score: 15, first_blood_time: 35,
    radiant_gold_adv: Array(36).fill(3500), radiant_xp_adv: Array(36).fill(2500), chat: [{text:'private chat'}],
    players: Array.from({length: 10}, (_, i) => ({ account_id:i+1,hero_id:i+1,player_slot:i<5?i:128+i-5,
      kills:999,denies:0,level:20,lane_role:i%3+1,is_roaming:false,obs_placed:0,sen_placed:2,
      observer_kills:1,sentry_kills:2,camps_stacked:3,stuns:10.5,neutral_kills:5,ancient_kills:2,
      tower_kills:1,roshan_kills:0,courier_kills:0,rank_tier:80,mmr_estimate:{estimate:9000},
      times:[0,600,1200],gold_t:[0,5000,10000],xp_t:[0,4000,9000],lh_t:[0,60,150],
      purchase_log:[{key:'tango',time:-60},{key:'blink',time:700},{key:'blink',time:1200}],
      buyback_log:[{time:1800}],ability_upgrades_arr:[1,2,3] })),
    objectives:[{type:'building_kill',key:'npc_dota_badguys_tower1_top',time:1000,player_slot:0},
      {type:'CHAT_MESSAGE_ROSHAN_KILL',team:3,time:1500},
      {type:'building_kill',key:'npc_dota_goodguys_tower1_top',time:1700,unit:'npc_dota_creep_badguys_melee'}],
    teamfights:[{start:900,end:950,players:Array.from({length:10},(_,i)=>({deaths:i>=5?1:0,damage:100+i,gold_delta:50,xp_delta:100}))}] };
}

test('migration is additive, creates independent patch IDs and leaves existing features untouched', () => {
  const db = fixture({migrate:false});
  try {
    db.exec(`CREATE TABLE ExistingConsumerState (Id INTEGER PRIMARY KEY,Payload TEXT NOT NULL);
      INSERT INTO ExistingConsumerState VALUES (1,'existing feature data');`);
    const before = captureWarehouseBaseline(db);
    assert.equal(warehouseNeedsMigration(db),true);
    initializeWarehouse(db);
    assert.equal(warehouseNeedsMigration(db),false);
    ensureWarehouseSchema(db);
    assert.equal(compareWarehouseBaseline(db,before).unchanged,true);
    const patch = db.prepare("SELECT * FROM Patches WHERE PatchKey='7.39'").get();
    assert.equal(patch.StartsAt,'2025-05-22T05:00:00.000Z');
    assert.equal(Object.hasOwn(patch,'OpenDotaPatchId'),false);
    assert.equal(db.prepare('SELECT Payload FROM ExistingConsumerState').get().Payload,'existing feature data');
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});

test('ingestion preserves every original field and stores repeated/pregame events without updating consumers', () => {
  const db = fixture();
  try {
    const baseline = captureWarehouseBaseline(db);
    const result = ingestWarehouseMatch(db,payload());
    assert.equal(result.status,'ready');
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true);
    const match = db.prepare('SELECT * FROM MatchTeam').get();
    const patch = db.prepare('SELECT PatchKey FROM Patches WHERE PatchId=?').get(match.PatchId);
    assert.equal(patch.PatchKey,'7.39');
    assert.equal(match.WinnerId,200); // The source winner must never overwrite a correction.
    assert.ok(result.issues.some(issue=>issue.includes('Source winner differs')));
    assert.ok(result.issues.some(issue=>issue.includes('curated Kills=3')));
    assert.equal(db.prepare('SELECT RadiantGoldAdvantage FROM MatchTeamTimeline WHERE TimeSeconds=1200').get().RadiantGoldAdvantage,3500);
    assert.equal(db.prepare('SELECT Gold FROM MatchPlayerTimeline WHERE PlayerId=1 AND TimeSeconds=600').get().Gold,5000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayerPurchases').get().n,30);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayerAbilityUpgrades').get().n,30);
    assert.equal(db.prepare('SELECT MIN(TimeSeconds) t FROM MatchPlayerPurchases').get().t,-60);
    const player = db.prepare('SELECT * FROM MatchPlayer WHERE PlayerId=1').get();
    assert.equal(player.Kills,3); assert.equal(player.Denies,0); assert.equal(player.ObserversPlaced,0);
    assert.equal(player.IsRoaming,0); assert.equal(player.StunSeconds,10.5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeamfightPlayers').get().n,10);
    const objective = db.prepare('SELECT * FROM MatchObjectives WHERE EventIndex=2').get();
    assert.equal(objective.PlayerId,null); assert.match(objective.SourceJson,/creep_badguys/);
    const snapshot = readGameplaySnapshot(db,1);
    assert.equal(snapshot.players[0].buyback_log.length,1);
    assert.equal(snapshot.players[0].kills,999); // Retain the source without overwriting curated facts.
    assert.equal(Object.hasOwn(snapshot,'patch'),false);
    assert.equal(Object.hasOwn(snapshot,'chat'),false);
    assert.equal(Object.hasOwn(snapshot.players[0],'rank_tier'),false);
    assert.equal(Object.hasOwn(snapshot.players[0],'mmr_estimate'),false);
    assert.equal(validateWarehouse(db,{leagueId:20}).valid,true);
    const deep = validateWarehouse(db,{leagueId:20,deep:true});
    assert.equal(deep.valid,true);
    assert.equal(deep.sourceReconciliation.checkedMatches,1);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    const counts = () => Object.fromEntries(WAREHOUSE_CHILDREN.map(t=>[t,db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
    const first = counts(), sourceHash = db.prepare('SELECT SourceHash FROM MatchSourceResponses').get().SourceHash;
    ingestWarehouseMatch(db,payload());
    assert.deepEqual(counts(),first);
    assert.equal(db.prepare('SELECT SourceHash FROM MatchSourceResponses').get().SourceHash,sourceHash);
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true);
    db.exec('UPDATE MatchPlayerTimeline SET Gold=999999 WHERE PlayerId=1 AND TimeSeconds=600');
    assert.equal(validateWarehouse(db,{leagueId:20,deep:true}).valid,false);
  } finally { db.close(); }
});

test('ability upgrades preserve repeated IDs, retain valid builds on partial/invalid/older responses, and replace newer builds', () => {
  const db = fixture();
  const read = () => db.prepare('SELECT UpgradeIndex,AbilityId FROM MatchPlayerAbilityUpgrades WHERE PlayerId=1 ORDER BY UpgradeIndex').raw().all();
  try {
    const data = payload(); data.players[0].ability_upgrades_arr = [5040, 5041, 5040, 9001];
    ingestWarehouseMatch(db, data);
    assert.deepEqual(read(), [[0,5040],[1,5041],[2,5040],[3,9001]]);
    const partial = payload(); delete partial.version; delete partial.players[0].ability_upgrades_arr;
    ingestWarehouseMatch(db, partial);
    assert.deepEqual(read().map(r => r[1]), [5040,5041,5040,9001]);
    for (const bad of [[5040,null], ['5040'], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], {}]) {
      const malformed = payload(); malformed.players[0].ability_upgrades_arr = bad;
      const result = ingestWarehouseMatch(db, malformed);
      assert.ok(result.issues.some(issue => issue.includes('Invalid ability_upgrades_arr for 1;')));
      assert.deepEqual(read().map(r => r[1]), [5040,5041,5040,9001]);
    }
    const older = payload(); older.version = 21; older.players[0].ability_upgrades_arr = [7];
    ingestWarehouseMatch(db, older);
    assert.equal(read().length, 4);
    const newer = payload(); newer.version = 23; newer.players[0].ability_upgrades_arr = [5041,5040];
    ingestWarehouseMatch(db, newer);
    assert.deepEqual(read(), [[0,5041],[1,5040]]);
    assert.equal(validateWarehouse(db, { deep: true }).valid, true);
    db.exec('UPDATE MatchPlayerAbilityUpgrades SET AbilityId=99 WHERE PlayerId=1 AND UpgradeIndex=0');
    assert.equal(validateWarehouse(db, { deep: true }).valid, false);
    newer.players[0].ability_upgrades_arr = [];
    ingestWarehouseMatch(db, newer);
    assert.deepEqual(read(), []);
    assert.equal(validateWarehouse(db, { deep: true }).valid, true);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});

test('version-one warehouses gain an empty upgrade table without scanning archives', () => {
  const db = fixture({ migrate: false });
  try {
    db.exec(`DROP TABLE MatchPlayerAbilityUpgrades; INSERT INTO WarehouseMigrations VALUES (1,'2026-10-20');`);
    ensureWarehouseSchema(db);
    assert.equal(warehouseNeedsMigration(db), false);
    assert.deepEqual(db.prepare('SELECT Version FROM WarehouseMigrations ORDER BY Version').pluck().all(), [1,2]);
    assert.equal(db.prepare('SELECT COUNT(*) FROM MatchPlayerAbilityUpgrades').pluck().get(), 0);
  } finally { db.close(); }
});

test('saved ability builds backfill in bounded idempotent batches, checking hashes and player identities', () => {
  const db = fixture();
  const saveArchive = data => {
    const raw = JSON.stringify(data), digest = createHash('sha256').update(raw).digest('hex');
    db.prepare('UPDATE MatchSourceResponses SET GameplayData=?,SourceHash=? WHERE MatchId=?').run(gzipSync(raw), digest, data.match_id);
  };
  try {
    const data = payload(); data.players[0].ability_upgrades_arr = [10,20,10,9001];
    ingestWarehouseMatch(db, data);
    db.exec(`INSERT INTO MatchTeam (MatchId,TeamRad,TeamDire,WinnerId,SeriesId,Duration) VALUES(2,100,200,200,0,2100);
      INSERT INTO MatchLeague VALUES(2,20,'2025-05-23');
      INSERT INTO MatchPlayer (MatchId,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM)
        SELECT 2,PlayerId,HeroId,Kills,Deaths,Assists,Lasthits,GPM,XPM FROM MatchPlayer WHERE MatchId=1;`);
    ingestWarehouseMatch(db, { ...data, match_id: 2 });
    db.exec(`DROP TABLE MatchPlayerAbilityUpgrades;
      UPDATE MatchIngestionState SET SectionsJson=json_remove(SectionsJson,'$.abilityUpgrades');`);
    const before = db.prepare('SELECT total_changes()').pluck().get();
    const preview = backfillAbilityUpgrades(db, { limit: 1 });
    assert.equal(preview.checked, 1); assert.equal(preview.upgrades, 31); assert.equal(preview.more, true);
    assert.equal(preview.changedMatches, 1); assert.equal(preview.lastMatchId, 1);
    assert.equal(db.prepare('SELECT total_changes()').pluck().get(), before);
    // Simulate the additive migration on an already-open fixture connection.
    db.exec(`CREATE TABLE MatchPlayerAbilityUpgrades (MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId),
      PlayerId INTEGER NOT NULL,UpgradeIndex INTEGER NOT NULL,AbilityId INTEGER NOT NULL,
      PRIMARY KEY(MatchId,PlayerId,UpgradeIndex));`);
    const baseline = captureWarehouseBaseline(db);
    assert.equal(validateWarehouse(db, { deep: true }).valid, true, 'old sections remain valid before explicit extraction');
    const archiveBefore = db.prepare('SELECT SourceHash,CollectedAt FROM MatchSourceResponses ORDER BY MatchId').all();
    const first = backfillAbilityUpgrades(db, { apply: true, limit: 1 });
    assert.equal(first.changedMatches, 1); assert.equal(first.more, true);
    const second = backfillAbilityUpgrades(db, { apply: true, afterMatchId: first.lastMatchId, limit: 1 });
    assert.equal(second.checked, 1); assert.equal(second.changedMatches, 1); assert.equal(second.more, false);
    assert.equal(db.prepare('SELECT COUNT(*) FROM MatchPlayerAbilityUpgrades').pluck().get(), 62);
    assert.equal(backfillAbilityUpgrades(db, { apply: true }).changedMatches, 0);
    assert.equal(compareWarehouseBaseline(db, baseline).unchanged, true);
    assert.deepEqual(db.prepare('SELECT SourceHash,CollectedAt FROM MatchSourceResponses ORDER BY MatchId').all(), archiveBefore);
    assert.equal(validateWarehouse(db, { deep: true }).valid, true);
    assert.deepEqual(JSON.parse(db.prepare('SELECT SectionsJson FROM MatchIngestionState WHERE MatchId=1').get().SectionsJson).abilityUpgrades,
      { players: 10, events: 31 });
    // Gapped indexes must be repaired even when the ordered ability IDs match.
    db.exec('UPDATE MatchPlayerAbilityUpgrades SET UpgradeIndex=20 WHERE MatchId=1 AND PlayerId=1 AND UpgradeIndex=3');
    assert.equal(backfillAbilityUpgrades(db, { apply: true, limit: 1 }).changedMatches, 1);
    assert.equal(db.prepare('SELECT MAX(UpgradeIndex) FROM MatchPlayerAbilityUpgrades WHERE MatchId=1 AND PlayerId=1').pluck().get(), 3);
    const original = db.prepare('SELECT * FROM MatchPlayerAbilityUpgrades ORDER BY MatchId,PlayerId,UpgradeIndex').all();
    data.players[0].hero_id = 999;
    saveArchive(data);
    const conflict = backfillAbilityUpgrades(db, { apply: true, limit: 1 });
    assert.equal(conflict.failedMatches, 1); assert.match(conflict.errors[0].message, /participants/);
    assert.deepEqual(db.prepare('SELECT * FROM MatchPlayerAbilityUpgrades ORDER BY MatchId,PlayerId,UpgradeIndex').all(), original);
    db.exec("UPDATE MatchSourceResponses SET SourceHash='wrong' WHERE MatchId=1");
    assert.match(backfillAbilityUpgrades(db, { apply: true, limit: 1 }).errors[0].message, /hash mismatch/);
    assert.throws(() => backfillAbilityUpgrades(db, { limit: 0 }), /Invalid backfill range/);
  } finally { db.close(); }
});

test('substitute team IDs and historic memberships do not block enrichment or change curated records', () => {
  const db = fixture();
  try {
    // Historic imports can retain substitute memberships, or assign both sides
    // to one team. Neither changes the verified match/player/hero identities.
    db.exec('UPDATE MatchTeamPlayer SET TeamId=200');
    const before = captureWarehouseBaseline(db);
    const data = payload();
    data.radiant_team_id=900; data.dire_team_id=901; data.radiant_win=false;
    for (const p of data.players) p.kills=3;
    const result = ingestWarehouseMatch(db,data);
    assert.equal(result.status,'ready');
    assert.deepEqual(result.issues,[]);
    assert.equal(compareWarehouseBaseline(db,before).unchanged,true);
    assert.equal(readGameplaySnapshot(db,1).radiant_team_id,900);
    assert.equal(readGameplaySnapshot(db,1).dire_team_id,901);
    assert.equal(validateWarehouse(db,{leagueId:20,deep:true}).valid,true);
    // A single substituted side is also allowed, with core memberships intact.
    db.exec("INSERT INTO TeamInfo (TeamId,TeamName) VALUES (300,'Substitute'); UPDATE MatchTeamPlayer SET TeamId=CASE WHEN PlayerId<=5 THEN 100 ELSE 300 END");
    data.radiant_team_id=100; data.dire_team_id=300;
    const substituted = captureWarehouseBaseline(db);
    assert.equal(ingestWarehouseMatch(db,data).status,'ready');
    assert.equal(compareWarehouseBaseline(db,substituted).unchanged,true);
  } finally { db.close(); }
});

test('a stale winner reference is enriched unchanged and reported separately from import errors', () => {
  const db=fixture();
  try {
    db.exec("INSERT INTO TeamInfo(TeamId,TeamName) VALUES(300,'Former team ID'); UPDATE MatchTeam SET WinnerId=300");
    const before=captureWarehouseBaseline(db);
    const plan=planWarehouseCollection(db,{leagueId:20});
    assert.deepEqual(plan.selectedMatchIds,[1]);
    assert.deepEqual(plan.excludedMatches,[]);
    assert.equal(plan.dataQualityNotes[0].winnerId,300);
    const data=payload();for(const p of data.players)p.kills=3;
    const result=ingestWarehouseMatch(db,data);
    assert.equal(result.status,'ready');assert.deepEqual(result.issues,[]);
    assert.equal(db.prepare('SELECT WinnerId FROM MatchTeam').get().WinnerId,300);
    assert.equal(compareWarehouseBaseline(db,before).unchanged,true);
    const validation=validateWarehouse(db,{leagueId:20,deep:true});
    assert.equal(validation.valid,true);assert.deepEqual(validation.problems,[]);
    assert.equal(validation.dataQualityNotes.length,1);
    assert.equal(validation.sourceReconciliation.mismatchCount,0);
  } finally {db.close();}
});

test('partial and malformed sections cannot erase richer data; absent scalars remain null', () => {
  const db = fixture();
  try {
    const first = payload(); delete first.players[0].stuns; first.first_blood_time=-20;
    ingestWarehouseMatch(db,first);
    assert.equal(db.prepare('SELECT FirstBloodTime FROM MatchTeam').get().FirstBloodTime,-20);
    assert.equal(db.prepare('SELECT StunSeconds FROM MatchPlayer WHERE PlayerId=1').get().StunSeconds,null);
    const partial = payload(); delete partial.version; delete partial.radiant_gold_adv; delete partial.radiant_xp_adv;
    delete partial.objectives; delete partial.teamfights;
    partial.players.reverse();
    for (const p of partial.players) { delete p.times; delete p.gold_t; delete p.xp_t; delete p.lh_t; p.purchase_log=[]; }
    const result = ingestWarehouseMatch(db,partial);
    assert.equal(result.status,'ready');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayerPurchases').get().n,30);
    assert.equal(db.prepare('SELECT RadiantGoldAdvantage FROM MatchTeamTimeline WHERE TimeSeconds=1200').get().RadiantGoldAdvantage,3500);
    assert.equal(db.prepare('SELECT Damage FROM MatchTeamfightPlayers WHERE PlayerId=1').get().Damage,100);
    const malformed = payload(); malformed.players[0].gold_t=[0]; malformed.objectives=[{}]; malformed.teamfights=[{start:5,end:1}];
    const repaired = ingestWarehouseMatch(db,malformed);
    assert.ok(repaired.issues.length>=3);
    assert.equal(db.prepare('SELECT Gold FROM MatchPlayerTimeline WHERE PlayerId=1 AND TimeSeconds=600').get().Gold,5000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchObjectives').get().n,3);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeamfights').get().n,1);
    const older = payload(); older.version=1; older.objectives=[]; older.teamfights=[];
    for (const p of older.players) p.purchase_log=[];
    ingestWarehouseMatch(db,older);
    assert.equal(db.prepare('SELECT ParseVersion FROM MatchIngestionState').get().ParseVersion,22);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayerPurchases').get().n,30);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchObjectives').get().n,3);
  } finally { db.close(); }
});

test('identity conflicts, unknown matches and failures never change existing records or successful sections', () => {
  const db = fixture();
  try {
    ingestWarehouseMatch(db,payload());
    const baseline = captureWarehouseBaseline(db);
    const previousHash = db.prepare('SELECT SourceHash FROM MatchSourceResponses').get().SourceHash;
    const conflict = payload(); conflict.players[0].hero_id=2;
    assert.throws(()=>ingestWarehouseMatch(db,conflict),/conflicts/);
    assert.equal(db.prepare('SELECT Status FROM MatchIngestionState').get().Status,'conflict');
    assert.equal(db.prepare('SELECT SourceHash FROM MatchSourceResponses').get().SourceHash,previousHash);
    assert.throws(()=>ingestWarehouseMatch(db,{...payload(),match_id:999}),/curated warehouse/);
    assert.throws(()=>ingestWarehouseMatch(db,payload(),{expectedMatchId:2}),/Mismatched/);
    db.exec("CREATE TRIGGER prevent_purchases BEFORE INSERT ON MatchPlayerPurchases BEGIN SELECT RAISE(ABORT,'blocked'); END");
    const changed = payload(); changed.radiant_score=999;
    assert.throws(()=>ingestWarehouseMatch(db,changed),/blocked/);
    assert.equal(db.prepare('SELECT RadiantScore FROM MatchTeam').get().RadiantScore,20);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchPlayerPurchases').get().n,30);
    assert.equal(db.prepare('SELECT SourceHash FROM MatchSourceResponses').get().SourceHash,previousHash);
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true);
    db.exec('UPDATE MatchPlayer SET Kills=4 WHERE PlayerId=1');
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,false);
  } finally { db.close(); }
});

test('admin deletion and orphan repair include all EDW children with foreign keys enabled', () => {
  const db = fixture();
  try {
    ingestWarehouseMatch(db,payload());
    assert.equal(Object.values(findOrphanMatchRecords(db)).every(n=>n===0),true);
    assert.equal(Object.values(cleanupOrphanMatchRecords(db)).every(n=>n===0),true);
    const removed = deleteMatchRecords(db,1);
    for (const table of WAREHOUSE_CHILDREN) assert.ok(removed[table]>0,table);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM MatchTeam').get().n,0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});

test('pilot planning includes undated curated games, skips recent/completed imports and never adds matches', () => {
  const db = fixture();
  try {
    db.exec('UPDATE MatchLeague SET DatePlayed=NULL');
    const before = captureWarehouseBaseline(db);
    const plan = planWarehouseCollection(db,{leagueId:20,limit:1});
    assert.deepEqual(plan.selectedMatchIds,[1]);
    assert.equal(plan.maximumRequestsThisRun,1);
    assert.deepEqual(planWarehouseCollection(db,{leagueId:20,limit:500}).selectedMatchIds,[1]);
    assert.equal(compareWarehouseBaseline(db,before).unchanged,true);
    ingestWarehouseMatch(db,payload());
    assert.equal(planWarehouseCollection(db,{leagueId:20}).selectedMatchIds.length,0);
    assert.deepEqual(planWarehouseCollection(db,{leagueId:20,force:true}).selectedMatchIds,[1]);
    db.exec("UPDATE MatchIngestionState SET Status='partial',AttemptedAt='2026-01-01T00:00:00.000Z'");
    assert.equal(planWarehouseCollection(db,{leagueId:20,now:Date.parse('2026-01-02T00:00:00Z')}).selectedMatchIds.length,0);
    assert.deepEqual(planWarehouseCollection(db,{leagueId:20,now:Date.parse('2026-01-09T00:00:00Z')}).selectedMatchIds,[1]);
    db.exec('UPDATE MatchTeam SET Rehost=1');
    assert.equal(planWarehouseCollection(db,{leagueId:20,force:true}).selectedMatchIds.length,0);
    assert.throws(()=>planWarehouseCollection(db,{leagueId:20,limit:501}),/batch size/);
    assert.throws(()=>planWarehouseCollection(db,{leagueId:999}),/not found/);
  } finally { db.close(); }
});

test('the independent Valve calendar uses 1am New York and reassigns already-landed matches on correction', async () => {
  const db = fixture();
  try {
    ingestWarehouseMatch(db,payload());
    const baseline = captureWarehouseBaseline(db);
    const oldId = db.prepare("SELECT PatchId FROM Patches WHERE PatchKey='7.39'").get().PatchId;
    const fetcher = async () => ({ok:true,json:async()=>({patches:[
      {patch_number:'7.39',patch_timestamp:Date.parse('2025-05-22T07:00:00Z')/1000},
      {patch_number:'7.39a',patch_timestamp:Date.parse('2025-05-22T07:00:00Z')/1000},
    ]})});
    await syncWarehousePatches(db,{fetcher});
    assert.equal(db.prepare("SELECT PatchId FROM Patches WHERE PatchKey='7.39'").get().PatchId,oldId);
    const newer = db.prepare("SELECT * FROM Patches WHERE PatchKey='7.39a'").get();
    assert.equal(newer.StartsAt,'2025-05-22T05:00:00.000Z');
    // Tied dates choose the later inserted patch as a deterministic final update for that date.
    assert.equal(db.prepare('SELECT PatchId FROM MatchTeam WHERE MatchId=1').get().PatchId,newer.PatchId);
    assert.equal(compareWarehouseBaseline(db,baseline).unchanged,true);
  } finally { db.close(); }
});

test('a failed legacy schema migration rolls back added columns and the migration ledger', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE MatchTeam (MatchId INTEGER PRIMARY KEY); INSERT INTO MatchTeam VALUES (1)');
    assert.throws(()=>ensureWarehouseSchema(db),/MatchPlayer is missing/);
    assert.deepEqual(db.pragma('table_info(MatchTeam)').map(c=>c.name),['MatchId']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='WarehouseMigrations'").get().n,0);
    db.exec('CREATE TABLE MatchPlayer (MatchId INTEGER,PlayerId INTEGER)');
    ensureWarehouseSchema(db); ensureWarehouseSchema(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM WarehouseMigrations').get().n,1);
    assert.equal(db.prepare('SELECT PatchId FROM MatchTeam').get().PatchId,null);
  } finally { db.close(); }
});
