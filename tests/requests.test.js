import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {ensureRequestSchema,readRequests,recordRequest} from '../config/requests.js';

test('request migration preserves old posts without inventing dates and keeps their IDs and player attribution',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(`CREATE TABLE Comments(ProblemId INTEGER PRIMARY KEY AUTOINCREMENT,UserId INTEGER,Comment VARCHAR(128));
      CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT);
      INSERT INTO PlayerInfo VALUES(7,'Captain');INSERT INTO Comments VALUES(12,7,'Existing request'),(13,99,'Unknown player request');`);
    ensureRequestSchema(db);ensureRequestSchema(db);
    assert.deepEqual(readRequests(db),[
      {ProblemId:13,UserId:99,PlayerName:'Unknown player',Comment:'Unknown player request',CreatedAtUtc:null},
      {ProblemId:12,UserId:7,PlayerName:'Captain',Comment:'Existing request',CreatedAtUtc:null},
    ]);
    const at='2026-10-24T01:30:00.000Z';recordRequest(db,7,'New request',at);
    assert.deepEqual(readRequests(db)[0],{ProblemId:14,UserId:7,PlayerName:'Captain',Comment:'New request',CreatedAtUtc:at});
    assert.equal(readRequests(db)[1].CreatedAtUtc,null);
  }finally{db.close();}
});

test('new request storage records an actual UTC submission time and reading posts preserves it',()=>{
  const db=new Database(':memory:');
  try {
    db.exec('CREATE TABLE PlayerInfo(PlayerId INTEGER PRIMARY KEY,PlayerName TEXT)');ensureRequestSchema(db);
    const before=Date.now();recordRequest(db,42,'Fresh post');const after=Date.now();
    const request=readRequests(db)[0],timestamp=Date.parse(request.CreatedAtUtc);
    assert.ok(request.CreatedAtUtc.endsWith('Z'));assert.ok(timestamp>=before&&timestamp<=after);
    assert.deepEqual(readRequests(db)[0],request);
    assert.equal(request.PlayerName,'Unknown player');
  }finally{db.close();}
});
