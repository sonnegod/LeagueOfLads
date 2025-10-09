import { Link } from 'react-router-dom';

export default function TeamRecentMatches({ matches }) {
  if (!matches?.length) return <div>No recent matches available</div>;
  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'fixed',  // keeps columns consistent
    }}>
      <thead>
        <tr style={{ backgroundColor: '#f0f0f0' }}>
          <th style={{ padding: '10px', textAlign: 'center' }}>Match ID</th>
          <th style={{ padding: '10px', textAlign: 'left' }}>Radiant</th>
          <th style={{ padding: '10px', textAlign: 'left' }}>Dire</th>
          <th style={{ padding: '10px', textAlign: 'left' }}>League</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((match, idx) => (
          <tr
            key={match.MatchId}
            style={{
              borderTop: '1px solid #ccc',
              borderBottom: '1px solid #ccc',
              backgroundColor: idx % 2 === 0 ? '#fff' : '#f9f9f9', // alternate row color
            }}
          >
            <td style={{ padding: '8px', textAlign: 'center' }}>
              <Link to={`/match/${match.MatchId}`}>{match.MatchId}</Link>
              </td>
            <td style={{ padding: '8px', textAlign: 'left' }}>
              <Link to={`/team/${match.rad_team_id}`}>
                {match.rad_team_name} {match.WinnerSide === 'r' && '♔'}
              </Link>
            </td>
            <td style={{ padding: '8px', textAlign: 'left' }}>
              <Link to={`/team/${match.dire_team_id}`}>
                {match.dire_team_name} {match.WinnerSide === 'd' && '♔'}
              </Link>
            </td>
            <td style={{ padding: '8px', textAlign: 'left' }}>
              <Link to={`/league/${match.LeagueId}`}>{match.LeagueName}</Link>
              </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
