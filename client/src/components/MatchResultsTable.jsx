import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import MatchResultBadge from './MatchResultBadge';
import LeagueMatchDetails from './LeagueMatchDetails';
import './LeagueSeriesTab.css';

export default function MatchResultsTable({ matches, showLeague = false, showDate = false }) {
  const [expandedMatches, setExpandedMatches] = useState({});
  const toggleMatch = matchId => setExpandedMatches(previous => ({
    ...previous, [matchId]: !previous[matchId],
  }));
  return <div className="league-series-table-scroll">
    <table className="league-series-matches">
      <thead><tr>{showDate && <th>Date</th>}
        <th>Match ID</th><th>Radiant Team</th><th>Dire Team</th>
        {showLeague && <th>League</th>}
      </tr></thead>
      <tbody>
        {matches.map(match => <Fragment key={match.MatchId}>
          <tr className="league-series-match-summary" data-expanded={Boolean(expandedMatches[match.MatchId])}
            onClick={() => toggleMatch(match.MatchId)}>
            {showDate && <td className="league-match-date">
              {match.DatePlayed ? <time dateTime={match.DatePlayed.slice(0, 10)}>
                {match.DatePlayed.slice(0, 10)}
              </time> : '—'}
            </td>}
            <td>
              <button type="button" className="league-match-toggle"
                aria-expanded={Boolean(expandedMatches[match.MatchId])}
                aria-label={`${expandedMatches[match.MatchId] ? 'Hide' : 'Show'} players for match ${match.MatchId}`}
                title={expandedMatches[match.MatchId] ? 'Hide player stats' : 'Show player stats'}
                onClick={event => { event.stopPropagation(); toggleMatch(match.MatchId); }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <Link to={`/match/${match.MatchId}`} onClick={event => event.stopPropagation()}>{match.MatchId}</Link>
            </td>
            <td><Link to={`/team/${match.RadiantTeamId}`} onClick={event => event.stopPropagation()}>{match.RadiantTeamName}</Link>{' '}
              <MatchResultBadge winnerSide={match.WinnerSide} side="r" /></td>
            <td><Link to={`/team/${match.DireTeamId}`} onClick={event => event.stopPropagation()}>{match.DireTeamName}</Link>{' '}
              <MatchResultBadge winnerSide={match.WinnerSide} side="d" /></td>
            {showLeague && <td><Link to={`/league/${match.LeagueId}`} onClick={event => event.stopPropagation()}>
              {match.LeagueName}
            </Link></td>}
          </tr>
          {expandedMatches[match.MatchId] && <tr className="league-series-match-details">
            <td colSpan={3 + Number(showLeague) + Number(showDate)}>
              <LeagueMatchDetails match={match} />
            </td>
          </tr>}
        </Fragment>)}
      </tbody>
    </table>
  </div>;
}
