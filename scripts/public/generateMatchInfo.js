import {
  openPublicDataStores,
  closePublicDataStores,
  assertPublicSchema,
} from '../../publicDatabase.js';
import { startSourceLoad, finishSourceLoad, ensurePublicAvailability } from '../../analytics/sourceMetadata.js';
import { publicMatchPages } from '../../analytics/publicMatchInput.js';
import { recordPublicSync } from '../../config/publicScouting.js';

const REQUEST_DELAY_MS = 350;

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function insertPublicMatchRows(publicDb, rows) {
  const observedAt = new Date().toISOString();
  const recordAvailability = publicDb.prepare(`INSERT OR IGNORE INTO PublicMatchAvailability
    (MatchId, PlayerId, FirstObservedAtUtc) VALUES (?, ?, ?)`);
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
      recordAvailability.run(row.MatchId, row.PlayerId, observedAt);
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
  let failures = 0;
  let sourceRunId;

  try {
    assertPublicSchema(stores.publicDb);
    ensurePublicAvailability(stores.publicDb);
    stores.publicDb.exec('CREATE INDEX IF NOT EXISTS idx_PublicMatchPlayer_AnalyticsWindow ON PublicMatchPlayer(PlayerId, DateCreated)');
    sourceRunId = startSourceLoad(stores.publicDb, 'public_matches');

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
      finishSourceLoad(stores.publicDb, sourceRunId);
      return;
    }

    for (const [index, player] of players.entries()) {
      const playerId = toNumber(player.PlayerId, null);
      if (!playerId) continue;

      try {
        let seen = 0; let inserted = 0;
        for await (const rows of publicMatchPages(playerId)) {
          seen += rows.length;
          inserted += insertPublicMatchRows(stores.publicDb, rows);
        }
        recordPublicSync(stores.publicDb, playerId, true);
        totalRowsSeen += seen;
        totalRowsInserted += inserted;
        console.log(`[${index + 1}/${totalPlayers}] ${player.PlayerName || playerId}: seen=${seen}, inserted=${inserted}`);
      } catch (err) {
        failures += 1;
        recordPublicSync(stores.publicDb, playerId, false, 'FETCH_FAILED');
        console.error(
          `[${index + 1}/${totalPlayers}] Failed ${player.PlayerName || playerId}: ${err.message}`
        );
      }

      await sleep(REQUEST_DELAY_MS);
    }

    console.log(
      `PublicMatchPlayer generation complete. players=${totalPlayers}, rows_seen=${totalRowsSeen}, rows_inserted=${totalRowsInserted}.`
    );
    finishSourceLoad(stores.publicDb, sourceRunId, { records: totalRowsSeen, failures });
    if (failures) process.exitCode = 1;
  } catch {
    if (sourceRunId) finishSourceLoad(stores.publicDb, sourceRunId, { failed: true, failures: failures + 1 });
    console.error('Public match load failed; source freshness was not advanced.');
    process.exitCode = 1;
  } finally {
    closePublicDataStores(stores);
  }
}

await main();
