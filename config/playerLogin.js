import {changePlayerDisplayName,nextNameChangeAt} from './playerDashboard.js';

export function ensurePlayerLoginSchema(db) {
  db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS Logins (
      UID INTEGER PRIMARY KEY AUTOINCREMENT,Username TEXT NOT NULL,
      SteamID INTEGER NOT NULL UNIQUE,LastLoginDate TEXT NOT NULL,
      FirstLoginAtUtc TEXT,NameConfirmedAtUtc TEXT,
      NameConfirmationRequired INTEGER NOT NULL DEFAULT 0 CHECK(NameConfirmationRequired IN (0,1))
    )`);
    const columns=new Set(db.prepare('PRAGMA table_info(Logins)').all().map(c=>c.name));
    for(const [column,type] of Object.entries({FirstLoginAtUtc:'TEXT',NameConfirmedAtUtc:'TEXT',
      NameConfirmationRequired:'INTEGER NOT NULL DEFAULT 0 CHECK(NameConfirmationRequired IN (0,1))'})) {
      if(!columns.has(column))db.exec(`ALTER TABLE Logins ADD COLUMN ${column} ${type}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS PlayerLoginMigrations (
      Version INTEGER PRIMARY KEY,AppliedAtUtc TEXT NOT NULL
    )`);
    // Roll out the popup to existing users once per database. Keep their real
    // first-login date unknown and leave already confirmed names alone.
    const migration=db.prepare('INSERT OR IGNORE INTO PlayerLoginMigrations VALUES (1,?)').run(new Date().toISOString());
    if(migration.changes)db.prepare(`UPDATE Logins SET NameConfirmationRequired=1
      WHERE NameConfirmedAtUtc IS NULL AND NameConfirmationRequired=0`).run();
  })();
}

export function recordPlayerLogin(db,accountId,username,at=new Date().toISOString()) {
  db.prepare(`INSERT INTO Logins
    (Username,SteamID,LastLoginDate,FirstLoginAtUtc,NameConfirmationRequired)
    VALUES (?,?,?,?,1) ON CONFLICT(SteamID) DO UPDATE SET
      Username=excluded.Username,LastLoginDate=excluded.LastLoginDate`)
    .run(username,accountId,at,at);
}

export function getPlayerLoginState(db,accountId) {
  const login=db.prepare('SELECT FirstLoginAtUtc,NameConfirmedAtUtc,NameConfirmationRequired FROM Logins WHERE SteamID=?').get(accountId);
  const player=db.prepare('SELECT PlayerName,LastDateChanged FROM PlayerInfo WHERE PlayerId=?').get(accountId);
  return {leagueName:player?.PlayerName||null,nameConfirmation:{
    required:Boolean(login?.NameConfirmationRequired),firstLoginAtUtc:login?.FirstLoginAtUtc||null,
    confirmedAtUtc:login?.NameConfirmedAtUtc||null,nextNameChangeAt:nextNameChangeAt(player?.LastDateChanged),
  }};
}

export function confirmPlayerName(db,accountId,value,now=new Date()) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>40)
    return {success:false,status:400,message:'Enter a league name of 1–40 characters.'};
  return db.transaction(()=>{
    const login=db.prepare('SELECT NameConfirmationRequired,NameConfirmedAtUtc FROM Logins WHERE SteamID=?').get(accountId);
    if(!login?.NameConfirmationRequired) {
      // Repeated submissions are harmless, and cannot turn this endpoint into
      // another way to change an already confirmed name.
      if(login?.NameConfirmedAtUtc) {
        const state=getPlayerLoginState(db,accountId);
        return {success:true,name:state.leagueName,...state.nameConfirmation};
      }
      return {success:false,status:409,message:'Your name does not need first-login confirmation. You can edit it from your dashboard.'};
    }
    const name=value.trim();
    const player=db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=?').get(accountId);
    if(!player) {
      db.prepare('INSERT INTO PlayerInfo(PlayerId,PlayerName,LastDateChanged) VALUES(?,?,?)').run(accountId,name,now.toISOString());
    } else if(name!==player.PlayerName) {
      const result=changePlayerDisplayName(db,accountId,name,now);
      if(!result.success)return result;
    }
    db.prepare('UPDATE Logins SET NameConfirmationRequired=0,NameConfirmedAtUtc=? WHERE SteamID=?').run(now.toISOString(),accountId);
    const state=getPlayerLoginState(db,accountId);
    return {success:true,name:state.leagueName,...state.nameConfirmation};
  })();
}
