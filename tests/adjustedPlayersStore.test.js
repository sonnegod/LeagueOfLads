import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import AdjustedPlayersStore from '../config/adjustedPlayersStore.js';

test('adjusted MMR entries persist, search existing players, and reject duplicates', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER PRIMARY KEY, PlayerName TEXT NOT NULL);
      INSERT INTO PlayerInfo VALUES (111, 'Alpha'), (222, 'Beta');`);
    const store = new AdjustedPlayersStore(db);
    assert.deepEqual(store.candidates('alp').map(player => player.PlayerId), [111]);
    assert.equal(store.add(111, 6000).AdjustedMMR, 6000);
    assert.deepEqual(store.candidates('alp'), []);
    assert.deepEqual(store.list('111').map(player => player.PlayerName), ['Alpha']);
    assert.throws(() => store.add(111, 7000), { code: 'ADJUSTMENT_EXISTS' });
    assert.throws(() => store.add(999, 7000), { code: 'PLAYER_NOT_FOUND' });
    assert.equal(store.update(111, 6250).AdjustedMMR, 6250);
    assert.equal(new AdjustedPlayersStore(db).get(111).AdjustedMMR, 6250);
    assert.equal(store.remove(111).AdjustedMMR, 6250);
    assert.equal(store.get(111), null);
    assert.equal(store.update(111, 6500), null);
  } finally {
    db.close();
  }
});
