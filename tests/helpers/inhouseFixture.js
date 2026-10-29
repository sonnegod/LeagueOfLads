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
  const store = new InhouseStore(db, {clock});
  store.saveSettings({version: 1, leagueId: 777, queueMode: options.queueMode || 'fifo',
    draftMode: options.draftMode || 'automatic', launchMinutes: 15}, 99);
  function join(id, body = {}) {return store.join(id, {roles: [1, 2, 3, 4, 5], offRole: true, ...body}, `Player ${id}`);}
  function ten(start = 1, body = {}) {for (let i = start; i < start + 10; i++) join(i, body); return store.db.prepare('SELECT MAX(InhouseId) id FROM InhouseGames').get().id;}
  function ready(id) {for (const p of store.members(id)) store.ready(id, p.playerId); return store.game(id);}
  function match(id, {matchId = 9001, winner = 'radiant', duration = 2400, reversed = false, ...rest} = {}) {
    const g = store.game(id);
    return {matchId, leagueId: g.leagueId, startedAt: g.formedAt + 60000, winner, duration,
      players: g.players.map(p => ({playerId: p.playerId, side: (p.side === 'A') !== reversed ? 'radiant' : 'dire'})), ...rest};
  }
  return {db, store, clock, join, ten, ready, match, setNow: value => {now = value;}, advance: ms => {now += ms;}, close: () => db.close()};
}
