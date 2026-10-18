import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import MatchResultBadge from './MatchResultBadge';
import { trackSiteEvent } from '../utils/siteAnalytics';
import './LeagueSeriesTab.css';

function HeroIcon({ heroId, heroName, action, iconSize = 24 }) {
  const label = `${action ? `${action}: ` : ''}${heroName || `Hero ${heroId}`}`;
  return <Link className="league-match-hero-link" to={`/hero/${heroId}`} title={label} aria-label={label}>
    <HeroDisplay heroId={heroId} heroName={heroName} iconSize={iconSize} showName={false} link={false} />
  </Link>;
}

function DraftHeroCell({ entry, colSpan, iconSize = 32 }) {
  if (!entry) return <td />;
  const isPick = Number(entry.IsPick) === 1;
  const side = entry.Team == null ? null : Number(entry.Team);
  const order = entry.OrderNum == null ? null : Number(entry.OrderNum);
  const draftOrder = Number.isInteger(order) && order >= 0 ? order + 1 : null;
  const action = `${side === 0 ? 'Radiant' : side === 1 ? 'Dire' : 'Side unavailable'} ${isPick ? 'pick' : 'ban'}, draft action ${draftOrder ?? 'unknown'}`;
  return <td colSpan={colSpan} className={`league-draft-cell${isPick ? '' : ' league-draft-ban'}`}>
    <HeroIcon heroId={entry.HeroId} heroName={entry.HeroName} action={action} iconSize={iconSize} />
    {draftOrder != null && <span className="league-draft-number" aria-hidden="true">{draftOrder}</span>}
  </td>;
}

export function MatchDraftBoard({ draft = [], radiantTeamName, direTeamName, iconSize = 32, showPhases = false }) {
  const entries = [...new Map(draft.map(entry => [`${entry.OrderNum}:${entry.Team}:${entry.IsPick}:${entry.HeroId}`, entry])).values()]
    .sort((a, b) => Number(a.OrderNum) - Number(b.OrderNum));
  const radiant = entries.filter(entry => entry.Team != null && Number(entry.Team) === 0);
  const dire = entries.filter(entry => entry.Team != null && Number(entry.Team) === 1);
  const unknownSide = entries.filter(entry => entry.Team == null || ![0, 1].includes(Number(entry.Team)));
  const startingSide = entries[0]?.Team == null || entries[0]?.playedOnly ? null : Number(entries[0].Team);
  const phases = [];
  if (showPhases && entries.length && entries.every(e => e.phaseKey)) {
    for (const entry of entries) {
      if (phases.at(-1)?.key !== entry.phaseKey) phases.push({ key: entry.phaseKey, label: entry.phase, entries: [] });
      phases.at(-1).entries.push(entry);
    }
  }
  if (!entries.length) return <p className="league-match-draft-message">Draft unavailable.</p>;
  return <>
    <table className="league-match-draft" aria-label="Picks and bans in order for each team">
      <thead><tr>{['Radiant', 'Dire'].map((team, side) => {
        const name = side === 0 ? radiantTeamName : direTeamName;
        const label = `${team}${name ? ` · ${name}` : ''}${startingSide === side ? ' — starts draft' : ''}`;
        return <th scope="col" key={team} title={label} aria-label={label}>
          <span className={`league-draft-header league-draft-header--${side === 0 ? 'radiant' : 'dire'}`} data-starting={startingSide === side}>{team[0]}</span>
        </th>;
      })}</tr></thead>
      <tbody>{phases.length ? phases.map(phase => {
        const sides = [0, 1].map(side => phase.entries.filter(e => e.Team === side));
        return <Fragment key={phase.key}><tr><th className="league-draft-phase" colSpan={2}>{phase.label}</th></tr>
          {Array.from({ length: Math.max(sides[0].length, sides[1].length) }, (_, index) => <tr key={index}>
            <DraftHeroCell entry={sides[0][index]} iconSize={iconSize} /><DraftHeroCell entry={sides[1][index]} iconSize={iconSize} />
          </tr>)}
        </Fragment>;
      }) : Array.from({ length: Math.max(radiant.length, dire.length) }, (_, index) => <tr key={index}>
        <DraftHeroCell entry={radiant[index]} iconSize={iconSize} />
        <DraftHeroCell entry={dire[index]} iconSize={iconSize} />
      </tr>)}{unknownSide.map((entry, index) => <tr key={`unknown-${index}`}><DraftHeroCell entry={entry} colSpan={2} iconSize={iconSize} /></tr>)}</tbody>
    </table>
    <small className="league-draft-legend"><span aria-hidden="true" />Ban</small>
  </>;
}

