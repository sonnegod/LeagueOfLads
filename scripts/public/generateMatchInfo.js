import {
  openPublicDataStores,
  closePublicDataStores,
  assertPublicSchema,
} from '../../publicDatabase.js';

const REQUEST_DELAY_MS = 350;
const MAX_RETRIES = 3;

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeWon(playerSlot, radiantWin) {
  const slot = toNumber(playerSlot, null);
  if (slot === null || typeof radiantWin !== 'boolean') return null;

  const isRadiant = slot >= 0 && slot <= 127;
  const isDire = slot >= 128 && slot <= 255;
  if (!isRadiant && !isDire) return null;

  if (isRadiant) return radiantWin ? 1 : 0;
  return radiantWin ? 0 : 1;
}

function toIsoDateFromStartTime(startTime) {
  const epochSeconds = toNumber(startTime, null);
  if (epochSeconds === null) return null;

  const dt = new Date(epochSeconds * 1000);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

async function fetchPlayerMatches(playerId) {
  const url = `https://api.opendota.com/api/players/${playerId}/matches?game_mode=22&date=30`;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    const response = await fetch(url, { method: 'GET' });

    if (response.ok) {
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(500 * attempt);
      continue;
    }

    const body = await response.text();
    throw new Error(`OpenDota ${response.status}: ${body}`);
  }

  return [];
}

function normalizeMatchRows(playerId, matches) {
  const dedupe = new Set();
  const rows = [];

  for (const row of matches || []) {
    const matchId = toNumber(row?.match_id, null);
    const heroId = toNumber(row?.hero_id, null);
    const kills = toNumber(row?.kills, null);
    const deaths = toNumber(row?.deaths, null);
    const assists = toNumber(row?.assists, null);
    const won = computeWon(row?.player_slot, row?.radiant_win);
    const dateCreated = toIsoDateFromStartTime(row?.start_time);

    if (
      matchId === null ||
      heroId === null ||
      kills === null ||
      deaths === null ||
      assists === null ||
      won === null
    ) {
      continue;
    }

    const key = `${matchId}|${playerId}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    rows.push({
      MatchId: matchId,
      PlayerId: playerId,
      Won: won,
      HeroId: heroId,
      Kills: kills,
      Deaths: deaths,
      Assists: assists,
      DateCreated: dateCreated,
    });
  }

  return rows;
}

function insertPublicMatchRows(publicDb, rows) {
  const insertStmt = publicDb.prepare(
    `
    INSERT OR IGNORE INTO PublicMatchPlayer
      (MatchId, PlayerId, Won, HeroId, Kills, Deaths, Assists, DateCreated)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  let insertedCount = 0;
  const txn = publicDb.transaction((batch) => {
    for (const row of batch) {
      const result = insertStmt.run(
        row.MatchId,
        row.PlayerId,
        row.Won,
        row.HeroId,
        row.Kills,
        row.Deaths,
        row.Assists,
        row.DateCreated
      );
      insertedCount += result.changes;
    }
  });

  txn(rows);
  return insertedCount;
}

async function main() {
  const stores = openPublicDataStores();
  let totalPlayers = 0;
  let totalRowsSeen = 0;
  let totalRowsInserted = 0;

  try {
    assertPublicSchema(stores.publicDb);

    const players = stores.publicDb
      .prepare(
        `
        SELECT PlayerId, PlayerName
        FROM PlayerInfo
        ORDER BY PlayerName ASC
        `
      )
      .all();

    totalPlayers = players.length;
    if (totalPlayers === 0) {
      console.log('No players in public.PlayerInfo. Skipping PublicMatchPlayer generation.');
      return;
    }

    for (const [index, player] of players.entries()) {
      const playerId = toNumber(player.PlayerId, null);
      if (!playerId) continue;

      try {
        const matches = await fetchPlayerMatches(playerId);
        const normalizedRows = normalizeMatchRows(playerId, matches);
        const inserted = insertPublicMatchRows(stores.publicDb, normalizedRows);

        totalRowsSeen += normalizedRows.length;
        totalRowsInserted += inserted;

        console.log(
          `[${index + 1}/${totalPlayers}] ${player.PlayerName || playerId}: seen=${normalizedRows.length}, inserted=${inserted}`
        );
      } catch (err) {
        console.error(
          `[${index + 1}/${totalPlayers}] Failed ${player.PlayerName || playerId}: ${err.message}`
        );
      }

      await sleep(REQUEST_DELAY_MS);
    }

    console.log(
      `PublicMatchPlayer generation complete. players=${totalPlayers}, rows_seen=${totalRowsSeen}, rows_inserted=${totalRowsInserted}.`
    );
  } finally {
    closePublicDataStores(stores);
  }
}

main();
