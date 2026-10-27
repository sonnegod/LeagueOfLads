import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import {ensurePlayerLoginSchema,recordPlayerLogin,getPlayerLoginState,confirmPlayerName} from '../config/playerLogin.js';
import {createPlayerLoginRouter} from '../routes/playerLoginRoutes.js';

const first='2026-10-19T12:00:00.000Z';
const later='2026-10-20T12:00:00.000Z';
function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT NOT NULL,LastDateChanged TEXT);
    CREATE TABLE Logins(UID INTEGER PRIMARY KEY AUTOINCREMENT,Username TEXT NOT NULL,SteamID INTEGER NOT NULL UNIQUE,LastLoginDate TEXT NOT NULL);
    INSERT INTO Logins VALUES(77,'Existing Steam user',77,'2026-10-01T00:00:00.000Z');
    INSERT INTO PlayerInfo VALUES(1,'Recorded league name',NULL),(2,'Other player',NULL),(77,'Existing player',NULL);`);
  ensurePlayerLoginSchema(db);return db;
}

test('existing users get the same confirmation popup once, without inventing a first-login date',()=>{
  const db=fixture();try {
    ensurePlayerLoginSchema(db);
    const before=getPlayerLoginState(db,77);
    assert.equal(before.leagueName,'Existing player');assert.equal(before.nameConfirmation.required,true);
    assert.equal(before.nameConfirmation.firstLoginAtUtc,null);assert.equal(before.nameConfirmation.confirmedAtUtc,null);
    recordPlayerLogin(db,77,'Updated Steam name',first);
    assert.equal(db.prepare('SELECT UID FROM Logins WHERE SteamID=77').get().UID,77);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.firstLoginAtUtc,null);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.required,true);
    const confirmed=confirmPlayerName(db,77,'Existing player',new Date(first));
    assert.equal(confirmed.success,true);assert.equal(confirmed.confirmedAtUtc,first);
    assert.equal(db.prepare('SELECT LastDateChanged FROM PlayerInfo WHERE PlayerId=77').get().LastDateChanged,null);
    ensurePlayerLoginSchema(db);
    recordPlayerLogin(db,77,'Returning again',later);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.required,false);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.firstLoginAtUtc,null);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.confirmedAtUtc,first);
  }finally{db.close();}
});

test('returning-user rollout runs only once per database and new logins still require confirmation',()=>{
  const db=fixture();try {
    const migration=db.prepare('SELECT * FROM PlayerLoginMigrations').all();
    assert.equal(migration.length,1);assert.equal(migration[0].Version,1);
    assert.equal(Number.isFinite(Date.parse(migration[0].AppliedAtUtc)),true);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.required,true);
    db.prepare('UPDATE Logins SET NameConfirmationRequired=0 WHERE SteamID=77').run();
    ensurePlayerLoginSchema(db);ensurePlayerLoginSchema(db);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.required,false);
    assert.deepEqual(db.prepare('SELECT * FROM PlayerLoginMigrations').all(),migration);
    recordPlayerLogin(db,1,'New Steam login',first);
    assert.equal(getPlayerLoginState(db,1).nameConfirmation.required,true);
  }finally{db.close();}
});

test('failed returning-user rollout rolls back its marker and can finish on the next startup',()=>{
  const db=fixture();try {
    db.exec(`DELETE FROM PlayerLoginMigrations;
      UPDATE Logins SET NameConfirmationRequired=0 WHERE SteamID=77;
      CREATE TRIGGER reject_confirmation BEFORE UPDATE ON Logins BEGIN SELECT RAISE(ABORT,'test migration failure'); END;`);
    assert.throws(()=>ensurePlayerLoginSchema(db),/test migration failure/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PlayerLoginMigrations').get().n,0);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.required,false);
    db.exec('DROP TRIGGER reject_confirmation');
    ensurePlayerLoginSchema(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM PlayerLoginMigrations').get().n,1);
    assert.equal(getPlayerLoginState(db,77).nameConfirmation.required,true);
  }finally{db.close();}
});

test('new logins preserve their first timestamp and pending confirmation across repeated sign-ins',()=>{
  const db=fixture();try {
    recordPlayerLogin(db,1,'Steam name',first);recordPlayerLogin(db,1,'Later Steam name',later);
    const login=db.prepare('SELECT * FROM Logins WHERE SteamID=1').get();
    assert.equal(login.FirstLoginAtUtc,first);assert.equal(login.LastLoginDate,later);assert.equal(login.Username,'Later Steam name');
    assert.equal(getPlayerLoginState(db,1).nameConfirmation.required,true);
    assert.equal(getPlayerLoginState(db,1).leagueName,'Recorded league name');
  }finally{db.close();}
});

test('keeping a recorded name confirms once without consuming a name change',()=>{
  const db=fixture();try {
    recordPlayerLogin(db,1,'Steam name',first);
    const result=confirmPlayerName(db,1,'Recorded league name',new Date(first));
    assert.equal(result.success,true);assert.equal(result.required,false);assert.equal(result.confirmedAtUtc,first);
    assert.equal(result.nextNameChangeAt,null);
    assert.equal(db.prepare('SELECT LastDateChanged FROM PlayerInfo WHERE PlayerId=1').get().LastDateChanged,null);
    recordPlayerLogin(db,1,'Another Steam name',later);
    assert.equal(getPlayerLoginState(db,1).nameConfirmation.required,false);
    const replay=confirmPlayerName(db,1,'A different name',new Date(later));
    assert.equal(replay.name,'Recorded league name');assert.equal(replay.confirmedAtUtc,first);
    assert.equal(confirmPlayerName(db,88,'Cannot bypass dashboard rules',new Date(first)).status,409);
  }finally{db.close();}
});

test('first-login edits respect the existing cooldown, and keeping the name still works while locked',()=>{
  const db=fixture();try {
    recordPlayerLogin(db,1,'Steam name',first);
    const edited=confirmPlayerName(db,1,'  My chosen name  ',new Date(first));
    assert.equal(edited.name,'My chosen name');assert.equal(edited.nextNameChangeAt,'2026-11-18T12:00:00.000Z');
    recordPlayerLogin(db,2,'Another user',first);
    db.prepare('UPDATE PlayerInfo SET LastDateChanged=? WHERE PlayerId=2').run(first);
    const denied=confirmPlayerName(db,2,'Too soon',new Date(later));
    assert.equal(denied.success,false);assert.equal(denied.status,400);
    assert.equal(getPlayerLoginState(db,2).nameConfirmation.required,true);
    assert.equal(confirmPlayerName(db,2,'Other player',new Date(later)).success,true);
  }finally{db.close();}
});

test('a first-time visitor without league games can choose a name, while invalid submissions do not confirm or create a profile',()=>{
  const db=fixture();try {
    recordPlayerLogin(db,3,'New Steam visitor',first);
    assert.equal(getPlayerLoginState(db,3).leagueName,null);
    for(const name of ['',null,{},'x'.repeat(41)])assert.equal(confirmPlayerName(db,3,name,new Date(first)).status,400);
    assert.equal(db.prepare('SELECT * FROM PlayerInfo WHERE PlayerId=3').get(),undefined);
    assert.equal(getPlayerLoginState(db,3).nameConfirmation.required,true);
    const chosen=confirmPlayerName(db,3,'New league player',new Date(first));
    assert.equal(chosen.success,true);assert.equal(chosen.name,'New league player');
    assert.equal(getPlayerLoginState(db,3).nameConfirmation.required,false);
    assert.equal(db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=2').get().PlayerName,'Other player');
  }finally{db.close();}
});

test('confirmation API requires authentication and takes the account from Steam rather than the request body',async()=>{
  const db=fixture();recordPlayerLogin(db,1,'Steam name',first);recordPlayerLogin(db,2,'Another Steam name',first);
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.isAuthenticated=()=>req.get('x-test-user')==='signed-in';
    req.user={id:'76561197960265729'};next();});
  app.use('/api',createPlayerLoginRouter(db,id=>Number(BigInt(id)-76561197960265728n)));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const request=(name,signedIn=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/auth/confirm-player-name`,{
    method:'POST',headers:{'Content-Type':'application/json',...(signedIn?{'x-test-user':'signed-in'}:{}),Connection:'close'},
    body:JSON.stringify({name,accountId:2,userId:2}),
  });
  try {
    assert.equal((await request('Unauthorized',false)).status,401);
    assert.equal((await request('')).status,400);
    const response=await request('Chosen league name');assert.equal(response.status,200);
    assert.match(response.headers.get('Cache-Control'),/no-store/);
    assert.equal((await response.json()).name,'Chosen league name');
    assert.equal(getPlayerLoginState(db,1).nameConfirmation.required,false);
    assert.equal(getPlayerLoginState(db,2).leagueName,'Other player');
    assert.equal(getPlayerLoginState(db,2).nameConfirmation.required,true);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});
