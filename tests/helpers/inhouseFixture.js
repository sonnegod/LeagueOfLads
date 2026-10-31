import Database from 'better-sqlite3';
import {InhouseStore} from '../../inhouses/store.js';

// Isolated stand-in for the production admin middleware; no real database.js.
export function inhousePreviewAdmin(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user) return res.status(401).json({error: 'Sign in required'});
  if (req.get('x-test-preview-role') === 'user') return res.status(403).json({error: 'Admin preview only'});
  return next();
}

export function inhouseFixture(options = {}) {
  const db = new Database(':memory:');
  let now = Date.parse('2026-10-28T20:00:00Z');
  const clock = () => now;
  const store = new InhouseStore(db, {clock, ...(options.random ? {random:options.random} : {})});
  store.saveSettings({version: 1, leagueId: 777, queueMode: options.queueMode || 'fifo',
    draftMode: options.draftMode || 'automatic', gameMode:options.gameMode ?? 1, launchMinutes: 15}, 99);
  // Queue/model tests use healthy virtual bot slots. Network/lobby behavior is
  // exercised separately with injected sessions in the bot pool tests.
  for (let id = 1; id <= (options.bots ?? 5); id++) store.updateBot(id,
    {steamId: String(76561197960265728n + BigInt(1000 + id)), status: 'idle'});
  function join(id, body = {}) {
    // Simulate the bot's completed-lobby cleanup before a later test game.
    for (const bot of options.bots === 0 ? [] : store.botStatus()) {
      if (bot.gameId && ['completed','cancelled'].includes(store.rawGame(bot.gameId).Status)) store.releaseBot(bot.id, bot.gameId);
      if (!store.db.prepare('SELECT InhouseId FROM InhouseBots WHERE BotId=?').get(bot.id).InhouseId && bot.steamId) store.updateBot(bot.id,{steamId:bot.steamId,status:'idle'});
    }
    return store.join(id, {roles: [1, 2, 3, 4, 5], offRole: true, ...body}, `Player ${id}`);
  }
  function ten(start = 1, body = {}) {for (let i = start; i < start + 10; i++) join(i, body); return store.db.prepare('SELECT MAX(InhouseId) id FROM InhouseGames').get().id;}
  function completeChoices(id) {
    let game=store.game(id);
    while(game.status==='awaiting_game'&&game.lobbyChoices.pending){
      const choice=game.lobbyChoices;
      store.chooseLobby(id,choice.captainId,{turn:choice.turn,choice:choice.kind==='pick'?'first_pick':choice.captainId===game.captainA?'radiant':'dire'});
      game=store.game(id);
    }
    return game;
  }
  function ready(id) {
    for (const p of store.members(id)) store.ready(id, p.playerId);
    return options.manualLobbyChoices ? store.game(id) : completeChoices(id);
  }
  function match(id, {matchId = 9001, winner = 'radiant', duration = 2400, reversed = false, ...rest} = {}) {
    const g = options.manualLobbyChoices ? store.game(id) : completeChoices(id);
    return {matchId, leagueId: g.leagueId, startedAt: g.formedAt + 60000, winner, duration,
      players: g.players.map(p => ({playerId: p.playerId, side: (p.side === 'A') !== reversed ? 'radiant' : 'dire'})), ...rest};
  }
  return {db, store, clock, join, ten, ready, match, completeChoices, setNow: value => {now = value;}, advance: ms => {now += ms;}, close: () => db.close()};
}
