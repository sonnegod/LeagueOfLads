import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import DraftGodStore from '../../config/draftGodStore.js';
import { analyzeDraft, MODEL_VERSION } from '../../shared/draftModel.js';

const [dbPath, publicPath, leagueArg, limitArg = '50'] = process.argv.slice(2);
const leagueId = Number(leagueArg), limit = Number(limitArg);
if (!dbPath || !publicPath || !Number.isSafeInteger(leagueId) || leagueId <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
  console.error('Usage: node scripts/league/replayDraftGod.js <LadsData.db> <public.db> <leagueId> [limit:1-500]');
  process.exit(1);
}
// Use SQLite backup, including WAL, into a disposable copy. Source files stay read-only.
const source = new Database(resolve(dbPath), { readonly: true, fileMustExist: true });
const directory = mkdtempSync(join(tmpdir(), 'lads-draft-replay-'));
let db, pub;
try {
  const path = join(directory, 'league.db'); await source.backup(path); source.close();
  db = new Database(path); pub = new Database(resolve(publicPath), { readonly: true, fileMustExist: true });
  const store = new DraftGodStore(db, pub);
  const season = db.prepare('SELECT * FROM LeagueSeasons WHERE ExternalLeagueId=?').get(leagueId);
  if (!season) throw new Error('No season record for this league.');
  const catalog = store.setup(season.SeasonId);
  const games = db.prepare(`SELECT ml.MatchId,ml.DatePlayed,m.TeamRad,m.TeamDire,m.WinnerId
    FROM MatchLeague ml JOIN MatchTeam m ON m.MatchId=ml.MatchId WHERE ml.LeagueId=?
    AND datetime(ml.DatePlayed) IS NOT NULL AND m.WinnerId IN (m.TeamRad,m.TeamDire)
    AND m.TeamRad<>m.TeamDire AND COALESCE(m.Rehost,0)=0 ORDER BY ml.DatePlayed,ml.MatchId LIMIT ?`).all(leagueId, limit);
  const results = [], skipped = [];
  for (const game of games) {
    try {
      const ourTeam = catalog.teams.find(t => t.teamId === game.TeamRad), opponentTeam = catalog.teams.find(t => t.teamId === game.TeamDire);
      if (!ourTeam || !opponentTeam) throw new Error('Unknown team');
      const picks = db.prepare('SELECT IsPick,Hero_Id,Team,OrderNum FROM PickInfo WHERE MatchId=? ORDER BY OrderNum').all(game.MatchId);
      const first = picks.find(p => p.IsPick === 1)?.Team;
      if (![0, 1].includes(first)) throw new Error('No draft order');
      const lineups = {};
      for (const [side, teamId] of [['our', game.TeamRad], ['opponent', game.TeamDire]]) {
        const players = db.prepare(`SELECT DISTINCT p.PlayerId FROM MatchTeamPlayer p JOIN MatchPlayer mp ON mp.MatchId=p.MatchId AND mp.PlayerId=p.PlayerId
          WHERE p.MatchId=? AND p.TeamId=? AND p.PlayerId>0 ORDER BY p.PlayerId`).all(game.MatchId, teamId);
        if (players.length !== 5) throw new Error('Game does not have five identified players per side');
        lineups[side] = players.map(p => ({ id: p.PlayerId, role: 0 }));
      }
      const asOf = game.DatePlayed.length <= 10 ? `${game.DatePlayed}T00:00:00.000Z` : new Date(game.DatePlayed).toISOString();
      const config = { seasonId: season.SeasonId, ourTeam: ourTeam.key, opponentTeam: opponentTeam.key,
        firstPick: first === 0, radiant: true, lineups, asOf,
        format: { id: 'recorded-order-v1', name: 'Recorded match draft', actions: picks.map(p => `${p.Team === first ? 'A' : 'B'}${p.IsPick ? 'P' : 'B'}`) } };
      const context = store.context(config);
      const board = picks.map(p => ({ heroId: p.Hero_Id, playerId: null }));
      const model = analyzeDraft(context, config, board);
      results.push({ matchId: game.MatchId, cutoff: asOf, historyGames: context.coverage.matches,
        assessment: model.score, confidence: model.confidence, radiantWon: game.WinnerId === game.TeamRad });
    } catch (e) { skipped.push({ matchId: game.MatchId, reason: e.message }); }
  }
  const bands = ['below 45', '45–55', 'above 55'].map((band, i) => {
    const rows = results.filter(r => r.assessment !== null && (i === 0 ? r.assessment < 45 : i === 1 ? r.assessment >= 45 && r.assessment <= 55 : r.assessment > 55));
    return { band, games: rows.length, radiantWins: rows.filter(r => r.radiantWon).length };
  });
  console.log(JSON.stringify({ modelVersion: MODEL_VERSION, leagueId,
    method: 'Known game lineups and recorded draft; all analytical match/public inputs precede the game. Date-only games exclude their entire day. Current private hero metadata is used. Assessment is not a probability; this report is not odds calibration.',
    games: results, bands, skipped }, null, 2));
} finally {
  if (source.open) source.close(); db?.close(); pub?.close();
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + '\\') && !target.startsWith(resolve(tmpdir()) + '/')) throw new Error('Unsafe temporary path');
  rmSync(target, { recursive: true, force: true });
}
