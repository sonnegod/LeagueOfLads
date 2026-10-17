// Shared EDW schema. No API requests, historical reimports or result corrections.
export const WAREHOUSE_VERSION = 1;
export const MATCH_TEAM_ADDITIONS = {
  StartTimeUtc: 'INTEGER', PatchId: 'INTEGER REFERENCES Patches(PatchId)',
  RadiantScore: 'INTEGER', DireScore: 'INTEGER', FirstBloodTime: 'INTEGER'
};
export const MATCH_PLAYER_ADDITIONS = {
  PlayerSlot: 'INTEGER', Denies: 'INTEGER', FinalLevel: 'INTEGER', LaneRole: 'INTEGER', IsRoaming: 'INTEGER',
  ObserversPlaced: 'INTEGER', SentriesPlaced: 'INTEGER', ObserversKilled: 'INTEGER', SentriesKilled: 'INTEGER',
  CampsStacked: 'INTEGER', StunSeconds: 'REAL', NeutralKills: 'INTEGER', AncientKills: 'INTEGER',
  TowerKills: 'INTEGER', RoshanKills: 'INTEGER', CourierKills: 'INTEGER'
};
// Child-before-parent order also drives deletion and orphan repair.
export const WAREHOUSE_CHILDREN = ['MatchTeamfightPlayers', 'MatchTeamfights', 'MatchObjectives',
  'MatchPlayerPurchases', 'MatchPlayerTimeline', 'MatchTeamTimeline', 'MatchSourceResponses', 'MatchIngestionState'];

const columns = (db, table) => new Set(db.pragma(`table_info(${table})`).map(c => c.name));
function addColumns(db, table, additions) {
  const existing = columns(db, table);
  if (!existing.size) throw new Error(`Not a match warehouse: ${table} is missing`);
  for (const [name, type] of Object.entries(additions)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export function ensurePatchSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS Patches (
    PatchId INTEGER PRIMARY KEY, PatchKey TEXT NOT NULL UNIQUE, StartsAt TEXT NOT NULL, Major INTEGER NOT NULL,
    Source TEXT NOT NULL, SyncedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_Patches_Start ON Patches(StartsAt);`);
}

export const WAREHOUSE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS MatchTeamTimeline (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), TimeSeconds INTEGER NOT NULL,
    RadiantGoldAdvantage INTEGER, RadiantXpAdvantage INTEGER, PRIMARY KEY(MatchId,TimeSeconds));
  CREATE TABLE IF NOT EXISTS MatchPlayerTimeline (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), PlayerId INTEGER NOT NULL, TimeSeconds INTEGER NOT NULL,
    Gold INTEGER, Experience INTEGER, LastHits INTEGER, PRIMARY KEY(MatchId,PlayerId,TimeSeconds));
  CREATE TABLE IF NOT EXISTS MatchPlayerPurchases (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), PlayerId INTEGER NOT NULL, EventIndex INTEGER NOT NULL,
    TimeSeconds INTEGER NOT NULL, ItemKey TEXT NOT NULL, PRIMARY KEY(MatchId,PlayerId,EventIndex));
  CREATE TABLE IF NOT EXISTS MatchObjectives (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), EventIndex INTEGER NOT NULL,
    TimeSeconds INTEGER NOT NULL, Type TEXT NOT NULL, PlayerId INTEGER, PlayerSlot INTEGER,
    TeamSide INTEGER, Target TEXT, SourceJson TEXT NOT NULL, PRIMARY KEY(MatchId,EventIndex));
  CREATE TABLE IF NOT EXISTS MatchTeamfights (
    MatchId INTEGER NOT NULL REFERENCES MatchTeam(MatchId), FightIndex INTEGER NOT NULL,
    StartSeconds INTEGER, EndSeconds INTEGER, SourceJson TEXT NOT NULL, PRIMARY KEY(MatchId,FightIndex));
  CREATE TABLE IF NOT EXISTS MatchTeamfightPlayers (
    MatchId INTEGER NOT NULL, FightIndex INTEGER NOT NULL, PlayerId INTEGER NOT NULL, PlayerSlot INTEGER NOT NULL,
    Deaths INTEGER, Damage INTEGER, GoldDelta INTEGER, XpDelta INTEGER, SourceJson TEXT NOT NULL,
    PRIMARY KEY(MatchId,FightIndex,PlayerId),
    FOREIGN KEY(MatchId,FightIndex) REFERENCES MatchTeamfights(MatchId,FightIndex));
  CREATE TABLE IF NOT EXISTS MatchIngestionState (
    MatchId INTEGER PRIMARY KEY REFERENCES MatchTeam(MatchId), Status TEXT NOT NULL,
    ImporterVersion INTEGER NOT NULL, ParseVersion INTEGER, SourceHash TEXT,
    SectionsJson TEXT NOT NULL DEFAULT '{}', IssuesJson TEXT NOT NULL DEFAULT '[]',
    AttemptedAt TEXT NOT NULL, LastSuccessAt TEXT, Error TEXT);
  CREATE INDEX IF NOT EXISTS idx_MatchIngestionState_Status ON MatchIngestionState(Status,ImporterVersion);
  CREATE TABLE IF NOT EXISTS MatchSourceResponses (
    MatchId INTEGER PRIMARY KEY REFERENCES MatchTeam(MatchId), Encoding TEXT NOT NULL CHECK(Encoding='gzip'),
    SourceHash TEXT NOT NULL, GameplayData BLOB NOT NULL, CollectedAt TEXT NOT NULL);
`;

export function warehouseNeedsMigration(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WarehouseMigrations'").get();
  return !exists || !db.prepare('SELECT 1 FROM WarehouseMigrations WHERE Version=?').get(WAREHOUSE_VERSION);
}

const ready = new WeakSet();
export function ensureWarehouseSchema(db) {
  if (ready.has(db)) return;
  if (warehouseNeedsMigration(db)) {
    db.transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS WarehouseMigrations (Version INTEGER PRIMARY KEY,AppliedAt TEXT NOT NULL)');
      ensurePatchSchema(db);
      addColumns(db, 'MatchTeam', MATCH_TEAM_ADDITIONS);
      addColumns(db, 'MatchPlayer', MATCH_PLAYER_ADDITIONS);
      db.exec(WAREHOUSE_TABLE_SQL);
      db.prepare('INSERT INTO WarehouseMigrations VALUES (?,?)').run(WAREHOUSE_VERSION, new Date().toISOString());
    }).immediate();
  }
  ready.add(db);
}
