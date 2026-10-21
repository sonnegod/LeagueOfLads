import { lazy, Suspense, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import MatchResultBadge from '../components/MatchResultBadge';
import MatchScoreboard from '../components/MatchScoreboard';
import { useReport, ReportState, fmt, clock } from '../components/PerformanceUI';
import './MatchSeriesPages.css';
import './MatchDashboard.css';

const MatchAnalysis = lazy(() => import('../components/MatchAnalysis'));
const MatchDraftAnalysis = lazy(() => import('../components/MatchDraftAnalysis'));
const MatchBuilds = lazy(() => import('../components/MatchBuilds'));
const views = [['overview', 'Overview', 'Scoreboard & team comparison'], ['builds', 'Builds', 'Items, spells & purchases'],
  ['analysis', 'Analysis', 'Game flow, economy & fights'], ['draft', 'Draft', 'Picks, bans & context']];

export default function MatchPage() {
  const { matchId } = useParams();
  const report = useReport(`/api/matches/${matchId}`);
  return <div className="match-detail-page ui-page"><ReportState report={report}>{data =>
    data.match?.length ? <MatchView key={matchId} data={data} matchId={matchId} /> : <p>Match not found.</p>}
  </ReportState></div>;
}

function MatchView({ data, matchId }) {
  const [tab, setTab] = useState('overview'), [playerId, setPlayerId] = useState(null);
  const match = data.match[0];
  const groups = [0, 1, null].map(side => ({ side, players: data.matchPlayers.filter(p => p.TeamSide === side) })).filter(g => g.players.length);
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
    <div className="ui-tabs match-view-navigation" aria-label="Match sections">{views.map(([key, label, description]) =>
      <button type="button" className="ui-tab" key={key} aria-pressed={tab === key} aria-controls="match-view" onClick={() => setTab(key)}>
        <strong>{label}</strong><small>{description}</small></button>)}
    </div>
    <div id="match-view">
      {tab === 'overview' ? <MatchScoreboard match={match} groups={groups} onViewBuild={id => { setPlayerId(id); setTab('builds'); }} /> :
        <Suspense fallback={<p role="status">Loading {tab === 'builds' ? 'player builds' : tab === 'draft' ? 'draft context' : 'match analysis'}…</p>}>
          {tab === 'builds' ? <MatchBuilds matchId={matchId} match={match} groups={groups} initialPlayerId={playerId} /> :
            tab === 'draft' ? <MatchDraftAnalysis matchId={matchId} /> : <MatchAnalysis matchId={matchId} section="analysis" />}
        </Suspense>}
    </div>
  </>;
}
