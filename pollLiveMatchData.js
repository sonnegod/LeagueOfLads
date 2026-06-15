import { createHash } from 'node:crypto';
import db from './database.js';
import dotenv from 'dotenv';
dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const properties = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${properties.join(',')}}`;
  }

  return JSON.stringify(value);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableSafeInteger(value) {
  const number = nullableNumber(value);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizeLiveMatch(game, activeLeagueId) {
  const matchId = nullableSafeInteger(game.match_id ?? game.matchId);
  if (!matchId) return null;

  const responseJson = stableStringify(game);

  return {
    MatchId: matchId,
    LeagueId: nullableNumber(game.league_id ?? game.leagueId) ?? activeLeagueId,
    LobbyId: nullableSafeInteger(game.lobby_id ?? game.lobbyId),
    RadiantTeamId: nullableSafeInteger(
      game.radiant_team?.team_id ?? game.radiant_team_id ?? game.team_id_radiant
    ),
    DireTeamId: nullableSafeInteger(
      game.dire_team?.team_id ?? game.dire_team_id ?? game.team_id_dire
    ),
    RadiantTeamName:
      game.radiant_team?.team_name ?? game.radiant_team_name ?? game.team_name_radiant ?? null,
    DireTeamName:
      game.dire_team?.team_name ?? game.dire_team_name ?? game.team_name_dire ?? null,
    RadiantScore: nullableNumber(game.scoreboard?.radiant?.score ?? game.radiant_score),
    DireScore: nullableNumber(game.scoreboard?.dire?.score ?? game.dire_score),
    GameDuration: nullableNumber(game.scoreboard?.duration ?? game.game_time ?? game.game_duration),
    StreamDelaySeconds: nullableNumber(
      game.stream_delay_seconds ?? game.stream_delay_s ?? game.delay
    ),
    SnapshotHash: createHash('sha256').update(responseJson).digest('hex'),
    ResponseJson: responseJson,
  };
}

async function getLiveLeagueMatches(leagueId) {
  const requestUrl =
    `https://api.steampowered.com/IDOTA2Match_570/GetLiveLeagueGames/v1/` +
    `?key=${encodeURIComponent(STEAM_API_KEY)}&league_id=${encodeURIComponent(leagueId)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let responseText;
  let status;
  let ok;

  try {
    const response = await fetch(requestUrl, { signal: controller.signal });
    responseText = await response.text();
    status = response.status;
    ok = response.ok;
  } finally {
    clearTimeout(timeout);
  }

  if (!ok) throw new Error(`Steam API returned HTTP ${status}`);

  try {
    const games = JSON.parse(responseText)?.result?.games;
    return Array.isArray(games) ? games : [];
  } catch (err) {
    throw new Error(`Steam returned invalid JSON: ${err.message}`);
  }
}

async function pollLiveMatches() {
  if (!STEAM_API_KEY) {
    throw new Error('Missing STEAM_API_KEY in .env');
  }

  const activeLeagueId = db.getActiveLeague()?.[0]?.LeagueId;
  if (!activeLeagueId) {
    console.log(`[${new Date().toISOString()}] No active league. Skipping live match poll.`);
    return;
  }

  const games = await getLiveLeagueMatches(activeLeagueId);
  let changedMatches = 0;

  for (const game of games) {
    const matchData = normalizeLiveMatch(game, activeLeagueId);
    if (!matchData) {
      console.warn(`[${new Date().toISOString()}] Skipping live game with no match ID.`);
      continue;
    }

    if (db.recordLiveMatchSnapshot(matchData)) changedMatches += 1;
  }

  console.log(`[${new Date().toISOString()}] Live poll complete. Games: ${games.length}, changed: ${changedMatches}.`);
}

async function runPollingLoop() {
  try {
    await pollLiveMatches();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Live poll failed:`, err);
  } finally {
    setTimeout(runPollingLoop, POLL_INTERVAL_MS);
  }
}

runPollingLoop();
