import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { prepareScreenshot, readScreenshot, screenshotValidationError } from '../utils/screenshotUpload';
import { isValidProfileUrl, scrubProfileUrl } from '../utils/profileUrl';
import './SignupPage.css';

const emptyPlayer = () => ({ search: '', playerId: '', playerName: '', mmr: '',
  dotaProfileUrl: '', screenshot: null, adjusted: false, candidates: [] });

async function signupRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { /* A proxy can return HTML for rejected uploads. */ }
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error('An individual screenshot upload was rejected as too large. Try a smaller image.');
    }
    throw new Error(data?.error || `Signup request failed (HTTP ${response.status}). Please try again.`);
  }
  if (!data) throw new Error(`Signup server returned an unexpected response (HTTP ${response.status}).`);
  return data;
}

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
  const [uploadedPlayers, setUploadedPlayers] = useState(0);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [screenshotErrors, setScreenshotErrors] = useState(Array(5).fill(null));
  const [screenshotProgress, setScreenshotProgress] = useState(Array(5).fill(false));
  const [screenshotNotes, setScreenshotNotes] = useState(Array(5).fill(null));
  const [screenshotPreviews, setScreenshotPreviews] = useState(Array(5).fill(null));
  const screenshotRequests = useRef(Array(5).fill(0));
  const previewUrls = useRef(Array(5).fill(null));
  const [submittedId, setSubmittedId] = useState(null);

  useEffect(() => () => {
    screenshotRequests.current = screenshotRequests.current.map(request => request + 1);
    previewUrls.current.forEach(url => { if (url) URL.revokeObjectURL(url); });
  }, []);

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
    setValidationErrors([]);
    setPlayers(current => current.map((player, slot) => slot === index ? { ...player, ...patch } : player));
  }

  async function selectScreenshot(index, event) {
    const input = event.currentTarget;
    const selected = input.files?.[0] || null;
    const request = ++screenshotRequests.current[index];
    if (previewUrls.current[index]) URL.revokeObjectURL(previewUrls.current[index]);
    previewUrls.current[index] = null;
    setScreenshotPreviews(current => current.map((value, slot) => slot === index ? null : value));
    setError('');
    setScreenshotErrors(current => current.map((value, slot) => slot === index ? null : value));
    setScreenshotNotes(current => current.map((value, slot) => slot === index ? null : value));
    change(index, { screenshot: null });
    if (!selected) {
      setScreenshotProgress(current => current.map((value, slot) => slot === index ? false : value));
      return;
    }
    setScreenshotProgress(current => current.map((value, slot) => slot === index ? true : value));
    try {
      const prepared = await prepareScreenshot(selected);
      if (screenshotRequests.current[index] !== request) return;
      change(index, { screenshot: prepared.file });
      if (typeof URL.createObjectURL === 'function') {
        const previewUrl = URL.createObjectURL(prepared.file);
        previewUrls.current[index] = previewUrl;
        setScreenshotPreviews(current => current.map((value, slot) => slot === index
          ? previewUrl : value));
      }
      if (prepared.compressed) {
        const mb = bytes => (bytes / (1024 * 1024)).toFixed(1);
        setScreenshotNotes(current => current.map((value, slot) => slot === index
          ? `Optimized from ${mb(prepared.originalBytes)} MB to ${mb(prepared.file.size)} MB. Check that the MMR is readable below.` : value));
      }
    } catch (uploadError) {
      if (screenshotRequests.current[index] !== request) return;
      input.value = '';
      setScreenshotErrors(current => current.map((value, slot) => slot === index
        ? uploadError.message : value));
    } finally {
      if (screenshotRequests.current[index] === request) {
        setScreenshotProgress(current => current.map((value, slot) => slot === index ? false : value));
      }
    }
  }

  function validate() {
    const issues = [];
    if (screenshotProgress.some(Boolean)) issues.push('Wait for screenshots to finish optimizing.');
    const ids = new Set();
    const name = teamName.trim();
    if (!name) issues.push('Enter a team name.');
    else if (name.length > 60) issues.push('Team name must be 60 characters or fewer.');

    players.forEach((player, index) => {
      const label = `Player ${index + 1}`;
      const playerId = Number(player.playerId);
      if (!Number.isSafeInteger(playerId) || playerId <= 0) {
        issues.push(`${label}: enter a valid account ID.`);
      } else if (ids.has(playerId)) {
        issues.push(`${label}: this account ID is already used in the roster.`);
      } else {
        ids.add(playerId);
      }

      const mmr = Number(player.mmr);
      if (!Number.isSafeInteger(mmr) || mmr < 5500) {
        issues.push(`${label}: MMR must be a whole number of at least 5,500.`);
      }
      if (!isValidProfileUrl(player.dotaProfileUrl)) {
        issues.push(`${label}: enter a valid HTTP(S) player profile URL.`);
      }
      const screenshotIssue = screenshotErrors[index] || screenshotValidationError(player.screenshot);
      if (screenshotIssue) issues.push(`${label}: ${screenshotIssue}`);
    });

    if (user?.accountId && !ids.has(Number(user.accountId))) {
      issues.push('Your own Steam account must be one of the five players.');
    }
    return issues;
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
    setError('');
    const issues = validate();
    setValidationErrors(issues);
    if (issues.length) return;

    setBusy(true);
    setUploadedPlayers(0);
    let draftId;
    try {
      const base = `/api/signup/${seasonId}/drafts`;
      ({ draftId } = await signupRequest(base, { method: 'POST' }));
      for (const [index, player] of players.entries()) {
        try {
          await signupRequest(`${base}/${draftId}/players/${index}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playerId: player.playerId,
              playerName: player.playerName,
              mmr: player.mmr,
              dotaProfileUrl: scrubProfileUrl(player.dotaProfileUrl),
              screenshot: await readScreenshot(player.screenshot),
            }),
          });
        } catch (uploadError) {
          throw new Error(`Player ${index + 1}: ${uploadError.message}`);
        }
        setUploadedPlayers(index + 1);
      }
      const data = await signupRequest(`${base}/${draftId}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName }),
      });
      setSubmittedId(data.teamSubmissionId);
      draftId = null;
    } catch (err) {
      setError(err.message);
      if (draftId) {
        fetch(`/api/signup/${seasonId}/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {});
      }
    } finally {
      setBusy(false);
      setUploadedPlayers(0);
    }
  }

  if (loading || authLoading) return <div className="ui-page">Loading signup...</div>;
  if (!season) return <div className="ui-page" role="alert">{error || 'Signups are closed.'}</div>;

  return <main className="ui-page signup-page">
    {preview && <p role="status">Admin preview. This form cannot be submitted while it is a draft.</p>}
    <h1>{season.SignupTitle}</h1>
    <p>{season.SignupDescription}</p>
    <p>Submit one team with five players, including yourself. Each player needs a public profile link and an MMR screenshot. Large screenshots are optimized automatically. Submissions cannot be edited after sending.</p>
    {!user ? <a className="ui-button-primary signup-login" href={`/api/auth/steam?returnTo=${encodeURIComponent(`/signup/${seasonId}`)}`}>
      Sign in with Steam to sign up
    </a> : submittedId ? <div role="status" className="signup-success">
      Your team was submitted. Submission #{submittedId}.
    </div> : <form onSubmit={submit} className="signup-form" noValidate>
      <label htmlFor="signup-team-name">Team name</label>
      <input id="signup-team-name" maxLength="60" required value={teamName} disabled={busy}
        onChange={event => { setTeamName(event.target.value); setValidationErrors([]); }} />
      {players.map((player, index) => <fieldset key={index} className="signup-player">
        <legend>Player {index + 1}</legend>
        <label htmlFor={`signup-search-${index}`}>Search player name or Steam ID</label>
        <input id={`signup-search-${index}`} value={player.search} disabled={busy}
          onChange={event => search(index, event.target.value)} autoComplete="off" />
        {player.candidates.length > 0 && <div className="signup-candidates">
          {player.candidates.map(candidate => <button type="button" key={candidate.PlayerId} disabled={busy}
            onClick={() => choose(index, candidate)}>
            {candidate.PlayerName} ({candidate.PlayerId}){candidate.AdjustedMMR ? ` · adjusted MMR ${candidate.AdjustedMMR}` : ''}
          </button>)}
        </div>}
        <div className="signup-fields">
          <label>Steam ID
            <input type="number" min="1" step="1" required value={player.playerId} disabled={busy}
              onChange={event => change(index, { playerId: event.target.value, adjusted: false, mmr: '' })} />
          </label>
          <label>Player name {player.playerName ? '' : '(required for a new player)'}
            <input maxLength="40" value={player.playerName} disabled={busy}
              onChange={event => change(index, { playerName: event.target.value })} />
          </label>
          <label>MMR {player.adjusted && <small>Set by admins</small>}
            <input type="number" min="5500" step="1" required value={player.mmr} disabled={busy}
              readOnly={player.adjusted} onChange={event => change(index, { mmr: event.target.value })} />
          </label>
          <label>Player profile URL
            <input type="text" inputMode="url" autoCapitalize="none" spellCheck="false"
              placeholder="dotabuff.com/players/12345678" maxLength="500" required
              value={player.dotaProfileUrl} disabled={busy}
              onChange={event => change(index, { dotaProfileUrl: event.target.value })}
              onBlur={event => change(index, { dotaProfileUrl: scrubProfileUrl(event.target.value) })} />
            <small>Dotabuff, OpenDota, Stratz, Steam, or another HTTP(S) profile link.</small>
          </label>
          <label>MMR screenshot (JPEG, PNG, or WebP; larger images optimized automatically)
            <input type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy}
              aria-invalid={Boolean(screenshotErrors[index])}
              onChange={event => selectScreenshot(index, event)} />
            {screenshotProgress[index] && <small role="status">Optimizing screenshot...</small>}
            {screenshotNotes[index] && <small role="status">{screenshotNotes[index]}</small>}
            {screenshotPreviews[index] && <img className="signup-screenshot-preview"
              src={screenshotPreviews[index]} alt={`Player ${index + 1} MMR screenshot preview`} />}
            {screenshotErrors[index] && <small className="signup-error" role="alert">
              {screenshotErrors[index]}
            </small>}
          </label>
        </div>
      </fieldset>)}
      {validationErrors.length > 0 && <div role="alert" className="signup-validation-summary">
        <strong>Please fix the following before submitting:</strong>
        <ul>{validationErrors.map(message => <li key={message}>{message}</li>)}</ul>
      </div>}
      {error && <p role="alert" className="signup-error">{error}</p>}
      {busy && <p role="status">{uploadedPlayers < 5
        ? `Uploading player ${uploadedPlayers + 1} of 5...`
        : 'Finalizing team submission...'}</p>}
      <button className="ui-button-primary" type="submit"
        disabled={busy || preview || screenshotProgress.some(Boolean)}>
        {preview ? 'Preview only' : screenshotProgress.some(Boolean)
          ? 'Optimizing screenshots...' : busy ? `Submitting ${uploadedPlayers}/5...` : 'Submit team'}
      </button>
    </form>}
  </main>;
}
