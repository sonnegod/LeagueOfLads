import session from 'express-session';
import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SESSION_MAX_AGE=30*24*60*60*1000;

// Keep authentication data separate from league data and collaborator exports.
export class SessionStore extends session.Store {
  constructor(filename,{now=Date.now}={}) {
    super();
    if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});
    this.now=now;
    this.db=new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('cache_size = -1024');
    this.db.exec(`CREATE TABLE IF NOT EXISTS Sessions (
      Sid TEXT PRIMARY KEY, Expires INTEGER NOT NULL, Data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS SessionsExpiry ON Sessions(Expires);`);
    this.read=this.db.prepare('SELECT Data FROM Sessions WHERE Sid=? AND Expires>?');
    this.write=this.db.prepare('INSERT INTO Sessions VALUES (?,?,?) ON CONFLICT(Sid) DO UPDATE SET Expires=excluded.Expires,Data=excluded.Data');
    this.remove=this.db.prepare('DELETE FROM Sessions WHERE Sid=?');
    this.renew=this.db.prepare('UPDATE Sessions SET Expires=? WHERE Sid=? AND Expires>?');
    this.prune=this.db.prepare('DELETE FROM Sessions WHERE Expires<=?');
    this.prune.run(this.now());
    this.cleanup=setInterval(()=>{
      try{this.prune.run(this.now());}catch(error){this.emit('error',error);}
    },60*60*1000);
    this.cleanup.unref();
  }

  complete(work,callback=()=>{}) {
    let result;
    try{result=work();}catch(error){return callback(error);}
    callback(null,result);
  }

  expires(value) {
    const expires=Date.parse(value.cookie?.expires);
    return Number.isFinite(expires)?expires:this.now()+SESSION_MAX_AGE;
  }

  get(sid,callback) {
    this.complete(()=>{
      const row=this.read.get(sid,this.now());
      return row?JSON.parse(row.Data):null;
    },callback);
  }

  set(sid,value,callback) {
    this.complete(()=>{this.write.run(sid,this.expires(value),JSON.stringify(value));},callback);
  }

  touch(sid,value,callback) {
    // An overlapping request must never recreate a logged-out or expired session.
    this.complete(()=>{this.renew.run(this.expires(value),sid,this.now());},callback);
  }

  destroy(sid,callback) {
    this.complete(()=>{this.remove.run(sid);},callback);
  }

  close() {
    clearInterval(this.cleanup);
    this.db.close();
  }
}

export function createSessionOptions(env=process.env,{filename=fileURLToPath(new URL('../db/Sessions.db',import.meta.url))}={}) {
  const secret=env.SESSION_SECRET;
  if(typeof secret!=='string'||Buffer.byteLength(secret.trim())<32) {
    throw new Error('Set SESSION_SECRET in .env to a stable random secret of at least 32 bytes before starting the server.');
  }
  return {
    store:new SessionStore(filename),secret,resave:false,saveUninitialized:false,rolling:true,
    cookie:{secure:env.ENVIRONMENT==='PROD',httpOnly:true,sameSite:'lax',maxAge:SESSION_MAX_AGE},
  };
}
