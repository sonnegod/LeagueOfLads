import { useEffect, useState } from 'react';

const emptyRules = { UpperBracketTeams: 0, LowerBracketTeams: 0, EliminatedTeams: 0, HasTiebreaker: false, TiebreakerPosition: '' };

export default function LeagueRulesCard({ refreshKey, seasonId }) {
  const [league, setLeague] = useState(null);
  const [rules, setRules] = useState(emptyRules);
  const [exists, setExists] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetch(seasonId ? `/api/admin/seasons/${seasonId}/rules` : '/api/admin/leagueRules')
      .then((res) => res.json()).then((data) => {
      if (!active) return;
      setLeague(data.league || null);
      setRules(emptyRules);
      setExists(false);
      if (data.rules) {
        setRules({ ...data.rules, HasTiebreaker: Boolean(data.rules.HasTiebreaker) });
        setExists(true);
      }
    }).catch(() => { if (active) setMessage('Unable to load league rules.'); });
    return () => { active = false; };
  }, [refreshKey, seasonId]);

  const setNumber = (key, value) => setRules((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setMessage('');
    const response = await fetch(seasonId ? `/api/admin/seasons/${seasonId}/rules` : '/api/admin/leagueRules', {
      method: seasonId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rules),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || 'Unable to save rules.');
    setRules({ ...data.rules, HasTiebreaker: Boolean(data.rules.HasTiebreaker) });
    setExists(true);
    setMessage('League rules saved.');
  };

  return (
    <section style={cardStyle}>
      <h2>League Rules</h2>
      {!seasonId && <p>{league ? `${league.LeagueName} (${league.LeagueId})` : 'No active league'}</p>}
      {!exists && <p>No saved rules exist. Enter values to create them.</p>}
      <div style={gridStyle}>
        {['UpperBracketTeams', 'LowerBracketTeams', 'EliminatedTeams'].map((key) => (
          <label key={key} style={fieldStyle}>
            {labels[key]}
            <input style={inputStyle} type="number" min="0" value={rules[key]} onChange={(e) => setNumber(key, e.target.value)} />
          </label>
        ))}
        <label style={checkboxFieldStyle}>
          <input style={checkboxStyle} type="checkbox" checked={rules.HasTiebreaker}
            onChange={(e) => setRules((current) => ({ ...current, HasTiebreaker: e.target.checked }))} />
          <span>Has tiebreaker</span>
        </label>
        {rules.HasTiebreaker && <label style={fieldStyle}>Tiebreaker position<input style={inputStyle} type="number" min="1" value={rules.TiebreakerPosition} onChange={(e) => setNumber('TiebreakerPosition', e.target.value)} /></label>}
      </div>
      <button className="ui-button-primary" type="button" onClick={save} disabled={!seasonId && !league}>Save Rules</button>
      {message && <p>{message}</p>}
    </section>
  );
}

const labels = { UpperBracketTeams: 'Upper bracket teams', LowerBracketTeams: 'Lower bracket teams', EliminatedTeams: 'Eliminated teams' };
const cardStyle = { border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 16 };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 };
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
const checkboxFieldStyle = { display: 'flex', alignItems: 'center', alignSelf: 'end', minHeight: 38,
  gap: 8, fontSize: '1.05rem' };
const checkboxStyle = { width: 20, height: 20, margin: 0, padding: 0, flex: 'none' };
const inputStyle = { background: '#fff', color: '#111', border: '1px solid #bbb', borderRadius: 6, padding: '8px 10px' };
