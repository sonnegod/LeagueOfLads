import { useCallback, useEffect, useState } from 'react';
import './CurrentLeagueTeams.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function GroupHeadToHeadEditor({ refreshKey, onResultsUpdated }) {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [matrix, setMatrix] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState('');

  const loadMatrix = useCallback(async (groupId) => {
    if (!groupId) { setMatrix(null); setDrafts({}); return; }
    const data = await request(`/api/admin/groupMatrix/${groupId}`);
    setMatrix(data);
    setDrafts(Object.fromEntries(data.pairs.map((pair) => [
      `${pair.TeamA}:${pair.TeamB}`, { winsA: String(pair.WinsA), winsB: String(pair.WinsB) },
    ])));
  }, []);

  useEffect(() => {
    let active = true;
    request('/api/admin/standingsGroups').then((data) => {
      if (!active) return;
      const available = data.groups || [];
      setGroups(available);
      setSelectedGroup((current) => available.some((group) => String(group.GroupId) === current)
        ? current : String(available[0]?.GroupId ?? ''));
    }).catch((err) => { if (active) setMessage(err.message); });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    loadMatrix(selectedGroup).catch((err) => { if (active) setMessage(err.message); });
    return () => { active = false; };
  }, [loadMatrix, selectedGroup, refreshKey]);

  const edit = (key, field, value) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  };

  const save = async (pair, clear = false) => {
    const key = `${pair.TeamA}:${pair.TeamB}`;
    const draft = drafts[key];
    const winsA = Number(draft?.winsA);
    const winsB = Number(draft?.winsB);
    if (!clear && (![draft?.winsA, draft?.winsB].every((value) => /^\d+$/.test(value)) ||
      ![winsA, winsB].every(Number.isSafeInteger))) {
      setMessage('Enter non-negative whole-number scores for both teams.');
      return;
    }
    setSaving(key);
    setMessage('');
    try {
      await request('/api/admin/groupResult', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: Number(selectedGroup), teamA: pair.TeamA, teamB: pair.TeamB,
          winsA, winsB, clear }),
      });
      await loadMatrix(selectedGroup);
      setMessage(clear ? 'Recorded game score restored.' : 'Head-to-head score saved.');
      onResultsUpdated?.();
    } catch (err) { setMessage(err.message); }
    finally { setSaving(null); }
  };

  const pairMap = new Map((matrix?.pairs || []).map((pair) => [`${pair.TeamA}:${pair.TeamB}`, pair]));

  return <section className="admin-teams-widget admin-matrix-widget">
    <div className="admin-teams-matrix-heading">
      <div><h2>Group head-to-head</h2><p>Each editable score is row team wins – column team wins. Saving updates records and Neustadtl.</p></div>
      <select aria-label="Matrix group" value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
        {groups.map((group) => <option key={group.GroupId} value={group.GroupId}>{group.GroupName}</option>)}
      </select>
    </div>
    {message && <p role="status" className="admin-teams-message">{message}</p>}
    {!groups.length && <p>Create a group to view its matrix.</p>}
    {matrix && <div className="admin-teams-scroll"><table className="admin-teams-matrix">
      <thead><tr><th>Team</th>{matrix.teams.map((team) => {
        const record = matrix.standings.find((row) => row.TeamId === team.TeamId);
        return <th key={team.TeamId}>{team.TeamName}<small>{record?.Wins ?? 0}–{record?.Losses ?? 0}</small></th>;
      })}</tr></thead>
      <tbody>{matrix.teams.map((row) => <tr key={row.TeamId}>
        <th>{row.TeamName}<small>Neustadtl {matrix.standings.find((team) => team.TeamId === row.TeamId)?.Score ?? 0}</small></th>
        {matrix.teams.map((column) => {
          if (row.TeamId === column.TeamId) return <td key={column.TeamId}>—</td>;
          const key = `${Math.min(row.TeamId, column.TeamId)}:${Math.max(row.TeamId, column.TeamId)}`;
          const pair = pairMap.get(key);
          if (!pair) return <td key={column.TeamId}>—</td>;
          if (row.TeamId > column.TeamId) return <td key={column.TeamId}>{pair.WinsB}–{pair.WinsA}</td>;
          const draft = drafts[key] || { winsA: '0', winsB: '0' };
          const changed = Number(draft.winsA) !== pair.WinsA || Number(draft.winsB) !== pair.WinsB;
          return <td key={column.TeamId}><div className="admin-teams-score">
            <input type="number" min="0" step="1" aria-label={`${row.TeamName} wins against ${column.TeamName}`}
              value={draft.winsA} onChange={(event) => edit(key, 'winsA', event.target.value)} />
            <span>–</span>
            <input type="number" min="0" step="1" aria-label={`${column.TeamName} wins against ${row.TeamName}`}
              value={draft.winsB} onChange={(event) => edit(key, 'winsB', event.target.value)} />
          </div><div className="admin-teams-score-actions">
            <button type="button" disabled={!changed || saving !== null} onClick={() => save(pair)}>Save</button>
            {pair.Overridden && <button type="button" disabled={saving !== null} onClick={() => save(pair, true)}
              title={`Recorded games: ${pair.ActualWinsA}–${pair.ActualWinsB}`}>Use games</button>}
          </div>{pair.Overridden && <small>Override · games {pair.ActualWinsA}–{pair.ActualWinsB}</small>}
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
