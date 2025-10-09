import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LeagueFilter from '../components/LeagueFilter';
import { useLeagues } from '../context/LeagueContext';

export default function MatchesPage() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [expandedMatches, setExpandedMatches] = useState({});
  const [expandedPlayers, setExpandedPlayers] = useState({});

  const { leagues: globalLeagues, loading: leaguesLoading } = useLeagues();

  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      setExpandedMatches({});
      setExpandedPlayers({});
      try {
        const url = new URL('/api/matches', window.location.origin);
        if (selectedLeague !== 'all') url.searchParams.append('leagueId', selectedLeague);
        const res = await fetch(url.toString());
        const data = await res.json();

        setMatches(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchMatches();
  }, [selectedLeague]);

  const toggleMatchExpanded = async (matchId) => {
    setExpandedMatches(prev => ({ ...prev, [matchId]: !prev[matchId] }));

    // Lazy load players only if expanding
    if (!expandedMatches[matchId]) {
      try {
        const url = new URL(`/api/matches/${matchId}/players`, window.location.origin);
        if (selectedLeague !== 'all') url.searchParams.append('leagueId', selectedLeague);
        const res = await fetch(url.toString());
        const players = await res.json();
        setMatches(prev =>
          prev.map(match =>
            match.MatchId === matchId ? { ...match, players } : match
          )
        );
      } catch (err) {
        console.error(err);
      }
    }
  };

  const togglePlayerExpanded = (playerId) => {
    setExpandedPlayers(prev => ({ ...prev, [playerId]: !prev[playerId] }));
  };

  if (loading || leaguesLoading) return <div>Loading matches...</div>;

  return (
    <div style={{ padding: '1rem' }}>
      <h1>Matches</h1>
      <LeagueFilter
        leagues={globalLeagues}
        value={selectedLeague}
        onChange={setSelectedLeague}
      />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Match ID</th>
            <th style={thStyle}>Radiant</th>
            <th style={thStyle}>Dire</th>
            <th style={thStyle}>League</th>
          </tr>
        </thead>
        <tbody>
          {matches.map(match => (
            <React.Fragment key={match.MatchId}>
              <tr
                onClick={() => toggleMatchExpanded(match.MatchId)}
                style={{ cursor: 'pointer', backgroundColor: expandedMatches[match.MatchId] ? '#f9f9f9' : 'white' }}
              >
                <td style={tdCenter}>
                    <Link to={`/match/${match.MatchId}`}>{match.MatchId}</Link>
                </td>
                <td style={tdStyle}>
                    <Link to={`/team/${match.rad_team_id}`}>{match.rad_team_name}{match.WinnerSide === 'r' ? '♔' : ''}</Link>
                </td>
                <td style={tdStyle}>
                    <Link to={`/team/${match.dire_team_id}`}>{match.dire_team_name}{match.WinnerSide === 'd' ? '♔' : ''}</Link>
                </td>
                <td style={tdStyle}>
                    <Link to={`/league/${match.LeagueId}`}>{match.LeagueName}</Link>
                </td>
              </tr>

              {expandedMatches[match.MatchId] && match.players && (
                <tr>
                  <td colSpan="5" style={{ paddingLeft: '2rem', background: '#f5f5f5' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Player</th>
                          <th style={thStyle}>Hero</th>
                          <th style={thStyle}>K/D/A</th>
                          <th style={thStyle}>Last Hits</th>
                          <th style={thStyle}>GPM</th>
                          <th style={thStyle}>XPM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {match.players.map((p,idx) => (
                          <React.Fragment key={p.PlayerId}>
                            {idx === 0 && (
                                <tr>
                                <td colSpan="9" style={{ textAlign: 'center', fontWeight: 'bold', background: '#e0f7fa' }}>
                                    Radiant{match.WinnerSide === 'r' ? '♔' : ''}
                                </td>
                                </tr>
                            )}
                            {idx === 5 && (
                                <tr>
                                <td colSpan="9" style={{ textAlign: 'center', fontWeight: 'bold', background: '#ffebee' }}>
                                    Dire{match.WinnerSide === 'd' ? '♔' : ''}
                                </td>
                                </tr>
                            )}
                            <tr
                              onClick={() => togglePlayerExpanded(p.PlayerId)}
                              style={{
                                cursor: 'pointer',
                                backgroundColor: expandedPlayers[p.PlayerId] ? '#f0f0f0' : 'white'
                              }}
                            >
                              <td style={tdStyle}><Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link></td>
                              <td style={tdStyle}><Link to={`/hero/${p.HeroId}`}>{p.HeroName}</Link></td>
                              <td style={tdCenter}>{p.Kills}/{p.Deaths}/{p.Assists}</td>
                              <td style={tdCenter}>{p.Lasthits}</td>
                              <td style={tdCenter}>{p.GPM}</td>
                              <td style={tdCenter}>{p.XPM}</td>
                            </tr>
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = { border: '1px solid #ccc', padding: '8px', textAlign: 'center', cursor: 'pointer' };
const tdStyle = { border: '1px solid #ccc', padding: '8px', textAlign: 'left',color: 'black' };
const tdCenter = { border: '1px solid #ccc', padding: '8px', textAlign: 'center' };
