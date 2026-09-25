import { useCallback, useEffect, useState } from 'react';

export default function MatchTeamIdReplacementCard({ refreshKey, onUpdated }) {
  const [league, setLeague] = useState(null);
  const [sources, setSources] = useState([]);
  const [targets, setTargets] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (signal) => {
    const response = await fetch('/api/admin/matchTeamIdOptions', { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load team IDs');
    setLeague(data.league);
    setSources(data.sources || []);
    setTargets(data.targets || []);
    setSourceId((current) => data.sources?.some((team) => String(team.TeamId) === current) ? current : '');
    setTargetId((current) => data.targets?.some((team) => String(team.TeamId) === current) ? current : '');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load(controller.signal)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, refreshKey]);

  const selectedSource = sources.find((team) => String(team.TeamId) === sourceId);
  const selectedTarget = targets.find((team) => String(team.TeamId) === targetId);

  async function replaceTeamId(event) {
    event.preventDefault();
    if (!selectedSource || !selectedTarget) return;
    if (!window.confirm(`Replace team ID ${sourceId} with ${targetId} in all ${selectedSource.MatchesPlayed} active-league matches?`)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/replaceMatchTeamId', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: Number(sourceId), targetId: Number(targetId) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to replace team ID');
      setSourceId('');
      setTargetId('');
      setMessage(`Updated ${data.matches} matches, ${data.players} player rows, and ${data.series} series.`);
      onUpdated?.();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={cardStyle} aria-labelledby="replace-match-team-id-heading">
      <h3 id="replace-match-team-id-heading" style={{ marginTop: 0 }}>Replace Match Team ID</h3>
      <p style={hintStyle}>Move an ungrouped team's active-league matches to a team already in a group.</p>
      {error && <p role="alert" style={errorStyle}>{error}</p>}
      {message && <p role="status" style={successStyle}>{message}</p>}
      {loading ? <p>Loading team IDs...</p> : !league ? <p>No active league found.</p> : (
        <form onSubmit={replaceTeamId} style={formStyle}>
          <label htmlFor="replacement-source-id">Ungrouped team ID</label>
          <select id="replacement-source-id" required value={sourceId}
            onChange={(event) => setSourceId(event.target.value)} style={inputStyle}>
            <option value="">Select team to replace</option>
            {sources.map((team) => (
              <option key={team.TeamId} value={team.TeamId}>
                {team.TeamName} ({team.TeamId}) - {team.MatchesPlayed} matches
              </option>
            ))}
          </select>
          {sources.length === 0 && <p style={hintStyle}>No ungrouped teams have matches in this league.</p>}

          <label htmlFor="replacement-target-id">Grouped team ID</label>
          <select id="replacement-target-id" required value={targetId}
            onChange={(event) => setTargetId(event.target.value)} style={inputStyle}>
            <option value="">Select replacement team</option>
            {targets.map((team) => (
              <option key={team.TeamId} value={team.TeamId}>
                {team.TeamName} ({team.TeamId}) - {team.GroupName || `Group ${team.GroupId}`}
              </option>
            ))}
          </select>

          {selectedSource && <p style={hintStyle}>This will update all {selectedSource.MatchesPlayed} active-league matches for team {selectedSource.TeamId}.</p>}
          <button type="submit" disabled={saving || !selectedSource || !selectedTarget}>
            {saving ? 'Replacing...' : 'Replace Team ID'}
          </button>
        </form>
      )}
    </section>
  );
}

const cardStyle = {
  minHeight: '450px',
  border: '1px solid var(--border, #ccc)',
  borderRadius: '8px',
  padding: '16px',
  boxSizing: 'border-box',
  background: 'var(--surface, #0b0b0b)',
};
const formStyle = { display: 'grid', gap: '10px' };
const inputStyle = {
  width: '100%',
  padding: '10px',
  border: '1px solid var(--border, #222428)',
  borderRadius: '6px',
  background: 'var(--button-bg, #1a1a1a)',
  color: 'var(--text, #e6e6e6)',
};
const hintStyle = { color: 'var(--muted-text, #9aa0b4)', margin: '4px 0' };
const errorStyle = { color: '#e57373' };
const successStyle = { color: '#8bd49c' };
