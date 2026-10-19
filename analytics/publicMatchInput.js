import { ANALYTICS_DEFAULTS } from './config.js';

function number(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePublicMatches(playerId, matches) {
  const rows = [];
  const seen = new Set();
  for (const match of matches) {
    const matchId = number(match.match_id);
    const heroId = number(match.hero_id);
    const kills = number(match.kills);
    const deaths = number(match.deaths);
    const assists = number(match.assists);
    const slot = number(match.player_slot);
    const start = number(match.start_time);
    if (!Number.isSafeInteger(matchId) || matchId <= 0 || !Number.isInteger(heroId) || heroId <= 0
      || [kills, deaths, assists].some(value => !Number.isInteger(value) || value < 0)
      || !Number.isInteger(slot) || !((slot >= 0 && slot <= 4) || (slot >= 128 && slot <= 132))
      || typeof match.radiant_win !== 'boolean' || start === null || start <= 0 || seen.has(matchId)) continue;
    const played = new Date(start * 1000);
    if (!Number.isFinite(played.getTime())) continue;
    seen.add(matchId);
    rows.push({ MatchId: matchId, PlayerId: playerId, Won: Number((slot <= 4) === match.radiant_win),
      HeroId: heroId, Kills: kills, Deaths: deaths, Assists: assists, DateCreated: played.toISOString() });
  }
  return rows;
}

// Parameters are documented at https://docs.opendota.com/ (player matches).
// Yield bounded pages rather than retaining a player's entire history in memory.
export async function* publicMatchPages(playerId, { fetchImpl = fetch,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), pageSize = 100, maxPages = 100 } = {}) {
  let previousPage = null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://api.opendota.com/api/players/${playerId}/matches`);
    url.searchParams.set('game_mode', '22');
    url.searchParams.set('date', String(ANALYTICS_DEFAULTS.publicLookbackDays));
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(page * pageSize));
    let matches;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetchImpl(url.toString(), { method: 'GET', signal: AbortSignal.timeout(30000) });
      if (response.ok) {
        matches = await response.json();
        if (!Array.isArray(matches)) throw new Error('Invalid public match response');
        break;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await pause(500 * attempt); continue;
      }
      throw new Error(`Public match request failed (${response.status})`);
    }
    const signature = JSON.stringify(matches.map(match => match.match_id));
    if (matches.length && signature === previousPage) throw new Error('Public match pagination did not advance');
    previousPage = signature;
    yield normalizePublicMatches(playerId, matches);
    if (matches.length < pageSize) return;
    await pause(350);
  }
  throw new Error('Public match pagination limit reached; coverage is incomplete');
}
