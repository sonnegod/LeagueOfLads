import {ensureInhouseSchema} from './schema.js';
import {selectPlayers, captains, bestTeams, autoPick, PICK_ORDER, ratingChanges} from './model.js';

export function fail(message, status = 400) {throw Object.assign(new Error(message), {status});}
export function positiveId(value, label = 'ID') {
  if (!/^\d+$/.test(String(value ?? '')) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail(`Invalid ${label}`);
  return Number(value);
}
const unpack = row => ({playerId: row.PlayerId, name: row.Name, roles: JSON.parse(row.RolesJson),
  offRole: Boolean(row.OffRole), rating: row.Rating, games: row.Games, wins: row.Wins, losses: row.Losses,
  joinedAt: row.JoinedAt, side: row.Side || null, position: row.Position || null,
  ready: Boolean(row.Ready), pickNumber: row.PickNumber, ratingBefore: row.RatingBefore,
  ratingAfter: row.RatingAfter, ratingDelta: row.RatingDelta});
const privateProfile = row => ({...unpack(row), preferencesPromptedAt: row.PreferencesPromptedAt});
const reasonText = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('Enter a reason (up to 500 characters)');
  return value.trim();
};

export class InhouseStore {
  constructor(db, {clock = Date.now} = {}) {
    this.db = db;
    this.clock = clock;
    this.listeners = new Set();
    ensureInhouseSchema(db);
  }
  mutate(fn) {
    let changed = false;
    const result = this.db.transaction(() => {
      const before = this.db.prepare('SELECT total_changes() n').get().n;
      const result = fn();
      changed = this.db.prepare('SELECT total_changes() n').get().n !== before;
      if (changed) this.db.prepare('UPDATE InhouseMeta SET Revision=Revision+1 WHERE Id=1').run();
      return result;
    }).immediate();
    if (changed && !this.db.inTransaction) this.notify();
    return result;
  }
  subscribe(listener) {this.listeners.add(listener); return () => this.listeners.delete(listener);}
  notify() {
    for (const listener of this.listeners) {
      try {listener();} catch {console.error('Inhouse live update could not be delivered');}
    }
  }
  revision() {return this.db.prepare('SELECT Revision FROM InhouseMeta WHERE Id=1').get().Revision;}
  settings() {
    const s = this.db.prepare('SELECT * FROM InhouseSettings WHERE Id=1').get();
    return {leagueId: s.LeagueId, queueMode: s.QueueMode, draftMode: s.DraftMode, launchMinutes: s.LaunchMinutes, version: s.Version};
  }
  audit(action, actorId, inhouseId, details) {
    this.db.prepare('INSERT INTO InhouseAudit(At,ActorId,InhouseId,Action,DetailsJson) VALUES(?,?,?,?,?)')
      .run(this.clock(), actorId || null, inhouseId || null, action, JSON.stringify(details));
  }
  saveSettings(body) {
    return this.mutate(() => {
      const current = this.settings();
      if (body.version !== current.version) fail('Settings changed. Refresh before saving.', 409);
      const leagueId = positiveId(body.leagueId, 'inhouse ticket ID');
      if (leagueId > 4294967295) fail('Invalid inhouse ticket ID');
      if (!['fifo', 'preference'].includes(body.queueMode) || !['captain', 'automatic'].includes(body.draftMode)) fail('Choose a valid queue and draft mode');
      const minutes = positiveId(body.launchMinutes, 'launch window');
      if (minutes > 120) fail('Launch window must be between 1 and 120 minutes');
      this.db.prepare('UPDATE InhouseSettings SET LeagueId=?,QueueMode=?,DraftMode=?,LaunchMinutes=?,Version=Version+1 WHERE Id=1')
        .run(leagueId, body.queueMode, body.draftMode, minutes);
      this.advance(this.clock());
      return this.settings();
    });
  }
  ensurePlayer(playerId, name) {
    const id = positiveId(playerId, 'player');
    const saved = String(name || `Player ${id}`).slice(0, 100);
    this.db.prepare("INSERT OR IGNORE INTO InhousePlayers(PlayerId,Name,RolesJson) VALUES(?,?,'[]')").run(id, saved);
    this.db.prepare('UPDATE InhousePlayers SET Name=? WHERE PlayerId=? AND Name<>?').run(saved, id, saved);
    return id;
  }
  profile(playerId, name) {
    return this.mutate(() => {
      const id = this.ensurePlayer(playerId, name);
      return privateProfile(this.db.prepare('SELECT * FROM InhousePlayers WHERE PlayerId=?').get(id));
    });
  }
  setPreferences(playerId, body, name) {
    const id = this.ensurePlayer(playerId, name);
    if (!Array.isArray(body.roles) || body.roles.length > 5 || (!body.roles.length && body.offRole !== true) ||
      body.roles.some(role => !Number.isInteger(role) || role < 1 || role > 5) || new Set(body.roles).size !== body.roles.length ||
      typeof body.offRole !== 'boolean') fail('Rank at least one position and choose whether to accept other positions');
    if (this.db.prepare('SELECT 1 FROM InhouseQueue WHERE PlayerId=? AND InhouseId IS NOT NULL').get(id)) fail('Preferences are locked while you are in an inhouse', 409);
    this.db.prepare('UPDATE InhousePlayers SET RolesJson=?,OffRole=?,PreferencesPromptedAt=COALESCE(PreferencesPromptedAt,?) WHERE PlayerId=?')
      .run(JSON.stringify(body.roles), Number(body.offRole), this.clock(), id);
    return id;
  }
  preferences(playerId, body, name) {
    return this.mutate(() => {
      this.setPreferences(playerId, body, name);
      this.advance(this.clock());
      return privateProfile(this.db.prepare('SELECT * FROM InhousePlayers WHERE PlayerId=?').get(playerId));
    });
  }
  dismissPreferencesPrompt(playerId, name) {
    return this.mutate(() => {
      const id = this.ensurePlayer(playerId, name);
      this.db.prepare('UPDATE InhousePlayers SET PreferencesPromptedAt=? WHERE PlayerId=? AND PreferencesPromptedAt IS NULL').run(this.clock(), id);
      return privateProfile(this.db.prepare('SELECT * FROM InhousePlayers WHERE PlayerId=?').get(id));
    });
  }
  join(playerId, body, name) {
    return this.mutate(() => {
      if (!this.settings().leagueId) fail('An admin must configure the inhouse ticket before queueing opens', 409);
      const id = positiveId(playerId, 'player');
      if (this.db.prepare('SELECT 1 FROM InhouseQueue WHERE PlayerId=?').get(id)) fail('You are already queued or reserved for an inhouse', 409);
      this.setPreferences(id, body, name);
      this.db.prepare('INSERT INTO InhouseQueue(PlayerId,JoinedAt) VALUES(?,?)').run(id, this.clock());
      this.advance(this.clock());
      return {ok: true};
    });
  }
  leave(playerId) {
    return this.mutate(() => {
      const q = this.db.prepare('SELECT * FROM InhouseQueue WHERE PlayerId=?').get(playerId);
      if (q?.InhouseId) fail('Your place is reserved. Wait for completion or admin cancellation.', 409);
      this.db.prepare('DELETE FROM InhouseQueue WHERE PlayerId=? AND InhouseId IS NULL').run(playerId);
      return {ok: true};
    });
  }
  leaveOnLogout(playerId) {
    // Logout must not release an existing game reservation or race selection.
    // The conditional delete runs under the same write lock used to select ten.
    return this.mutate(() => ({removed: this.db.prepare('DELETE FROM InhouseQueue WHERE PlayerId=? AND InhouseId IS NULL').run(playerId).changes === 1}));
  }
  queueSummary() {
    const players = this.db.prepare(`SELECT p.PlayerId playerId,p.Name name FROM InhouseQueue q
      JOIN InhousePlayers p USING(PlayerId) WHERE q.InhouseId IS NULL ORDER BY q.JoinedAt,q.PlayerId`).all();
    return {count: players.length, players};
  }
  playerActivity(playerId) {
    const row = this.db.prepare(`SELECT q.InhouseId,g.Status,g.Deadline,m.Ready FROM InhouseQueue q
      LEFT JOIN InhouseGames g USING(InhouseId)
      LEFT JOIN InhouseMembers m ON m.InhouseId=q.InhouseId AND m.PlayerId=q.PlayerId
      WHERE q.PlayerId=?`).get(playerId ?? null);
    return {queued: Boolean(row && !row.InhouseId),
      readyCheck: row?.Status === 'ready' && row.Ready === 0 && row.Deadline > this.clock()
        ? {gameId: row.InhouseId, deadline: row.Deadline} : null};
  }
  activitySummary() {
    return this.db.transaction(() => {
      const queue = this.queueSummary();
      const games = this.db.prepare(`SELECT g.InhouseId id,g.Status status,COUNT(m.PlayerId) playerCount
        FROM InhouseGames g JOIN InhouseMembers m USING(InhouseId)
        WHERE g.Status IN ('ready','drafting','awaiting_game','playing')
        GROUP BY g.InhouseId ORDER BY g.InhouseId DESC`).all();
      const activePlayers = games.reduce((sum, game) => sum + game.playerCount, 0);
      return {...queue, games, activePlayers, totalPlayers: queue.count + activePlayers};
    })();
  }
  chatAccess(id, playerId) {
    const game = this.rawGame(id);
    if (!this.db.prepare('SELECT 1 FROM InhouseMembers WHERE InhouseId=? AND PlayerId=?').get(game.InhouseId, playerId)) fail('Only players in this inhouse can use its chat', 403);
    return game;
  }
  chatMessages(id, after = null) {
    const columns = 'MessageId id,InhouseId inhouseId,PlayerId playerId,PlayerName name,Body text,SentAt sentAt,ClientId clientId';
    return after == null
      ? this.db.prepare(`SELECT ${columns} FROM InhouseChat WHERE InhouseId=? ORDER BY MessageId DESC LIMIT 100`).all(id).reverse()
      : this.db.prepare(`SELECT ${columns} FROM InhouseChat WHERE InhouseId=? AND MessageId>? ORDER BY MessageId LIMIT 100`).all(id, after);
  }
  readChat(id, playerId) {
    return this.db.transaction(() => {
      const game = this.chatAccess(id, playerId);
      return {inhouseId: game.InhouseId, status: game.Status, messages: this.chatMessages(game.InhouseId)};
    })();
  }
  postChat(id, playerId, body) {
    let inserted = false;
    const result = this.db.transaction(() => {
      const game = this.chatAccess(id, playerId);
      const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
      if (!text || text.length > 500) fail('Messages must contain 1–500 characters');
      if (typeof body.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(body.clientId)) fail('Invalid message identifier');
      const previous = this.db.prepare('SELECT MessageId FROM InhouseChat WHERE InhouseId=? AND PlayerId=? AND ClientId=?').get(game.InhouseId, playerId, body.clientId);
      if (previous) {
        const existing = this.chatMessages(game.InhouseId, previous.MessageId - 1)[0];
        if (existing.text !== text) fail('This message identifier has already been used', 409);
        return {inhouseId: game.InhouseId, status: game.Status, messages: [existing]};
      }
      if (['completed', 'cancelled'].includes(game.Status)) fail('This lobby has closed', 409);
      const now = this.clock();
      const recent = this.db.prepare('SELECT COUNT(*) n FROM InhouseChat WHERE InhouseId=? AND PlayerId=? AND SentAt>?').get(game.InhouseId, playerId, now - 10000).n;
      if (recent >= 5) fail('Please wait a moment before sending more messages', 429);
      const name = this.db.prepare('SELECT Name FROM InhousePlayers WHERE PlayerId=?').get(playerId).Name;
      const messageId = Number(this.db.prepare('INSERT INTO InhouseChat(InhouseId,PlayerId,PlayerName,Body,SentAt,ClientId) VALUES(?,?,?,?,?,?)')
        .run(game.InhouseId, playerId, name, text, now, body.clientId).lastInsertRowid);
      inserted = true;
      return {inhouseId: game.InhouseId, status: game.Status, messages: this.chatMessages(game.InhouseId, messageId - 1)};
    }).immediate();
    // Chat has its own cursor. Do not republish the entire game/standings
    // snapshot for every line of conversation.
    if (inserted && !this.db.inTransaction) this.notify();
    return result;
  }
  queue() {
    return this.db.prepare(`SELECT p.*,q.JoinedAt FROM InhouseQueue q JOIN InhousePlayers p USING(PlayerId)
      WHERE q.InhouseId IS NULL ORDER BY q.JoinedAt,q.PlayerId`).all().map(unpack);
  }
  rawGame(id) {
    const game = this.db.prepare('SELECT * FROM InhouseGames WHERE InhouseId=?').get(positiveId(id, 'inhouse'));
    if (!game) fail('Inhouse not found', 404);
    return game;
  }
  members(id) {
    return this.db.prepare(`SELECT m.*,p.Name,m.RatingAtDraft Rating,m.GamesAtDraft Games,p.Wins,p.Losses
      FROM InhouseMembers m JOIN InhousePlayers p USING(PlayerId) WHERE m.InhouseId=? ORDER BY m.JoinedAt,m.PlayerId`).all(id).map(unpack);
  }
  game(id) {
    const g = this.rawGame(id), players = this.members(id);
    const fixed = Object.fromEntries(players.filter(p => p.side).map(p => [p.playerId, p.side]));
    const seeds = {A: g.CaptainA, B: g.CaptainB};
    const allowedPicks = g.Status === 'drafting' ? players.filter(p => !p.side &&
      bestTeams(players, g.QueueMode, {...fixed, [p.playerId]: PICK_ORDER[g.Turn]}, seeds)).map(p => p.playerId) : [];
    return {id: g.InhouseId, status: g.Status, leagueId: g.LeagueId, queueMode: g.QueueMode, draftMode: g.DraftMode, playerCount: g.PlayerCount,
      launchMinutes: g.LaunchMinutes, createdAt: g.CreatedAt, deadline: g.Deadline, formedAt: g.FormedAt,
      turn: g.Turn, captainA: g.CaptainA, captainB: g.CaptainB, matchId: g.MatchId, radiantSide: g.RadiantSide,
      winner: g.Winner, startedAt: g.StartedAt, completedAt: g.CompletedAt, cancelReason: g.CancelReason,
      turnSide: g.Status === 'drafting' ? PICK_ORDER[g.Turn] : null, players, allowedPicks};
  }
  snapshot() {
    return this.db.transaction(() => {
      const ids = this.db.prepare(`SELECT InhouseId FROM InhouseGames WHERE Status NOT IN ('completed','cancelled')
        UNION SELECT InhouseId FROM (SELECT InhouseId FROM InhouseGames WHERE Status IN ('completed','cancelled') ORDER BY InhouseId DESC LIMIT 30)
        ORDER BY InhouseId DESC`).all();
      const worker = this.db.prepare('SELECT LastTick lastTick,LastSuccess lastSuccess,LastError lastError FROM InhouseWorker WHERE Id=1').get();
      return {revision: this.revision(), serverNow: this.clock(), settings: this.settings(), worker,
        queue: this.queue(), games: ids.map(g => this.game(g.InhouseId)),
        leaderboard: this.db.prepare('SELECT * FROM InhousePlayers ORDER BY Rating DESC,Games DESC,PlayerId').all().map(unpack)};
    })();
  }
  history(before) {
    return this.db.prepare('SELECT InhouseId FROM InhouseGames WHERE InhouseId<? ORDER BY InhouseId DESC LIMIT 20')
      .all(before || Number.MAX_SAFE_INTEGER).map(row => this.game(row.InhouseId));
  }
  startSelection(now) {
    const settings = this.settings();
    if (!settings.leagueId) return;
    let queue = this.queue();
    while (queue.length >= 10) {
      const selected = selectPlayers(queue, settings.queueMode);
      if (selected.length !== 10) break;
      this.reservePlayers(selected, settings, now);
      const chosen = new Set(selected.map(p => p.playerId));
      queue = queue.filter(p => !chosen.has(p.playerId));
    }
  }
  reservePlayers(selected, settings, now, actorId = null) {
    const id = Number(this.db.prepare(`INSERT INTO InhouseGames(Status,LeagueId,QueueMode,DraftMode,LaunchMinutes,CreatedAt,Deadline,PlayerCount)
      VALUES('ready',?,?,?,?,?,?,?)`).run(settings.leagueId, settings.queueMode, settings.draftMode, settings.launchMinutes, now, now + 60000, selected.length).lastInsertRowid);
    for (const p of selected) {
      this.db.prepare(`INSERT INTO InhouseMembers(InhouseId,PlayerId,JoinedAt,RolesJson,OffRole,RatingAtDraft,GamesAtDraft)
        VALUES(?,?,?,?,?,?,?)`).run(id, p.playerId, p.joinedAt, JSON.stringify(p.roles), Number(p.offRole), p.rating, p.games);
      const reserved = this.db.prepare('UPDATE InhouseQueue SET InhouseId=? WHERE PlayerId=? AND InhouseId IS NULL').run(id, p.playerId);
      if (reserved.changes !== 1) fail('Queue changed during selection', 409);
    }
    this.audit(selected.length === 2 ? 'test-started' : 'selected', actorId, id, {players: selected.map(p => p.playerId)});
    return id;
  }
  startAdminTest(actorId) {
    return this.mutate(() => {
      const settings = this.settings();
      if (!settings.leagueId) fail('Configure the inhouse ticket before starting a test', 409);
      const players = this.queue();
      if (players.length !== 2) fail('Exactly two players must be waiting in the queue to start a test', 409);
      return {gameId: this.reservePlayers(players, {...settings, queueMode: 'fifo', draftMode: 'automatic'}, this.clock(), actorId)};
    });
  }
  ready(id, playerId) {
    return this.mutate(() => {
      const now = this.clock();
      this.advance(now);
      const g = this.rawGame(id);
      if (g.Status !== 'ready' || g.Deadline <= now) fail('This ready check has ended', 409);
      const updated = this.db.prepare('UPDATE InhouseMembers SET Ready=1 WHERE InhouseId=? AND PlayerId=?').run(id, playerId);
      if (!updated.changes) fail('You are not in this inhouse', 403);
      const players = this.members(id);
      if (players.every(p => p.ready)) {
        const seeds = captains(players);
        this.db.prepare('UPDATE InhouseGames SET CaptainA=?,CaptainB=? WHERE InhouseId=?').run(seeds.A, seeds.B, id);
        for (const side of ['A', 'B']) this.db.prepare('UPDATE InhouseMembers SET Side=? WHERE InhouseId=? AND PlayerId=?').run(side, id, seeds[side]);
        if (g.DraftMode === 'automatic') this.finalize(id, bestTeams(players, g.QueueMode, {}, seeds), now);
        else this.db.prepare("UPDATE InhouseGames SET Status='drafting',Deadline=? WHERE InhouseId=?").run(now + 60000, id);
        this.audit('ready', null, id, {captains: seeds});
      }
      return {ok: true};
    });
  }
  finalize(id, teams, now) {
    if (!teams) fail('No valid team assignment is available', 409);
    const g = this.rawGame(id);
    for (const [playerId, side] of Object.entries(teams.sides)) this.db.prepare('UPDATE InhouseMembers SET Side=?,Position=? WHERE InhouseId=? AND PlayerId=?')
      .run(side, teams.positions[playerId] || null, id, playerId);
    this.db.prepare("UPDATE InhouseGames SET Status='awaiting_game',FormedAt=?,Deadline=? WHERE InhouseId=?")
      .run(now, now + g.LaunchMinutes * 60000, id);
    this.audit('formed', null, id, {deadline: now + g.LaunchMinutes * 60000});
  }
  pickInside(id, playerId, now, actorId = null) {
    const g = this.rawGame(id), players = this.members(id), side = PICK_ORDER[g.Turn];
    const chosen = players.find(p => p.playerId === playerId);
    if (!chosen || chosen.side) fail('Choose an available player', 409);
    const fixed = Object.fromEntries(players.filter(p => p.side).map(p => [p.playerId, p.side]));
    const teams = bestTeams(players, g.QueueMode, {...fixed, [playerId]: side}, {A: g.CaptainA, B: g.CaptainB});
    if (!teams) fail('That pick would leave an invalid position assignment', 409);
    this.db.prepare('UPDATE InhouseMembers SET Side=?,PickNumber=? WHERE InhouseId=? AND PlayerId=?').run(side, g.Turn + 1, id, playerId);
    this.db.prepare('UPDATE InhouseGames SET Turn=Turn+1,Deadline=? WHERE InhouseId=?').run(now + 60000, id);
    this.audit('pick', actorId, id, {playerId, side, turn: g.Turn, automatic: actorId == null});
    if (g.Turn === 7) this.finalize(id, teams, now);
  }
  pick(id, actorId, body) {
    return this.mutate(() => {
      const now = this.clock();
      this.advance(now);
      const g = this.rawGame(id);
      if (g.Status !== 'drafting' || body.turn !== g.Turn) fail('The draft has moved on. Refresh and try again.', 409);
      if (Number(actorId) !== (PICK_ORDER[g.Turn] === 'A' ? g.CaptainA : g.CaptainB)) fail('Only the current captain can pick', 403);
      this.pickInside(Number(id), positiveId(body.playerId, 'player'), now, actorId);
      return {ok: true};
    });
  }
  cancelInside(g, reason, actorId, failedReady = false) {
    this.db.prepare("UPDATE InhouseGames SET Status='cancelled',Deadline=NULL,CancelReason=?,CompletedAt=? WHERE InhouseId=?")
      .run(reason, this.clock(), g.InhouseId);
    if (failedReady) {
      this.db.prepare(`DELETE FROM InhouseQueue WHERE InhouseId=? AND PlayerId IN
        (SELECT PlayerId FROM InhouseMembers WHERE InhouseId=? AND Ready=0)`).run(g.InhouseId, g.InhouseId);
      this.db.prepare('UPDATE InhouseQueue SET InhouseId=NULL WHERE InhouseId=?').run(g.InhouseId);
    } else this.db.prepare('DELETE FROM InhouseQueue WHERE InhouseId=?').run(g.InhouseId);
    this.audit('cancelled', actorId, g.InhouseId, {reason});
  }
  cancel(id, reason, actorId) {
    return this.mutate(() => {
      const g = this.rawGame(id);
      if (['completed', 'cancelled'].includes(g.Status)) fail('This inhouse has already ended', 409);
      this.cancelInside(g, reasonText(reason), actorId);
      this.advance(this.clock());
      return {ok: true};
    });
  }
  advance(now, {expireLaunch = true} = {}) {
    const expired = this.db.prepare("SELECT * FROM InhouseGames WHERE Status IN ('ready','drafting','awaiting_game') AND Deadline<=? ORDER BY InhouseId").all(now);
    for (const g of expired) {
      if (g.Status === 'ready') this.cancelInside(g, 'Ready check expired', null, true);
      if (g.Status === 'awaiting_game' && expireLaunch) this.cancelInside(g, 'No matching game found within the launch window', null);
      if (g.Status === 'drafting') {
        const players = this.members(g.InhouseId), fixed = Object.fromEntries(players.filter(p => p.side).map(p => [p.playerId, p.side]));
        const playerId = autoPick(players, g.QueueMode, fixed, g.Turn, {A: g.CaptainA, B: g.CaptainB});
        if (!playerId) this.cancelInside(g, 'Draft has no valid completion', null);
        else this.pickInside(g.InhouseId, playerId, now);
      }
    }
    this.startSelection(now);
  }
  tick(options) {return this.mutate(() => this.advance(this.clock(), options));}
  validateMatch(g, match) {
    if (match.leagueId !== g.LeagueId) fail('Match uses a different inhouse ticket', 409);
    if (!match.players || match.players.length !== g.PlayerCount || new Set(match.players.map(p => p.playerId)).size !== g.PlayerCount) fail(`Match must identify all ${g.PlayerCount} players`, 409);
    const members = this.members(g.InhouseId), assigned = new Map(members.map(p => [p.playerId, p.side]));
    if (members.length !== g.PlayerCount) fail('Saved inhouse roster is incomplete', 409);
    let radiantSide = null;
    for (const p of match.players) {
      if (!assigned.has(p.playerId) || !['radiant', 'dire'].includes(p.side)) fail('Match participants do not match this inhouse', 409);
      const implied = p.side === 'radiant' ? assigned.get(p.playerId) : assigned.get(p.playerId) === 'A' ? 'B' : 'A';
      if (!implied || radiantSide && radiantSide !== implied) fail('Match teams do not match the drafted teams', 409);
      radiantSide = implied;
    }
    if (match.startedAt && (match.startedAt < g.FormedAt - 120000 || match.startedAt > g.FormedAt + g.LaunchMinutes * 60000)) fail('Match start is outside this inhouse launch window', 409);
    return radiantSide;
  }
  applyMatch(id, match, {actorId = null, reason = null, correction = false} = {}) {
    return this.mutate(() => {
      const g = this.rawGame(id), matchId = positiveId(match.matchId, 'match');
      if (!['awaiting_game', 'playing', 'completed'].includes(g.Status)) fail('This inhouse cannot be linked in its current state', 409);
      if (g.MatchId && g.MatchId !== matchId && !correction) fail('Inhouse is already linked', 409);
      if (this.db.prepare('SELECT 1 FROM InhouseGames WHERE MatchId=? AND InhouseId<>?').get(matchId, id)) fail('Match is already assigned to another inhouse', 409);
      const radiantSide = this.validateMatch(g, match);
      if (correction) reasonText(reason);
      // A draft-only/short remake must not award a rating outcome. Admins can
      // cancel it or correct the link to the replacement game using the two
      // agreed recovery controls.
      const finished = ['radiant', 'dire'].includes(match.winner) && match.duration >= (g.PlayerCount === 2 ? 1 : 300) && Boolean(match.startedAt);
      if (g.Status === 'completed' && !finished) fail('A resolved inhouse can only be corrected to a confirmed full-game result', 409);
      const winner = finished ? match.winner === 'radiant' ? radiantSide : radiantSide === 'A' ? 'B' : 'A' : null;
      if (g.MatchId === matchId && g.Winner === winner && g.RadiantSide === radiantSide) return {ok: true, completed: finished};
      this.db.prepare(`UPDATE InhouseGames SET MatchId=?,RadiantSide=?,Winner=?,StartedAt=?,Status=?,Deadline=NULL,CompletedAt=? WHERE InhouseId=?`)
        .run(matchId, radiantSide, winner, match.startedAt || g.StartedAt || this.clock(), finished ? 'completed' : 'playing', finished ? this.clock() : null, id);
      if (finished) {
        this.db.prepare('DELETE FROM InhouseQueue WHERE InhouseId=?').run(id);
        const latest = this.db.prepare("SELECT InhouseId FROM InhouseGames WHERE Status='completed' ORDER BY StartedAt DESC,MatchId DESC,InhouseId DESC LIMIT 1").get();
        if (g.Status !== 'completed' && latest.InhouseId === Number(id)) this.rateGame(Number(id));
        else this.reconcileRatings();
      }
      this.audit(correction ? 'match-corrected' : finished ? 'resolved' : 'linked', actorId, Number(id),
        {previousMatchId: g.MatchId, matchId, previousWinner: g.Winner, winner, reason});
      this.advance(this.clock(), {expireLaunch: false});
      return {ok: true, completed: finished};
    });
  }
  rateGame(id) {
    const g = this.rawGame(id);
    const roster = this.members(id).map(p => ({...p, ...this.db.prepare('SELECT Rating rating,Games games FROM InhousePlayers WHERE PlayerId=?').get(p.playerId)}));
    const saveMember = this.db.prepare('UPDATE InhouseMembers SET RatingBefore=?,RatingAfter=?,RatingDelta=?,Expected=?,K=? WHERE InhouseId=? AND PlayerId=?');
    const savePlayer = this.db.prepare('UPDATE InhousePlayers SET Rating=?,Games=Games+1,Wins=Wins+?,Losses=Losses+? WHERE PlayerId=?');
    for (const change of ratingChanges(roster, g.Winner)) {
      const win = roster.find(p => p.playerId === change.playerId).side === g.Winner;
      saveMember.run(change.before, change.after, change.delta, change.expected, change.k, id, change.playerId);
      savePlayer.run(change.after, Number(win), Number(!win), change.playerId);
    }
  }
  reconcileRatings() {
    // Replay the small outcome ledger, never full game JSON. Opponents' later
    // expectations and calibration counts depend on earlier corrected results.
    const players = new Map(this.db.prepare('SELECT PlayerId FROM InhousePlayers').all().map(p => [p.PlayerId, {rating: 1000, games: 0, wins: 0, losses: 0}]));
    const games = this.db.prepare("SELECT InhouseId,Winner FROM InhouseGames WHERE Status='completed' ORDER BY StartedAt,MatchId,InhouseId").all();
    const saveMember = this.db.prepare('UPDATE InhouseMembers SET RatingBefore=?,RatingAfter=?,RatingDelta=?,Expected=?,K=? WHERE InhouseId=? AND PlayerId=?');
    for (const g of games) {
      const roster = this.members(g.InhouseId).map(p => ({...p, ...players.get(p.playerId)}));
      for (const change of ratingChanges(roster, g.Winner)) {
        const state = players.get(change.playerId), side = roster.find(p => p.playerId === change.playerId).side;
        state.rating = change.after; state.games++;
        if (side === g.Winner) state.wins++; else state.losses++;
        saveMember.run(change.before, change.after, change.delta, change.expected, change.k, g.InhouseId, change.playerId);
      }
    }
    const savePlayer = this.db.prepare('UPDATE InhousePlayers SET Rating=?,Games=?,Wins=?,Losses=? WHERE PlayerId=?');
    for (const [id, p] of players) savePlayer.run(p.rating, p.games, p.wins, p.losses, id);
  }
  auditLog() {
    return this.db.prepare("SELECT * FROM InhouseAudit WHERE Action<>'settings' ORDER BY AuditId DESC LIMIT 100").all().map(r => ({id: r.AuditId, at: r.At, actorId: r.ActorId, inhouseId: r.InhouseId, action: r.Action, details: JSON.parse(r.DetailsJson)}));
  }
}
