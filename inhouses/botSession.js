import SteamUser from 'steam-user';
import {Dota2User} from 'dota2-user';
import {gc, encodeLobbyCommand, decodeLobbyResponse, decodeChatJoined, normalizeGCMatch, steamIdForPlayer} from './botProtocol.js';

export function createBotSession(auth, {clock = Date.now, onToken = () => {}, onInvitation = () => {},
  steam = new SteamUser({dataDirectory: null, autoRelogin: true, renewRefreshTokens: true})} = {}) {
  const dota = new Dota2User(steam), results = new Map();
  let lobby = null, ready = false, readyAt = 0, lastActivityAt = 0, status = 'connecting', error = null, closed = false;
  let chatChannel = null, chatJoinDue = 0;
  function rawCommand(name, data) {
    const {messageId,payload} = encodeLobbyCommand(name,data);
    dota.sendRawBuffer(messageId,payload);
  }
  function resetChat(leave = true) {
    if (leave && chatChannel && ready && !closed) rawCommand('chatLeave',{channelId:chatChannel});
    chatChannel = null; chatJoinDue = 0;
  }
  function accept(bytes, removed = false) {
    const next = gc.CSODOTALobby.decode(bytes);
    if (removed) {if (lobby?.lobbyId === next.lobbyId) {resetChat(); lobby = null;} return;}
    if (lobby?.lobbyId !== next.lobbyId) resetChat();
    lobby = next; error = null; lastActivityAt = clock();
    if (Number(next.matchId) > 0 && next.matchOutcome !== 0) results.set(Number(next.matchId), next);
    while (results.size > 10) results.delete(results.keys().next().value);
  }
  const object = (item, removed = false) => {if (item.typeId === 2004) accept(item.objectData, removed);};
  const cache = data => {for (const item of data.objects || []) if (item.typeId === 2004) for (const bytes of item.objectData) accept(bytes);};
  dota.router.on(gc.EGCBaseClientMsg.k_EMsgGCClientWelcome, data => {for (const entry of data.outofdateSubscribedCaches || []) cache(entry);});
  dota.router.on(gc.ESOMsg.k_ESOMsg_CacheSubscribed, cache);
  dota.router.on(gc.ESOMsg.k_ESOMsg_CacheUnsubscribed, data => {if (data.ownerSoid?.id === lobby?.lobbyId) {resetChat(); lobby = null;}});
  dota.router.on(gc.ESOMsg.k_ESOMsg_Create, item => object(item));
  dota.router.on(gc.ESOMsg.k_ESOMsg_Update, item => object(item));
  dota.router.on(gc.ESOMsg.k_ESOMsg_Destroy, item => object(item, true));
  dota.router.on(gc.ESOMsg.k_ESOMsg_UpdateMultiple, data => {
    for (const item of [...data.objectsAdded, ...data.objectsModified]) object(item);
    for (const item of data.objectsRemoved) object(item, true);
  });
  // This response schema is missing from the library's router mappings.
  steam.on('receivedFromGC', (app, type, bytes) => {
    if (app === 570 && type === 7010) {
      const response = decodeChatJoined(bytes);
      if (lobby && response.channelName === `Lobby_${lobby.lobbyId}` && response.channelType === 3) {
        if (response.result === 0 && response.channelId !== '0') chatChannel = response.channelId;
        else error = `Dota lobby chat join failed (code ${response.result}).`;
      }
    }
    if (app === 570 && type === gc.EGCBaseMsg.k_EMsgGCInvitationCreated) {
      const data = gc.CMsgInvitationCreated.decode(bytes);
      onInvitation({steamId: data.steamId, lobbyId: data.groupId, userOffline: data.userOffline});
    }
    if (app === 570 && type === 22) object(gc.CMsgSOSingleObject.decode(bytes));
    if (app === 570 && type === 7113) {
      const code = decodeLobbyResponse(bytes);
      if (code) error = `Dota rejected a lobby command (code ${code}). Check ticket permissions and lobby settings.`;
    }
  });
  dota.on('connectedToGC', () => {ready = true; readyAt = clock(); lastActivityAt = clock(); status = 'connected'; error = null;});
  dota.on('disconnectedFromGC', () => {ready = false; resetChat(false); status = 'offline'; error = 'Dota connection interrupted; reconnecting.';});
  steam.on('loggedOn', () => {
    if (steam.steamID.getSteamID64() !== auth.steamId) {error = 'Steam session belongs to a different bot account.'; status = 'error'; steam.logOff(); return;}
    steam.gamesPlayed([570]);
  });
  steam.on('refreshToken', token => {
    try {onToken({...auth, refreshToken: token});}
    catch {error = 'Unable to save the renewed Steam session.';}
  });
  steam.on('steamGuard', () => {status = 'error'; error = 'Steam authentication required. Run the bot authentication command again.';});
  steam.on('error', problem => {status = 'error'; ready = false; error = `Steam login failed (code ${Number(problem.eresult) || 'unknown'}). Reauthenticate this bot if needed.`;});
  return {
    get steamId() {return auth.steamId;}, get lobby() {return lobby;},
    get ready() {return ready && !closed && clock() >= readyAt + 2000;},
    get status() {return status;}, get error() {return error;},
    get lastActivityAt() {return lastActivityAt;},
    start() {steam.logOn({refreshToken: auth.refreshToken});},
    command(name, data) {
      if (!ready || closed) throw new Error('Lobby bot is not connected to Dota');
      const {messageId, payload} = encodeLobbyCommand(name, data);
      dota.sendRawBuffer(messageId, payload);
    },
    invite(playerId) {dota.sendPartial(gc.EGCBaseMsg.k_EMsgGCInviteToLobby, {steamId: String(76561197960265728n + BigInt(playerId))});},
    async playerName(playerId) {
      const id = steamIdForPlayer(playerId);
      let name = steam.users?.[id]?.player_name;
      if (!name) {
        try {name = (await steam.getPersonas([id])).personas?.[id]?.player_name;}
        catch {return null;}
      }
      return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100) || null : null;
    },
    sayLobby(text) {
      if (!ready || closed || !lobby) return false;
      if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('Lobby messages must contain 1–500 characters');
      if (!chatChannel) {
        if (clock() >= chatJoinDue) {
          chatJoinDue = clock() + 10000;
          rawCommand('chatJoin',{channelName:`Lobby_${lobby.lobbyId}`,channelType:3});
        }
        return false;
      }
      rawCommand('chat',{channelId:chatChannel,text}); return true;
    },
    async details(matchId) {
      if (!ready || closed) throw new Error('Lobby bot is not connected to Dota');
      const response = await dota.sendJob(gc.EDOTAGCMsg.k_EMsgGCMatchDetailsRequest,
        gc.CMsgGCMatchDetailsRequest.fromPartial({matchId: String(matchId)}));
      if (response.result !== 1) throw new Error('Dota has not returned the completed match yet');
      lastActivityAt = clock();
      return normalizeGCMatch(response.match, matchId);
    },
    result(matchId) {return results.get(matchId);},
    resultForLobby(lobbyId) {return [...results.values()].find(value => value.lobbyId === lobbyId);},
    close() {closed = true; ready = false; steam.logOff();},
  };
}
