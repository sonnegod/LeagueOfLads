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
    ON CONFLICT(PlayerId) DO NOTHING
    `
  );

  const syncTxn = publicDb.transaction((rows) => {
    for (const row of rows) {
      upsertStmt.run(row.PlayerId, row.PlayerName);
    }
  });

  syncTxn(players);
}

function main() {
  const stores = openPublicDataStores();

  try {
    assertPublicSchema(stores.publicDb);

    const leagueId = getCurrentLeagueId(stores.ladsDb);
    const players = leagueId ? getCurrentSeasonPlayers(stores.ladsDb, leagueId) : [];
    const signupSchema = stores.ladsDb.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'SeasonTeamPlayers' AND type = 'table'`).get();
    if (signupSchema) {
      // Preseason players have no league games yet but still need private inputs.
      const submissions = stores.ladsDb.prepare(`SELECT DISTINCT p.PlayerId, pi.PlayerName
        FROM SeasonTeamPlayers p JOIN SeasonTeams t ON t.TeamSubmissionId = p.TeamSubmissionId
        JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId JOIN PlayerInfo pi ON pi.PlayerId = p.PlayerId
        WHERE s.Status IN ('draft', 'signup_open', 'signup_closed', 'active')`).all();
      const ids = new Set(players.map(player => player.PlayerId));
      for (const player of submissions) if (!ids.has(player.PlayerId)) {
        players.push(player); ids.add(player.PlayerId);
      }
    }
    syncPublicPlayerInfo(stores.publicDb, players);

    console.log(
      `Public PlayerInfo sync complete. League=${leagueId}, players=${players.length}.`
    );
  } finally {
    closePublicDataStores(stores);
  }
}

main();
