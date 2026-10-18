import { lazy, Suspense, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import HeroDisplay from '../components/HeroDisplay';
import MatchResultBadge from '../components/MatchResultBadge';
import { useReport, ReportState, Panel, ReportTable, fmt, clock } from '../components/PerformanceUI';
import './MatchSeriesPages.css';

const MatchAnalysis = lazy(() => import('../components/MatchAnalysis'));
const MatchDraftAnalysis = lazy(() => import('../components/MatchDraftAnalysis'));
const modes = {
  combat: [['Kills', 'K'], ['Deaths', 'D'], ['Assists', 'A'], ['HeroDamage', 'Hero damage'], ['Healing', 'Healing'], ['TowerDamage', 'Tower damage']],
  economy: [['Lasthits', 'LH'], ['Denies', 'Denies'], ['Networth', 'Net worth'], ['GPM', 'GPM'], ['XPM', 'XPM'], ['FinalLevel', 'Level']],
  support: [['ObserversPlaced', 'Observers'], ['SentriesPlaced', 'Sentries'], ['ObserversKilled', 'Obs destroyed'],
    ['SentriesKilled', 'Sentries destroyed'], ['CampsStacked', 'Stacks'], ['StunSeconds', 'Stun seconds']],
};

export default function MatchPage() {
  const { matchId } = useParams();
  const report = useReport(`/api/matches/${matchId}`);
  return <div className="match-detail-page ui-page"><ReportState report={report}>{data =>
    data.match?.length ? <MatchView key={matchId} data={data} matchId={matchId} /> : <p>Match not found.</p>}
  </ReportState></div>;
}

function MatchView({ data, matchId }) {
  const [tab, setTab] = useState('overview'), [mode, setMode] = useState('combat'), [playerId, setPlayerId] = useState(null);
  const match = data.match[0];
  const groups = [0, 1, null].map(side => ({ side, players: data.matchPlayers.filter(p => p.TeamSide === side) })).filter(g => g.players.length);
  const columns = [
    { key: 'PlayerName', label: 'Player', render: p => <Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link> },
    { key: 'HeroName', label: 'Hero', render: p => <HeroDisplay heroId={p.HeroId} heroName={p.HeroName} showName={false} /> },
    ...(modes[mode] || []).map(([key, label]) => ({ key, label })),
    { key: 'details', label: 'Details', sortable: false, value: () => null, render: p => <button type="button"
      onClick={() => { setPlayerId(p.PlayerId); setMode('items'); }}>View</button> },
  ].map(column => ({ ...column, className: 'performance-cell-center' }));
  const date = match.StartTimeUtc ? `${new Intl.DateTimeFormat(undefined, { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(match.StartTimeUtc * 1000))} ET` : match.DatePlayed || 'Date unavailable';
  return <>
    <header className="match-overview-header">
      <div className="match-overview-main">
        <h1 className="match-overview-score">
          <span className={`match-overview-team ${match.WinnerSide === 'r' ? 'is-winner' : match.WinnerSide === 'd' ? 'is-loser' : ''}`}><Link className="performance-side-0" to={`/team/${match.rad_team_id}`}>{match.rad_team_name}</Link>
            <MatchResultBadge winnerSide={match.WinnerSide} side="r" />
            <small title={`${match.LeagueName} · current season record`}>GP {fmt(data.teamSeasonRad?.[0]?.GamesPlayed, 0)} · WR {fmt(data.teamSeasonRad?.[0]?.WinPercentage)}%</small></span>
          <span className="match-overview-score-block"><strong>{fmt(match.RadiantScore, 0)} - {fmt(match.DireScore, 0)}</strong>
            <span className="match-overview-time" aria-label={`Match time ${clock(match.Duration)}`}>{clock(match.Duration)}</span></span>
          <span className={`match-overview-team ${match.WinnerSide === 'd' ? 'is-winner' : match.WinnerSide === 'r' ? 'is-loser' : ''}`}><Link className="performance-side-1" to={`/team/${match.dire_team_id}`}>{match.dire_team_name}</Link>
            <MatchResultBadge winnerSide={match.WinnerSide} side="d" />
            <small title={`${match.LeagueName} · current season record`}>GP {fmt(data.teamSeasonDire?.[0]?.GamesPlayed, 0)} · WR {fmt(data.teamSeasonDire?.[0]?.WinPercentage)}%</small></span>
        </h1>
      </div>
      <div className="match-overview-meta" aria-label="Match details"><Link to={`/league/${match.LeagueId}`}>{match.LeagueName}</Link>
        <span>Match {match.MatchId}</span>
        <span>{date}</span><span>Patch {match.PatchKey || 'unavailable'}</span></div>
    </header>
    <div className="ui-tabs" aria-label="Match sections">{[['overview', 'Overview'], ['gameflow', 'Game flow'], ['economy', 'Player economy'], ['fights', 'Teamfights']].map(([key, label]) =>
      <button className="ui-tab" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    {tab === 'overview' ? <div className="performance-report">
      <div className="ui-tabs" aria-label="Overview sections">{[...Object.keys(modes), 'items', 'draft'].map(key => <button key={key} className="ui-tab"
        aria-pressed={mode === key} onClick={() => setMode(key)}>{key === 'draft' ? 'Picks & bans' : key[0].toUpperCase() + key.slice(1)}</button>)}</div>
      {mode === 'items' ? <Suspense fallback={<p role="status">Loading items…</p>}>
        <MatchAnalysis matchId={matchId} section="items" initialPlayerId={playerId} />
      </Suspense> : mode === 'draft' ? <Suspense fallback={<p role="status">Loading draft context…</p>}>
        <MatchDraftAnalysis matchId={matchId} />
      </Suspense> : <>
      {groups.map(({ side, players }) => <Panel key={side ?? 'unknown'}>
        <div className={`match-scoreboard-team performance-side-${side}`}>
          <h2>{side === null ? 'Side unavailable' : <Link to={`/team/${side === 0 ? match.rad_team_id : match.dire_team_id}`}>
            {side === 0 ? match.rad_team_name : match.dire_team_name}</Link>}</h2>
          {side !== null && <MatchResultBadge winnerSide={match.WinnerSide} side={side === 0 ? 'r' : 'd'} />}
        </div>
        <ReportTable key={mode} rows={players} columns={columns} rowKey="PlayerId" initialSort="PlayerSlot" initialDirection="asc" />
      </Panel>)}
      <p className="performance-note">Extended statistics are shown where recorded. Missing values are unavailable, not zero.</p>
      </>}
    </div> : <Suspense fallback={<p role="status">Loading match analysis…</p>}>
      <MatchAnalysis matchId={matchId} section={tab} initialPlayerId={playerId} />
    </Suspense>}
  </>;
}
