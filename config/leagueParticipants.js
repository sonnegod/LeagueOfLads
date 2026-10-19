// Published roster entries retain the signup identity before a Dota team ID exists.
export function getLeagueRegisteredTeams(db, leagueId) {
  return db.prepare(`SELECT e.EntryId, e.TeamSubmissionId, e.TeamId,
      e.DisplayName AS TeamName, e.GroupId, g.GroupName,
      EXISTS (SELECT 1 FROM TeamRosterPlayers r
        WHERE r.TeamSubmissionId = e.TeamSubmissionId) AS HasRoster
    FROM LeagueRosterEntries e
    JOIN GroupNames g ON g.LeagueId = e.LeagueId AND g.GroupId = e.GroupId
    WHERE e.LeagueId = ? ORDER BY e.GroupId, e.SortOrder, e.DisplayName`).all(leagueId);
}

export function includeRegisteredTeams(records, registered) {
  const byTeam = new Map(records.map(row => [row.TeamId, row]));
  const linkedIds = new Set(registered.filter(row => row.TeamId != null).map(row => row.TeamId));
  return [
    ...registered.map(team => ({ GamesPlayed: 0, WinPercentage: null,
      ...byTeam.get(team.TeamId), ...team })),
    ...records.filter(row => !linkedIds.has(row.TeamId)),
  ].map(team => ({ ...team, TeamName: String(team.TeamName ?? '') }))
    .sort((a, b) => b.GamesPlayed - a.GamesPlayed || a.TeamName.localeCompare(b.TeamName));
}

export function includeRegisteredPlayers(db, leagueId, records, teams) {
  const result = records.map(row => ({ ...row,
    PlayerName: String(row.PlayerName ?? ''), TeamName: String(row.TeamName ?? '') }));
  const byPlayerTeam = new Map(result.map(row => [`${row.PlayerId}:${row.TeamId}`, row]));
  const roster = db.prepare(`SELECT r.PlayerId, p.PlayerName, r.TeamSubmissionId
    FROM TeamRosterPlayers r JOIN PlayerInfo p ON p.PlayerId = r.PlayerId
    JOIN SeasonTeams t ON t.TeamSubmissionId = r.TeamSubmissionId
    JOIN LeagueSeasons s ON s.SeasonId = t.SeasonId
    WHERE s.ExternalLeagueId = ? AND s.Status IN ('active', 'ended')`).all(leagueId);
  const bySubmission = new Map(teams.filter(t => t.TeamSubmissionId != null)
    .map(t => [t.TeamSubmissionId, t]));
  for (const player of roster) {
    const team = bySubmission.get(player.TeamSubmissionId);
    if (!team) continue;
    const played = team.TeamId == null ? null : byPlayerTeam.get(`${player.PlayerId}:${team.TeamId}`);
    const identity = { TeamSubmissionId: team.TeamSubmissionId, EntryId: team.EntryId,
      HasRoster: team.HasRoster, TeamId: team.TeamId, TeamName: team.TeamName };
    if (played) Object.assign(played, identity);
    else result.push({ ...player, PlayerName: String(player.PlayerName ?? ''), ...identity, TeamGames: team.GamesPlayed, GamesPlayed: 0,
      WinPercentage: null, AvgKills: null, AvgDeaths: null, AvgAssists: null,
      AvgLastHits: null, AvgGPM: null, AvgXPM: null });
  }
  return result.sort((a, b) => b.GamesPlayed - a.GamesPlayed
    || a.PlayerName.localeCompare(b.PlayerName) || (a.TeamSubmissionId ?? a.TeamId) - (b.TeamSubmissionId ?? b.TeamId));
}

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

