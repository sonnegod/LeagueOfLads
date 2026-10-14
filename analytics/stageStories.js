import { verifiedSeriesOutcome } from './seriesStories.js';

const stages = { regular: 'group stage', tiebreaker: 'tiebreakers', playoff: 'playoffs' };
const hasTable = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));

export function seasonWatch(db, runId, leagueId = null, respectModeration = true) {
  const seasons = db.prepare(`SELECT * FROM SeasonFacts WHERE RunId = ? AND (? IS NULL OR LeagueId = ?)
    ORDER BY CASE WHEN Status = 'active' THEN 0 ELSE 1 END, SeasonId DESC`).all(runId, leagueId, leagueId);
  const season = seasons[0];
  if (!season) return null;
  const latest = db.prepare("SELECT Stage FROM MatchFacts WHERE RunId = ? AND SeasonId = ? AND Stage != 'unknown' ORDER BY MatchId DESC LIMIT 1")
    .get(runId, season.SeasonId);
  const stage = season.Status === 'ended' ? latest?.Stage ?? 'regular'
    : season.TiebreakerEndMatchId ? 'playoff' : season.GroupEndMatchId ? 'tiebreaker' : latest?.Stage ?? 'regular';
  const forms = [];
  const hasHighlights = hasTable(db, 'HighlightEvents'); const hasGroups = hasTable(db, 'GroupFacts');
  for (const team of db.prepare('SELECT * FROM TeamFacts WHERE RunId = ? AND SeasonId = ?').all(runId, season.SeasonId)) {
    const recent = db.prepare(`SELECT g.Won, m.MatchId, m.StartedAtUtc FROM TeamGameFacts g JOIN MatchFacts m
      ON m.RunId = g.RunId AND m.MatchId = g.MatchId WHERE g.RunId = ? AND g.TeamSubmissionId = ?
      AND m.Stage = ? ORDER BY m.MatchId DESC LIMIT 5`).all(runId, team.TeamSubmissionId, stage);
    if (recent.length < 3) continue;
    const wins = recent.reduce((sum, g) => sum + g.Won, 0);
    const streak = recent.findIndex(g => !g.Won);
    const consecutive = streak === -1 ? recent.length : streak;
    if (consecutive < 3 && !(recent.length === 5 && wins >= 4)) continue;
    const fingerprint = `hot_run:${season.SeasonId}:${stage}:${team.TeamSubmissionId}`;
    const moderation = hasHighlights ? db.prepare('SELECT Hidden, OverrideNeedsReview FROM HighlightEvents WHERE Fingerprint = ?').get(fingerprint) : null;
    if (respectModeration && (moderation?.Hidden || moderation?.OverrideNeedsReview)) continue;
    const group = hasGroups && team.GroupId ? db.prepare('SELECT GroupName FROM GroupFacts WHERE RunId = ? AND SeasonId = ? AND GroupId = ?')
      .get(runId, season.SeasonId, team.GroupId) : null;
    const records = db.prepare(`SELECT m.Stage, COUNT(*) AS games, SUM(g.Won) AS wins FROM TeamGameFacts g
      JOIN MatchFacts m ON m.RunId = g.RunId AND m.MatchId = g.MatchId
      WHERE g.RunId = ? AND g.TeamSubmissionId = ? AND m.SeasonId = ? GROUP BY m.Stage`)
      .all(runId, team.TeamSubmissionId, season.SeasonId);
    const record = rows => ({ wins: rows.reduce((sum, r) => sum + r.wins, 0),
      losses: rows.reduce((sum, r) => sum + r.games - r.wins, 0) });
    let latestSeries = null;
    if (hasTable(db, 'SeriesFacts')) {
      const series = db.prepare(`SELECT s.* FROM TeamGameFacts g JOIN MatchFacts m
        ON m.RunId = g.RunId AND m.MatchId = g.MatchId JOIN SeriesFacts s
        ON s.RunId = m.RunId AND s.SeriesId = m.SeriesId AND s.SeasonId = m.SeasonId
        WHERE g.RunId = ? AND g.TeamSubmissionId = ? AND m.Stage = ? ORDER BY m.MatchId DESC LIMIT 1`)
        .get(runId, team.TeamSubmissionId, stage);
      if (series && [series.Team1Id, series.Team2Id].includes(team.TeamId)) {
        const opponentId = series.Team1Id === team.TeamId ? series.Team2Id : series.Team1Id;
        const opponent = db.prepare('SELECT TeamName FROM TeamFacts WHERE RunId = ? AND SeasonId = ? AND TeamId = ?')
          .get(runId, season.SeasonId, opponentId);
        const games = db.prepare(`SELECT m.*, g.TeamId, o.TeamId AS OpponentId FROM MatchFacts m
          JOIN TeamGameFacts g ON g.RunId = m.RunId AND g.MatchId = m.MatchId AND g.TeamSubmissionId = ?
          JOIN TeamGameFacts o ON o.RunId = g.RunId AND o.MatchId = g.MatchId AND o.TeamSubmissionId = g.OpponentSubmissionId
          WHERE m.RunId = ? AND m.SeriesId = ? AND m.SeasonId = ?`)
          .all(team.TeamSubmissionId, runId, series.SeriesId, season.SeasonId);
        // Display recorded scores even without historical kickoff times, but never
        // call a partial import or a mismatched pairing a completed series.
        if (opponent && games.length > 0 && games.length === series.SourceMatchCount
          && games.every(g => g.TeamId === team.TeamId && g.OpponentId === opponentId
            && g.Stage === stage && [team.TeamId, opponentId].includes(g.WinnerTeamId))) {
          const won = games.filter(g => g.WinnerTeamId === team.TeamId).length;
          latestSeries = { seriesId: series.SeriesId, opponentId, opponentName: opponent.TeamName,
            wins: won, losses: games.length - won, bestOf: series.BestOf,
            verifiedComplete: Boolean(verifiedSeriesOutcome(series, games)) };
        }
      }
    }
    forms.push({ teamId: team.TeamId, teamName: team.TeamName, teamSubmissionId: team.TeamSubmissionId,
      groupName: stage === 'regular' ? group?.GroupName ?? (team.GroupId ? `Group ${team.GroupId}` : null) : null,
      games: recent.length, wins, streak: consecutive, matchIds: recent.map(g => g.MatchId), lastPlayedAt: recent[0].StartedAtUtc,
      form: [...recent].reverse().map(g => g.Won ? 'W' : 'L'),
      seasonRecord: record(records), stageRecord: record(records.filter(r => r.Stage === stage)), latestSeries,
      fingerprint });
  }
  forms.sort((a, b) => b.wins / b.games - a.wins / a.games || b.streak - a.streak || a.teamSubmissionId - b.teamSubmissionId);
  return { seasonId: season.SeasonId, leagueId: season.LeagueId, leagueName: season.LeagueName,
    phase: season.Status === 'ended' ? 'ended' : stage, stage, forms: forms.slice(0, 3) };
}

