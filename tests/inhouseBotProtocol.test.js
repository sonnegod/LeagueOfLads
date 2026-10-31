import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync, readFileSync, unlinkSync, rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import protobuf from 'protobufjs';
import {createBotSession} from '../inhouses/botSession.js';
import {accountId, steamIdForPlayer, encodeLobbyCommand, normalizeGCMatch, lobbyMembers, gc} from '../inhouses/botProtocol.js';
import {readBotAuth, writeBotAuth, botAuthPath} from '../inhouses/botAuth.js';

test('lobby command bytes preserve Valve field numbers and full 64-bit lobby IDs', () => {
  // Independent minimal decoders describe the published wire contract.
  const schema = protobuf.parse(`syntax="proto2";
    message Config {optional uint64 lobby=1; optional string name=2; optional uint32 region=4; optional uint32 mode=5; optional uint32 pick=6; optional uint32 ticket=16; optional uint32 priority=46;}
    message NewLobby {optional string password=5; optional Config config=7;}
    message AccountKick {optional uint32 account=3;}
    message AccountUnseat {optional uint32 account=1;}
  `).root;
  const create = encodeLobbyCommand('create', {passKey:'secret', lobbyDetails:{gameName:'Inhouse #1',serverRegion:2,gameMode:1,leagueid:18083}});
  assert.equal(create.messageId, 7038);
  const decoded = schema.lookupType('NewLobby').decode(create.payload);
  assert.equal(decoded.password, 'secret'); assert.equal(decoded.config.ticket, 18083);
  assert.equal(decoded.config.region, 2); assert.equal(decoded.config.mode, 1);
  const captainMode=schema.lookupType('Config').decode(encodeLobbyCommand('details',{gameMode:2,cmPick:2,selectionPriorityRules:0}).payload);
  assert.equal(captainMode.mode,2);assert.equal(captainMode.pick,2);assert.equal(captainMode.priority,0);
  const id = '18446744073709550000';
  const config = schema.lookupType('Config').decode(encodeLobbyCommand('details',{lobbyId:id}).payload);
  assert.equal(config.lobby.toString(), id);
  assert.equal(schema.lookupType('AccountKick').decode(encodeLobbyCommand('kick',{accountId:123}).payload).account,123);
  assert.equal(schema.lookupType('AccountUnseat').decode(encodeLobbyCommand('unseat',{accountId:123}).payload).account,123);
  assert.equal(encodeLobbyCommand('launch').payload.length, 0);
  assert.equal(accountId(steamIdForPlayer(92627233)), 92627233);
  assert.equal(accountId('not-a-steam-id'), null);
  const stale = {allMembers:[{id:steamIdForPlayer(1)},{id:steamIdForPlayer(2)}],memberIndices:[1]};
  assert.deepEqual(lobbyMembers(stale), [stale.allMembers[1]]);
  assert.deepEqual(lobbyMembers({...stale,memberIndices:[]}), []);
});

