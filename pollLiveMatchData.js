import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {notifyLiveMatchUpdate} from './config/liveMatchNotifications.js';
dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;
const REPEATED_ERROR_LOG_INTERVAL_MS = 5 * 60_000;
const HEARTBEAT_LOG_INTERVAL_MS = 5 * 60_000;
const STALE_LIVE_MATCH_SECONDS = 120;

let noActiveLeagueLogged = false;
let lastErrorMessage = null;
let lastErrorLoggedAt = 0;
let lastSkippedMatchWarningAt = 0;
let lastHeartbeatLoggedAt = 0;
let lastPushErrorAt = 0;

function timestamp() {
  return new Date().toISOString();
}

function logRateLimitedError(message, error = null) {
  const now = Date.now();
  const shouldLog =
    message !== lastErrorMessage ||
    now - lastErrorLoggedAt >= REPEATED_ERROR_LOG_INTERVAL_MS;

  if (!shouldLog) return;

  if (error) {
    console.error(`[${timestamp()}] ${message}`, error);
  } else {
    console.error(`[${timestamp()}] ${message}`);
  }

  lastErrorMessage = message;
  lastErrorLoggedAt = now;
}

function logRecovery() {
  if (!lastErrorMessage) return;

  console.log(`[${timestamp()}] Live polling recovered.`);
  lastErrorMessage = null;
  lastErrorLoggedAt = 0;
}

function logHeartbeat({ activeLeagueId, gamesCount, changedMatches, skippedMatches, removedMatches }) {
  const now = Date.now();
  if (now - lastHeartbeatLoggedAt < HEARTBEAT_LOG_INTERVAL_MS) return;

  console.log(
    `[${timestamp()}] Live polling heartbeat: ` +
    `activeLeague=${activeLeagueId}, ` +
    `games=${gamesCount}, ` +
    `changed=${changedMatches}, ` +
    `skipped=${skippedMatches}, ` +
    `removed=${removedMatches}`
  );
  lastHeartbeatLoggedAt = now;
}

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

function normalizeLivePlayers(game, matchId) {
  const playerNames = new Map(
    (game.players || []).map((player) => [
      nullableSafeInteger(player.account_id),
      {
        PlayerName: player.name || null,
        Team: nullableNumber(player.team),
        HeroId: nullableNumber(player.hero_id),
      },
    ])
  );

  const scoreboardPlayers = [
    ...(game.scoreboard?.radiant?.players || []).map((player) => ({ ...player, Team: 0 })),
    ...(game.scoreboard?.dire?.players || []).map((player) => ({ ...player, Team: 1 })),
  ];

  const sourcePlayers = scoreboardPlayers.length
    ? scoreboardPlayers
    : (game.players || []).map((player) => ({
        account_id: player.account_id,
        hero_id: player.hero_id,
        Team: player.team,
      }));

  return sourcePlayers
    .map((player) => {
      const accountId = nullableSafeInteger(player.account_id);
      if (!accountId) return null;

      const playerMeta = playerNames.get(accountId) || {};

      return {
        MatchId: matchId,
        AccountId: accountId,
        PlayerName: playerMeta.PlayerName || player.name || null,
        Team: nullableNumber(player.Team ?? playerMeta.Team),
        PlayerSlot: nullableNumber(player.player_slot),
        HeroId: nullableNumber(player.hero_id ?? playerMeta.HeroId),
        Kills: nullableNumber(player.kills),
        Deaths: nullableNumber(player.death ?? player.deaths),
        Assists: nullableNumber(player.assists),
        LastHits: nullableNumber(player.last_hits),
        Denies: nullableNumber(player.denies),
        Gold: nullableNumber(player.gold),
        Level: nullableNumber(player.level),
        GPM: nullableNumber(player.gold_per_min),
        XPM: nullableNumber(player.xp_per_min),
        NetWorth: nullableNumber(player.net_worth),
        RespawnTimer: nullableNumber(player.respawn_timer),
        PositionX: nullableNumber(player.position_x),
        PositionY: nullableNumber(player.position_y),
      };
    })
    .filter(Boolean);
}

function normalizeDraftState(game, matchId) {
  const radiantPicks = game.scoreboard?.radiant?.picks || [];
  const direPicks = game.scoreboard?.dire?.picks || [];
  const radiantBans = game.scoreboard?.radiant?.bans || [];
  const direBans = game.scoreboard?.dire?.bans || [];
  const draft = {
    radiant: {
      picks: radiantPicks,
      bans: radiantBans,
    },
    dire: {
      picks: direPicks,
      bans: direBans,
    },
  };

  return {
    MatchId: matchId,
    RadiantPicks: radiantPicks,
    DirePicks: direPicks,
    RadiantBans: radiantBans,
    DireBans: direBans,
    DraftJson: stableStringify(draft),
  };
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
    RadiantTowerState: nullableNumber(game.scoreboard?.radiant?.tower_state),
    DireTowerState: nullableNumber(game.scoreboard?.dire?.tower_state),
    RadiantBarracksState: nullableNumber(game.scoreboard?.radiant?.barracks_state),
    DireBarracksState: nullableNumber(game.scoreboard?.dire?.barracks_state),
    SnapshotHash: createHash('sha256').update(responseJson).digest('hex'),
    Players: normalizeLivePlayers(game, matchId),
    Draft: normalizeDraftState(game, matchId),
  };
}

