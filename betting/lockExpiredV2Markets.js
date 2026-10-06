export function lockExpiredV2Markets(db, now = new Date().toISOString()) {
  if (Number.isNaN(Date.parse(now))) throw new Error('Invalid lock time');
  return db.prepare(`UPDATE Markets SET status = 'LOCKED'
    WHERE status = 'OPEN' AND close_time IS NOT NULL AND close_time <= ?`).run(now).changes;
}
