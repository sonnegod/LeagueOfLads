import { useState } from 'react';
import { Link } from 'react-router-dom';
import './LeagueSchedule.css';

function formatDate(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function LeagueScheduleView({ plan, onEdit, onRemove, busy = false }) {
  const [groupId, setGroupId] = useState('all');
  const [teamId, setTeamId] = useState('all');
  const teams = plan.teams.filter(team => groupId === 'all' || String(team.GroupId) === groupId);
  const matchups = plan.matchups.filter(row => (groupId === 'all' || String(row.GroupId) === groupId)
    && (teamId === 'all' || [row.TeamAEntryId, row.TeamBEntryId].some(id => String(id) === teamId)));
  const editing = Boolean(onEdit && onRemove);
  const settings = plan.settings;

  return <div className="league-schedule">
    {settings && <p className="schedule-note">
      Suggested pace: <strong>{settings.SeriesPerWindow} series per team every {settings.WeeksPerWindow} week{settings.WeeksPerWindow === 1 ? '' : 's'}</strong>.
      {' '}These are pacing suggestions. Teams may play other opponents or play outside these windows.
      Final windows and byes can mean fewer series.
    </p>}
    {plan.matchups.length > 0 && <div className="schedule-controls">
      <label>Group<select value={groupId} onChange={event => { setGroupId(event.target.value); setTeamId('all'); }}>
        <option value="all">All groups</option>
        {plan.groups.map(group => <option key={group.GroupId} value={group.GroupId}>{group.GroupName}</option>)}
      </select></label>
      <label>Team<select value={teamId} onChange={event => setTeamId(event.target.value)}>
        <option value="all">All teams</option>
        {teams.map(team => <option key={team.EntryId} value={team.EntryId}>{team.TeamName}</option>)}
      </select></label>
    </div>}
    {!matchups.length && <p role="status">{plan.matchups.length
      ? 'No matchups match these filters.' : 'No suggested matchups have been published for this league.'}</p>}
    {plan.windows.map(window => {
      const rows = matchups.filter(row => row.WindowNumber === window.number);
      if (!rows.length) return null;
      return <section key={window.number} className="schedule-window">
        <header><h3>Window {window.number}</h3>
          <span>{formatDate(window.startDate)} - {formatDate(window.endDate)}</span></header>
        <div className="schedule-table-wrap"><table>
          <thead><tr><th>Group</th><th>Team</th><th>Opponent</th>{editing && <th>Actions</th>}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.MatchupId}>
            <td>{plan.groups.find(group => group.GroupId === row.GroupId)?.GroupName || 'Unassigned group'}</td>
            <td>{row.TeamAId ? <Link to={`/team/${row.TeamAId}`}>{row.TeamAName}</Link> : row.TeamAName}</td>
            <td>{row.TeamBId ? <Link to={`/team/${row.TeamBId}`}>{row.TeamBName}</Link> : row.TeamBName}</td>
            {editing && <td><div className="schedule-actions">
              <button type="button" disabled={busy} onClick={() => onEdit(row)}>Edit</button>
              <button type="button" disabled={busy} onClick={() => onRemove(row)}>Remove</button>
            </div></td>}
          </tr>)}</tbody>
        </table></div>
        <details><summary>Series per team in this window</summary><div className="schedule-loads">
          {window.teamLoads.filter(team => teams.some(choice => choice.EntryId === team.EntryId)
            && (teamId === 'all' || String(team.EntryId) === teamId)).map(team => <span key={team.EntryId}>
            {team.TeamName}: <strong>{team.series}</strong>
          </span>)}
        </div></details>
      </section>;
    })}
  </div>;
}