export function saveRegisteredLeagueTeam(db, leagueId, { entryId, teamId, teamName, groupId }, { rebuild, audit }) {
  return db.transaction(() => {
    const entry = db.prepare('SELECT * FROM LeagueRosterEntries WHERE LeagueId = ? AND EntryId = ?')
      .get(leagueId, entryId);
    if (!entry) fail('Team is not in the active league', 404);
    if (!teamName || teamName.length > 60 || !Number.isSafeInteger(groupId) || groupId <= 0
      || (teamId !== null && (!Number.isSafeInteger(teamId) || teamId <= 0))) fail('Enter a valid team name, group, and optional team ID');
    const group = db.prepare('SELECT GroupName FROM GroupNames WHERE LeagueId = ? AND GroupId = ?')
      .get(leagueId, groupId);
    if (!group) fail('Group is not in the active league');
    if (teamId !== null && teamId !== entry.TeamId) {
      if (db.prepare('SELECT 1 FROM LeagueRosterEntries WHERE LeagueId = ? AND TeamId = ? AND EntryId <> ?')
        .get(leagueId, teamId, entryId) || db.prepare('SELECT 1 FROM LeagueGroups WHERE LeagueId = ? AND TeamId = ?')
        .get(leagueId, teamId)) fail('That team ID is already assigned to another leaderboard row', 409);
    }
    const changedAlignment = teamId !== entry.TeamId || groupId !== entry.GroupId;
    if (entry.TeamId !== null && changedAlignment) {
      db.prepare('DELETE FROM GroupResultOverrides WHERE LeagueId = ? AND GroupId = ? AND (TeamA = ? OR TeamB = ?)')
        .run(leagueId, entry.GroupId, entry.TeamId, entry.TeamId);
      db.prepare('DELETE FROM LeagueGroups WHERE LeagueId = ? AND TeamId = ?').run(leagueId, entry.TeamId);
      if (teamId !== entry.TeamId) db.prepare('DELETE FROM LeagueTeamNames WHERE LeagueId = ? AND TeamId = ?')
        .run(leagueId, entry.TeamId);
    }
    db.prepare('UPDATE LeagueRosterEntries SET TeamId = ?, DisplayName = ?, GroupId = ? WHERE EntryId = ?')
      .run(teamId, teamName, groupId, entryId);
    if (teamId !== null) {
      db.prepare('INSERT OR IGNORE INTO TeamInfo (TeamId, TeamName) VALUES (?, ?)').run(teamId, teamName);
      db.prepare(`INSERT INTO LeagueTeamNames (LeagueId, TeamId, DisplayName) VALUES (?, ?, ?)
        ON CONFLICT(LeagueId, TeamId) DO UPDATE SET DisplayName = excluded.DisplayName`).run(leagueId, teamId, teamName);
      db.prepare(`INSERT INTO LeagueGroups (LeagueId, TeamId, GroupId) VALUES (?, ?, ?)
        ON CONFLICT(LeagueId, TeamId) DO UPDATE SET GroupId = excluded.GroupId`).run(leagueId, teamId, groupId);
    }
    if (entry.TeamSubmissionId) {
      const team = db.prepare('SELECT SeasonId, GroupId FROM SeasonTeams WHERE TeamSubmissionId = ?')
        .get(entry.TeamSubmissionId);
      let seasonGroupId = team.GroupId;
      if (groupId !== entry.GroupId) {
        // At season start, public group IDs are assigned in SeasonGroups sort order.
        const groups = db.prepare('SELECT GroupId FROM SeasonGroups WHERE SeasonId = ? ORDER BY SortOrder, GroupId')
          .all(team.SeasonId);
        seasonGroupId = groups[groupId - 1]?.GroupId;
        if (seasonGroupId == null) fail('This group has no matching season group');
      }
      db.prepare(`UPDATE SeasonTeams SET TeamName = ?, ExternalTeamId = ?, GroupId = ?, UpdatedAt = ?
        WHERE TeamSubmissionId = ?`).run(teamName, teamId, seasonGroupId, new Date().toISOString(), entry.TeamSubmissionId);
    }
    if (changedAlignment) rebuild(leagueId);
    audit('League Team Edit', `League ${leagueId}: entry ${entryId}, team ID ${entry.TeamId ?? 'unlinked'} -> ${teamId ?? 'unlinked'}, named ${teamName}, group ${groupId}`);
  })();
}
