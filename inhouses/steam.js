import {fail, positiveId} from './store.js';

function livePlayers(game) {
  const radiant = game.scoreboard?.radiant?.players, dire = game.scoreboard?.dire?.players;
  if (Array.isArray(radiant) && Array.isArray(dire) && radiant.length + dire.length === 10) {
    return [...radiant.map(p => ({playerId: Number(p.account_id), side: 'radiant'})),
      ...dire.map(p => ({playerId: Number(p.account_id), side: 'dire'}))];
  }
  const source = Array.isArray(game.players) ? game.players : [];
  const teamNumbers = source.some(p => p.team === 0 || p.team === 1) ? [0, 1] : [2, 3];
  return source.map(p => ({playerId: Number(p.account_id),
    side: p.team === teamNumbers[0] ? 'radiant' : p.team === teamNumbers[1] ? 'dire' : null}));
}

export function normalizeLiveGame(game, leagueId) {
  return {matchId: Number(game.match_id), leagueId: Number(game.league_id ?? leagueId),
    startedAt: Number(game.start_time) > 0 ? Number(game.start_time) * 1000 : null,
    players: livePlayers(game), winner: null, duration: Number(game.scoreboard?.duration) || 0};
}

export function normalizeMatchDetails(result, requestedId) {
  if (Number(result?.match_id) !== Number(requestedId) || !Array.isArray(result?.players)) fail('Match details are not available yet', 503);
  return {matchId: positiveId(result.match_id, 'match'), leagueId: Number(result.leagueid),
    startedAt: Number(result.start_time) > 0 ? Number(result.start_time) * 1000 : null,
    players: result.players.map(p => ({playerId: Number(p.account_id), side: Number.isInteger(p.player_slot)
      ? p.player_slot < 128 ? 'radiant' : 'dire' : null})),
    winner: typeof result.radiant_win === 'boolean' ? result.radiant_win ? 'radiant' : 'dire' : null,
    duration: Number(result.duration) || 0};
}

export function createSteamInhouseClient({apiKey = process.env.STEAM_API_KEY, fetchImpl = fetch, timeoutMs = 8000,
  minIntervalMs = 1000, clock = Date.now, signal, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let nextRequest = 0;
  // All calls from this client are serialized, including admin corrections.
  let tail = Promise.resolve();
  function request(method, params) {
    const run = async () => {
      if (!apiKey) fail('STEAM_API_KEY is not configured', 503);
      const delay = nextRequest - clock();
      if (delay > 0) await sleep(delay);
      nextRequest = clock() + minIntervalMs;
      const url = new URL(`https://api.steampowered.com/IDOTA2Match_570/${method}/v1/`);
      url.searchParams.set('key', apiKey);
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
      let response;
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      try {response = await fetchImpl(url, {cache: 'no-store', signal: requestSignal});}
      catch {fail('Steam did not respond. The worker will retry.', 503);}
      if (!response.ok) fail(`Steam returned HTTP ${response.status}. The worker will retry.`, 503);
      let data;
      try {data = await response.json();} catch {fail('Steam returned an unreadable response', 503);}
      if (!data?.result || data.result.error) fail('Steam match data is not available yet', 503);
      return data.result;
    };
    const result = tail.then(run, run);
    tail = result.catch(() => {});
    return result;
  }
  return {
    async live(leagueId) {
      const result = await request('GetLiveLeagueGames', {league_id: positiveId(leagueId)});
      if (!Array.isArray(result.games)) fail('Steam returned no live games list', 503);
      return result.games.map(g => normalizeLiveGame(g, leagueId));
    },
    async history(leagueId) {
      const result = await request('GetMatchHistory', {league_id: positiveId(leagueId), matches_requested: 100});
      if (result.status !== 1 || !Array.isArray(result.matches)) fail('Steam match history is unavailable', 503);
      return result.matches.map(m => ({matchId: positiveId(m.match_id, 'match'), startedAt: Number(m.start_time) * 1000}));
    },
    async details(matchId) {
      return normalizeMatchDetails(await request('GetMatchDetails', {match_id: positiveId(matchId, 'match')}), matchId);
    },
  };
}
