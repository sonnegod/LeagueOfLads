// Templates use derived league facts only. Private inputs never enter content.
export function emitWarehouseHighlights(db, runId, emit) {
  const matches = db.prepare(`SELECT m.*,s.LeagueName FROM MatchFacts m JOIN SeasonFacts s USING(RunId,SeasonId)
    WHERE m.RunId=? ORDER BY m.MatchId`);
  const players = db.prepare(`SELECT e.*,g.TeamSubmissionId,g.Membership,g.HeroId,n.PlayerName,t.TeamName,t.TeamId
    FROM PlayerPerformanceFacts e JOIN PlayerGameFacts g USING(RunId,MatchId,PlayerId)
    JOIN PlayerFacts n USING(RunId,PlayerId) JOIN TeamFacts t ON t.RunId=g.RunId AND t.TeamSubmissionId=g.TeamSubmissionId
    WHERE e.RunId=? AND e.MatchId=?`);
  const teams = db.prepare(`SELECT e.*,t.TeamName,t.TeamId FROM TeamPerformanceFacts e JOIN TeamFacts t USING(RunId,TeamSubmissionId)
    WHERE e.RunId=? AND e.MatchId=?`);
  const fights = db.prepare(`SELECT f.*,t.TeamName,t.TeamId FROM TeamfightFacts f JOIN TeamFacts t USING(RunId,TeamSubmissionId)
    WHERE f.RunId=? AND f.MatchId=? AND f.Outcome='win' AND f.Kills>=4 AND f.Deaths<=1
      AND (f.TowersAfter>0 OR f.RoshansAfter>0 OR f.BarracksAfter>0) ORDER BY f.FightIndex`);
  const firstSeen = db.prepare('SELECT FirstSeenAtUtc FROM HighlightMatchHistory WHERE SeasonId=? AND MatchId=?');
  // Fetch a bounded page before emitting: writes cannot happen while this DB has an active iterator.
  const page = db.prepare(`${matches.source} LIMIT 64 OFFSET ?`);
  for (let offset = 0; ; offset += 64) {
    const batch = page.all(runId, offset);
    if (!batch.length) break;
    for (const match of batch) {
      const eligibleAt = firstSeen.get(match.SeasonId, match.MatchId)?.FirstSeenAtUtc;
      if (!eligibleAt) continue;
      const base = { seasonId: match.SeasonId, leagueId: match.LeagueId, leagueName: match.LeagueName,
        stage: match.Stage, period: 'daily', occurredAt: match.StartedAtUtc, eligibleAt };
      for (const p of players.all(runId, match.MatchId)) {
        const dewards = p.ObserversKilled !== null && p.SentriesKilled !== null ? p.ObserversKilled + p.SentriesKilled : null;
        const candidates = [
          ['Dewards', dewards, 10, 'dewarding', 'enemy wards destroyed'],
          ['CampsStacked', p.CampsStacked, 15, 'stacking', 'camps stacked'],
          ['StunSeconds', p.StunSeconds, 120, 'control', 'seconds of stuns'],
        ];
        for (const [metric, value, minimum, label, unit] of candidates) {
          if (value === null || value < minimum) continue;
          const note = p.Membership === 'stand_in' ? ' Stand-in appearance.' : p.Membership === 'unknown' ? ' Roster status unavailable.' : '';
          emit({ ...base, category: 'support', subjectKey: `player:${p.PlayerId}`,
            playerId: p.PlayerId, teamSubmissionId: p.TeamSubmissionId,
            title: `${p.PlayerName}: standout ${label}`,
            body: `${p.PlayerName} recorded ${Number(value.toFixed(1)).toLocaleString('en-US')} ${unit} for ${p.TeamName}.${note}`,
            evidence: { matchIds: [match.MatchId], metric, value, playerId: p.PlayerId, playerName: p.PlayerName,
              teamId: p.TeamId, teamName: p.TeamName, heroId: p.HeroId, membership: p.Membership,
              comparison: 'single_game', observedAt: match.SourceObservedAtUtc }, score: 2 + Math.min(value / minimum, 3),
            fingerprint: `edw:player:${match.SeasonId}:${match.MatchId}:${p.PlayerId}:${metric}` });
        }
      }
      for (const t of teams.all(runId, match.MatchId)) if (t.Comeback10k === 1) {
        emit({ ...base, category: 'comeback', subjectKey: `team:${t.TeamSubmissionId}`, teamSubmissionId: t.TeamSubmissionId,
          title: `${t.TeamName} turn the game around`,
          body: `${t.TeamName} won after facing a recorded ${t.MaximumGoldDeficit.toLocaleString('en-US')}-gold deficit.`,
          evidence: { matchIds: [match.MatchId], metric: 'GoldDeficit', value: t.MaximumGoldDeficit,
            teamId: t.TeamId, teamName: t.TeamName, goldSamples: t.GoldSamples,
            comparison: 'observed_team_timeline', observedAt: match.SourceObservedAtUtc }, score: 7,
          fingerprint: `edw:comeback:${match.SeasonId}:${match.MatchId}:${t.TeamSubmissionId}` });
      }
      for (const f of fights.all(runId, match.MatchId)) {
        const objectives = [[f.TowersAfter, 'tower'], [f.RoshansAfter, 'Roshan'], [f.BarracksAfter, 'barracks']]
          .filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}${count > 1 && label === 'tower' ? 's' : ''}`).join(', ');
        emit({ ...base, category: 'teamfight', subjectKey: `team:${f.TeamSubmissionId}`, teamSubmissionId: f.TeamSubmissionId,
          title: `${f.TeamName} win the fight and take objectives`,
          body: `${f.TeamName} traded ${f.Kills} kills for ${f.Deaths} deaths around ${Math.floor(f.EndSeconds / 60)} minutes. `
            + `${objectives} followed within 90 seconds, before the next recorded fight.`,
          evidence: { matchIds: [match.MatchId], teamId: f.TeamId, teamName: f.TeamName, fightIndex: f.FightIndex,
            kills: f.Kills, deaths: f.Deaths, towersAfter: f.TowersAfter, roshansAfter: f.RoshansAfter,
            barracksAfter: f.BarracksAfter, comparison: 'recorded_fight_followed_by_objective', observedAt: match.SourceObservedAtUtc }, score: 6,
          fingerprint: `edw:fight:${match.SeasonId}:${match.MatchId}:${f.FightIndex}:${f.TeamSubmissionId}` });
      }
    }
  }
}
