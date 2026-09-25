import { useCallback, useEffect, useRef, useState } from 'react';
import './LeagueSetupTable.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function LeagueSetupTable({ refreshKey, onUpdated }) {
  const [league, setLeague] = useState(null);
  const [groups, setGroups] = useState([]);
  const [availableTeams, setAvailableTeams] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupNames, setGroupNames] = useState({});
  const [teamNames, setTeamNames] = useState({});
  const [newTeamNames, setNewTeamNames] = useState({});
  const [linkChoices, setLinkChoices] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState('');
  const loadedLeagueId = useRef(null);

  const load = useCallback(async () => {
    const data = await request('/api/admin/leagueSetup');
    const loadedGroups = data.groups || [];
    const leagueChanged = loadedLeagueId.current !== (data.league?.LeagueId ?? null);
    loadedLeagueId.current = data.league?.LeagueId ?? null;
    setLeague(data.league);
    setGroups(loadedGroups);
    setAvailableTeams(data.availableTeams || []);
    setGroupNames((current) => Object.fromEntries(loadedGroups.map((group) => [
      group.GroupId, leagueChanged ? group.GroupName : (current[group.GroupId] ?? group.GroupName),
    ])));
    setTeamNames((current) => Object.fromEntries(loadedGroups.flatMap((group) =>
      group.teams.filter((team) => team.EntryId != null).map((team) => [
        team.EntryId, leagueChanged ? team.TeamName : (current[team.EntryId] ?? team.TeamName),
      ]))));
    if (leagueChanged) {
      setNewGroupName('');
      setNewTeamNames({});
      setLinkChoices({});
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().catch((err) => { if (active) setMessage(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, refreshKey]);

  const run = async (key, action, successMessage) => {
    setSaving(key);
    setMessage('');
    try {
      await action();
      await load();
      setMessage(successMessage);
      onUpdated?.();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(null);
    }
  };

  const addGroup = (event) => {
    event.preventDefault();
    const groupName = newGroupName.trim();
    if (!groupName) { setMessage('Enter a group name.'); return; }
    run('group:new', async () => {
      await request('/api/admin/leagueSetup/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName }),
      });
      setNewGroupName('');
    }, `${groupName} added.`);
  };

  const renameGroup = (group) => {
    const groupName = (groupNames[group.GroupId] || '').trim();
    if (!groupName) { setMessage('Group name cannot be empty.'); return; }
    run(`group:${group.GroupId}`, () => request(`/api/admin/leagueSetup/groups/${group.GroupId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName }),
    }), 'Group name saved.');
  };

  const addTeam = (event, group) => {
    event.preventDefault();
    const displayName = (newTeamNames[group.GroupId] || '').trim();
    if (!displayName) { setMessage('Enter a team name.'); return; }
    run(`team:new:${group.GroupId}`, async () => {
      await request('/api/admin/leagueRosterEntries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.GroupId, displayName }),
      });
      setNewTeamNames((current) => ({ ...current, [group.GroupId]: '' }));
    }, `${displayName} added to ${group.GroupName}.`);
  };

  const renameTeam = (team) => {
    const displayName = (teamNames[team.EntryId] || '').trim();
    if (!displayName) { setMessage('Team name cannot be empty.'); return; }
    run(`team:${team.EntryId}`, () => request(`/api/admin/leagueRosterEntries/${team.EntryId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    }), 'Team name saved.');
  };

  const removeTeam = (team) => run(`team:${team.EntryId}`,
    () => request(`/api/admin/leagueRosterEntries/${team.EntryId}`, { method: 'DELETE' }),
    `${team.TeamName} removed.`);

  const linkTeam = (team) => {
    const teamId = Number(linkChoices[team.EntryId]);
    if (!Number.isSafeInteger(teamId) || teamId <= 0) {
      setMessage('Choose a team ID to link.');
      return;
    }
    run(`team:link:${team.EntryId}`, () => request(`/api/admin/leagueRosterEntries/${team.EntryId}/link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId }),
    }), `${team.TeamName} linked to TeamId ${teamId}.`);
  };

  const rowCount = Math.max(1, ...groups.map((group) => group.teams.length + 1));

  return <section className="league-setup-widget">
    <h2>Initial group setup</h2>
    <p>Add groups and team names before Dota TeamIds are available.</p>
    {message && <p role="status" className="league-setup-message">{message}</p>}
    {loading ? <p>Loading groups...</p> : <div className="league-setup-scroll">
      <table className="league-setup-table" style={{ minWidth: `${Math.max(360, groups.length * 320)}px` }}>
        <thead>
          <tr><th colSpan={Math.max(groups.length, 1)} className="league-setup-add-heading">
            <form onSubmit={addGroup} className="league-setup-add-group">
              <label htmlFor="league-setup-new-group">Add group</label>
              <input id="league-setup-new-group" type="text" maxLength="60" placeholder="Group name"
                value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)}
                disabled={!league || saving !== null} />
              <button type="submit" disabled={!league || saving !== null || !newGroupName.trim()}>
                {saving === 'group:new' ? 'Adding...' : 'Add group'}
              </button>
            </form>
            {!league && <small>Add an active league first.</small>}
          </th></tr>
          {groups.length > 0 && <tr>{groups.map((group) => {
            const draft = groupNames[group.GroupId] ?? group.GroupName;
            return <th key={group.GroupId} scope="col" className="league-setup-group-heading">
              <div className="league-setup-group-title">
                <input aria-label={`Name for group ${group.GroupId}`} type="text" maxLength="60"
                  value={draft} onChange={(event) => setGroupNames((current) => ({
                    ...current, [group.GroupId]: event.target.value,
                  }))} />
                <button type="button" disabled={saving !== null || draft.trim() === group.GroupName}
                  onClick={() => renameGroup(group)}>Save</button>
              </div>
              <small>Group {group.GroupId}</small>
            </th>;
          })}</tr>}
        </thead>
        <tbody>{groups.length === 0
          ? <tr><td className="league-setup-empty">Add a group to start the leaderboard.</td></tr>
          : Array.from({ length: rowCount }, (_, rowIndex) => <tr key={rowIndex}>
            {groups.map((group) => {
              const team = group.teams[rowIndex];
              if (team) return <td key={group.GroupId}>
                {team.EntryId != null && team.TeamId == null ? <div className="league-setup-team-row">
                  <input aria-label={`Name for team ${team.EntryId}`} type="text" maxLength="60"
                    value={teamNames[team.EntryId] ?? team.TeamName}
                    onChange={(event) => setTeamNames((current) => ({
                      ...current, [team.EntryId]: event.target.value,
                    }))} />
                  <div className="league-setup-row-actions">
                    <button type="button" disabled={saving !== null ||
                      (teamNames[team.EntryId] ?? team.TeamName).trim() === team.TeamName}
                      onClick={() => renameTeam(team)}>Save</button>
                    <button type="button" disabled={saving !== null} onClick={() => removeTeam(team)}>Remove</button>
                  </div>
                  <small>Awaiting TeamId</small>
                  {availableTeams.length > 0 && <div className="league-setup-link-row">
                    <select aria-label={`Team ID for ${team.TeamName}`}
                      value={linkChoices[team.EntryId] || ''}
                      onChange={(event) => setLinkChoices((current) => ({
                        ...current, [team.EntryId]: event.target.value,
                      }))}>
                      <option value="">Choose unassigned played team</option>
                      {availableTeams.map((candidate) => <option key={candidate.TeamId} value={candidate.TeamId}>
                        {candidate.TeamName || 'Unknown name'} (ID {candidate.TeamId})
                      </option>)}
                    </select>
                    <button type="button" disabled={saving !== null || !linkChoices[team.EntryId]}
                      onClick={() => linkTeam(team)}>Link</button>
                  </div>}
                </div> : <div className="league-setup-linked-team">
                  <strong>{team.TeamName}</strong>
                  <small>{team.Wins}-{team.Losses} | TeamId {team.TeamId}</small>
                </div>}
              </td>;
              if (rowIndex === group.teams.length) return <td key={group.GroupId}>
                <form className="league-setup-new-team" onSubmit={(event) => addTeam(event, group)}>
                  <input aria-label={`Add team to ${group.GroupName}`} type="text" maxLength="60"
                    placeholder="Add team name" value={newTeamNames[group.GroupId] || ''}
                    onChange={(event) => setNewTeamNames((current) => ({
                      ...current, [group.GroupId]: event.target.value,
                    }))} />
                  <button type="submit" disabled={saving !== null || !(newTeamNames[group.GroupId] || '').trim()}>
                    {saving === `team:new:${group.GroupId}` ? 'Adding...' : 'Add team'}
                  </button>
                </form>
              </td>;
              return <td key={group.GroupId} />;
            })}
          </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
