import {
  openPublicDataStores,
  closePublicDataStores,
  assertPublicSchema,
} from '../../publicDatabase.js';
import { publicScoutingPlayers } from '../../config/publicScouting.js';

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

    const players = publicScoutingPlayers(stores.ladsDb);
    syncPublicPlayerInfo(stores.publicDb, players);

    console.log(
      `Public PlayerInfo sync complete. Signup and league players=${players.length}.`
    );
  } finally {
    closePublicDataStores(stores);
  }
}

main();
