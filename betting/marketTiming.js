// Existing databases require a text close time. An empty value represents a
// preseason market without a scheduled kickoff; the public API exposes null.
export function marketHasClosed(market, now = new Date()) {
  return Boolean(market.CloseAtUtc) && Date.parse(market.CloseAtUtc) <= now.getTime();
}

export function lockDueMarkets(db, now = new Date()) {
  return db.prepare("UPDATE BettingMarkets SET Status='locked' WHERE Status IN ('open','held') AND CloseAtUtc<>'' AND CloseAtUtc<=?")
    .run(now.toISOString());
}
