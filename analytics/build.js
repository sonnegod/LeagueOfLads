import { randomUUID } from 'node:crypto';
import { ANALYTICS_DEFAULTS, ANALYTICS_VERSION, positiveId } from './config.js';
import { METRICS } from './store.js';
import { publishLeagueHighlights } from './highlights.js';
import { bracketSeriesFormats } from './seriesStories.js';
import { createWarehouseFeatures, warehouseMatchTime, summarizeWarehouseFeatures, WAREHOUSE_FACT_TABLES } from './warehouseFeatures.js';
import { applySignupSlotOverrides, pendingSlotOverrides } from '../config/pendingRosterSlots.js';

function hasTable(db, name) {
  return Boolean(db?.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function utc(value) {
  // Date-only and host-local timestamps are not exact instants.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function snapshot(db, source, at) {
  if (!hasTable(db, 'SourceLoadRuns')) return [source, at, null, null, db ? 'untracked' : 'unavailable', 1];
  const latest = db.prepare(`SELECT SourceRunId, Status FROM SourceLoadRuns
    WHERE SourceName = ? AND StartedAtUtc <= ? ORDER BY SourceRunId DESC LIMIT 1`).get(source, at);
  const success = db.prepare(`SELECT FinishedAtUtc FROM SourceLoadRuns WHERE SourceName = ?
    AND Status = 'complete' AND FinishedAtUtc <= ? ORDER BY FinishedAtUtc DESC LIMIT 1`).get(source, at);
  const last = utc(success?.FinishedAtUtc);
  return [source, at, last, latest?.SourceRunId ?? null, latest?.Status ?? 'untracked',
    !last || Date.parse(at) - Date.parse(last) >= ANALYTICS_DEFAULTS.sourceStaleHours * 3600000 ? 1 : 0];
}

function matchStage(matchId, boundary, linkedStage) {
  const groupEnd = boundary?.GroupEndMatchId;
  const tieEnd = boundary?.TieBreakerEndMatchId;
  if (groupEnd > 0) {
    if (matchId <= groupEnd) return 'regular';
    if (tieEnd >= groupEnd) return matchId <= tieEnd ? 'tiebreaker' : 'playoff';
    // Tiebreakers may still be ongoing; do not assume every post-group game is a playoff.
    return linkedStage === 't' ? 'tiebreaker' : linkedStage === 'p' ? 'playoff' : 'unknown';
  }
  return ({ g: 'regular', t: 'tiebreaker', p: 'playoff' })[linkedStage] ?? 'unknown';
}

function membershipFor(roster, playerId, startedAt) {
  if (roster?.conflicts.has(playerId)) return 'unknown';
  if(roster?.intervals?.length) {
    if(!startedAt)return 'unknown';
    if(roster.from&&!roster.estimated&&(startedAt<roster.from||roster.to&&startedAt>=roster.to))return 'unknown';
    const declared=roster.intervals.filter(r=>r.EffectiveFromUtc<=startedAt&&(!r.EffectiveToUtc||startedAt<r.EffectiveToUtc));
    if(!declared.length||declared.some(r=>r.FromEstimated))return 'unknown';
    const active=roster.peers.filter(r=>r.PlayerId===playerId&&r.EffectiveFromUtc<=startedAt&&(!r.EffectiveToUtc||startedAt<r.EffectiveToUtc));
    if(new Set(active.map(r=>r.TeamSubmissionId)).size>1||active.some(r=>r.FromEstimated))return 'unknown';
    const known=roster.intervals.some(r=>r.PlayerId===playerId&&r.EffectiveFromUtc<=startedAt&&(!r.EffectiveToUtc||startedAt<r.EffectiveToUtc));
    return known?'rostered':'stand_in';
  }
  if (!roster?.finalized || !startedAt || !roster.from || roster.estimated) return 'unknown';
  if (startedAt < roster.from || (roster.to && startedAt >= roster.to)) return 'unknown';
  return roster.players.has(playerId) ? 'rostered' : 'stand_in';
}

function summarize(db, runId) {
  db.prepare(`INSERT INTO TeamSeasonStats
    SELECT ?, m.SeasonId, t.TeamSubmissionId, m.Stage, COUNT(*), SUM(t.Won), COUNT(*) - SUM(t.Won)
    FROM TeamGameFacts t JOIN MatchFacts m ON m.RunId = t.RunId AND m.MatchId = t.MatchId
    WHERE t.RunId = ? GROUP BY m.SeasonId, t.TeamSubmissionId, m.Stage`).run(runId, runId);
  db.prepare(`INSERT INTO PlayerTeamSeasonStats
    SELECT ?, m.SeasonId, p.TeamSubmissionId, p.PlayerId, m.Stage, p.Membership,
      COUNT(*), SUM(p.Won), t.GamesPlayed,
      CASE WHEN m.Stage = 'regular' AND p.Membership = 'rostered' AND COUNT(*) >= ?
        AND COUNT(*) * 2 > t.GamesPlayed THEN 1 ELSE 0 END
    FROM PlayerGameFacts p JOIN MatchFacts m ON m.RunId = p.RunId AND m.MatchId = p.MatchId
    JOIN TeamSeasonStats t ON t.RunId = p.RunId AND t.SeasonId = m.SeasonId
      AND t.TeamSubmissionId = p.TeamSubmissionId AND t.Stage = m.Stage
    WHERE p.RunId = ? GROUP BY m.SeasonId, p.TeamSubmissionId, p.PlayerId, m.Stage, p.Membership`)
    .run(runId, ANALYTICS_DEFAULTS.minimumRosterGames, runId);
  for (const [metric] of METRICS) {
    // Column identifiers come only from the internal metric catalog, never request input.
    db.prepare(`INSERT INTO PlayerMetricStats
      WITH games AS (
        SELECT m.SeasonId, m.Stage, p.TeamSubmissionId, p.PlayerId, p.Membership, p.${metric} AS Value,
          ROW_NUMBER() OVER (PARTITION BY m.SeasonId, m.Stage, p.TeamSubmissionId, p.PlayerId, p.Membership
            ORDER BY m.StartedAtUtc DESC,m.MatchId DESC) AS RecentRank
        FROM PlayerGameFacts p JOIN MatchFacts m ON m.RunId = p.RunId AND m.MatchId = p.MatchId
        WHERE p.RunId = ?
      ) SELECT ?, SeasonId, TeamSubmissionId, PlayerId, Stage, Membership, ?, COUNT(Value),
        SUM(Value), AVG(Value), MIN(Value), MAX(Value),
        MAX(0, AVG(Value * Value) - AVG(Value) * AVG(Value)),
        COUNT(CASE WHEN RecentRank <= ? THEN Value END),
        AVG(CASE WHEN RecentRank <= ? THEN Value END)
      FROM games GROUP BY SeasonId, TeamSubmissionId, PlayerId, Stage, Membership`)
      .run(runId, runId, metric, ANALYTICS_DEFAULTS.recentGames, ANALYTICS_DEFAULTS.recentGames);
  }
}

function previewSeason(league, leagueId) {
  if (!hasTable(league, 'LeagueInfo')) throw new Error('League catalog is missing');
  const hasActive = league.pragma('table_info(LeagueInfo)').some(column => column.name === 'Active');
  const row = league.prepare(`SELECT LeagueId, LeagueName, ${hasActive ? 'Active' : '0 AS Active'} FROM LeagueInfo WHERE LeagueId = ?`).get(leagueId);
  if (!row) throw new Error('Preview league was not found');
  return { SeasonId: -leagueId, ExternalLeagueId: leagueId, LeagueName: row.LeagueName, Status: row.Active ? 'active' : 'ended', Preview: true };
}

function previewTeams(league, leagueId) {
  // Older leagues may have only a few rows copied into the newer roster table.
  // Preserve their complete legacy alignment and apply any explicit overrides.
  const teams = new Map();
  if (hasTable(league, 'LeagueGroups')) for (const row of league.prepare(
    'SELECT TeamId, GroupId FROM LeagueGroups WHERE LeagueId = ? AND TeamId > 0').all(leagueId)) teams.set(row.TeamId, row);
  if (hasTable(league, 'LeagueRosterEntries')) for (const row of league.prepare(`SELECT TeamId, GroupId, DisplayName AS TeamName
    FROM LeagueRosterEntries WHERE LeagueId = ? AND TeamId > 0`).all(leagueId)) teams.set(row.TeamId, row);
  const rows = [...teams.values()];
  if (!rows.length) throw new Error('Preview league has no team/group alignment');
  return rows.map(row => ({ TeamSubmissionId: -row.TeamId, ExternalTeamId: row.TeamId,
    GroupId: row.GroupId, IsManual: 0, ManualAverageMMR: null,
    TeamName: row.TeamName || (hasTable(league, 'TeamInfo')
      ? league.prepare('SELECT TeamName FROM TeamInfo WHERE TeamId = ?').get(row.TeamId)?.TeamName : null) || `Team ${row.TeamId}` }));
}

// All reads below occur in source read transactions, independent per database.
// All generation writes and the publication switch occur in one Analytics transaction.
export function buildAnalytics({ analytics, league, publicDb = null, firstSeasonId = null,
  seasonId = null, previewLeagueId = null,
  now = new Date(), beforePublish = null }) {
  const started = performance.now();
  const at = now.toISOString();
  firstSeasonId = positiveId(firstSeasonId, 'first signup season');
  seasonId = positiveId(seasonId, 'season');
  previewLeagueId = positiveId(previewLeagueId, 'preview league');
  if (previewLeagueId && (seasonId || firstSeasonId)) throw new Error('Preview league cannot be combined with signup season filters');
  const scope = previewLeagueId ? 'legacy_preview' : seasonId ? 'season' : 'signup_era';
  const owner = randomUUID();
  const lease = new Date(now.getTime() + 30 * 60000).toISOString();
  const runId = analytics.transaction(() => {
    const lock = analytics.prepare(`INSERT INTO AnalyticsBuildLock VALUES (1, ?, ?)
      ON CONFLICT(Id) DO UPDATE SET Owner = excluded.Owner, LeaseUntilUtc = excluded.LeaseUntilUtc
      WHERE AnalyticsBuildLock.LeaseUntilUtc <= ?`).run(owner, lease, at);
    if (!lock.changes) {
      const error = new Error('Analytics build already running'); error.code = 'ANALYTICS_BUILD_BUSY'; throw error;
    }
    analytics.prepare(`UPDATE AnalyticsRuns SET Status = 'failed', FailureCode = 'interrupted', FinishedAtUtc = ?
      WHERE Status = 'running'`).run(at);
    return Number(analytics.prepare(`INSERT INTO AnalyticsRuns
      (StartedAtUtc, AsOfUtc, Version, FirstSeasonId, Status, Scope, SelectedSeasonId, PreviewLeagueId)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`)
      .run(at, at, ANALYTICS_VERSION, firstSeasonId, scope, seasonId, previewLeagueId).lastInsertRowid);
  })();

  try {
    league.exec('BEGIN');
    if (publicDb) publicDb.exec('BEGIN');
    analytics.transaction(() => {
      for (const table of [...(previewLeagueId ? [] : ['LeagueSeasons', 'SeasonTeams', 'SeasonTeamPlayers']),
        'PlayerInfo', 'MatchLeague', 'MatchTeam', 'MatchPlayer', 'MatchTeamPlayer']) {
        if (!hasTable(league, table)) throw new Error('Required league source schema is missing');
      }
      const issue = analytics.prepare('INSERT OR IGNORE INTO DataQualityIssues VALUES (?, ?, ?, ?)');
      const flag = (type, id, code) => issue.run(runId, type, String(id), code);
      const warehouse = createWarehouseFeatures({ league, analytics, runId, flag });
      const addSnapshot = analytics.prepare('INSERT INTO SourceSnapshots VALUES (?, ?, ?, ?, ?, ?, ?)');
      const snapshots = ['match_history', 'match_details'].map(name => snapshot(league, name, at));
      snapshots.push(snapshot(publicDb, 'public_matches', at));
      for (const source of snapshots) addSnapshot.run(runId, ...source);

      // SeasonStore imports legacy leagues into LeagueSeasons. MIN(SeasonId) alone
      // would therefore violate the signup-era boundary. A signup title or a real
      // submitted roster is the marker; remember the first detected marker across builds.
      let seasons;
      if (previewLeagueId) {
        seasons = [previewSeason(league, previewLeagueId)];
        flag('source', previewLeagueId, 'historical_preview_unknown_rosters');
      } else {
      const previousCutoff = analytics.prepare(`SELECT FirstSeasonId FROM AnalyticsRuns
        WHERE Status = 'complete' AND FirstSeasonId IS NOT NULL ORDER BY RunId DESC LIMIT 1`).get();
      firstSeasonId ??= previousCutoff?.FirstSeasonId ?? league.prepare(`SELECT MIN(s.SeasonId) AS Id
        FROM LeagueSeasons s WHERE NULLIF(TRIM(s.SignupTitle), '') IS NOT NULL OR EXISTS (
          SELECT 1 FROM SeasonTeams t JOIN SeasonTeamPlayers p ON p.TeamSubmissionId = t.TeamSubmissionId
          WHERE t.SeasonId = s.SeasonId AND t.IsManual = 0)`).get().Id;
      analytics.prepare('UPDATE AnalyticsRuns SET FirstSeasonId = ? WHERE RunId = ?').run(firstSeasonId, runId);
      if (!firstSeasonId) flag('source', 'league', 'no_signup_seasons');

      // Legacy champion imports can receive NEW internal IDs after signup seasons.
      // An ID cutoff alone must not pull those historical, rosterless seasons in.
      seasons = firstSeasonId ? league.prepare(`SELECT SeasonId, ExternalLeagueId, LeagueName, Status
        FROM LeagueSeasons s WHERE SeasonId >= ? AND (? IS NULL OR SeasonId = ?)
        AND (s.SeasonId=? OR s.Status<>'ended' OR NULLIF(TRIM(s.SignupTitle),'') IS NOT NULL
          OR EXISTS(SELECT 1 FROM SeasonTeams t WHERE t.SeasonId=s.SeasonId)) ORDER BY SeasonId`)
        .all(firstSeasonId, seasonId, seasonId, firstSeasonId) : [];
      if (seasonId && !seasons.length) throw new Error('Season is missing or predates signups; use an isolated league preview for historical data');
      }
      const addSeason = analytics.prepare('INSERT INTO SeasonFacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const addTeam = analytics.prepare('INSERT INTO TeamFacts VALUES (?, ?, ?, ?, ?, ?, ?)');
      const addPlayer = analytics.prepare('INSERT OR IGNORE INTO PlayerFacts VALUES (?, ?, ?)');
      const addRoster = analytics.prepare('INSERT INTO RosterMembership VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const addRosterInput = analytics.prepare('INSERT INTO PrivateRosterInputs VALUES (?, ?, ?, ?, ?)');
      const addTeamFeatures = analytics.prepare('INSERT INTO PrivateTeamFeatures VALUES (?, ?, ?, ?, ?, ?, ?)');
      const addMatch = analytics.prepare('INSERT INTO MatchFacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const addTeamGame = analytics.prepare('INSERT INTO TeamGameFacts VALUES (?, ?, ?, ?, ?, ?, ?)');
      const addPlayerGame = analytics.prepare(`INSERT INTO PlayerGameFacts VALUES
        (${Array.from({ length: 17 }, () => '?').join(',')})`);
      const rosterTables = hasTable(league, 'TeamRosterPlayers') && hasTable(league, 'TeamRosterPeriods');
      const sourceTimes = hasTable(league, 'MatchSourceDetails');
      const hasSeries = hasTable(league, 'SeriesMatch') && hasTable(league, 'SeriesInfo');
      const hasEntries = hasTable(league, 'LeagueRosterEntries');
      const hasBounds = hasTable(league, 'LeagueStageBoundaries');
      const hasRules = hasTable(league, 'SeasonLeagueRules');
      const hasLiveRules = hasTable(league, 'LeagueRules');
      const hasSignupMMRs = hasTable(league, 'SignupMMRs');
      const hasSubmittedMMRs = league.prepare("SELECT 1 FROM pragma_table_info('SeasonTeamPlayers') WHERE name = 'MMR'").get();
      const hasManualMMR = league.prepare("SELECT 1 FROM pragma_table_info('SeasonTeams') WHERE name = 'ManualAverageMMR'").get();
      const matches = league.prepare(`SELECT mt.*, ml.LeagueId, ml.DatePlayed FROM MatchLeague ml
        JOIN MatchTeam mt ON mt.MatchId = ml.MatchId WHERE ml.LeagueId = ? ORDER BY ml.MatchId`);
      const assignments = league.prepare(`SELECT DISTINCT PlayerId, TeamId FROM MatchTeamPlayer WHERE MatchId = ?`);
      const playerRows = league.prepare('SELECT * FROM MatchPlayer WHERE MatchId = ?');
      let matchCount = 0;
      let playerCount = 0;
      for (const season of seasons) {
        const boundary = hasBounds && season.ExternalLeagueId ? league.prepare(`SELECT GroupEndMatchId,
          TieBreakerEndMatchId FROM LeagueStageBoundaries WHERE LeagueId = ?`).get(season.ExternalLeagueId) : null;
        const liveRules = hasLiveRules && season.ExternalLeagueId ? league.prepare(`SELECT UpperBracketTeams,
          LowerBracketTeams, EliminatedTeams, HasTiebreaker, TiebreakerPosition FROM LeagueRules WHERE LeagueId = ?`)
          .get(season.ExternalLeagueId) : null;
        const rules = liveRules ?? (!season.Preview && hasRules ? league.prepare(`SELECT UpperBracketTeams, LowerBracketTeams, EliminatedTeams,
          HasTiebreaker, TiebreakerPosition FROM SeasonLeagueRules WHERE SeasonId = ?`).get(season.SeasonId) : null);
        addSeason.run(runId, season.SeasonId, season.ExternalLeagueId, season.LeagueName, season.Status,
          rules ? JSON.stringify(rules) : null, boundary?.GroupEndMatchId ?? null, boundary?.TieBreakerEndMatchId ?? null);
        const teamMap = new Map();
        const rosters = new Map();
        const playerTeams = new Map();
        const slotOverrides = season.Preview ? [] : pendingSlotOverrides(league, season.SeasonId);
        const history = !season.Preview && hasTable(league,'TeamRosterMembershipHistory') ? league.prepare(`SELECT h.* FROM TeamRosterMembershipHistory h
          JOIN SeasonTeams t ON t.TeamSubmissionId=h.TeamSubmissionId WHERE t.SeasonId=? ORDER BY h.EffectiveFromUtc,h.MembershipId`).all(season.SeasonId) : [];
        const submittedTeams = season.Preview ? previewTeams(league, season.ExternalLeagueId) : league.prepare(`SELECT TeamSubmissionId, TeamName, GroupId, ExternalTeamId, IsManual,
          ${hasManualMMR ? 'ManualAverageMMR' : 'NULL AS ManualAverageMMR'}
          FROM SeasonTeams WHERE SeasonId = ? ORDER BY TeamSubmissionId`).all(season.SeasonId);
        for (const team of submittedTeams) {
          const entry = !season.Preview && hasEntries && season.ExternalLeagueId ? league.prepare(`SELECT DisplayName, GroupId
            FROM LeagueRosterEntries WHERE LeagueId = ? AND (TeamSubmissionId = ? OR TeamId = ?)
            ORDER BY EntryId LIMIT 1`).get(season.ExternalLeagueId, team.TeamSubmissionId, team.ExternalTeamId) : null;
          const groupId = !season.Preview && hasEntries && ['active', 'ended'].includes(season.Status)
            ? entry?.GroupId ?? null : team.GroupId;
          addTeam.run(runId, team.TeamSubmissionId, season.SeasonId, team.ExternalTeamId,
            entry?.DisplayName ?? team.TeamName, groupId, team.IsManual);
          if (!team.ExternalTeamId) flag('team', team.TeamSubmissionId, 'unlinked_team');
          if (team.ExternalTeamId) {
            if (teamMap.has(team.ExternalTeamId)) {
              teamMap.set(team.ExternalTeamId, null); flag('team', team.ExternalTeamId, 'ambiguous_team_identity');
            } else teamMap.set(team.ExternalTeamId, groupId ? team.TeamSubmissionId : null);
          }
          const declared = !season.Preview && rosterTables ? league.prepare(`SELECT PlayerId, Slot FROM TeamRosterPlayers
            WHERE TeamSubmissionId = ? ORDER BY Slot`).all(team.TeamSubmissionId) : [];
          const finalized = declared.length > 0 || history.some(h=>h.TeamSubmissionId===team.TeamSubmissionId);
          const rawPlayers = season.Preview ? [] : finalized ? declared : league.prepare(`SELECT PlayerId, Slot FROM SeasonTeamPlayers
            WHERE TeamSubmissionId = ? ORDER BY Slot`).all(team.TeamSubmissionId);
          const teamOverrides = slotOverrides.filter(p=>p.TeamSubmissionId===team.TeamSubmissionId);
          const pending = teamOverrides.filter(p=>p.ConfirmedPlayerId==null);
          const players = finalized ? rawPlayers.filter(p=>!pending.some(s=>s.Slot===p.Slot))
            : applySignupSlotOverrides(rawPlayers.map(p=>({...p,TeamSubmissionId:team.TeamSubmissionId})),teamOverrides);
          for(const p of pending) analytics.prepare('INSERT INTO PrivatePendingRosterSlots VALUES(?,?,?,?)')
            .run(runId,team.TeamSubmissionId,p.Slot,p.EstimatedMMR);
          if(pending.length)flag('team',team.TeamSubmissionId,'provisional_roster');
          const period = finalized ? league.prepare('SELECT EffectiveFrom, EffectiveTo, FromEstimated FROM TeamRosterPeriods WHERE TeamSubmissionId = ?')
            .get(team.TeamSubmissionId) : null;
          const roster = { finalized, from: utc(period?.EffectiveFrom), to: utc(period?.EffectiveTo),
            estimated: period?.FromEstimated !== 0, players: new Set(players.map(p => p.PlayerId)), conflicts: new Set() };
          roster.intervals=history.filter(h=>h.TeamSubmissionId===team.TeamSubmissionId).map(h=>({...h,
            EffectiveToUtc:utc(h.EffectiveToUtc)||roster.to}));roster.peers=history;
          for(const h of roster.intervals)analytics.prepare('INSERT INTO RosterMembershipIntervals VALUES (?,?,?,?,?,?,?)')
            .run(runId,team.TeamSubmissionId,h.PlayerId,h.Slot,h.EffectiveFromUtc,h.EffectiveToUtc,h.FromEstimated);
          rosters.set(team.TeamSubmissionId, roster);
          if (!season.Preview && ['active', 'ended'].includes(season.Status) && (!finalized || !roster.from || roster.estimated)) {
            flag('team', team.TeamSubmissionId, 'unresolved_roster_period');
          }
          let mmrTotal = pending.reduce((sum,p)=>sum+p.EstimatedMMR,0); let mmrSamples = pending.length;
          for (const player of players) {
            if (playerTeams.has(player.PlayerId) && playerTeams.get(player.PlayerId) !== team.TeamSubmissionId) {
              roster.conflicts.add(player.PlayerId);
              rosters.get(playerTeams.get(player.PlayerId)).conflicts.add(player.PlayerId);
              flag('player', `${season.SeasonId}:${player.PlayerId}`, 'ambiguous_player_roster');
            } else playerTeams.set(player.PlayerId, team.TeamSubmissionId);
            const name = league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId = ?').get(player.PlayerId);
            addPlayer.run(runId, player.PlayerId, name?.PlayerName || `Player ${player.PlayerId}`);
            const interval=roster.intervals.filter(h=>h.PlayerId===player.PlayerId).at(-1);
            addRoster.run(runId, team.TeamSubmissionId, player.PlayerId, player.Slot,
              interval?.EffectiveFromUtc||roster.from,interval?interval.EffectiveToUtc:roster.to,
              interval?interval.FromEstimated:roster.estimated ? 1 : 0, finalized ? 'finalized' : 'submission');
            const frozen = hasSignupMMRs ? league.prepare(`SELECT SignupMMR AS MMR FROM SignupMMRs
              WHERE TeamSubmissionId = ? AND PlayerId = ?`).get(team.TeamSubmissionId, player.PlayerId) : null;
            const submitted = !finalized && hasSubmittedMMRs ? league.prepare(`SELECT MMR FROM SeasonTeamPlayers
              WHERE TeamSubmissionId = ? AND PlayerId = ?`).get(team.TeamSubmissionId, player.PlayerId) : null;
            const confirmed = teamOverrides.find(p=>p.ConfirmedPlayerId===player.PlayerId);
            const candidateMMR = validNumber(frozen?.MMR ?? confirmed?.ConfirmedMMR ?? submitted?.MMR);
            const mmr = candidateMMR > 0 ? candidateMMR : null;
            addRosterInput.run(runId, team.TeamSubmissionId, player.PlayerId, mmr,
              frozen ? 'finalized_signup' : confirmed ? 'pending_slot_confirmation' : submitted ? 'submission' : 'unavailable');
            if (mmr !== null) { mmrSamples += 1; mmrTotal += mmr; }
          }
          const historical=new Map(roster.intervals.filter(h=>!players.some(p=>p.PlayerId===h.PlayerId)).map(h=>[h.PlayerId,h]));
          for(const [playerId,h] of historical) {
            const name=league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=?').get(playerId);
            addPlayer.run(runId,playerId,name?.PlayerName||`Player ${playerId}`);
            addRoster.run(runId,team.TeamSubmissionId,playerId,h.Slot,h.EffectiveFromUtc,h.EffectiveToUtc,h.FromEstimated,'finalized');
          }
          const candidateManualMMR = validNumber(team.ManualAverageMMR);
          const manualMMR = candidateManualMMR > 0 ? candidateManualMMR : null;
          const quality = team.IsManual ? manualMMR === null ? 'missing_manual_mmr' : 'manual_input'
            : mmrSamples === 5 && players.length + pending.length === 5 ? pending.length ? 'provisional_roster' : 'ready' : 'missing_roster_inputs';
          addTeamFeatures.run(runId, team.TeamSubmissionId, season.SeasonId,
            team.IsManual ? manualMMR : ['ready','provisional_roster'].includes(quality) ? mmrTotal / mmrSamples : null, mmrSamples, 1, quality);
        }
        for (const [teamId, roster] of rosters) if (roster.conflicts.size) {
          analytics.prepare(`UPDATE PrivateTeamFeatures SET QualityStatus = 'conflicting_roster'
            WHERE RunId = ? AND TeamSubmissionId = ?`).run(runId, teamId);
        }
        if (!season.ExternalLeagueId || !['active', 'ended'].includes(season.Status)) continue;
        for (const match of matches.iterate(season.ExternalLeagueId)) {
          const reject = code => flag('match', match.MatchId, code);
          const official=hasTable(league,'OfficialMatchStatus')?league.prepare('SELECT * FROM OfficialMatchStatus WHERE MatchId=? AND SeasonId=?').get(match.MatchId,season.SeasonId):null;
          if(official?.Status==='abandoned')continue;
          if(official?.Status==='superseded') {
            const replay=league.prepare('SELECT TeamRad,TeamDire FROM MatchTeam WHERE MatchId=?').get(official.ReplacementMatchId);
            if(replay&&[match.TeamRad,match.TeamDire].includes(replay.TeamRad)&&[match.TeamRad,match.TeamDire].includes(replay.TeamDire)&&replay.TeamRad!==replay.TeamDire)continue;
            reject('unresolved_replay');continue;
          }
          const radiant = teamMap.get(match.TeamRad);
          const dire = teamMap.get(match.TeamDire);
          if (!radiant || !dire || radiant === dire) { reject('unmapped_match_team'); continue; }
          if (match.Rehost && official?.Status!=='official') { reject('unresolved_rehost'); continue; }
          if (!Number.isFinite(match.Duration) || match.Duration <= 0 || ![match.TeamRad, match.TeamDire].includes(match.WinnerId)) {
            reject('incomplete_match'); continue;
          }
          const map = new Map();
          let conflict = false;
          for (const player of assignments.all(match.MatchId)) {
            if (!Number.isSafeInteger(player.PlayerId) || player.PlayerId <= 0 || ![match.TeamRad, match.TeamDire].includes(player.TeamId)
              || (map.has(player.PlayerId) && map.get(player.PlayerId) !== player.TeamId)) conflict = true;
            map.set(player.PlayerId, player.TeamId);
          }
          const stats = new Map();
          for (const player of playerRows.all(match.MatchId)) {
            if (stats.has(player.PlayerId) && JSON.stringify(stats.get(player.PlayerId)) !== JSON.stringify(player)) conflict = true;
            stats.set(player.PlayerId, player);
          }
          if (conflict || map.size !== 10 || stats.size !== 10 || [...map.keys()].some(id => !stats.has(id))
            || [...map.values()].filter(id => id === match.TeamRad).length !== 5
            || [...stats.values()].some(p => !Number.isSafeInteger(p.HeroId) || p.HeroId <= 0)) {
            reject('invalid_player_assignments'); continue;
          }
          const links = hasSeries ? league.prepare(`SELECT DISTINCT s.SeriesId, s.Stage, s.Team1, s.Team2, s.LeagueId
            FROM SeriesMatch sm JOIN SeriesInfo s ON s.SeriesId = sm.SeriesId WHERE sm.MatchId = ?`).all(match.MatchId) : [];
          if (links.length > 1 || (links[0] && (links[0].LeagueId !== season.ExternalLeagueId
            || ![links[0].Team1, links[0].Team2].includes(match.TeamRad)
            || ![links[0].Team1, links[0].Team2].includes(match.TeamDire)))) {
            reject('conflicting_series_link'); continue;
          }
          const stage = official?.StageOverride || matchStage(match.MatchId, boundary, links[0]?.Stage);
          if (stage === 'unknown') reject('unknown_match_stage');
          const detail = sourceTimes ? league.prepare('SELECT StartedAtUtc, ObservedAtUtc FROM MatchSourceDetails WHERE MatchId = ?').get(match.MatchId) : null;
          const metadata = warehouse.metadata(match.MatchId);
          const timing = warehouseMatchTime(match, detail, metadata);
          if (timing.observedAt && timing.observedAt > at) {
            reject('match_not_available_as_of'); continue;
          }
          const startedAt = timing.startedAt;
          if (startedAt && startedAt > at) { reject('future_match'); continue; }
          if (startedAt && Date.parse(startedAt) + match.Duration * 1000 > now.getTime()) {
            reject('match_not_completed_as_of'); continue;
          }
          if (!startedAt) reject('unknown_match_time');
          addMatch.run(runId, match.MatchId, season.SeasonId, season.ExternalLeagueId, links[0]?.SeriesId ?? null,
            stage, startedAt, match.DatePlayed ?? null, timing.timeSource,
            match.Duration, match.WinnerId, timing.observedAt);
          addTeamGame.run(runId, match.MatchId, radiant, dire, match.TeamRad, Number(match.WinnerId === match.TeamRad), 'radiant');
          addTeamGame.run(runId, match.MatchId, dire, radiant, match.TeamDire, Number(match.WinnerId === match.TeamDire), 'dire');
          for (const [playerId, teamId] of map) {
            const submissionId = teamId === match.TeamRad ? radiant : dire;
            const p = stats.get(playerId);
            const name = league.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId = ?').get(playerId);
            addPlayer.run(runId, playerId, name?.PlayerName || `Player ${playerId}`);
            const membership = membershipFor(rosters.get(submissionId), playerId, startedAt);
            if (membership === 'unknown') flag('player_game', `${match.MatchId}:${playerId}`, 'unknown_membership');
            const values = [p.Kills, p.Deaths, p.Assists, p.Lasthits, p.GPM, p.XPM, p.Networth, p.HeroDamage, p.TowerDamage, p.Healing]
              .map(validNumber);
            if (values.some(v => v === null)) flag('player_game', `${match.MatchId}:${playerId}`, 'missing_metric_values');
            addPlayerGame.run(runId, match.MatchId, playerId, submissionId, p.HeroId,
              Number(match.WinnerId === teamId), membership, ...values);
            playerCount += 1;
          }
          warehouse.write({ match, metadata, stats, assignments: map, radiant, dire });
          matchCount += 1;
        }
      }
      for (const season of seasons) {
        for (const { GroupId } of analytics.prepare('SELECT DISTINCT GroupId FROM TeamFacts WHERE RunId = ? AND SeasonId = ? AND GroupId IS NOT NULL')
          .all(runId, season.SeasonId)) {
          const live = season.ExternalLeagueId && hasTable(league, 'GroupNames') ? league.prepare('SELECT GroupName FROM GroupNames WHERE LeagueId = ? AND GroupId = ?')
            .get(season.ExternalLeagueId, GroupId) : null;
          const draft = !season.Preview && !season.ExternalLeagueId && hasTable(league, 'SeasonGroups')
            ? league.prepare('SELECT GroupName FROM SeasonGroups WHERE SeasonId = ? AND GroupId = ?').get(season.SeasonId, GroupId) : null;
          analytics.prepare('INSERT INTO GroupFacts VALUES (?, ?, ?, ?)').run(runId, season.SeasonId, GroupId, live?.GroupName || draft?.GroupName || `Group ${GroupId}`);
        }
        if (!hasSeries || !season.ExternalLeagueId) continue;
        const structure = hasTable(league, 'PlayoffBracket') ? league.prepare('SELECT PlayoffStructure FROM PlayoffBracket WHERE LeagueId = ?').get(season.ExternalLeagueId) : null;
        const formats = bracketSeriesFormats(structure?.PlayoffStructure);
        const seriesColumns = new Set(league.pragma('table_info(SeriesInfo)').map(c => c.name));
        for (const series of league.prepare(`SELECT SeriesId, Team1, Team2, Stage, ${seriesColumns.has('BestOf') ? 'BestOf' : 'NULL AS BestOf'}
          FROM SeriesInfo WHERE LeagueId = ?`).all(season.ExternalLeagueId)) {
          if (!Number.isSafeInteger(series.Team1) || !Number.isSafeInteger(series.Team2)
            || series.Team1 <= 0 || series.Team2 <= 0 || series.Team1 === series.Team2) {
            flag('series', series.SeriesId, 'invalid_series_teams'); continue;
          }
          const linked = formats.get(series.SeriesId);
          const pairsMatch = linked && [linked.team1, linked.team2].includes(series.Team1) && [linked.team1, linked.team2].includes(series.Team2);
          const direct = [3, 5].includes(series.BestOf) ? series.BestOf : null;
          const bestOf = direct && linked && direct !== linked.bestOf ? null : direct ?? (pairsMatch ? linked.bestOf : null);
          const sourceLinks=league.prepare('SELECT DISTINCT MatchId FROM SeriesMatch WHERE SeriesId=?').all(series.SeriesId);
          const sourceCount=sourceLinks.filter(link=>{
            const c=hasTable(league,'OfficialMatchStatus')?league.prepare('SELECT Status,ReplacementMatchId FROM OfficialMatchStatus WHERE MatchId=?').get(link.MatchId):null;
            return c?.Status!=='abandoned'&&!(c?.Status==='superseded'&&sourceLinks.some(r=>r.MatchId===c.ReplacementMatchId));
          }).length;
          if (series.Stage === 'p' && !bestOf && analytics.prepare('SELECT 1 FROM MatchFacts WHERE RunId = ? AND SeriesId = ? LIMIT 1').get(runId, series.SeriesId)) {
            flag('series', series.SeriesId, 'unverified_series_format');
          }
          analytics.prepare('INSERT INTO SeriesFacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(runId, series.SeriesId, season.SeasonId, series.Team1, series.Team2, bestOf, pairsMatch ? linked.roundLabel : null, sourceCount);
        }
      }
      summarize(analytics, runId);

      const addHero = analytics.prepare('INSERT INTO HeroFacts VALUES (?, ?, ?)');
      const heroNames = hasTable(league, 'HeroInfo') ? league.prepare('SELECT HeroName FROM HeroInfo WHERE HeroId = ?') : null;
      for (const { HeroId } of analytics.prepare('SELECT DISTINCT HeroId FROM PlayerGameFacts WHERE RunId = ?').all(runId)) {
        addHero.run(runId, HeroId, heroNames?.get(HeroId)?.HeroName || `Hero ${HeroId}`);
      }
      if (!previewLeagueId && league.pragma('table_info(LeagueSeasons)').some(column => column.name === 'ChampionTeamId')) {
        for (const season of seasons) {
          const champion = league.prepare('SELECT ChampionTeamId FROM LeagueSeasons WHERE SeasonId = ?').get(season.SeasonId);
          const team = champion?.ChampionTeamId ? analytics.prepare('SELECT TeamSubmissionId FROM TeamFacts WHERE RunId = ? AND SeasonId = ? AND TeamId = ?')
            .get(runId, season.SeasonId, champion.ChampionTeamId) : null;
          if (season.Status === 'ended' && team) analytics.prepare('INSERT INTO ChampionFacts VALUES (?, ?, ?)').run(runId, season.SeasonId, team.TeamSubmissionId);
        }
      }

      // Public features require an observed-at record. Existing untracked rows must
      // not be retroactively treated as information available before ingestion.
      if (hasTable(publicDb, 'PublicMatchPlayer') && hasTable(publicDb, 'PublicMatchAvailability')) {
        const start = new Date(now.getTime() - ANALYTICS_DEFAULTS.publicLookbackDays * 86400000).toISOString();
        const stale = snapshots.find(s => s[0] === 'public_matches')[5] === 1;
        const partial = snapshots.find(s => s[0] === 'public_matches')[4] !== 'complete';
        const rows = publicDb.prepare(`SELECT p.MatchId, p.Won, p.Kills, p.Deaths, p.Assists,
          p.DateCreated, a.FirstObservedAtUtc FROM PublicMatchPlayer p JOIN PublicMatchAvailability a
          ON a.MatchId = p.MatchId AND a.PlayerId = p.PlayerId WHERE p.PlayerId = ?
          AND p.DateCreated >= ? AND p.DateCreated <= ? AND a.FirstObservedAtUtc <= ?`);
        const insert = analytics.prepare('INSERT INTO PrivatePlayerFeatures VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        // Iterate only the included cohort, never all public players/matches in memory.
        for (const player of analytics.prepare('SELECT PlayerId FROM PlayerFacts WHERE RunId = ?').all(runId)) {
          let samples = 0; let wins = 0; let kills = 0; let deaths = 0; let assists = 0;
          const seen = new Set();
          for (const row of rows.iterate(player.PlayerId, start, at, at)) {
            const playedAt = utc(row.DateCreated); const observedAt = utc(row.FirstObservedAtUtc);
            if (!playedAt || !observedAt || playedAt < start || playedAt > at || observedAt > at
              || seen.has(row.MatchId) || ![0, 1].includes(row.Won)
              || [row.Kills, row.Deaths, row.Assists].some(v => validNumber(v) === null)) continue;
            seen.add(row.MatchId); samples += 1; wins += row.Won;
            kills += row.Kills; deaths += row.Deaths; assists += row.Assists;
          }
          insert.run(runId, player.PlayerId, start, at, samples, wins,
            samples ? kills / samples : null, samples ? deaths / samples : null, samples ? assists / samples : null,
            1, stale ? 'stale' : partial ? 'partial_source'
              : samples < ANALYTICS_DEFAULTS.minimumSamples ? 'insufficient_samples' : 'ready');
        }
      } else flag('source', 'public', 'public_availability_untracked');

      summarizeWarehouseFeatures(analytics, runId);
      publishLeagueHighlights(analytics, runId, now);
      beforePublish?.({ runId, analytics });
      const issueCount = analytics.prepare('SELECT COUNT(*) AS Count FROM DataQualityIssues WHERE RunId = ?').get(runId).Count;
      analytics.prepare(`UPDATE AnalyticsRuns SET Status = 'complete', FinishedAtUtc = ?, MatchCount = ?,
        PlayerGameCount = ?, IssueCount = ?, DurationMs = ?, PeakRssBytes = ? WHERE RunId = ?`)
        .run(new Date().toISOString(), matchCount, playerCount, issueCount, Math.round(performance.now() - started),
          process.resourceUsage().maxRSS * 1024, runId);
      analytics.prepare('UPDATE AnalyticsState SET PublishedRunId = ? WHERE Id = 1').run(runId);
      // Retain two complete generations, not an ever-growing daily copy of facts.
      const old = analytics.prepare(`SELECT RunId FROM AnalyticsRuns WHERE Status = 'complete'
        ORDER BY RunId DESC LIMIT -1 OFFSET ?`).all(ANALYTICS_DEFAULTS.retainedGenerations);
      for (const { RunId } of old) {
        for (const table of [...WAREHOUSE_FACT_TABLES, 'SourceSnapshots', 'DataQualityIssues', 'SeasonFacts', 'TeamFacts', 'PlayerFacts',
          'RosterMembership', 'RosterMembershipIntervals', 'MatchFacts', 'PlayerTeamSeasonStats', 'PlayerMetricStats', 'TeamSeasonStats', 'PrivatePlayerFeatures',
          'PrivateRosterInputs', 'PrivateTeamFeatures', 'PrivatePendingRosterSlots', 'HeroFacts', 'ChampionFacts', 'GroupFacts', 'SeriesFacts']) {
          analytics.prepare(`DELETE FROM ${table} WHERE RunId = ?`).run(RunId);
        }
      }
      analytics.prepare(`DELETE FROM AnalyticsRuns WHERE RunId NOT IN
        (SELECT RunId FROM AnalyticsRuns ORDER BY RunId DESC LIMIT 100)
        AND RunId NOT IN (SELECT RunId FROM AnalyticsRuns WHERE Status = 'complete' ORDER BY RunId DESC LIMIT 2)`).run();
    })();
    return { runId, status: 'complete' };
  } catch (error) {
    analytics.prepare(`UPDATE AnalyticsRuns SET Status = 'failed', FailureCode = 'build_failed', FinishedAtUtc = ?,
      DurationMs = ? WHERE RunId = ?`).run(new Date().toISOString(), Math.round(performance.now() - started), runId);
    throw error;
  } finally {
    if (league.inTransaction) league.exec('ROLLBACK');
    if (publicDb?.inTransaction) publicDb.exec('ROLLBACK');
    analytics.prepare('DELETE FROM AnalyticsBuildLock WHERE Owner = ?').run(owner);
  }
}
