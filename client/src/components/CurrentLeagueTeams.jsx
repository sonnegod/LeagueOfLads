import { useCallback, useEffect, useState } from 'react';
import './CurrentLeagueTeams.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function CurrentLeagueTeams({ refreshKey, onTeamUpdated }) {
  const [teams, setTeams] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [teamData, groupData] = await Promise.all([
      request('/api/admin/currentLeagueTeams'), request('/api/admin/standingsGroups'),
    ]);
    const rows = teamData.result || [];
    setTeams(rows);
    setDrafts(Object.fromEntries(rows.map((team) => [team.TeamId, {
      teamId: String(team.TeamId), teamName: team.TeamName || '',
      groupId: team.GroupId == null ? '' : String(team.GroupId),
    }])));
    setGroups(groupData.groups || []);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().catch((err) => { if (active) setMessage(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, refreshKey]);

  const edit = (teamId, key, value) => {
    setDrafts((current) => ({ ...current, [teamId]: { ...current[teamId], [key]: value } }));
  };

  const save = async (teamId) => {
    const draft = drafts[teamId];
    if (!draft?.teamName.trim()) { setMessage('Team name is required.'); return; }
    if (!/^[1-9]\d*$/.test(draft.teamId) || !Number.isSafeInteger(Number(draft.teamId))) {
      setMessage('Enter a positive whole-number team ID.');
      return;
    }
    setSaving(teamId);
    setMessage('');
    try {
      await request('/api/admin/leagueTeam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalTeamId: teamId, teamId: Number(draft.teamId),
          teamName: draft.teamName.trim(), groupId: draft.groupId || null,
        }),
      });
      await load();
      setMessage('Team saved.');
      onTeamUpdated?.();
    } catch (err) { setMessage(err.message); }
    finally { setSaving(null); }
  };

  return <section className="admin-teams-widget">
    <h2>League teams</h2>
    <p>Edit a team ID, name, or group, then save the row. Changing an ID updates its leaderboard link; match records keep their original IDs.</p>
    {message && <p role="status" className="admin-teams-message">{message}</p>}
    {loading ? <p>Loading teams...</p> : <div className="admin-teams-scroll">
      <table className="admin-teams-table">
        <thead><tr><th>Team ID</th><th>Team name</th><th>Group</th><th>Action</th></tr></thead>
        <tbody>{teams.map((team) => {
          const draft = drafts[team.TeamId] || { teamId: '', teamName: '', groupId: '' };
          const changed = draft.teamId !== String(team.TeamId) ||
            draft.teamName !== team.TeamName || draft.groupId !== String(team.GroupId ?? '');
          return <tr key={team.TeamId}>
            <td><input aria-label={`Team ID for ${team.TeamName}`} className="admin-teams-id-input"
              type="text" inputMode="numeric" pattern="[0-9]*" value={draft.teamId}
              onChange={(event) => edit(team.TeamId, 'teamId', event.target.value)} /></td>
            <td><input aria-label={`Name for team ${team.TeamId}`} maxLength="60" value={draft.teamName}
              onChange={(event) => edit(team.TeamId, 'teamName', event.target.value)} /></td>
            <td><select aria-label={`Group for team ${team.TeamId}`} value={draft.groupId}
              onChange={(event) => edit(team.TeamId, 'groupId', event.target.value)}>
              <option value="">Unassigned</option>
              {groups.map((group) => <option key={group.GroupId} value={group.GroupId}>{group.GroupName}</option>)}
            </select></td>
            <td className="admin-teams-actions">
              <button className="ui-button-primary" type="button" disabled={!changed || saving !== null} onClick={() => save(team.TeamId)}>
                {saving === team.TeamId ? 'Saving...' : 'Save'}</button>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </section>;
}
