import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import {Passport} from 'passport';
import {SessionStore,createSessionOptions,SESSION_MAX_AGE} from '../config/sessionStore.js';
import {createLogoutHandler} from '../routes/authLogout.js';

const secret='a-test-secret-only-not-used-by-the-application-12345';
const call=(store,method,...args)=>new Promise((resolve,reject)=>store[method](...args,(error,value)=>error?reject(error):resolve(value)));

async function server(filename,{production=false,sessionSecret=secret}={}) {
  const options=createSessionOptions({SESSION_SECRET:sessionSecret,ENVIRONMENT:production?'PROD':'DEV'},{filename});
  const passport=new Passport();
  passport.serializeUser((user,done)=>done(null,user));
  passport.deserializeUser((user,done)=>done(null,user));
  const app=express();app.set('trust proxy','loopback');
  app.use(session(options));app.use(passport.initialize());app.use(passport.session());
  app.post('/login',(req,res,next)=>req.logIn({id:'76561197960265829',displayName:'Test player'},error=>error?next(error):res.json({ok:true})));
  app.get('/me',(req,res)=>req.isAuthenticated()?res.json({name:req.user.displayName}):res.status(401).end());
  const removed=[];
  app.post('/logout',createLogoutHandler({removeWaiting:id=>removed.push(id)}));
  const http=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  return {store:options.store,removed,request:(route,{cookie,method='GET',https=false}={})=>fetch(`http://127.0.0.1:${http.address().port}${route}`,{
    method,redirect:'manual',headers:{...(cookie?{cookie}:{}),...(https?{'X-Forwarded-Proto':'https'}:{})},
  }),close:async()=>{await new Promise(resolve=>{http.close(resolve);http.closeAllConnections();});options.store.close();}};
}

test('Passport login survives a server/store restart; logout revokes the persisted cookie',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'lads-sessions-')),filename=path.join(directory,'Sessions.db');
  let app;
  try {
    app=await server(filename);
    assert.equal((await app.request('/me')).status,401);
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM Sessions').get().n,0,'Anonymous requests do not create sessions');
    const before=Date.now(),login=await app.request('/login',{method:'POST'});
    assert.equal(login.status,200);
    const header=login.headers.get('set-cookie'),cookie=header.split(';')[0];
    assert.match(header,/HttpOnly/i);assert.match(header,/SameSite=Lax/i);assert.doesNotMatch(header,/; Secure/i);
    const expires=Date.parse(header.match(/Expires=([^;]+)/i)[1]);
    assert.ok(Math.abs(expires-before-SESSION_MAX_AGE)<5000,'Browser cookie lasts 30 days');
    const firstExpiry=app.store.db.prepare('SELECT Expires FROM Sessions').get().Expires;
    assert.ok(Math.abs(firstExpiry-before-SESSION_MAX_AGE)<5000,'Stored session also lasts 30 days');
    await app.close();app=null;

    app=await server(filename);
    const resumed=await app.request('/me',{cookie});
    assert.equal(resumed.status,200);assert.equal((await resumed.json()).name,'Test player');
    assert.ok(resumed.headers.get('set-cookie'),'Active requests renew the browser cookie');
    assert.ok(app.store.db.prepare('SELECT Expires FROM Sessions').get().Expires>=firstExpiry);
    const tampered=cookie.slice(0,-1)+(cookie.endsWith('x')?'y':'x');
    assert.equal((await app.request('/me',{cookie:tampered})).status,401);
    const logout=await app.request('/logout',{method:'POST',cookie});
    assert.equal(logout.status,302);assert.match(logout.headers.get('set-cookie'),/connect\.sid=;/);
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM Sessions').get().n,0);
    assert.deepEqual(app.removed,['101']);
    assert.equal((await app.request('/me',{cookie})).status,401,'Old cookies cannot authenticate after logout');
  }finally{if(app)await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('production uses secure cookies behind HTTPS proxy and a changed secret rejects saved sessions',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'lads-sessions-')),filename=path.join(directory,'Sessions.db');
  let app;
  try {
    app=await server(filename,{production:true});
    const login=await app.request('/login',{method:'POST',https:true});
    const header=login.headers.get('set-cookie');assert.match(header,/; Secure/i);
    const cookie=header.split(';')[0];
    assert.equal((await app.request('/me',{cookie,https:true})).status,200);
    await app.close();app=null;
    app=await server(filename,{production:true,sessionSecret:secret+'changed'});
    assert.equal((await app.request('/me',{cookie,https:true})).status,401);
  }finally{if(app)await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('expiry is enforced before cleanup, renewal does not revive expired or logged-out sessions, and startup prunes old rows',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'lads-sessions-')),filename=path.join(directory,'Sessions.db');
  let clock=Date.parse('2026-11-16T12:00:00Z'),store;
  const value=()=>({cookie:{expires:new Date(clock+SESSION_MAX_AGE).toISOString()},passport:{user:{id:101}}});
  try {
    store=new SessionStore(filename,{now:()=>clock});
    await call(store,'set','expired',value());
    clock+=SESSION_MAX_AGE;
    assert.equal(await call(store,'get','expired'),null);
    await call(store,'touch','expired',value());
    assert.equal(await call(store,'get','expired'),null);
    await call(store,'set','active',value());
    clock+=1000;
    await call(store,'touch','active',value());
    assert.equal(store.db.prepare('SELECT Expires FROM Sessions WHERE Sid=?').get('active').Expires,clock+SESSION_MAX_AGE);
    await call(store,'destroy','active');await call(store,'touch','active',value());
    assert.equal(await call(store,'get','active'),null);
    store.close();store=null;
    store=new SessionStore(filename,{now:()=>clock});
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM Sessions').get().n,0);
  }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});

test('session secret must be configured with at least 32 bytes without exposing it in errors',()=>{
  for(const value of [undefined,'','your-secret',' '.repeat(40),'short']) {
    assert.throws(()=>createSessionOptions({SESSION_SECRET:value},{filename:':memory:'}),/Set SESSION_SECRET/);
  }
  const options=createSessionOptions({SESSION_SECRET:secret,ENVIRONMENT:'DEV'},{filename:':memory:'});
  try{assert.equal(options.cookie.maxAge,SESSION_MAX_AGE);assert.equal(options.rolling,true);assert.equal(options.saveUninitialized,false);}
  finally{options.store.close();}
});