function MatchDraft({ matchId }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setDraft(null);
      setError('');
      try {
        const response = await fetch(`/api/matches/${matchId}/draft`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error('Unable to load draft');
        if (!controller.signal.aborted) {
          setDraft(data);
          if (data.length) trackSiteEvent('draft_viewed');
        }
      } catch (err) {
        if (!controller.signal.aborted) setError('Unable to load draft.');
      }
    }
    load();
    return () => controller.abort();
  }, [matchId, attempt]);

  return <aside className="league-match-draft-panel" aria-label="Pick and ban order">
    {error ? <div className="league-match-draft-message" role="alert">{error}{' '}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </div> : draft === null ? <p className="league-match-draft-message">Loading draft...</p>
      : !draft.length ? <p className="league-match-draft-message">Draft unavailable.</p>
        : <MatchDraftBoard draft={draft} />}
  </aside>;
}

export default function LeagueMatchDetails({ match }) {
  const [loadedPlayers, setLoadedPlayers] = useState(null);
  const [playersError, setPlayersError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const players = match.matchPlayers ?? loadedPlayers;

  useEffect(() => {
    if (match.matchPlayers != null) return undefined;
    const controller = new AbortController();
    async function loadPlayers() {
      setLoadedPlayers(null);
      setPlayersError('');
      try {
        const response = await fetch(`/api/matches/${match.MatchId}/players`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error('Unable to load player stats');
        setLoadedPlayers(data);
      } catch (err) {
        if (!controller.signal.aborted) setPlayersError('Unable to load player stats.');
      }
    }
    loadPlayers();
    return () => controller.abort();
  }, [match.MatchId, match.matchPlayers, attempt]);

  return <div className="league-match-info">
    <div className="league-match-stats-scroll">
      {playersError ? <p role="alert">{playersError}{' '}
        <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      </p> : players == null ? <p>Loading player stats...</p> : players.length ? <table className="league-series-player-stats">
        <thead><tr>
          <th>Player</th><th>Hero</th><th title="Kills / deaths / assists">K / D / A</th>
          <th title="Last hits">LH</th><th title="Gold per minute">GPM</th><th title="Experience per minute">XPM</th>
        </tr></thead>
        <tbody>{players.map((player, index) => <Fragment key={player.PlayerId}>
          {(index === 0 || player.TeamSide !== players[index - 1].TeamSide) && <tr>
            <th colSpan="6">{player.TeamSide == null ? <span>Side unavailable</span> : <Link
              className={`league-match-team-name league-match-team-name--${player.TeamSide === 0 ? 'radiant' : 'dire'}`}
              to={`/team/${player.TeamSide === 0 ? match.RadiantTeamId : match.DireTeamId}`}>
              {player.TeamSide === 0 ? match.RadiantTeamName : player.TeamSide === 1 ? match.DireTeamName : 'Side unavailable'}
            </Link>}{' '}
              {player.TeamSide != null && <MatchResultBadge winnerSide={match.WinnerSide} side={player.TeamSide === 0 ? 'r' : 'd'} />}
            </th>
          </tr>}
          <tr>
            <td className="league-match-player-name"><Link to={`/player/${player.PlayerId}`} title={player.PlayerName}>
              {player.PlayerName}
            </Link></td>
            <td><HeroIcon heroId={player.HeroId} heroName={player.HeroName} /></td>
            <td className="league-match-kda">{player.Kills} / {player.Deaths} / {player.Assists}</td>
            <td>{player.Lasthits}</td><td>{player.GPM}</td><td>{player.XPM}</td>
          </tr>
        </Fragment>)}</tbody>
      </table> : <p>Player details are not available yet.</p>}
    </div>
    <MatchDraft matchId={match.MatchId} />
  </div>;
}