export function emitStageStories(db, runId, now, emit) {
  const firstSeen = db.prepare('SELECT FirstSeenAtUtc FROM HighlightMatchHistory WHERE SeasonId = ? AND MatchId = ?');
  for (const season of db.prepare('SELECT * FROM SeasonFacts WHERE RunId = ?').all(runId)) {
    if (!season.LeagueId) continue;
    const make = (category, stage, subjectKey, title, body, evidence, score, occurredAt, eligibleAt) => ({
      seasonId: season.SeasonId, leagueId: season.LeagueId, leagueName: season.LeagueName,
      category, period: 'daily', stage, subjectKey, title, body, evidence, score, occurredAt, eligibleAt,
    });
    const watch = seasonWatch(db, runId, season.LeagueId, false);
    if (watch?.seasonId === season.SeasonId) for (const form of watch.forms) {
      const where = form.groupName || stages[watch.stage];
      emit({ ...make('hot_run', watch.stage, `team:${form.teamSubmissionId}`,
        `${form.teamName} ${season.Status === 'ended' ? 'finished strong' : 'are on a tear'}`,
        `${form.wins} wins in their last ${form.games} recorded ${stages[watch.stage]} games${form.groupName ? ` in ${form.groupName}` : ''}.`
          + (form.streak >= 3 ? ` Their latest ${form.streak} games were all wins.` : ''),
        { matchIds: form.matchIds, teamId: form.teamId, teamName: form.teamName, groupName: form.groupName,
          wins: form.wins, games: form.games, streak: form.streak, comparison: 'last_five_recorded_stage_games', context: where },
        7 + form.wins / form.games, form.lastPlayedAt,
        firstSeen.get(season.SeasonId, form.matchIds[0])?.FirstSeenAtUtc ?? now.toISOString()),
      fingerprint: form.fingerprint, teamSubmissionId: form.teamSubmissionId });
    }
    for (const stage of ['tiebreaker', 'playoff']) {
      const first = db.prepare(`SELECT m.*, w.TeamId, t.TeamName, o.TeamName AS OpponentName FROM MatchFacts m
        JOIN TeamGameFacts w ON w.RunId = m.RunId AND w.MatchId = m.MatchId AND w.Won = 1
        JOIN TeamFacts t ON t.RunId = w.RunId AND t.TeamSubmissionId = w.TeamSubmissionId
        JOIN TeamFacts o ON o.RunId = w.RunId AND o.TeamSubmissionId = w.OpponentSubmissionId
        WHERE m.RunId = ? AND m.SeasonId = ? AND m.Stage = ? ORDER BY m.MatchId LIMIT 1`).get(runId, season.SeasonId, stage);
      if (!first) continue;
      emit({ ...make('stage_opening', stage, `stage:${season.SeasonId}:${stage}`,
        `${stage === 'playoff' ? 'Playoffs' : 'Tiebreakers'} opened with ${first.TeamName} vs ${first.OpponentName}`,
        `${first.TeamName} won the opening recorded ${stage === 'playoff' ? 'playoff' : 'tiebreaker'} game against ${first.OpponentName}.`,
        { matchIds: [first.MatchId], comparison: 'first_recorded_stage_game' }, 8, first.StartedAtUtc,
        firstSeen.get(season.SeasonId, first.MatchId)?.FirstSeenAtUtc ?? now.toISOString()),
      fingerprint: `stage_opening:${season.SeasonId}:${stage}` });
    }
    if (!hasTable(db, 'SeriesFacts')) continue;
    for (const series of db.prepare('SELECT * FROM SeriesFacts WHERE RunId = ? AND SeasonId = ?').all(runId, season.SeasonId)) {
      const games = db.prepare('SELECT MatchId, Stage, StartedAtUtc, DurationSeconds, WinnerTeamId FROM MatchFacts WHERE RunId = ? AND SeriesId = ?')
        .all(runId, series.SeriesId);
      const outcome = verifiedSeriesOutcome(series, games);
      if (!outcome?.reverseSweep) continue;
      const winner = db.prepare('SELECT * FROM TeamFacts WHERE RunId = ? AND SeasonId = ? AND TeamId = ?').get(runId, season.SeasonId, outcome.winnerId);
      const loser = db.prepare('SELECT * FROM TeamFacts WHERE RunId = ? AND SeasonId = ? AND TeamId = ?').get(runId, season.SeasonId, outcome.loserId);
      if (!winner || !loser) continue;
      const final = outcome.games.at(-1);
      emit({ ...make('reverse_sweep', 'playoff', `team:${winner.TeamSubmissionId}`,
        `${winner.TeamName} pull off a reverse sweep`,
        `Down ${outcome.loserScore}-0, ${winner.TeamName} won ${outcome.winnerScore} straight games to beat ${loser.TeamName} ${outcome.winnerScore}-${outcome.loserScore}`
          + `${series.RoundLabel ? ` in ${series.RoundLabel.toLowerCase()}` : ' in the playoffs'}.`,
        { matchIds: outcome.games.map(g => g.MatchId), seriesId: series.SeriesId, bestOf: series.BestOf,
          teamId: winner.TeamId, teamName: winner.TeamName, opponentName: loser.TeamName,
          winnerScore: outcome.winnerScore, loserScore: outcome.loserScore, orderSource: 'verified_start_times', comparison: 'complete_playoff_series' },
        12, final.StartedAtUtc, firstSeen.get(season.SeasonId, final.MatchId)?.FirstSeenAtUtc ?? now.toISOString()),
      fingerprint: `reverse_sweep:${season.SeasonId}:${series.SeriesId}`, teamSubmissionId: winner.TeamSubmissionId });
    }
  }
}
