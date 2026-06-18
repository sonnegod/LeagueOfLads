import {
  openPublicDataStores,
  closePublicDataStores,
  assertPublicSchema,
} from '../../publicDatabase.js';

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCurrentLeagueId(ladsDb) {
  const row = ladsDb
    .prepare(
      `
      SELECT ml.LeagueId
      FROM MatchLeague ml
      ORDER BY ml.LeagueId DESC
      LIMIT 1
      `
    )
    .get();

  return toNumber(row?.LeagueId, null);
}

function getCurrentSeasonPlayers(ladsDb, leagueId) {
  return ladsDb
    .prepare(
      `
      SELECT DISTINCT
        pi.PlayerId,
        pi.PlayerName
      FROM MatchPlayer mp
      JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      JOIN PlayerInfo pi ON pi.PlayerId = mp.PlayerId
      WHERE ml.LeagueId = ?
      ORDER BY pi.PlayerName ASC
      `
    )
    .all(leagueId)
    .map((row) => ({
      PlayerId: toNumber(row.PlayerId, null),
      PlayerName: row.PlayerName || '',
    }))
    .filter((row) => row.PlayerId);
}

function syncPublicPlayerInfo(publicDb, players) {
  const upsertStmt = publicDb.prepare(
    `
    INSERT INTO PlayerInfo (PlayerId, PlayerName)
    VALUES (?, ?)
    ON CONFLICT(PlayerId) DO UPDATE SET
      PlayerName = excluded.PlayerName
    `
  );

  const syncTxn = publicDb.transaction((rows) => {
    for (const row of rows) {
      upsertStmt.run(row.PlayerId, row.PlayerName);
    }

    if (rows.length === 0) {
      publicDb.prepare(`DELETE FROM PlayerInfo`).run();
      return;
    }

    const placeholders = rows.map(() => '?').join(', ');
    const keepIds = rows.map((row) => row.PlayerId);
    publicDb
      .prepare(`DELETE FROM PlayerInfo WHERE PlayerId NOT IN (${placeholders})`)
      .run(...keepIds);
  });

  syncTxn(players);
}

function main() {
  const stores = openPublicDataStores();

  try {
    assertPublicSchema(stores.publicDb);

    const leagueId = getCurrentLeagueId(stores.ladsDb);
    if (!leagueId) {
      console.log('No league found in LadsData. Skipping public PlayerInfo sync.');
      return;
    }

    const players = getCurrentSeasonPlayers(stores.ladsDb, leagueId);
    syncPublicPlayerInfo(stores.publicDb, players);

    console.log(
      `Public PlayerInfo sync complete. League=${leagueId}, players=${players.length}.`
    );
  } finally {
    closePublicDataStores(stores);
  }
}

main();
