// Import pending legacy tickets into the isolated season-zero ledger. Original
// tables remain untouched, including every historical price/result/balance.
export function importLegacyPending(book) {
  const db=book.db;
  const exists=table=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if(!['ParlayTickets','BetLegs','BettingOptions','Markets'].every(exists))return;
  db.transaction(()=>{
    const timestamp=book.now().toISOString();
    db.prepare("INSERT OR IGNORE INTO BettingInputSnapshots (SeasonId,AnalyticsRunId,AsOfUtc,Digest,InputJson,CreatedAtUtc) VALUES (0,0,?,'legacy_import','{}',?)").run(timestamp,timestamp);
    const snapshot=db.prepare("SELECT SnapshotId FROM BettingInputSnapshots WHERE Digest='legacy_import'").get().SnapshotId;
    let forecast=db.prepare("SELECT ForecastId FROM BettingForecasts WHERE SnapshotId=? AND ModelVersion='legacy_import' LIMIT 1").get(snapshot)?.ForecastId;
    if(!forecast)forecast=Number(db.prepare("INSERT INTO BettingForecasts (SnapshotId,ModelVersion,Seed,ValidationJson,ForecastJson,CreatedAtUtc) VALUES (?,'legacy_import',0,'{}','{}',?)").run(snapshot,timestamp).lastInsertRowid);
    const markets=new Map(),selections=new Map();
    const pending=db.prepare("SELECT * FROM ParlayTickets WHERE status='PENDING' ORDER BY id").all();
    for(const ticket of pending) {
      if(db.prepare('SELECT 1 FROM BettingTickets WHERE RequestKey=? AND UserId=?').get(`legacy_ticket_${ticket.id}`,String(ticket.user_id)))continue;
      const legs=db.prepare(`SELECT l.*,l.rowid AS LegacyLegId,o.market_id,o.name,m.title,m.close_time FROM BetLegs l
        JOIN BettingOptions o ON o.id=l.option_id JOIN Markets m ON m.id=o.market_id WHERE l.ticket_id=? ORDER BY l.option_id`).all(ticket.id);
      const originalCount=db.prepare('SELECT COUNT(*) AS n FROM BetLegs WHERE ticket_id=?').get(ticket.id).n;
      if(!legs.length||legs.length!==originalCount||legs.some(l=>!Number.isSafeInteger(Math.round(Number(l.odds_at_time)*1000000))||Number(l.odds_at_time)<1)
        ||!Number.isSafeInteger(Math.round(Number(ticket.total_amount)*100))||Number(ticket.total_amount)<=0) {
        db.prepare(`INSERT INTO BettingLegacyImportIssues VALUES (?,'legacy_ticket_needs_review',?) ON CONFLICT(LegacyTicketId) DO UPDATE SET UpdatedAtUtc=excluded.UpdatedAtUtc`).run(ticket.id,timestamp);
        continue;
      }
      db.prepare('DELETE FROM BettingLegacyImportIssues WHERE LegacyTicketId=?').run(ticket.id);
      // The old slip allowed related legs. Preserve each original option by
      // giving it an isolated legacy market; no new correlated ticket is offered.
      for(const leg of legs) {
        if(markets.has(leg.LegacyLegId))continue;
        const created=db.prepare(`INSERT INTO BettingMarkets (DefinitionKey,SeasonId,Stage,MarketType,Title,RulesJson,RulesVersion,ForecastId,CloseAtUtc,Status,CreatedAtUtc,UpdatedAtUtc)
          VALUES (?,0,'legacy','legacy',?, ?,1,?,?,'locked',?,?)`).run(`legacy_leg:${leg.LegacyLegId}`,leg.title,
            JSON.stringify({legacyMarketId:leg.market_id,legacyOptionId:leg.option_id}),forecast,leg.close_time||timestamp,timestamp,timestamp);
        const marketId=Number(created.lastInsertRowid);markets.set(leg.LegacyLegId,marketId);
        const selected=db.prepare(`INSERT INTO BettingSelections (MarketId,OutcomeKey,Label,Probability,AnchorMicros,OfferedMicros) VALUES (?,?,?,.5,?,?)`)
          .run(marketId,`legacy_option:${leg.option_id}`,leg.name,Math.round(leg.odds_at_time*1000000),Math.round(leg.odds_at_time*1000000));
        selections.set(leg.LegacyLegId,Number(selected.lastInsertRowid));
      }
      const created=db.prepare(`INSERT INTO BettingTickets (SeasonId,UserId,StakeCents,RequestKey,PlacedAtUtc) VALUES (0,?,?,?,?)`)
        .run(String(ticket.user_id),Math.round(Number(ticket.total_amount)*100),`legacy_ticket_${ticket.id}`,ticket.created_at||timestamp);
      const id=Number(created.lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO BettingWallets VALUES (0,?,0)').run(String(ticket.user_id));
      for(const leg of legs)db.prepare(`INSERT INTO BettingTicketLegs (TicketId,MarketId,SelectionId,OutcomeKey,QuoteVersion,AcceptedMicros,DefinitionJson)
        VALUES (?,?,?,?,1,?,?)`).run(id,markets.get(leg.LegacyLegId),selections.get(leg.LegacyLegId),`legacy_option:${leg.option_id}`,
          Math.round(Number(leg.odds_at_time)*1000000),JSON.stringify({legacyTicketId:ticket.id,legacyMarketId:leg.market_id,legacyOptionId:leg.option_id}));
    }
    db.prepare('INSERT OR IGNORE INTO BettingSchema VALUES (2,?)').run(timestamp);
  })();
}

export function settleLegacy(book,legacyMarketId,winningOptionIds,{voidAll=false,seriesId=null,actorId=null}={}) {
  const db=book.db;return db.transaction(()=>{
    const markets=db.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=0 AND MarketType='legacy'").all()
      .filter(m=>JSON.parse(m.RulesJson).legacyMarketId===legacyMarketId);
    if(!markets.length)throw new Error('Legacy market has no migrated pending tickets');
    for(const market of markets) {
      const optionId=JSON.parse(market.RulesJson).legacyOptionId;
      book.settle(market.MarketId,{[`legacy_option:${optionId}`]:{result:voidAll?'void':winningOptionIds.includes(optionId)?'won':'lost'}},
        {legacyMarketId,seriesId,actorId,manualResolution:true});
    }
    return {resolved:true};
  })();
}
