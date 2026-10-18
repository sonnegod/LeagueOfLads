import { createHash } from 'node:crypto';
import { ANALYTICS_DEFAULTS } from './config.js';
import { emitStageStories } from './stageStories.js';
import { emitWarehouseHighlights } from './warehouseHighlights.js';

const DAY = 86400000;
const stageNames = { regular: 'regular season', tiebreaker: 'tiebreakers', playoff: 'playoffs', unknown: 'league' };
const performanceMetrics = [
  ['GPM', 'farming', 'gold per minute', 700],
  ['XPM', 'experience', 'experience per minute', 850],
  ['HeroDamage', 'damage', 'hero damage', 40000],
  ['TowerDamage', 'siege', 'tower damage', 8000],
  ['Healing', 'healing', 'healing', 10000],
  ['Kills', 'kills', 'kills', 15],
  ['Assists', 'assists', 'assists', 25],
];

export function localDay(value) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ANALYTICS_DEFAULTS.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function localWeek(value) {
  const day = localDay(value);
  const date = new Date(`${day}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * DAY).toISOString().slice(0, 10);
}

const number = value => Number(value.toFixed(1)).toLocaleString('en-US');
const membershipNote = membership => membership === 'stand_in' ? ' Stand-in appearance.'
  : membership === 'unknown' ? ' Roster status unavailable.' : '';

// better-sqlite3 prohibits writes while an iterator is active on that connection.
// Fetch bounded batches, close each query, then generate/write its stories.
function* scan(db, sql, args) {
  const statement = db.prepare(`${sql} LIMIT 64 OFFSET ?`);
  for (let offset = 0; ; offset += 64) {
    const batch = statement.all(...args, offset);
    yield* batch;
    if (batch.length < 64) return;
  }
}

function revision(db, row, at, reason, actorId = null) {
  db.prepare(`INSERT INTO HighlightRevisions
    (HighlightId, Revision, RunId, ChangedAtUtc, Reason, Title, Body, EvidenceJson, Status, Hidden, ActorId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.HighlightId, row.Revision, row.GeneratedRunId,
    at, reason, row.TitleOverride ?? row.Title, row.BodyOverride ?? row.Body, row.EvidenceJson,
    row.Status, row.Hidden, actorId);
}

function makeCandidates(db, runId, now, emit) {
  const at = now.toISOString();
  const firstSeen = db.prepare('SELECT FirstSeenAtUtc FROM HighlightMatchHistory WHERE SeasonId = ? AND MatchId = ?');
  db.prepare(`INSERT OR IGNORE INTO HighlightMatchHistory
    SELECT SeasonId, MatchId, ? FROM MatchFacts WHERE RunId = ?`).run(at, runId);
  const players = db.prepare(`SELECT p.*, n.PlayerName, t.TeamName, t.TeamId, o.TeamName AS OpponentName
    FROM PlayerGameFacts p JOIN PlayerFacts n ON n.RunId = p.RunId AND n.PlayerId = p.PlayerId
    JOIN TeamFacts t ON t.RunId = p.RunId AND t.TeamSubmissionId = p.TeamSubmissionId
    JOIN TeamGameFacts g ON g.RunId = p.RunId AND g.MatchId = p.MatchId AND g.TeamSubmissionId = p.TeamSubmissionId
    JOIN TeamFacts o ON o.RunId = p.RunId AND o.TeamSubmissionId = g.OpponentSubmissionId
    WHERE p.RunId = ? AND p.MatchId = ? ORDER BY p.PlayerId`);

  for (const season of db.prepare('SELECT * FROM SeasonFacts WHERE RunId = ? ORDER BY SeasonId').all(runId)) {
    if (!season.LeagueId) continue;
    const base = (category, period, stage, subject, title, body, evidence, score, occurred, eligible) => ({
      seasonId: season.SeasonId, leagueId: season.LeagueId, leagueName: season.LeagueName,
      category, period, stage, subjectKey: subject, title, body, evidence, score,
      occurredAt: occurred, eligibleAt: eligible,
    });
    // Only current league facts are queried. Private features never enter templates.
    const best = new Map();
    const stageGames = new Map();
    const stageMatchIds = new Map();
    const weeks = new Map();
    const days = new Map();
    for (const match of scan(db, 'SELECT * FROM MatchFacts WHERE RunId = ? AND SeasonId = ? ORDER BY MatchId', [runId, season.SeasonId])) {
      const cohort = players.all(runId, match.MatchId); // At most ten rows, not a warehouse-sized array.
      const eligible = firstSeen.get(season.SeasonId, match.MatchId).FirstSeenAtUtc;
      const gameCount = (stageGames.get(match.Stage) ?? 0) + 1;
      stageGames.set(match.Stage, gameCount);
      if (!stageMatchIds.has(match.Stage)) stageMatchIds.set(match.Stage, []);
      stageMatchIds.get(match.Stage).push(match.MatchId);
      for (const [metric, category, label, threshold] of performanceMetrics) {
        const valid = cohort.filter(p => p[metric] !== null);
        if (!valid.length) continue;
        const maximum = Math.max(...valid.map(p => p[metric]));
        const previous = best.get(`${match.Stage}:${metric}`);
        const isRecord = match.Stage !== 'unknown' && gameCount >= ANALYTICS_DEFAULTS.minimumSamples
          && previous?.complete && valid.length === 10 && maximum > previous.value;
        for (const player of valid.filter(p => p[metric] === maximum)) {
          if (maximum < threshold && !isRecord) continue;
          if (maximum <= 0) continue;
          const title = isRecord ? `A new recorded ${stageNames[match.Stage]} ${category} high` : `${player.PlayerName}: standout ${category}`;
          const timing = match.StartedAtUtc ? ` Played ${localDay(match.StartedAtUtc)} (New York).` : ' Match date is unverified.';
          const body = `${player.PlayerName} recorded ${number(maximum)} ${label} for ${player.TeamName} against ${player.OpponentName}.`
            + (isRecord ? ` Highest among validated games in this season's ${stageNames[match.Stage]} through match ${match.MatchId} (${gameCount} games compared).` : '')
            + membershipNote(player.Membership) + timing;
          emit({ ...base(category, 'daily', match.Stage, `player:${player.PlayerId}`, title, body, {
            matchIds: [match.MatchId], metric, value: maximum, comparisonGames: isRecord ? gameCount : null,
            comparisonMatchIds: isRecord ? [...stageMatchIds.get(match.Stage)] : [],
            comparison: isRecord ? 'season_stage_through_match_id' : 'single_game', membership: player.Membership,
            playerId: player.PlayerId, teamId: player.TeamId, matchTimeKnown: Boolean(match.StartedAtUtc),
            observedAt: match.SourceObservedAtUtc, playerName: player.PlayerName, teamName: player.TeamName,
          }, (isRecord ? 2 : 1) + Math.min(maximum / threshold, 3), match.StartedAtUtc, eligible),
          fingerprint: `performance:${season.SeasonId}:${match.Stage}:${metric}:${match.MatchId}:${player.PlayerId}`,
          playerId: player.PlayerId, teamSubmissionId: player.TeamSubmissionId });
        }
        best.set(`${match.Stage}:${metric}`, { value: Math.max(previous?.value ?? 0, maximum),
          complete: (previous?.complete ?? true) && valid.length === 10 });
      }
      for (const player of cohort) if (player.Won && player.Deaths === 0 && player.Kills !== null
        && player.Assists !== null && player.Kills + player.Assists >= 15) {
        emit({ ...base('survival', 'daily', match.Stage, `player:${player.PlayerId}`,
          `${player.PlayerName} wins without a death`,
          `${player.PlayerName} finished ${player.Kills}/0/${player.Assists} for ${player.TeamName} against ${player.OpponentName}.`
          + membershipNote(player.Membership) + (!match.StartedAtUtc ? ' Match date is unverified.' : ''),
          { matchIds: [match.MatchId], kills: player.Kills, deaths: 0, assists: player.Assists,
            playerId: player.PlayerId, teamId: player.TeamId, membership: player.Membership, comparison: 'single_game' },
          2 + Math.min((player.Kills + player.Assists) / 20, 3), match.StartedAtUtc, eligible),
        fingerprint: `survival:${season.SeasonId}:${match.MatchId}:${player.PlayerId}`,
        playerId: player.PlayerId, teamSubmissionId: player.TeamSubmissionId });
      }

      if (match.StartedAtUtc) {
        for (const [windows, key] of [[weeks, localWeek(match.StartedAtUtc)], [days, localDay(match.StartedAtUtc)]]) {
        if (!windows.has(key)) windows.set(key, { ids: [], teams: new Map(), players: new Map(), unknown: 0, standIns: 0 });
        const summary = windows.get(key);
        summary.ids.push(match.MatchId);
        for (const team of db.prepare(`SELECT g.Won, t.TeamName, t.TeamId FROM TeamGameFacts g
          JOIN TeamFacts t ON t.RunId = g.RunId AND t.TeamSubmissionId = g.TeamSubmissionId
          WHERE g.RunId = ? AND g.MatchId = ?`).all(runId, match.MatchId)) {
          const item = summary.teams.get(team.TeamId) ?? { ...team, wins: 0, games: 0 };
          item.games++; item.wins += team.Won; summary.teams.set(team.TeamId, item);
        }
        for (const p of cohort) {
          summary.unknown += Number(p.Membership === 'unknown'); summary.standIns += Number(p.Membership === 'stand_in');
          const item = summary.players.get(p.PlayerId) ?? { playerName: p.PlayerName, playerId: p.PlayerId,
            kills: 0, killSamples: 0, games: 0, gpm: 0, gpmSamples: 0, xpm: 0, xpmSamples: 0 };
          item.games++;
          if (p.Kills !== null) { item.kills += p.Kills; item.killSamples++; }
          if (p.GPM !== null) { item.gpm += p.GPM; item.gpmSamples++; }
          if (p.XPM !== null) { item.xpm += p.XPM; item.xpmSamples++; }
          summary.players.set(p.PlayerId, item);
        }
        }
      }
    }

    // Full history is recomputed so old published stories can be validated after corrections.
    for (const team of db.prepare('SELECT * FROM TeamFacts WHERE RunId = ? AND SeasonId = ?').all(runId, season.SeasonId)) {
      let stage = null; let streak = [];
      for (const game of scan(db, `SELECT g.Won, m.MatchId, m.Stage, m.StartedAtUtc FROM TeamGameFacts g
        JOIN MatchFacts m ON m.RunId = g.RunId AND m.MatchId = g.MatchId
        WHERE g.RunId = ? AND g.TeamSubmissionId = ? ORDER BY m.MatchId`, [runId, team.TeamSubmissionId])) {
        if (game.Stage !== stage) { streak = []; stage = game.Stage; }
        if (stage === 'unknown') continue;
        const before = streak.length;
        if (game.Won) streak.push(game.MatchId);
        const milestone = game.Won && (streak.length === 3 || streak.length % 5 === 0);
        if (milestone || (!game.Won && before >= 3)) {
          const ids = game.Won ? [...streak] : [...streak, game.MatchId];
          const title = game.Won ? `${team.TeamName} reaches ${streak.length} straight wins` : `${team.TeamName}'s ${before}-game streak ends`;
          emit({ ...base('streak', 'daily', stage, `team:${team.TeamSubmissionId}`, title,
            game.Won ? `${streak.length} consecutive recorded game wins in this season's ${stageNames[stage]}. Only validated matches are included.`
              : `A run of ${before} consecutive recorded game wins in this season's ${stageNames[stage]} ended in match ${game.MatchId}. Only validated matches are included.`,
            { matchIds: ids, teamId: team.TeamId, wins: game.Won ? streak.length : before,
              ended: !game.Won, comparison: 'season_stage_game_streak' }, 3 + Math.min(before / 5, 3),
            game.StartedAtUtc, firstSeen.get(season.SeasonId, game.MatchId).FirstSeenAtUtc),
          fingerprint: `streak:${season.SeasonId}:${stage}:${team.TeamSubmissionId}:${game.MatchId}`,
          teamSubmissionId: team.TeamSubmissionId });
        }
        if (!game.Won) streak = [];
      }
    }

    // Current season/stage trends have stable identities: changes revise the same card.
    for (const scope of db.prepare(`SELECT Stage, COUNT(*) AS Games FROM MatchFacts
      WHERE RunId = ? AND SeasonId = ? AND Stage != 'unknown' GROUP BY Stage`).all(runId, season.SeasonId)) {
      if (scope.Games < ANALYTICS_DEFAULTS.minimumSamples) continue;
      const hero = db.prepare(`SELECT p.HeroId, h.HeroName, COUNT(*) AS Picks, SUM(p.Won) AS Wins
        FROM PlayerGameFacts p JOIN MatchFacts m ON m.RunId = p.RunId AND m.MatchId = p.MatchId
        JOIN HeroFacts h ON h.RunId = p.RunId AND h.HeroId = p.HeroId
        WHERE p.RunId = ? AND m.SeasonId = ? AND m.Stage = ? GROUP BY p.HeroId
        ORDER BY Picks DESC, p.HeroId LIMIT 1`).get(runId, season.SeasonId, scope.Stage);
      const ids = db.prepare('SELECT MatchId FROM MatchFacts WHERE RunId = ? AND SeasonId = ? AND Stage = ? ORDER BY MatchId')
        .all(runId, season.SeasonId, scope.Stage).map(m => m.MatchId);
      if (hero) emit({ ...base('heroes', 'daily', scope.Stage, `hero:${hero.HeroId}`,
        `${hero.HeroName} leads the hero appearances`,
        `${hero.Picks} appearances and ${hero.Wins} wins across ${scope.Games} ${stageNames[scope.Stage]} games in ${season.LeagueName}.`,
        { matchIds: ids, heroId: hero.HeroId, appearances: hero.Picks, wins: hero.Wins,
          comparisonGames: scope.Games, comparison: 'season_stage_hero_appearances' }, 2.5, null, at),
      fingerprint: `hero_trend:${season.SeasonId}:${scope.Stage}` });
    }

    for (const player of db.prepare(`SELECT p.PlayerId, p.TeamSubmissionId, m.Stage, n.PlayerName, t.TeamName, t.TeamId,
      COUNT(*) AS Games, COUNT(DISTINCT p.HeroId) AS Heroes, SUM(p.Membership = 'stand_in') AS StandIns,
      SUM(p.Membership = 'unknown') AS UnknownRoster FROM PlayerGameFacts p
      JOIN MatchFacts m ON m.RunId = p.RunId AND m.MatchId = p.MatchId
      JOIN PlayerFacts n ON n.RunId = p.RunId AND n.PlayerId = p.PlayerId
      JOIN TeamFacts t ON t.RunId = p.RunId AND t.TeamSubmissionId = p.TeamSubmissionId
      WHERE p.RunId = ? AND m.SeasonId = ? AND m.Stage != 'unknown'
      GROUP BY p.PlayerId, p.TeamSubmissionId, m.Stage HAVING Games >= ? AND Heroes >= 4`)
      .all(runId, season.SeasonId, ANALYTICS_DEFAULTS.minimumSamples)) {
      const ids = db.prepare(`SELECT p.MatchId FROM PlayerGameFacts p JOIN MatchFacts m ON m.RunId = p.RunId AND m.MatchId = p.MatchId
        WHERE p.RunId = ? AND p.PlayerId = ? AND p.TeamSubmissionId = ? AND m.Stage = ? ORDER BY p.MatchId`)
        .all(runId, player.PlayerId, player.TeamSubmissionId, player.Stage).map(m => m.MatchId);
      emit({ ...base('variety', 'daily', player.Stage, `player:${player.PlayerId}`,
        `${player.PlayerName}'s hero pool`,
        `${player.Heroes} different heroes in ${player.Games} ${stageNames[player.Stage]} appearances for ${player.TeamName}.`
          + (player.StandIns ? ` Includes ${player.StandIns} stand-in appearances.` : '')
          + (player.UnknownRoster ? ' Some roster statuses are unavailable.' : ''),
        { matchIds: ids, playerId: player.PlayerId, teamId: player.TeamId, games: player.Games, heroes: player.Heroes,
          standInGames: player.StandIns, unknownRosterGames: player.UnknownRoster, comparison: 'season_stage_player_team' },
        2 + player.Heroes / player.Games, null, at),
      fingerprint: `hero_variety:${season.SeasonId}:${player.Stage}:${player.PlayerId}:${player.TeamSubmissionId}`,
      playerId: player.PlayerId, teamSubmissionId: player.TeamSubmissionId });
    }

    const currentWeek = localWeek(at);
    for (const [period, start, summary] of [
      ...[...weeks].map(([start, summary]) => ['weekly', start, summary]),
      ...[...days].map(([start, summary]) => ['daily', start, summary]),
    ]) {
      if (start >= (period === 'weekly' ? currentWeek : localDay(at))) continue;
      const end = new Date(Date.parse(`${start}T12:00:00Z`) + (period === 'weekly' ? 6 : 0) * DAY).toISOString().slice(0, 10);
      const topTeams = [...summary.teams.values()].sort((a, b) => b.wins - a.wins || a.TeamId - b.TeamId);
      const leader = topTeams[0];
      const stats = [...summary.players.values()];
      const topKills = stats.filter(p => p.killSamples === p.games).sort((a, b) => b.kills - a.kills || a.playerId - b.playerId)[0];
      const averageLeader = (metric, samples) => stats.filter(p => p[samples] >= ANALYTICS_DEFAULTS.minimumSamples && p[samples] === p.games)
        .sort((a, b) => b[metric] / b[samples] - a[metric] / a[samples] || a.playerId - b.playerId)[0];
      const gpm = averageLeader('gpm', 'gpmSamples'); const xpm = averageLeader('xpm', 'xpmSamples');
      const unknownTimes = db.prepare(`SELECT COUNT(*) AS n FROM MatchFacts WHERE RunId = ? AND SeasonId = ? AND StartedAtUtc IS NULL`)
        .get(runId, season.SeasonId).n;
      // Missing a required stat means no complete league-wide leader claim.
      const completeKills = stats.every(p => p.killSamples === p.games);
      const completeGpm = stats.every(p => p.gpmSamples === p.games);
      const completeXpm = stats.every(p => p.xpmSamples === p.games);
      const evidence = { matchIds: summary.ids, ...(period === 'weekly' ? { weekStart: start, weekEnd: end } : { day: start }),
        timezone: ANALYTICS_DEFAULTS.timezone,
        games: summary.ids.length, comparison: `dated_league_appearances_in_${period === 'weekly' ? 'week' : 'day'}`, standInAppearances: summary.standIns,
        unknownRosterAppearances: summary.unknown, excludesUndatedMatches: unknownTimes > 0,
        teamLeaders: topTeams.filter(t => t.wins === leader.wins).map(t => ({ teamId: t.TeamId, teamName: t.TeamName, wins: t.wins, games: t.games })),
        topKills: completeKills && topKills ? { playerId: topKills.playerId, value: topKills.kills, games: topKills.games } : null,
        topGpm: completeGpm && gpm ? { playerId: gpm.playerId, value: gpm.gpm / gpm.gpmSamples, samples: gpm.gpmSamples } : null,
        topXpm: completeXpm && xpm ? { playerId: xpm.playerId, value: xpm.xpm / xpm.xpmSamples, samples: xpm.xpmSamples } : null };
      const body = `${summary.ids.length} dated league games. ${evidence.teamLeaders.map(t => t.teamName).join(' and ')} led with ${leader.wins} wins.`
        + (evidence.topKills ? ` ${topKills.playerName}: ${topKills.kills} total kills.` : '')
        + (evidence.topGpm ? ` ${gpm.playerName}: ${number(evidence.topGpm.value)} average GPM (${gpm.gpmSamples} games).` : '')
        + (evidence.topXpm ? ` ${xpm.playerName}: ${number(evidence.topXpm.value)} average XPM (${xpm.xpmSamples} games).` : '')
        + ' Covers all stages and all appearances, including stand-ins.'
        + (summary.unknown ? ' Some roster statuses are unavailable.' : '')
        + (unknownTimes ? ' Matches with unverified dates are excluded.' : '');
      emit({ ...base('recap', period, 'all', `${period}:${start}`,
        period === 'weekly' ? `Weekly recap: ${start} to ${end}` : `Daily recap: ${start}`, body, evidence, 9, null,
        new Date(Date.parse(`${start}T12:00:00Z`) + (period === 'weekly' ? 7 : 1) * DAY).toISOString()),
      fingerprint: `${period}:${season.SeasonId}:${start}` });
    }

    const champion = db.prepare(`SELECT c.TeamSubmissionId, t.TeamId, t.TeamName FROM ChampionFacts c
      JOIN TeamFacts t ON t.RunId = c.RunId AND t.TeamSubmissionId = c.TeamSubmissionId
      WHERE c.RunId = ? AND c.SeasonId = ?`).get(runId, season.SeasonId);
    if (champion) {
      const records = db.prepare('SELECT Stage, GamesPlayed, Wins, Losses FROM TeamSeasonStats WHERE RunId = ? AND TeamSubmissionId = ?')
        .all(runId, champion.TeamSubmissionId);
      const ids = db.prepare('SELECT MatchId FROM TeamGameFacts WHERE RunId = ? AND TeamSubmissionId = ? ORDER BY MatchId')
        .all(runId, champion.TeamSubmissionId).map(m => m.MatchId);
      if (ids.length) emit({ ...base('champion', 'daily', 'all', `team:${champion.TeamSubmissionId}`,
        `${champion.TeamName} are league champions`,
        `Champions of ${season.LeagueName}. ` + records.map(r => `${stageNames[r.Stage]}: ${r.Wins} wins, ${r.Losses} losses`).join('; ') + '.',
        { matchIds: ids, teamId: champion.TeamId, records, comparison: 'official_champion_stage_records' }, 10, null, at),
      fingerprint: `champion:${season.SeasonId}`, teamSubmissionId: champion.TeamSubmissionId });
    }
  }
}

// Called inside the build's publication transaction. Corrections/withdrawals,
// fact publication, and new content publication become visible together.
export function publishLeagueHighlights(db, runId, now = new Date()) {
  const at = now.toISOString();
  const day = localDay(at);
  const scope = db.prepare('SELECT Scope, SelectedSeasonId FROM AnalyticsRuns WHERE RunId = ?').get(runId);
  const existing = db.prepare('SELECT * FROM HighlightEvents WHERE Fingerprint = ?');
  const get = db.prepare('SELECT * FROM HighlightEvents WHERE HighlightId = ?');
  const add = db.prepare(`INSERT INTO HighlightEvents (Fingerprint, SeasonId, LeagueId, LeagueName,
    Category, Period, Stage, SubjectKey, TeamSubmissionId, PlayerId, Title, Body, EvidenceJson,
    Score, OccurredAtUtc, EligibleAtUtc, GeneratedRunId, SourceHash, Status, UpdatedAtUtc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)`);
  const playerName = db.prepare('SELECT PlayerName FROM PlayerFacts WHERE RunId = ? AND PlayerId = ?');
  const teamName = db.prepare('SELECT TeamName FROM TeamFacts WHERE RunId = ? AND TeamSubmissionId = ?');
  const saveCandidate = candidate => {
    if (candidate.playerId) candidate.evidence.playerName ??= playerName.get(runId, candidate.playerId)?.PlayerName;
    if (candidate.teamSubmissionId) candidate.evidence.teamName ??= teamName.get(runId, candidate.teamSubmissionId)?.TeamName;
    const json = JSON.stringify(candidate.evidence);
    const hash = createHash('sha256').update(JSON.stringify([candidate.title, candidate.body, json, candidate.subjectKey, candidate.leagueId,
      candidate.leagueName, candidate.score, candidate.occurredAt])).digest('hex');
    const old = existing.get(candidate.fingerprint);
    if (!old) {
      const id = add.run(candidate.fingerprint, candidate.seasonId, candidate.leagueId, candidate.leagueName,
        candidate.category, candidate.period, candidate.stage, candidate.subjectKey, candidate.teamSubmissionId ?? null,
        candidate.playerId ?? null, candidate.title, candidate.body, json, candidate.score, candidate.occurredAt,
        candidate.eligibleAt, runId, hash, at).lastInsertRowid;
      revision(db, get.get(id), at, 'generated');
    } else if (old.SourceHash !== hash || old.Status === 'withdrawn') {
      db.prepare(`UPDATE HighlightEvents SET Title = ?, Body = ?, EvidenceJson = ?, SourceHash = ?,
        SubjectKey = ?, LeagueName = ?, LeagueId = ?, Score = ?, OccurredAtUtc = ?, GeneratedRunId = ?, Revision = Revision + 1,
        Status = ?, EligibleAtUtc = ?, UpdatedAtUtc = ?,
        OverrideNeedsReview = CASE WHEN TitleOverride IS NOT NULL OR BodyOverride IS NOT NULL THEN 1 ELSE 0 END
        WHERE HighlightId = ?`)
        .run(candidate.title, candidate.body, json, hash, candidate.subjectKey, candidate.leagueName, candidate.leagueId,
          candidate.score, candidate.occurredAt, runId, old.FirstPublishedAtUtc ? 'published' : 'candidate',
          candidate.period === 'weekly' ? candidate.eligibleAt : at, at, old.HighlightId);
      revision(db, get.get(old.HighlightId), at, 'source_correction');
    } else db.prepare('UPDATE HighlightEvents SET GeneratedRunId = ? WHERE HighlightId = ?').run(runId, old.HighlightId);
  };
  makeCandidates(db, runId, now, saveCandidate);
  emitWarehouseHighlights(db, runId, saveCandidate);
  emitStageStories(db, runId, now, saveCandidate);

  // A filtered build may not withdraw another season's still-valid publications.
  const rows = db.prepare(`SELECT * FROM HighlightEvents WHERE GeneratedRunId != ? AND Status != 'withdrawn'
    ${scope.Scope === 'season' ? 'AND SeasonId = ?' : ''}`)
    .all(...(scope.Scope === 'season' ? [runId, scope.SelectedSeasonId] : [runId]));
  for (const row of rows) {
    db.prepare("UPDATE HighlightEvents SET Status = 'withdrawn', UpdatedAtUtc = ?, Revision = Revision + 1 WHERE HighlightId = ?")
      .run(at, row.HighlightId);
    revision(db, get.get(row.HighlightId), at, 'source_withdrawal');
  }
  if (db.prepare('SELECT Paused FROM HighlightSettings WHERE Id = 1').get().Paused) return;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM HighlightEvents WHERE PublishedDayLocal = ? AND Period = 'daily'`).get(day).n;
  let remaining = Math.max(0, ANALYTICS_DEFAULTS.dailyHighlights - count);
  const subjectCounts = new Map(); const categoryCounts = new Map(); const teamCounts = new Map();
  for (const row of db.prepare("SELECT SubjectKey, Category, TeamSubmissionId FROM HighlightEvents WHERE PublishedDayLocal = ? AND Period = 'daily'").all(day)) {
    subjectCounts.set(row.SubjectKey, (subjectCounts.get(row.SubjectKey) ?? 0) + 1);
    categoryCounts.set(row.Category, (categoryCounts.get(row.Category) ?? 0) + 1);
    if (row.TeamSubmissionId) teamCounts.set(row.TeamSubmissionId, (teamCounts.get(row.TeamSubmissionId) ?? 0) + 1);
  }
  const publish = row => {
    db.prepare(`UPDATE HighlightEvents SET Status = 'published', FirstPublishedAtUtc = ?, PublishedDayLocal = ?,
      UpdatedAtUtc = ?, Revision = Revision + 1 WHERE HighlightId = ?`).run(at, day, at, row.HighlightId);
    revision(db, get.get(row.HighlightId), at, 'automatic_publication');
  };
  const cutoff = new Date(now.getTime() - 48 * 3600000).toISOString();
  const yesterday = new Date(Date.parse(`${day}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
  for (const row of db.prepare(`SELECT * FROM HighlightEvents WHERE GeneratedRunId = ? AND Status = 'candidate'
    AND FirstPublishedAtUtc IS NULL AND Hidden = 0 AND Period = 'daily' AND EligibleAtUtc >= ?
    ORDER BY Score DESC, OccurredAtUtc DESC, HighlightId DESC LIMIT 200`).all(runId, cutoff)) {
    if (!remaining) break;
    if (row.Category === 'recap' && JSON.parse(row.EvidenceJson).day !== yesterday) continue;
    if ((subjectCounts.get(row.SubjectKey) ?? 0) >= 1 || (categoryCounts.get(row.Category) ?? 0) >= 2
      || (row.TeamSubmissionId && (teamCounts.get(row.TeamSubmissionId) ?? 0) >= 2)) continue;
    publish(row); remaining--;
    subjectCounts.set(row.SubjectKey, 1); categoryCounts.set(row.Category, (categoryCounts.get(row.Category) ?? 0) + 1);
    if (row.TeamSubmissionId) teamCounts.set(row.TeamSubmissionId, (teamCounts.get(row.TeamSubmissionId) ?? 0) + 1);
  }
  // Only the latest completed local week is newly published; historical backfill
  // recaps remain inspectable candidates instead of flooding the public feed.
  const lastWeek = new Date(Date.parse(`${localWeek(at)}T12:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
  for (const row of db.prepare(`SELECT * FROM HighlightEvents WHERE GeneratedRunId = ? AND Status = 'candidate'
    AND FirstPublishedAtUtc IS NULL AND Hidden = 0 AND Period = 'weekly'
    AND json_extract(EvidenceJson, '$.weekStart') = ?`).all(runId, lastWeek)) {
    if (JSON.parse(row.EvidenceJson).weekStart === lastWeek) publish(row);
  }
}

export function moderateHighlight(db, highlightId, changes, actorId = null, now = new Date()) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM HighlightEvents WHERE HighlightId = ?').get(highlightId);
    if (!row) return null;
    const hidden = changes.hidden === undefined ? row.Hidden : Number(changes.hidden);
    const title = changes.title === undefined ? row.TitleOverride : changes.title;
    const body = changes.body === undefined ? row.BodyOverride : changes.body;
    const reviewed = changes.title !== undefined || changes.body !== undefined;
    if (hidden === row.Hidden && title === row.TitleOverride && body === row.BodyOverride && !(reviewed && row.OverrideNeedsReview)) return row;
    db.prepare(`UPDATE HighlightEvents SET Hidden = ?, TitleOverride = ?, BodyOverride = ?,
      Revision = Revision + 1, UpdatedAtUtc = ?, OverrideNeedsReview = ? WHERE HighlightId = ?`)
      .run(hidden, title, body, now.toISOString(), reviewed ? 0 : row.OverrideNeedsReview, highlightId);
    const updated = db.prepare('SELECT * FROM HighlightEvents WHERE HighlightId = ?').get(highlightId);
    revision(db, updated, now.toISOString(), 'admin_override', actorId);
    return updated;
  })();
}