test('the real GC decoder accepts reconnect caches, live updates, terminal outcomes and lobby unsubscribe', async () => {
  let now = 1000;
  const steam = new EventEmitter(), sent = [], invitations = [];
  Object.assign(steam,{packageName:'steam-user',packageVersion:'5.3.0',steamID:{getSteamID64:()=>steamIdForPlayer(1001)},
    logOn(){},logOff(){},gamesPlayed(){},sendToGC(app,id,header,bytes){sent.push({app,id,bytes});}});
  const session = createBotSession({steamId:steamIdForPlayer(1001),refreshToken:'test'}, {steam,clock:()=>now,onInvitation:data=>invitations.push(data)});
  steam.getPersonas=async ids=>({personas:{[ids[0]]:{player_name:'  Lobby Tester\n  '}}});
  assert.equal(await session.playerName(49219700),'Lobby Tester');
  const raw = (id,type,data) => steam.emit('receivedFromGC',570,id,Buffer.from(type.encode(type.fromPartial(data)).finish()));
  const lobby = gc.CSODOTALobby.fromPartial({lobbyId:'12345678901234567',leaderId:steamIdForPlayer(1001),
    gameName:'Lads Inhouse #1',leagueid:18083,allMembers:[{id:steamIdForPlayer(1),team:0},{id:steamIdForPlayer(2),team:1}],memberIndices:[0,1]});
  const bytes = Buffer.from(gc.CSODOTALobby.encode(lobby).finish());
  raw(4004,gc.CMsgClientWelcome,{outofdateSubscribedCaches:[{objects:[{typeId:2004,objectData:[bytes]}]}]});
  now += 2000; assert.equal(session.ready,true); assert.equal(session.lobby.lobbyId,lobby.lobbyId);
  session.command('create',{passKey:'test',lobbyDetails:{leagueid:18083}});
  assert.equal(sent.at(-1).id,7038);
  const chatSchema=protobuf.parse(`syntax="proto2";
    message Join {optional string name=2;optional uint32 type=4;}
    message Joined {optional string name=2;optional fixed64 id=3;optional uint32 type=6;optional uint32 result=7;}
    message Text {optional uint64 id=2;optional string text=4;}
  `).root;
  assert.equal(session.sayLobby('Join Radiant, slot 1.'),false);
  assert.equal(sent.at(-1).id,7009);
  const join=chatSchema.lookupType('Join').decode(sent.at(-1).bytes);
  assert.equal(join.name,`Lobby_${lobby.lobbyId}`);assert.equal(join.type,3);
  const sends=sent.length;
  session.sayLobby('Join Radiant, slot 1.');assert.equal(sent.length,sends,'Chat join requests are paced while waiting');
  const chatId='12345678901234568',joined=chatSchema.lookupType('Joined');
  steam.emit('receivedFromGC',570,7010,Buffer.from(joined.encode({name:`Lobby_${lobby.lobbyId}`,id:chatId,type:3,result:0}).finish()));
  assert.equal(session.sayLobby('Join Radiant, slot 1.'),true);
  assert.equal(sent.at(-1).id,7273);
  const text=chatSchema.lookupType('Text').decode(sent.at(-1).bytes);
  assert.equal(text.id.toString(),chatId);assert.equal(text.text,'Join Radiant, slot 1.');
  session.invite(49219700);
  assert.equal(sent.at(-1).id,4512);
  assert.equal(gc.CMsgInviteToLobby.decode(sent.at(-1).bytes).steamId,steamIdForPlayer(49219700));
  raw(4502,gc.CMsgInvitationCreated,{groupId:lobby.lobbyId,steamId:steamIdForPlayer(49219700),userOffline:false});
  assert.deepEqual(invitations,[{lobbyId:lobby.lobbyId,steamId:steamIdForPlayer(49219700),userOffline:false}]);
  raw(7055,gc.CMsgGenericResult,{eresult:15});
  assert.match(session.error,/AccessDenied, code 15/);
  raw(22,gc.CMsgSOSingleObject,{typeId:2004,objectData:bytes});
  assert.match(session.error,/league-admin/,'A lobby snapshot does not hide a rejected command');
  raw(7055,gc.CMsgGenericResult,{eresult:1});assert.equal(session.error,null,'EResult 1 is success');
  steam.emit('receivedFromGC',570,7113,Buffer.from([8,0]));assert.equal(session.error,null,'Join result 0 is success');
  const final = {...lobby,state:3,matchId:'9067573923',matchOutcome:3,matchDuration:600};
  raw(22,gc.CMsgSOSingleObject,{typeId:2004,objectData:Buffer.from(gc.CSODOTALobby.encode(final).finish())});
  assert.equal(session.lobby.matchOutcome,3);
  assert.equal(session.result(9067573923).matchDuration,600);
  raw(25,gc.CMsgSOCacheUnsubscribed,{ownerSoid:{id:lobby.lobbyId,type:0}});
  assert.equal(sent.at(-1).id,7272,'Leaving the lobby also leaves its chat');
  assert.equal(session.sayLobby('Cannot write to the old lobby.'),false);
  assert.equal(session.lobby,null);
  assert.equal(session.result(9067573923).matchOutcome,3,'The result survives players leaving the lobby');
  steam.emit('error',{eresult:5,message:'secret credentials must never be exposed'});
  assert.equal(session.ready,false); assert.doesNotMatch(session.error,/secret credentials/);
  session.close();
});

test('GC result normalization requires an explicit victory outcome rather than a default boolean', () => {
  const raw = {matchId:'5',leagueid:18083,starttime:100,duration:500,
    players:[{accountId:1,playerSlot:0},{accountId:2,playerSlot:128}]};
  assert.equal(normalizeGCMatch(raw,5).winner,null);
  assert.equal(normalizeGCMatch({...raw,matchOutcome:0},5).winner,null);
  assert.equal(normalizeGCMatch({...raw,matchOutcome:66},5).winner,null);
  assert.equal(normalizeGCMatch({...raw,matchOutcome:2},5).winner,'radiant');
  assert.equal(normalizeGCMatch({...raw,matchOutcome:3},5).winner,'dire');
  assert.throws(()=>normalizeGCMatch(raw,6),/not returned/);
});

test('bot authentication stays in separate private files and slot IDs are bounded to five', () => {
  const directory = mkdtempSync(join(tmpdir(),'lads-bot-auth-')), previous = process.env.INHOUSE_BOT_AUTH_DIR;
  process.env.INHOUSE_BOT_AUTH_DIR = directory;
  try {
    assert.equal(readBotAuth(1),null);
    const data = {steamId:steamIdForPlayer(1001),refreshToken:'fake-test-session'};
    writeBotAuth(1,data); assert.deepEqual(readBotAuth(1),data);
    assert.equal(JSON.parse(readFileSync(botAuthPath(1),'utf8')).refreshToken,data.refreshToken);
    const newer = {...data,steamId:steamIdForPlayer(3000000000)};
    writeBotAuth(1,newer); assert.deepEqual(readBotAuth(1),newer,'Newer accounts must not be restricted to an old Steam ID prefix');
    assert.throws(()=>botAuthPath(0),/1 to 5/); assert.throws(()=>botAuthPath(6),/1 to 5/);
  } finally {
    unlinkSync(join(directory,'bot-1.json')); rmdirSync(directory);
    if (previous === undefined) delete process.env.INHOUSE_BOT_AUTH_DIR; else process.env.INHOUSE_BOT_AUTH_DIR=previous;
  }
});
