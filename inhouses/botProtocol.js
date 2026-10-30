import protobuf from 'protobufjs';
import * as gc from 'dota2-user/protobufs/index.js';

// Field numbers from Valve's dota_gcmessages_client_match_management.proto.
// The client library handles the Steam/GC session and snapshots, but omits
// these lobby command encoders. Keep this small wire schema explicit.
const root = protobuf.parse(`syntax = "proto2";
  message Details {
    optional uint64 lobby_id=1; optional string game_name=2;
    optional uint32 server_region=4; optional uint32 game_mode=5;
    optional bool allow_cheats=10; optional bool fill_with_bots=11;
    optional bool allow_spectating=13; optional string pass_key=15;
    optional uint32 leagueid=16; optional uint32 dota_tv_delay=24;
    optional bool lan=25; optional uint32 visibility=33;
  }
  message Create {optional string pass_key=5; optional Details lobby_details=7;}
  message Join {optional uint64 lobby_id=1; optional string pass_key=3;}
  message Team {optional uint32 team=1; optional uint32 slot=2;}
  message Kick {optional uint32 account_id=3;}
  message Unseat {optional uint32 account_id=1;}
  message Empty {}
  message Response {optional uint32 result=1;}
  message ChatJoin {optional string channel_name=2; optional uint32 channel_type=4;}
  message ChatJoined {optional string channel_name=2; optional fixed64 channel_id=3; optional uint32 channel_type=6; optional uint32 result=7;}
  message ChatText {optional uint64 channel_id=2; optional string text=4;}
  message ChatLeave {optional uint64 channel_id=1;}
`).root;
const commands = {
  create: [7038, 'Create'], details: [7046, 'Details'], join: [7044, 'Join'],
  team: [7047, 'Team'], kick: [7081, 'Kick'], unseat: [8047, 'Unseat'],
  leave: [7040, 'Empty'], launch: [7041, 'Empty'],
  chatJoin: [7009, 'ChatJoin'], chat: [7273, 'ChatText'], chatLeave: [7272, 'ChatLeave'],
};
export {gc};
export function encodeLobbyCommand(name, data = {}) {
  const [messageId, typeName] = commands[name] || [];
  if (!typeName) throw new Error('Unknown lobby command');
  const type = root.lookupType(typeName), message = type.fromObject(data);
  return {messageId, payload: Buffer.from(type.encode(message).finish())};
}
export const decodeLobbyResponse = bytes => root.lookupType('Response').decode(bytes).result || 0;
export const decodeChatJoined = bytes => root.lookupType('ChatJoined').toObject(root.lookupType('ChatJoined').decode(bytes), {longs:String,defaults:true});
export const steamIdForPlayer = id => String(76561197960265728n + BigInt(id));
export function accountId(steamId) {
  try {const id = BigInt(steamId) - 76561197960265728n; return id > 0n && id < 4294967295n ? Number(id) : null;}
  catch {return null;}
}
export function lobbyMembers(lobby) {
  const all = lobby.allMembers || [];
  // allMembers retains historical slots. Only memberIndices identifies the
  // currently present accounts; stale slots must not make a lobby look full.
  const indices = lobby.memberIndices || [];
  return indices.map(i => all[i]).filter(p => p && accountId(p.id));
}
export function normalizeGCMatch(match, requestedId) {
  if (!match || Number(match.matchId) !== Number(requestedId)) throw new Error('Dota has not returned this match result yet');
  return {matchId: Number(match.matchId), leagueId: Number(match.leagueid),
    startedAt: Number(match.starttime) > 0 ? Number(match.starttime) * 1000 : null,
    duration: Number(match.duration) || 0,
    winner: match.matchOutcome === 2 ? 'radiant' : match.matchOutcome === 3 ? 'dire' : null,
    players: (match.players || []).map(p => ({playerId: Number(p.accountId),
      side: Number.isInteger(p.playerSlot) ? p.playerSlot < 128 ? 'radiant' : 'dire' : null}))};
}
