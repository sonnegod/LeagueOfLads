const tablesIn = db => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
const fail = message => { throw Object.assign(new Error(message),{status:409}); };
const playedFixture = event => event.StartedAtUtc || event.SeriesId != null || ['started','completed','forfeit'].includes(event.Status);
const teamEvents = (db,tables,seasonId,teamId) => tables.has('ScheduledEvents')
  ? db.prepare('SELECT * FROM ScheduledEvents WHERE SeasonId=? AND (Team1Key=? OR Team2Key=?)').all(seasonId,teamId,teamId) : [];

// Remove a signup as one unit, including its published entry and provisional roster.
// Player identities and recorded matches belong to the league history, not the signup.
export function deleteSeasonSignup(db,seasonId,teamId) {
  return db.transaction(()=>{
    const team=db.prepare('SELECT * FROM SeasonTeams WHERE SeasonId=? AND TeamSubmissionId=?').get(seasonId,teamId);
    if(!team)return null;
    const season=db.prepare('SELECT Status,ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
    if(!['signup_open','signup_closed','active'].includes(season?.Status))fail('Teams cannot be deleted from completed seasons');
    const tables=tablesIn(db);
    const entries=tables.has('LeagueRosterEntries')
      ?db.prepare('SELECT EntryId,LeagueId,TeamId FROM LeagueRosterEntries WHERE TeamSubmissionId=?').all(teamId):[];
    const events=teamEvents(db,tables,seasonId,teamId);
    const publishedGroup=team.ExternalTeamId!=null&&tables.has('LeagueGroups')
      ?db.prepare('SELECT 1 FROM LeagueGroups WHERE LeagueId=? AND TeamId=?').get(season.ExternalLeagueId,team.ExternalTeamId):null;
    const assigned=team.GroupId!=null || entries.length>0 || publishedGroup;
    const playedMatch=team.ExternalTeamId!=null&&tables.has('MatchTeam')&&tables.has('MatchLeague')
      ?db.prepare(`SELECT 1 FROM MatchTeam m JOIN MatchLeague l ON l.MatchId=m.MatchId
        WHERE l.LeagueId=? AND (m.TeamRad=? OR m.TeamDire=?) LIMIT 1`).get(season.ExternalLeagueId,team.ExternalTeamId,team.ExternalTeamId):null;
    if((team.ExternalTeamId!=null&&assigned) || entries.some(entry=>entry.TeamId!=null || entry.LeagueId!==season.ExternalLeagueId)
      || events.some(playedFixture) || playedMatch)fail('Teams linked to played matches or recorded fixtures cannot be deleted');

    for(const entry of entries) {
      if(tables.has('SeasonMatchups'))db.prepare('DELETE FROM SeasonMatchups WHERE SeasonId=? AND (TeamAEntryId=? OR TeamBEntryId=?)')
        .run(seasonId,entry.EntryId,entry.EntryId);
      db.prepare('DELETE FROM LeagueRosterEntries WHERE EntryId=?').run(entry.EntryId);
    }
    for(const event of events)if(!['cancelled','replaced'].includes(event.Status)) {
      const timestamp=new Date().toISOString();
      db.prepare("UPDATE ScheduledEvents SET Status='cancelled',Revision=Revision+1,UpdatedAtUtc=? WHERE EventId=?").run(timestamp,event.EventId);
      if(tables.has('ScheduleEventRevisions')) {
        const updated=db.prepare('SELECT * FROM ScheduledEvents WHERE EventId=?').get(event.EventId);
        db.prepare('INSERT INTO ScheduleEventRevisions(EventId,Revision,SnapshotJson,Reason,CreatedAtUtc) VALUES(?,?,?,?,?)')
          .run(updated.EventId,updated.Revision,JSON.stringify(updated),'team_removed',timestamp);
      }
    }
    for(const table of ['SeasonPendingRosterSlots','TeamRosterMembershipHistory','TeamDiscordAliases',
      'BettingOfficialOutcomes','SignupMMRs','TeamRosterPeriods','TeamRosterPlayers','SeasonTeamPlayers']) {
      if(tables.has(table))db.prepare(`DELETE FROM ${table} WHERE TeamSubmissionId=?`).run(teamId);
    }
    db.prepare('DELETE FROM SeasonTeams WHERE SeasonId=? AND TeamSubmissionId=?').run(seasonId,teamId);
    return team;
  })();
}

// The old Remove action deleted only LeagueRosterEntries. Assigned, unlinked
// signups with no published entry are its leftovers; new unassigned teams stay.
export function repairRemovedSeasonSignups(db,audit=()=>{}) {
  return db.transaction(()=>{
    const tables=tablesIn(db);
    if(!['SeasonTeams','LeagueSeasons','SeasonGroups','GroupNames','LeagueRosterEntries'].every(table=>tables.has(table)))return [];
    const leftovers=db.prepare(`SELECT t.* FROM SeasonTeams t JOIN LeagueSeasons s ON s.SeasonId=t.SeasonId
      WHERE s.Status='active' AND t.GroupId IS NOT NULL AND t.ExternalTeamId IS NULL
        AND EXISTS(SELECT 1 FROM SeasonGroups g WHERE g.SeasonId=t.SeasonId AND g.GroupId=t.GroupId)
        AND EXISTS(SELECT 1 FROM GroupNames g WHERE g.LeagueId=s.ExternalLeagueId)
        AND NOT EXISTS(SELECT 1 FROM LeagueRosterEntries e WHERE e.TeamSubmissionId=t.TeamSubmissionId)`).all();
    const removed=[];
    for(const team of leftovers) {
      if(teamEvents(db,tables,team.SeasonId,team.TeamSubmissionId).some(playedFixture))continue;
      deleteSeasonSignup(db,team.SeasonId,team.TeamSubmissionId);
      audit('Signup Removal Repaired',`Removed leftover signup ${team.TeamName} (submission ${team.TeamSubmissionId}) from season ${team.SeasonId}`);
      removed.push(team.TeamSubmissionId);
    }
    return removed;
  }).immediate();
}
