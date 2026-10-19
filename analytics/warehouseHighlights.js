// Templates use derived league facts only. Private inputs never enter content.
export function emitWarehouseHighlights(db, runId, emit) {
  const matches = db.prepare(`SELECT m.*,s.LeagueName FROM MatchFacts m JOIN SeasonFacts s USING(RunId,SeasonId)
    WHERE m.RunId=? ORDER BY m.MatchId`);
  const players = db.prepare(`SELECT e.*,g.TeamSubmissionId,g.Membership,g.HeroId,g.Kills,g.Assists,g.HeroDamage,g.Healing,n.PlayerName,t.TeamName,t.TeamId,h.HeroName
    FROM PlayerPerformanceFacts e JOIN PlayerGameFacts g USING(RunId,MatchId,PlayerId)
    JOIN PlayerFacts n USING(RunId,PlayerId) JOIN TeamFacts t ON t.RunId=g.RunId AND t.TeamSubmissionId=g.TeamSubmissionId
    LEFT JOIN HeroFacts h ON h.RunId=g.RunId AND h.HeroId=g.HeroId
    WHERE e.RunId=? AND e.MatchId=?`);
  const teams = db.prepare(`SELECT e.*,t.TeamName,t.TeamId FROM TeamPerformanceFacts e JOIN TeamFacts t USING(RunId,TeamSubmissionId)
    WHERE e.RunId=? AND e.MatchId=?`);
  const fights = db.prepare(`SELECT f.*,t.TeamName,t.TeamId FROM TeamfightFacts f JOIN TeamFacts t USING(RunId,TeamSubmissionId)
    WHERE f.RunId=? AND f.MatchId=? AND f.Outcome='win' AND f.Kills>=4 AND f.Deaths<=1
      AND (f.TowersAfter>0 OR f.RoshansAfter>0 OR f.BarracksAfter>0 OR (f.Kills>=5 AND f.Deaths=0)) ORDER BY f.FightIndex`);
  const checkpoints = db.prepare(`SELECT Minute,LastHits,GoldEarned FROM PlayerEconomyCheckpoints
    WHERE RunId=? AND MatchId=? AND PlayerId=? AND Minute IN (10,20)`);
  const items = db.prepare(`SELECT ItemKey,FirstPurchaseSeconds FROM PlayerItemTimings
    WHERE RunId=? AND MatchId=? AND PlayerId=? AND FirstPurchaseSeconds>0 ORDER BY FirstPurchaseSeconds,ItemKey`);
  const itemTargets = { blink: ['Blink Dagger', 720], black_king_bar: ['Black King Bar', 1080],
    bfury: ['Battle Fury', 840], radiance: ['Radiance', 960], ultimate_scepter: ["Aghanim's Scepter", 900] };
  const firstSeen = db.prepare('SELECT FirstSeenAtUtc FROM HighlightMatchHistory WHERE SeasonId=? AND MatchId=?');
  const teamKills = db.prepare(`SELECT COUNT(Kills) samples,SUM(Kills) kills FROM PlayerGameFacts
    WHERE RunId=? AND MatchId=? AND TeamSubmissionId=?`);
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
        // Shares already require a complete five-player denominator in warehouseFeatures.
        if (p.HeroDamage >= 30000) candidates.push(['DamageShare', p.DamageShare, 45, 'damage contribution', '% of team hero damage']);
        if (p.Healing >= 10000) candidates.push(['HealingShare', p.HealingShare, 60, 'healing contribution', '% of team healing']);
        const kills = teamKills.get(runId, match.MatchId, p.TeamSubmissionId);
        if (kills.samples === 5 && kills.kills >= 20) candidates.push(['KillParticipation', p.KillParticipation, 90, 'fight involvement', '% kill participation']);
        for (const [metric, value, minimum, label, unit] of candidates) {
          if (value === null || value < minimum) continue;
          const note = p.Membership === 'stand_in' ? ' Stand-in appearance.' : p.Membership === 'unknown' ? ' Roster status unavailable.' : '';
          emit({ ...base, category: metric.endsWith('Share') || metric === 'KillParticipation' ? 'contribution' : 'support', subjectKey: `player:${p.PlayerId}`,
            playerId: p.PlayerId, teamSubmissionId: p.TeamSubmissionId,
            title: `${p.PlayerName}: standout ${label}`,
            body: `${p.PlayerName} recorded ${Number(value.toFixed(1)).toLocaleString('en-US')} ${unit} for ${p.TeamName}.${note}`,
            evidence: { matchIds: [match.MatchId], metric, value, playerId: p.PlayerId, playerName: p.PlayerName,
              teamId: p.TeamId, teamName: p.TeamName, heroId: p.HeroId, heroName: p.HeroName, membership: p.Membership,
              comparison: 'single_game', observedAt: match.SourceObservedAtUtc }, score: 2 + Math.min(value / minimum, 3),
            fingerprint: `edw:player:${match.SeasonId}:${match.MatchId}:${p.PlayerId}:${metric}` });
        }
        const note = p.Membership === 'stand_in' ? ' Stand-in appearance.' : p.Membership === 'unknown' ? ' Roster status unavailable.' : '';
        const evidence = { matchIds: [match.MatchId], playerId: p.PlayerId, playerName: p.PlayerName,
          teamId: p.TeamId, teamName: p.TeamName, heroId: p.HeroId, heroName: p.HeroName, membership: p.Membership,
          comparison: 'single_game', observedAt: match.SourceObservedAtUtc };
        for (const c of checkpoints.all(runId, match.MatchId, p.PlayerId)) {
          const minimum = c.Minute === 10 ? 80 : 180;
          if (c.LastHits === null || c.LastHits < minimum) continue;
          emit({ ...base, category: 'farming', subjectKey: `player:${p.PlayerId}`, playerId: p.PlayerId,
            teamSubmissionId: p.TeamSubmissionId, title: `${p.PlayerName}: a flying farming start`,
            body: `${p.PlayerName} reached ${c.LastHits} last hits at ${c.Minute} minutes for ${p.TeamName}.`
              + (c.GoldEarned === null ? '' : ` ${c.GoldEarned.toLocaleString('en-US')} cumulative gold earned at that checkpoint.`) + note,
            evidence: { ...evidence, metric: 'LastHitsAtCheckpoint', value: c.LastHits, minute: c.Minute, goldEarned: c.GoldEarned },
            score: 2 + Math.min(c.LastHits / minimum, 3),
            fingerprint: `edw:farming:${match.SeasonId}:${match.MatchId}:${p.PlayerId}:${c.Minute}` });
        }
        for (const item of items.all(runId, match.MatchId, p.PlayerId)) {
          const target = Object.hasOwn(itemTargets, item.ItemKey) ? itemTargets[item.ItemKey] : null;
          if (!target || item.FirstPurchaseSeconds > target[1]) continue;
          const clock = `${Math.floor(item.FirstPurchaseSeconds / 60)}:${String(item.FirstPurchaseSeconds % 60).padStart(2, '0')}`;
          emit({ ...base, category: 'items', subjectKey: `player:${p.PlayerId}`, playerId: p.PlayerId,
            teamSubmissionId: p.TeamSubmissionId, title: `${p.PlayerName}: an early ${target[0]}`,
            body: `${target[0]} first appears in ${p.PlayerName}'s recorded purchases at ${clock} for ${p.TeamName}.${note}`,
            evidence: { ...evidence, itemName: target[0], purchaseSeconds: item.FirstPurchaseSeconds,
              comparison: 'first_recorded_purchase' }, score: 3 + (1 - item.FirstPurchaseSeconds / target[1]),
            fingerprint: `edw:item:${match.SeasonId}:${match.MatchId}:${p.PlayerId}:${item.ItemKey}` });
        }
      }
      for (const t of teams.all(runId, match.MatchId)) {
        if (t.ObjectivesAvailable === 1 && t.Roshans >= 3) emit({ ...base, category: 'objectives',
          subjectKey: `team:${t.TeamSubmissionId}`, teamSubmissionId: t.TeamSubmissionId,
          title: `${t.TeamName} control the Roshan pit`, body: `${t.TeamName} secured ${t.Roshans} recorded Roshan kills.`,
          evidence: { matchIds: [match.MatchId], teamId: t.TeamId, teamName: t.TeamName, metric: 'Roshans', value: t.Roshans,
            comparison: 'recorded_objectives' }, score: 5,
          fingerprint: `edw:roshan:${match.SeasonId}:${match.MatchId}:${t.TeamSubmissionId}` });
        if (t.Comeback10k !== 1) continue;
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
          title: objectives ? `${f.TeamName} win the fight and take objectives` : `${f.TeamName} sweep the fight`,
          body: `${f.TeamName} traded ${f.Kills} kills for ${f.Deaths} deaths around ${Math.floor(f.EndSeconds / 60)} minutes. `
            + (objectives ? `${objectives} followed within 90 seconds, before the next recorded fight.`
              : f.TowersAfter === 0 && f.RoshansAfter === 0 && f.BarracksAfter === 0
                ? 'No tower, barracks or Roshan was recorded in the follow-up window.' : 'Objective follow-up is unavailable.'),
          evidence: { matchIds: [match.MatchId], teamId: f.TeamId, teamName: f.TeamName, fightIndex: f.FightIndex,
            kills: f.Kills, deaths: f.Deaths, towersAfter: f.TowersAfter, roshansAfter: f.RoshansAfter,
            barracksAfter: f.BarracksAfter, comparison: objectives ? 'recorded_fight_followed_by_objective' : 'recorded_fight', observedAt: match.SourceObservedAtUtc }, score: 6,
          fingerprint: `edw:fight:${match.SeasonId}:${match.MatchId}:${f.FightIndex}:${f.TeamSubmissionId}` });
      }
    }
  }
}
