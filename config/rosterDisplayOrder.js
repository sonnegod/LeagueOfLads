export function ensureRosterDisplayOrderSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS TeamRosterDisplayOrder (
    TeamSubmissionId INTEGER PRIMARY KEY, OrderJson TEXT NOT NULL
  )`);
}

export function validRosterOrder(order) {
  return Array.isArray(order)&&order.length===5&&new Set(order).size===5&&order.every(slot=>Number.isInteger(slot)&&slot>=0&&slot<5);
}

export function readRosterOrder(db,teamKey) {
  const saved=db.prepare('SELECT OrderJson FROM TeamRosterDisplayOrder WHERE TeamSubmissionId=?').get(teamKey);
  if(saved)try{const order=JSON.parse(saved.OrderJson);if(validRosterOrder(order))return order;}catch{}
  return [0,1,2,3,4];
}
