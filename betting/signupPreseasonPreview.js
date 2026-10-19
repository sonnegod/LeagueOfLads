import { resolve, dirname } from 'node:path';
import { digest } from './scheduleStore.js';
import { METRICS, seededRandom, statForecast, leaderForecast, simulateSeason, seasonWinsForecast } from './models.js';
import { configuredPricePolicy, anchorPrice, ODDS_SCALE } from './pricing.js';

export const PRESEASON_MODEL_VERSION = 'edw-preseason-records-v4';
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function signupPreviewPath(bettingPath, seasonId) {
  if (!positive(seasonId)) throw new Error('Invalid preview season');
  return resolve(dirname(bettingPath), `Betting-preseason-${Number(seasonId)}.db`);
}

// Weighted empirical distributions keep a player's own history central. Lane
// pools reduce shrinkage toward a mixture of unrelated roles. Lane is inferred,
// never treated as a submitted carry/support position or exposed private input.
function distributions(history, roster, asOf) {
  const result = {}, pools = {}, currentPatch = history.filter(g => g.PatchKey).at(-1)?.PatchKey;
  const recentWeight = game => Math.pow(.5, Math.floor((Date.parse(asOf) - Date.parse(game.StartedAtUtc)) / 86400000) / 180);
  for (const player of roster) {
    const personal = history.filter(g => g.PlayerId === player.PlayerId).slice(-100);
    const roles = new Map();
    for (const g of personal.slice(-10)) if ([1, 2, 3, 4].includes(g.LaneRole)) roles.set(g.LaneRole, (roles.get(g.LaneRole) || 0) + 1);
    const preferred = [...roles].sort((a, b) => b[1] - a[1])[0];
    const lane = preferred && preferred[1] >= 5 && preferred[1] > Math.min(10, personal.length) / 2 ? preferred[0] : null;
    const pool = history.filter(g => !lane || g.LaneRole === lane).slice(-2000);
    result[player.PlayerId] = {};
    for (const [stat, column] of Object.entries(METRICS)) {
      const own = personal.filter(g => valid(g[column])), peers = pool.filter(g => valid(g[column]));
      if (own.length < 5 || peers.length < 5) continue;
      const weight = game => recentWeight(game) * (currentPatch && game.PatchKey === currentPatch ? 2 : 1);
      const poolKey = `${lane || 0}:${stat}`;
      pools[poolKey] ||= { values: peers.map(g => g[column]), weights: peers.map(weight) };
      result[player.PlayerId][stat] = { samples: own.length, personalWeight: own.length / (own.length + 10),
        values: own.map(g => g[column]), weights: own.map(weight), poolKey,
        inferredLaneRole: lane, referencePatch: currentPatch || null };
    }
  }
  return { players: result, pools };
}

export function signupTeamPricingInputs({season,teams,roster},eligible,asOf) {
  const priceInputs={season,teams,roster,teamStats:[],metricHistory:eligible,
    modelMode:'preseason_candidate',preseasonDistributions:distributions(eligible,roster,asOf)};
  const mmrs=teams.map(t=>t.AverageSignupMMR).filter(Number.isFinite);
  const average=mmrs.length?mmrs.reduce((sum,n)=>sum+n,0)/mmrs.length:null;
  priceInputs.preseasonTeamPriors=Object.fromEntries(teams.map(team=>{
    const mmrSignal=average!==null&&Number.isFinite(team.AverageSignupMMR)?(team.AverageSignupMMR-average)/1000:0;
    const signals=roster.filter(p=>p.TeamSubmissionId===team.TeamSubmissionId).map(p=>{
      const games=eligible.filter(g=>g.PlayerId===p.PlayerId).slice(-100),wins=games.reduce((sum,g)=>sum+Number(g.Won===1),0);
      const chance=(wins+10)/(games.length+20);return Math.log(chance/(1-chance));
    });
    const signal=Math.max(-.6,Math.min(.6,signals.reduce((sum,n)=>sum+n,0)/5));
    return [team.TeamSubmissionId,Math.max(.1,Math.min(.9,1/(1+Math.exp(-(mmrSignal+.35*signal)))))];
  }));
  return priceInputs;
}

