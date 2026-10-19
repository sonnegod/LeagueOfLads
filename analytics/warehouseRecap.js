// Recorded league facts only; missing sections cannot become zero or a record claim.
export function warehouseRecap(db, runId, matchIds) {
  const ids = JSON.stringify(matchIds);
  const comeback = db.prepare(`SELECT t.TeamName,p.MaximumGoldDeficit AS value,p.MatchId AS matchId
    FROM TeamPerformanceFacts p JOIN TeamFacts t USING(RunId,TeamSubmissionId)
    WHERE p.RunId=? AND p.MatchId IN (SELECT value FROM json_each(?)) AND p.Comeback10k=1
    ORDER BY p.MaximumGoldDeficit DESC,p.MatchId LIMIT 1`).get(runId, ids);
  const support = db.prepare(`SELECT n.PlayerName,p.ObserversKilled+p.SentriesKilled AS value,p.MatchId AS matchId
    FROM PlayerPerformanceFacts p JOIN PlayerFacts n USING(RunId,PlayerId)
    WHERE p.RunId=? AND p.MatchId IN (SELECT value FROM json_each(?))
      AND p.ObserversKilled+p.SentriesKilled>=10
    ORDER BY value DESC,p.MatchId,p.PlayerId LIMIT 1`).get(runId, ids);
  return { comeback: comeback ? { teamName: comeback.TeamName, value: comeback.value, matchId: comeback.matchId } : null,
    support: support ? { playerName: support.PlayerName, value: support.value, matchId: support.matchId } : null };
}
