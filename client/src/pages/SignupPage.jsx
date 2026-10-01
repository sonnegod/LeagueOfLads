import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MAX_SCREENSHOT_BYTES, readScreenshot } from '../utils/screenshotUpload';
import './SignupPage.css';

const emptyPlayer = () => ({ search: '', playerId: '', playerName: '', mmr: '',
  dotaProfileUrl: '', screenshot: null, adjusted: false, candidates: [] });

export default function SignupPage() {
  const { seasonId } = useParams();
  const [searchParams] = useSearchParams();
  const preview = searchParams.get('preview') === '1';
  const { user, loading: authLoading } = useAuth();
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [players, setPlayers] = useState(Array.from({ length: 5 }, emptyPlayer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submittedId, setSubmittedId] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(preview ? `/api/admin/seasons/${seasonId}/signupPreview` : `/api/signup/${seasonId}`)
      .then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Signups are closed');
      return data;
    }).then(data => { if (active) setSeason(data.season); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [seasonId, preview]);

  useEffect(() => {
    if (!user?.accountId || !season) return undefined;
    let active = true;
    fetch(`/api/signup/players?search=${encodeURIComponent(user.accountId)}`)
      .then(response => response.json()).then(data => {
        if (!active) return;
        const existing = data.players?.find(player => String(player.PlayerId) === String(user.accountId));
        setPlayers(current => {
          if (current[0].playerId) return current;
          const captain = { ...current[0], playerId: String(user.accountId),
            playerName: existing?.PlayerName || user.personaname || '',
            search: `${existing?.PlayerName || user.personaname || 'Captain'} (${user.accountId})`,
            mmr: existing?.AdjustedMMR ? String(existing.AdjustedMMR) : '',
            adjusted: Boolean(existing?.AdjustedMMR) };
          return [captain, ...current.slice(1)];
        });
      }).catch(() => {});
    return () => { active = false; };
  }, [user?.accountId, user?.personaname, season]);

  function change(index, patch) {
    setPlayers(current => current.map((player, slot) => slot === index ? { ...player, ...patch } : player));
  }

  async function search(index, value) {
    change(index, { search: value, candidates: [], playerId: '', playerName: '', mmr: '', adjusted: false });
    if (!value.trim()) return;
    try {
      const response = await fetch(`/api/signup/players?search=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (response.ok) setPlayers(current => current.map((player, slot) =>
        slot === index && player.search === value ? { ...player, candidates: data.players } : player));
    } catch { /* The user can retry the search. */ }
  }

  function choose(index, player) {
    change(index, { playerId: String(player.PlayerId), playerName: player.PlayerName,
      search: `${player.PlayerName} (${player.PlayerId})`, candidates: [],
      mmr: player.AdjustedMMR ? String(player.AdjustedMMR) : '',
      adjusted: Boolean(player.AdjustedMMR) });
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const roster = await Promise.all(players.map(async player => ({
        playerId: player.playerId,
        playerName: player.playerName,
        mmr: player.mmr,
        dotaProfileUrl: player.dotaProfileUrl,
        screenshot: await readScreenshot(player.screenshot),
      })));
      const response = await fetch(`/api/signup/${seasonId}/teams`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName, players: roster }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Submission failed');
      setSubmittedId(data.teamSubmissionId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || authLoading) return <div className="ui-page">Loading signup...</div>;
  if (!season) return <div className="ui-page" role="alert">{error || 'Signups are closed.'}</div>;

  return <main className="ui-page signup-page">
    {preview && <p role="status">Admin preview. This form cannot be submitted while it is a draft.</p>}
    <h1>{season.SignupTitle}</h1>
    <p>{season.SignupDescription}</p>
    <p>Submit one team with five players, including yourself. Each player needs a Dotabuff link and an MMR screenshot. Submissions cannot be edited after sending.</p>
    {!user ? <a className="ui-button-primary signup-login" href={`/api/auth/steam?returnTo=${encodeURIComponent(`/signup/${seasonId}`)}`}>
      Sign in with Steam to sign up
    </a> : submittedId ? <div role="status" className="signup-success">
      Your team was submitted. Submission #{submittedId}.
    </div> : <form onSubmit={submit} className="signup-form">
      <label htmlFor="signup-team-name">Team name</label>
      <input id="signup-team-name" maxLength="60" required value={teamName}
        onChange={event => setTeamName(event.target.value)} />
      {players.map((player, index) => <fieldset key={index} className="signup-player">
        <legend>Player {index + 1}</legend>
        <label htmlFor={`signup-search-${index}`}>Search player name or Steam ID</label>
        <input id={`signup-search-${index}`} value={player.search}
          onChange={event => search(index, event.target.value)} autoComplete="off" />
        {player.candidates.length > 0 && <div className="signup-candidates">
          {player.candidates.map(candidate => <button type="button" key={candidate.PlayerId}
            onClick={() => choose(index, candidate)}>
            {candidate.PlayerName} ({candidate.PlayerId}){candidate.AdjustedMMR ? ` · adjusted MMR ${candidate.AdjustedMMR}` : ''}
          </button>)}
        </div>}
        <div className="signup-fields">
          <label>Steam ID
            <input type="number" min="1" step="1" required value={player.playerId}
              onChange={event => change(index, { playerId: event.target.value, adjusted: false, mmr: '' })} />
          </label>
          <label>Player name {player.playerName ? '' : '(required for a new player)'}
            <input maxLength="40" value={player.playerName}
              onChange={event => change(index, { playerName: event.target.value })} />
          </label>
          <label>MMR {player.adjusted && <small>Set by admins</small>}
            <input type="number" min="5500" step="1" required value={player.mmr}
              readOnly={player.adjusted} onChange={event => change(index, { mmr: event.target.value })} />
          </label>
          <label>Dotabuff URL
            <input type="url" maxLength="500" required value={player.dotaProfileUrl}
              onChange={event => change(index, { dotaProfileUrl: event.target.value })} />
          </label>
          <label>MMR screenshot (JPEG, PNG; 2 MB max)
            <input type="file" accept="image/jpeg,image/png,image/webp" required
              onChange={event => {
                const file = event.target.files?.[0] || null;
                if (file && file.size > MAX_SCREENSHOT_BYTES) {
                  setError(`Player ${index + 1}: screenshot must be 2 MB or less.`);
                  event.target.value = '';
                  change(index, { screenshot: null });
                } else {
                  setError('');
                  change(index, { screenshot: file });
                }
              }} />
          </label>
        </div>
      </fieldset>)}
      {error && <p role="alert" className="signup-error">{error}</p>}
      <button className="ui-button-primary" type="submit" disabled={busy || preview}>
        {preview ? 'Preview only' : busy ? 'Submitting...' : 'Submit team'}
      </button>
    </form>}
  </main>;
}