export function buildSignupPreseasonPreview({ inputs, history, historyReports = [], simulations = 2000,
  now = new Date(), margin = configuredPricePolicy().margin }) {
  if (!inputs || !positive(inputs.season?.SeasonId)) throw new Error('Build Analytics for this season first');
  if (!['signup_closed', 'active'].includes(inputs.season.Status)) throw new Error('Close signups and assign groups first');
  if (!Number.isInteger(simulations) || simulations < 100 || simulations > 10000) throw new Error('Use 100–10000 simulations');
  if (inputs.games.some(g => g.Stage === 'regular')) throw new Error('Preseason preview requires a season without regular-season games');
  if (inputs.teams.length < 2 || inputs.teams.some(t => !t.GroupId)) throw new Error('Assign every team to a group');
  const roster = inputs.roster;
  const pendingSlots=inputs.pendingSlots||[];
  if (new Set(roster.map(p => p.PlayerId)).size !== roster.length || inputs.teams.some(t => {
    const players=roster.filter(p=>p.TeamSubmissionId===t.TeamSubmissionId),pending=pendingSlots.filter(p=>p.TeamSubmissionId===t.TeamSubmissionId);
    return players.length+pending.length!==5||new Set([...players,...pending].map(p=>p.Slot)).size!==5;
  })) throw new Error('Each team needs five confirmed or explicit TBD slots and distinct players with no duplicate team memberships');
  const gameCounts = Object.fromEntries(inputs.teams.map(t => [t.TeamSubmissionId,
    2 * (inputs.teams.filter(other => other.GroupId === t.GroupId).length - 1)]));
  if (Object.values(gameCounts).some(n => n < 5 || n > 100)) throw new Error('BO2 groups require 4–51 teams');
  const asOf = now.toISOString();
  // Never use target-season performances. Observation cutoff is independent of
  // game kickoff; recently backfilled old games may inform today's preview only.
  const eligible = history.filter(g => g.LeagueId !== inputs.season.LeagueId && ['regular', 'playoff'].includes(g.Stage)
    && Number.isFinite(Date.parse(g.SourceObservedAtUtc)) && Date.parse(g.SourceObservedAtUtc) <= now.getTime()
    && Number.isFinite(Date.parse(g.StartedAtUtc)) && g.DurationSeconds > 0
    && Date.parse(g.StartedAtUtc) + g.DurationSeconds * 1000 < now.getTime())
    .sort((a, b) => a.StartedAtUtc.localeCompare(b.StartedAtUtc) || a.MatchId - b.MatchId || a.PlayerId - b.PlayerId);
  const teams = inputs.teams.map(t => ({ ...t, ActualTeamId: t.TeamId, TeamId: t.TeamSubmissionId }));
  const neutral = teams.some(t => !Number.isFinite(t.AverageSignupMMR));
  const priceInputs = signupTeamPricingInputs({season:inputs.season,teams,roster},eligible,asOf);
  const privateInputs = { inputs: priceInputs, gameCounts, historyReports };
  const inputDigest = digest({ model: PRESEASON_MODEL_VERSION, privateInputs, simulations, margin });
  const random = seededRandom(parseInt(inputDigest.slice(0, 8), 16)), markets = [], held = [];
  const add = (definition, outcomes) => markets.push({ marketId: markets.length + 1, scope: 'preseason', ...definition,
    selections: outcomes.map(o => ({ key: o.key, label: o.label, odds: anchorPrice(o.probability, margin) / ODDS_SCALE })) });
  for (const p of roster) for (const stat of Object.keys(METRICS)) {
    if (!priceInputs.preseasonDistributions.players[p.PlayerId]?.[stat]) {
      held.push({ scope: 'preseason', playerId: p.PlayerId, stat, reason: 'fewer_than_five_preseason_metric_games' }); continue;
    }
    for (const aggregation of ['total', 'average']) {
      if (aggregation === 'total' && ['gpm', 'xpm'].includes(stat)) continue;
      const forecast = statForecast(priceInputs, { playerId: p.PlayerId, teamKey: p.TeamSubmissionId, stat,
        scope: aggregation, games: gameCounts[p.TeamSubmissionId] }, random, simulations);
      add({ type: 'season_player', playerId: p.PlayerId, teamKey: p.TeamSubmissionId, stat, aggregation, line: forecast.line,
        title: `${p.PlayerName} — ${stat.replaceAll('_', ' ')} ${aggregation}` },
      [{ key: 'over', label: `Over ${forecast.line}`, probability: forecast.over }, { key: 'under', label: `Under ${forecast.line}`, probability: forecast.under }]);
    }
  }
  for (const [stat, aggregation] of [['kills', 'total'], ['kills', 'average'], ['gpm', 'average'], ['xpm', 'average']]) {
    const prediction = pendingSlots.length?null:leaderForecast(priceInputs, roster, stat, aggregation, gameCounts, random, simulations);
    if (prediction) add({ type: 'player_leader', stat, aggregation, title: `Regular-season leader — ${stat} ${aggregation}` }, prediction);
    else held.push({ scope: 'preseason', stat, reason: pendingSlots.length?'pending_roster_slots':'leader_field_has_missing_history_or_conflicting_players' });
  }
  const simulated = simulateSeason(priceInputs, { RegularGamesPerTeam: gameCounts }, random, simulations, { includeMatchups: true });
  if(simulated)for(const team of teams) {
    const prediction=seasonWinsForecast(simulated,team.TeamId);
    if(prediction)add({type:'season_team',teamKey:team.TeamId,stat:'wins',aggregation:'total',line:prediction.line,
      regularGames:prediction.games,title:`${team.TeamName} — Regular-season wins`},
      [{key:'over',label:`Over ${prediction.line}`,probability:prediction.over},{key:'under',label:`Under ${prediction.line}`,probability:prediction.under}]);
  }
  const matchupSimulation = simulated ? { samples: simulated.samples, matchups: simulated.matchups.map(m => ({
    groupId: m.groupId, team1Key: m.team1Key, team2Key: m.team2Key,
    team1: teams.find(t => t.TeamSubmissionId === m.team1Key).TeamName,
    team2: teams.find(t => t.TeamSubmissionId === m.team2Key).TeamName,
    gameWinProbability: m.gameWinProbability,
    scores: [{ score: '2-0', probability: m.gameWinProbability ** 2, count: m.scores[2] },
      { score: '1-1', probability: 2 * m.gameWinProbability * (1 - m.gameWinProbability), count: m.scores[1] },
      { score: '0-2', probability: (1 - m.gameWinProbability) ** 2, count: m.scores[0] }],
  })) } : null;
  if (simulated?.champion && !neutral) add({ type: 'champion', title: 'League champion' }, teams.map(t => ({
    key: `team:${t.TeamId}`, label: t.TeamName, probability: simulated.champion[t.TeamId] })));
  else held.push({ scope: 'preseason', reason: 'group_or_bracket_format_not_supported' });
  if (simulated?.placement) for (const team of teams) {
    const buckets = Object.entries(simulated.placement[team.TeamId]).filter(([, probability]) => probability > 0 && probability < 1);
    if (buckets.length >= 2 && Math.abs(buckets.reduce((sum, [, p]) => sum + p, 0) - 1) < 1e-6) add({ type: 'placement',
      teamKey: team.TeamId, title: `${team.TeamName} — Bracket placement` }, buckets.map(([key, probability]) => ({
        key, label: key === 'upper' ? 'Upper bracket' : key === 'lower' ? 'Lower bracket' : 'Eliminated', probability })));
  }
  return { version: 1, previewKind: 'signup', seasonId: inputs.season.SeasonId,
    leagueId: inputs.season.LeagueId || inputs.season.SeasonId, leagueName: inputs.season.LeagueName,
    cutoffDay: asOf.slice(0, 10), asOf, trainingLeagueId: historyReports[0]?.leagueId || null,
    trainingLeagueName: historyReports.map(r => r.name).join(', ') || 'No eligible earlier league history',
    trainingGames: new Set(eligible.map(g => `${g.LeagueId}:${g.MatchId}`)).size,
    trainingLastDay: eligible.at(-1)?.StartedAtUtc?.slice(0, 10) || null,
    modelVersion: PRESEASON_MODEL_VERSION, inputDigest, simulations,
    preseasonMarkets: markets.length, seriesMarkets: 0, preseasonStatus: 'candidate_signup_rosters', pricingStatus: 'illustration_only',
    rosterSource: 'website_signups', neutralTeamPriors: neutral, conflictingPlayers: [], fixtures: [],
    warnings: ['candidate_model_not_validated_for_live_betting', 'legacy_training_membership_unknown', ...(neutral ? ['team_prior_missing'] : []), ...(pendingSlots.length?['provisional_rosters']:[])],
    rosterTeams: teams.map(t => ({ teamId: t.TeamId, externalTeamId: t.ActualTeamId, teamName: t.TeamName,
      regularGames: gameCounts[t.TeamId], pendingPlayers:pendingSlots.filter(p=>p.TeamSubmissionId===t.TeamId).length,
      players: roster.filter(p => p.TeamSubmissionId === t.TeamId).map(p => ({ playerId: p.PlayerId, name: p.PlayerName })) })),
    held, markets, privateInputs, matchupSimulation, generatedAt: asOf };
}
