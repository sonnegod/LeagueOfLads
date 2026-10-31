import {BOT_COUNT, readBotAuth, writeBotAuth} from './botAuth.js';
import {createBotSession} from './botSession.js';
import {accountId, lobbyMembers} from './botProtocol.js';

export function createInhouseBotPool(store, {clock = Date.now, readAuth = readBotAuth,
  saveAuth = writeBotAuth, createSession = createBotSession} = {}) {
  const slots = new Map(), received = [], requests = new Map();
  let stopped = false;
  function errorFor(slot, message) {
    slot.error = message;
    if (slot.gameId) store.hostingUpdate(slot.gameId, {HostingError: message});
  }
  function send(slot, name, body) {
    slot.nextCommand = clock() + 1000;
    slot.session.command(name, body);
  }
  function settingsFor(g) {
    return {lobbyId: g.LobbyId || undefined, gameName: g.LobbyName, passKey: g.LobbyPassword,
      serverRegion: g.ServerRegion, gameMode: g.GameMode, leagueid: g.LeagueId,
      cmPick: g.GameMode === 2 && g.FirstPickSide ? g.FirstPickSide === g.LobbyRadiantSide ? 1 : 2 : 0, selectionPriorityRules: 0,
      allowCheats: false, fillWithBots: false, allowSpectating: true, dotaTvDelay: 0, lan: false, visibility: 2};
  }
  function applyResult(gameId, match) {
    const g = store.rawGame(gameId);
    if (!['awaiting_game','playing'].includes(g.Status)) return;
    store.validateMatch(g, match);
    const outcome = store.applyMatch(gameId, match);
    if (outcome.completed) store.saveBotMatchResult(match);
    else if (match.winner && match.duration > 0 && match.duration < (g.PlayerCount < 10 ? 1 : 300)) {
      store.cancel(gameId, 'Dota confirmed a short game; treated as an unrated remake.', null);
    }
  }
  function processLobby(slot, g, lobby) {
    const session = slot.session;
    if (lobby.lobbyId !== g.LobbyId && (g.LobbyId || lobby.gameName !== g.LobbyName)) {
      errorFor(slot, 'This bot is in a different lobby. Its saved inhouse has not been reassigned.'); return;
    }
    if (!g.LobbyId) {store.hostingUpdate(g.InhouseId, {LobbyId: lobby.lobbyId}); g = store.rawGame(g.InhouseId);}
    if (lobby.leagueid !== g.LeagueId) {
      if (lobby.state === 0) {
        errorFor(slot, g.LeagueId
          ? `Dota has not applied inhouse ticket ${g.LeagueId} to this lobby (current ticket: ${lobby.leagueid || 'none'}). Check this bot account's league-admin access.`
          : `Dota has not removed ticket ${lobby.leagueid} from this solo test lobby. Waiting for the unticketed lobby settings.`);
        send(slot, 'details', {...settingsFor(g), lobbyId: lobby.lobbyId}); return;
      }
      errorFor(slot, 'Lobby uses a different ticket. Check the bot account’s league permissions.'); return;
    }
    const matchId = Number(lobby.matchId);
    if (matchId > 0 && g.LaunchRosterJson && g.BotLaunchedAt) {
      const match = {matchId, leagueId: g.LeagueId, startedAt: Number(lobby.gameStartTime) > 0
        ? Number(lobby.gameStartTime) * 1000 : g.StartedAt || g.BotLaunchedAt,
      players: JSON.parse(g.LaunchRosterJson), duration: Number(lobby.matchDuration) || 0,
      winner: lobby.matchOutcome === 2 ? 'radiant' : lobby.matchOutcome === 3 ? 'dire' : null};
      if (g.MatchId && g.MatchId !== matchId) {errorFor(slot, 'Lobby match ID differs from the saved inhouse match. An admin must check its link.'); return;}
      if ([64,65,66,67,68,69].includes(lobby.matchOutcome)) {
        store.validateMatch(g, match);
        store.cancel(g.InhouseId, `Dota confirmed this match was not scored (outcome ${lobby.matchOutcome}).`, null); return;
      }
      applyResult(g.InhouseId, match);
      if (store.rawGame(g.InhouseId).Status === 'completed') return;
    }
    if (g.Status === 'playing' || matchId > 0 || lobby.state !== 0) return;
    if (g.BotLaunchedAt && clock() > g.BotLaunchedAt + 300000) {
      store.cancel(g.InhouseId, 'Dota returned to the waiting lobby without starting a match within five minutes of launch.', null); return;
    }
    if (!g.BotLaunchedAt && g.LobbyJoinStartedAt != null && g.Deadline <= clock()) {
      store.cancel(g.InhouseId, 'The lobby join timer expired before all players joined their assigned teams.', null); return;
    }
    if (lobby.leaderId !== session.steamId) {errorFor(slot, 'Lobby bot is not the lobby host.'); return;}
    if (lobby.gameMode !== g.GameMode || lobby.serverRegion !== g.ServerRegion || g.GameMode === 2 && (lobby.cmPick !== settingsFor(g).cmPick || lobby.selectionPriorityRules !== 0) || lobby.allowCheats || lobby.fillWithBots || lobby.lan
      || lobby.visibility !== 2 || !lobby.allowSpectating || lobby.passKey !== g.LobbyPassword) {
      send(slot, 'details', settingsFor(g)); return;
    }
    const members = lobbyMembers(lobby), bot = members.find(p => p.id === session.steamId);
    if (bot && [0,1].includes(bot.team)) {send(slot, 'unseat', {accountId: accountId(session.steamId)}); return;}
    if (!bot) {errorFor(slot, 'Bot is not present in the assigned lobby.'); return;}
    if (g.LobbyJoinStartedAt == null) {
      store.startLobbyTimer(g.InhouseId, lobby.lobbyId);
      g = store.rawGame(g.InhouseId);
    }
    const players = store.members(g.InhouseId);
    const expected = new Map(players.map(p => [p.playerId, p.side === g.LobbyRadiantSide ? 0 : 1]));
    for (const member of members) {
      const id = accountId(member.id);
      if (member.id === session.steamId) continue;
      if (!expected.has(id)) {send(slot, 'kick', {accountId: id}); return;}
      if ([0,1].includes(member.team) && member.team !== expected.get(id)) {
        send(slot, 'unseat', {accountId: id}); return;
      }
    }
    const present = new Map(members.filter(p => p.id !== session.steamId).map(p => [accountId(p.id), p]));
    for (const player of players) {
      if (!present.has(player.playerId) && (slot.invites.get(player.playerId) || 0) <= clock()) {
        slot.invites.set(player.playerId, clock() + 30000); slot.nextCommand = clock() + 1000;
        session.invite(player.playerId); return;
      }
    }
    if (players.some(p => present.get(p.playerId)?.team !== expected.get(p.playerId))) {
      store.hostingUpdate(g.InhouseId, {HostingError: 'Waiting for all invited players to join their assigned Radiant / Dire teams.'}); return;
    }
    if ((slot.launchDue || 0) > clock()) return;
    // Persist the verified identities before launch: postgame snapshots may
    // remove players as they leave, but cannot change this verified roster.
    const roster = players.map(p => ({playerId: p.playerId, side: p.side === g.LobbyRadiantSide ? 'radiant' : 'dire'}));
    store.hostingUpdate(g.InhouseId, {BotLaunchedAt: g.BotLaunchedAt || clock(), LaunchRosterJson: JSON.stringify(roster), HostingError: null});
    slot.launchDue = clock() + 30000; send(slot, 'launch');
  }
  function pollResult(slot, g, lobby) {
    if (lobby && [1,2,6].includes(lobby.state) && ![6,7].includes(lobby.gameState) && !lobby.matchOutcome) return;
    if (!g.MatchId || (slot.resultDue || 0) > clock() || requests.has(g.MatchId)) return;
    slot.resultDue = clock() + 15000;
    details(g.MatchId, slot.id).then(match => {if (!stopped) received.push({gameId: g.InhouseId, match});}, () => {
      if (!stopped) received.push({gameId: g.InhouseId, error: 'Dota has not returned the completed result yet. The bot remains assigned and will retry.'});
    });
  }
  async function details(matchId, botId = null) {
    const cached = store.botMatchResult(matchId);
    if (cached) return cached;
    if (requests.has(matchId)) return requests.get(matchId);
    const slot = botId ? slots.get(botId) : [...slots.values()].find(s => s.session?.ready && (s.nextResultRequest || 0) <= clock());
    if (!slot?.session?.ready) throw new Error('No lobby bot is connected to Dota');
    if ((slot.nextResultRequest || 0) > clock()) throw new Error('Lobby bot result checks are paced. It will retry shortly.');
    slot.nextResultRequest = clock() + 15000;
    const pending = slot.session.details(matchId);
    requests.set(matchId, pending);
    try {return await pending;} finally {requests.delete(matchId);}
  }
  return {
    start() {
      const configs = new Map(), identities = new Set();
      for (let id = 1; id <= BOT_COUNT; id++) {
        try {
          const auth = readAuth(id);
          if (auth && identities.has(auth.steamId)) throw new Error('Each bot needs a different Steam account.');
          if (auth) identities.add(auth.steamId);
          configs.set(id, {auth});
        } catch {configs.set(id, {error: `Bot ${id} authentication is invalid or duplicated. Reauthenticate this slot.`});}
      }
      for (const [id, config] of configs) {
        const previous = store.db.prepare('SELECT * FROM InhouseBots WHERE BotId=?').get(id);
        const slot = {id, session: null, error: config.error || null, nextCommand: 0, invites: new Map(), gameId: previous.InhouseId};
        slots.set(id, slot);
        if (config.auth && (!previous.InhouseId || !previous.SteamId || previous.SteamId === config.auth.steamId)) {
          slot.session = createSession(config.auth, {clock, onToken: data => saveAuth(id, data)});
          store.updateBot(id, {steamId: config.auth.steamId, status: 'connecting'});
          slot.session.start();
        } else {
          slot.error ||= previous.InhouseId ? 'Restore this bot’s original authentication; it still owns an inhouse.' : null;
          store.updateBot(id, {steamId: previous.InhouseId ? previous.SteamId : null,
            status: slot.error ? 'error' : 'unconfigured', error: slot.error});
        }
      }
    },
    tick() {
      if (stopped) return;
      for (const event of received.splice(0)) {
        try {
          if (event.lookupId) {
            if (event.error || !event.match?.winner) {
              store.mutate(() => store.db.prepare(`UPDATE InhouseBotLookups SET LastError=?,
                Status=CASE WHEN Attempts>=10 THEN 'failed' ELSE 'pending' END WHERE LookupId=? AND Status='pending'`)
                .run(event.error || 'Dota has not confirmed a winner yet. The bot will retry.', event.lookupId));
            } else store.finishBotLookup(event.lookupId, event.match);
            continue;
          }
          const game = store.rawGame(event.gameId);
          if (!['awaiting_game','playing'].includes(game.Status)) continue;
          if (event.error) store.hostingUpdate(game.InhouseId, {HostingError: event.error});
          else {applyResult(game.InhouseId, event.match); store.hostingUpdate(game.InhouseId, {HostingError: null});}
        } catch {
          const error = 'Dota result did not match the saved ticket, players, teams or start window. An admin must check the game.';
          if (event.lookupId) store.mutate(() => store.db.prepare("UPDATE InhouseBotLookups SET Status='failed',LastError=? WHERE LookupId=? AND Status='pending'").run(error,event.lookupId));
          else store.hostingUpdate(event.gameId, {HostingError: error});
        }
      }
      // Web-admin corrections use the worker's authenticated GC sessions too.
      const lookup = store.db.prepare(`SELECT * FROM InhouseBotLookups WHERE Status='pending'
        AND (AttemptedAt IS NULL OR AttemptedAt<=?) ORDER BY RequestedAt LIMIT 1`).get(clock() - 15000);
      if (lookup && [...slots.values()].some(s => s.session?.ready && (s.nextResultRequest || 0) <= clock())) {
        store.mutate(() => store.db.prepare('UPDATE InhouseBotLookups SET Attempts=Attempts+1,AttemptedAt=? WHERE LookupId=?').run(clock(),lookup.LookupId));
        details(lookup.MatchId).then(match => {if (!stopped) received.push({lookupId:lookup.LookupId,match});}, () => {
          if (!stopped) received.push({lookupId:lookup.LookupId,error:'Dota has not returned this completed result. The bot will retry; check its match ID if it remains unavailable.'});
        });
      }
      for (const slot of slots.values()) {
        const session = slot.session;
        if (!session) continue;
        try {
          const row = store.db.prepare('SELECT * FROM InhouseBots WHERE BotId=?').get(slot.id);
          if (row.InhouseId !== slot.gameId) {
            slot.gameId = row.InhouseId; slot.invites.clear(); slot.resultDue = 0; slot.launchDue = 0; slot.nextCreate = 0;
          }
          store.updateBot(slot.id, {steamId: session.steamId,
            status: !session.ready ? session.status : row.InhouseId ? 'busy' : session.lobby ? 'blocked' : 'idle', error: session.error || slot.error});
          if (!session.ready || clock() < slot.nextCommand) continue;
          slot.error = null;
          if (!row.InhouseId) continue;
          const g = store.rawGame(row.InhouseId), lobby = session.lobby;
          if (session.error) store.hostingUpdate(g.InhouseId, {HostingError: session.error});
          if (['completed','cancelled'].includes(g.Status)) {
            if (lobby) {
              if (lobby.lobbyId === g.LobbyId || !g.LobbyId && lobby.gameName === g.LobbyName) send(slot, 'leave');
              else errorFor(slot, 'Bot is in an unexpected lobby; its reservation remains held for an admin check.');
            } else store.releaseBot(slot.id, g.InhouseId);
            continue;
          }
          if (!['awaiting_game','playing'].includes(g.Status)) continue;
          if (g.ChoiceTurn < 2) continue;
          const finalLobby = g.MatchId ? session.result(g.MatchId) : session.resultForLobby?.(g.LobbyId);
          if (finalLobby) processLobby(slot, g, finalLobby);
          else if (lobby) processLobby(slot, g, lobby);
          else if (g.Status === 'awaiting_game' && (slot.nextCreate || 0) <= clock()) {
            if (!g.BotLaunchedAt && g.LobbyJoinStartedAt != null && g.Deadline <= clock()) {
              store.cancel(g.InhouseId, 'The lobby join timer expired before the game started.', null); continue;
            }
            slot.nextCreate = clock() + 30000;
            if (!session.error) store.hostingUpdate(g.InhouseId, {HostingError: `Waiting for Dota to confirm the ${g.LobbyId ? 'saved lobby' : 'new lobby'}${g.LeagueId ? ` for ticket ${g.LeagueId}. If this persists, check the bot account's league-admin access.` : ' (no ticket).'}`});
            if (g.LobbyId) send(slot, 'join', {lobbyId: g.LobbyId, passKey: g.LobbyPassword});
            else send(slot, 'create', {passKey: g.LobbyPassword, lobbyDetails: settingsFor(g)});
          }
          const current = store.rawGame(g.InhouseId);
          if (current.Status === 'playing') pollResult(slot, current, lobby);
        } catch {errorFor(slot, 'Lobby bot could not process its assignment. Check its connection, ticket permissions and saved lobby.');}
      }
      return {lastSuccess: Math.max(0,...[...slots.values()].map(s => s.session?.lastActivityAt || 0)),
        errors: [...slots.values()].filter(s => s.session?.error || s.error).map(s => `Bot ${s.id}: ${s.session?.error || s.error}`)};
    },
    details,
    close({report = true} = {}) {
      if (stopped) return;
      stopped = true;
      for (const slot of slots.values()) slot.session?.close();
      for (const slot of slots.values()) {
        if (report && slot.session) store.updateBot(slot.id, {steamId: slot.session.steamId, status: 'offline'});
      }
    },
  };
}