async function getLiveLeagueMatches(leagueId, { apiKey = STEAM_API_KEY, fetchImpl = fetch } = {}) {
  const requestUrl =
    `https://api.steampowered.com/IDOTA2Match_570/GetLiveLeagueGames/v1/` +
    `?key=${encodeURIComponent(apiKey)}&league_id=${encodeURIComponent(leagueId)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let responseText;
  let status;
  let ok;

  try {
    const response = await fetchImpl(requestUrl, { signal: controller.signal, cache: 'no-store' });
    responseText = await response.text();
    status = response.status;
    ok = response.ok;
  } finally {
    clearTimeout(timeout);
  }

  if (!ok) throw new Error(`Steam API returned HTTP ${status}`);

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (err) {
    throw new Error(`Steam returned invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(payload?.result?.games)) {
    throw new Error('Steam returned no live games list');
  }
  return payload.result.games;
}

async function pollLiveMatches({ database, apiKey = STEAM_API_KEY, fetchImpl = fetch, notify = notifyLiveMatchUpdate } = {}) {
  if (!apiKey) {
    throw new Error('Missing STEAM_API_KEY in .env');
  }
  const db = database || (await import('./database.js')).default;

  const activeLeagueId = db.getActiveLeague()?.[0]?.LeagueId;
  if (!activeLeagueId) {
    if (!noActiveLeagueLogged) {
      console.log(`[${timestamp()}] No active league. Pausing live match API calls.`);
      noActiveLeagueLogged = true;
    }
    return;
  }

  if (noActiveLeagueLogged) {
    console.log(`[${timestamp()}] Active league ${activeLeagueId} found. Resuming live match polling.`);
    noActiveLeagueLogged = false;
  }

  const games = await getLiveLeagueMatches(activeLeagueId, { apiKey, fetchImpl });
  let changedMatches = 0;
  let skippedMatches = 0;
  const seenMatchIds = [];

  for (const game of games) {
    const matchData = normalizeLiveMatch(game, activeLeagueId);
    if (!matchData) {
      skippedMatches += 1;
      continue;
    }

    seenMatchIds.push(matchData.MatchId);
    if (db.recordLiveMatchSnapshot(matchData)) changedMatches += 1;
  }

  const removedMatches = db.pruneMissingLiveMatches(
    seenMatchIds,
    STALE_LIVE_MATCH_SECONDS,
    activeLeagueId
  );

  // Commit all changes before notifying the web process. Successful unchanged
  // polls also update the viewers' "last checked" time, without new snapshots.
  let delivered=false;
  try{delivered=await notify();}catch{/* Saved state remains available through HTTP polling. */}
  if(!delivered&&Date.now()-lastPushErrorAt>=REPEATED_ERROR_LOG_INTERVAL_MS) {
    console.warn(`[${timestamp()}] Live push notification unavailable; browser polling remains available.`);
    lastPushErrorAt=Date.now();
  }else if(delivered&&lastPushErrorAt) {
    console.log(`[${timestamp()}] Live push notifications recovered.`);lastPushErrorAt=0;
  }

  if (skippedMatches > 0) {
    const now = Date.now();
    if (now - lastSkippedMatchWarningAt >= REPEATED_ERROR_LOG_INTERVAL_MS) {
      console.warn(`[${timestamp()}] Skipped ${skippedMatches} live game(s) with no valid match ID.`);
      lastSkippedMatchWarningAt = now;
    }
  }

  if (changedMatches > 0) {
    console.log(`[${timestamp()}] Recorded ${changedMatches} changed live match(es).`);
  }

  if (removedMatches > 0) {
    console.log(`[${timestamp()}] Removed ${removedMatches} stale live match(es) from current state.`);
  }

  logHeartbeat({
    activeLeagueId,
    gamesCount: games.length,
    changedMatches,
    skippedMatches,
    removedMatches,
  });
}

async function runPollingLoop() {
  const startedAt = Date.now();
  try {
    await pollLiveMatches();
    logRecovery();
  } catch (err) {
    logRateLimitedError(`Live poll failed: ${err.message}`, err);
  } finally {
    setTimeout(runPollingLoop, nextLivePollDelay(startedAt));
  }
}

// Five seconds between request starts, without overlapping a slow Steam request.
function nextLivePollDelay(startedAt, now = Date.now()) {
  return Math.max(100, POLL_INTERVAL_MS - (now - startedAt));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  console.log(
    `[${timestamp()}] Live polling worker started. ` +
    `intervalMs=${POLL_INTERVAL_MS}, cwd=${process.cwd()}`
  );
  runPollingLoop();
}

export {
  getLiveLeagueMatches,
  normalizeLiveMatch,
  pollLiveMatches,
  nextLivePollDelay,
};
