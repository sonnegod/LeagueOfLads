export default class AdjustedPlayersStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS AdjustedPlayers (
      PlayerId INTEGER PRIMARY KEY NOT NULL REFERENCES PlayerInfo(PlayerId),
      AdjustedMMR INTEGER NOT NULL CHECK (AdjustedMMR > 5500),
      CreatedAt TEXT NOT NULL,
      UpdatedAt TEXT NOT NULL
    )`);
  }

  list(search = '') {
    const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
    return this.db.prepare(`SELECT a.PlayerId, CAST(p.PlayerName AS TEXT) AS PlayerName,
        a.AdjustedMMR, a.CreatedAt, a.UpdatedAt
      FROM AdjustedPlayers a JOIN PlayerInfo p ON p.PlayerId = a.PlayerId
      WHERE CAST(p.PlayerName AS TEXT) LIKE ? ESCAPE '!'
        OR CAST(a.PlayerId AS TEXT) LIKE ? ESCAPE '!'
      ORDER BY p.PlayerName COLLATE NOCASE, a.PlayerId`).all(pattern, pattern);
  }

  candidates(search) {
    if (!search) return [];
    const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
    return this.db.prepare(`SELECT p.PlayerId, CAST(p.PlayerName AS TEXT) AS PlayerName
      FROM PlayerInfo p
      WHERE p.PlayerId > 0
        AND NOT EXISTS (SELECT 1 FROM AdjustedPlayers a WHERE a.PlayerId = p.PlayerId)
        AND (CAST(p.PlayerName AS TEXT) LIKE ? ESCAPE '!'
          OR CAST(p.PlayerId AS TEXT) LIKE ? ESCAPE '!')
      ORDER BY p.PlayerName COLLATE NOCASE, p.PlayerId LIMIT 50`).all(pattern, pattern);
  }

  get(playerId) {
    return this.db.prepare(`SELECT a.PlayerId, CAST(p.PlayerName AS TEXT) AS PlayerName,
        a.AdjustedMMR, a.CreatedAt, a.UpdatedAt
      FROM AdjustedPlayers a JOIN PlayerInfo p ON p.PlayerId = a.PlayerId
      WHERE a.PlayerId = ?`).get(playerId) || null;
  }

  add(playerId, mmr) {
    if (!Number.isSafeInteger(mmr) || mmr <= 5500) throw new RangeError('Adjusted MMR must be greater than 5,500');
    if (!this.db.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId = ?').get(playerId)) {
      const error = new Error('Player not found in PlayerInfo');
      error.code = 'PLAYER_NOT_FOUND';
      throw error;
    }
    if (this.get(playerId)) {
      const error = new Error('Player already has an adjusted MMR');
      error.code = 'ADJUSTMENT_EXISTS';
      throw error;
    }
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO AdjustedPlayers (PlayerId, AdjustedMMR, CreatedAt, UpdatedAt)
      VALUES (?, ?, ?, ?)`).run(playerId, mmr, now, now);
    return this.get(playerId);
  }

  update(playerId, mmr) {
    if (!Number.isSafeInteger(mmr) || mmr <= 5500) throw new RangeError('Adjusted MMR must be greater than 5,500');
    const existing = this.get(playerId);
    if (!existing) return null;
    if (existing.AdjustedMMR === mmr) return existing;
    this.db.prepare(`UPDATE AdjustedPlayers SET AdjustedMMR = ?, UpdatedAt = ?
      WHERE PlayerId = ?`).run(mmr, new Date().toISOString(), playerId);
    return this.get(playerId);
  }

  remove(playerId) {
    const existing = this.get(playerId);
    if (!existing) return null;
    this.db.prepare('DELETE FROM AdjustedPlayers WHERE PlayerId = ?').run(playerId);
    return existing;
  }
}
