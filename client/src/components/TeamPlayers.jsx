// components/TeamPlayers.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function TeamPlayers({ teamId, leagueId }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlayers, setExpandedPlayers] = useState({}); // Track multiple expanded players

  useEffect(() => {
    async function fetchPlayers() {
      setLoading(true);
      try {
        const url = new URL(`/api/teams/${teamId}/players`, window.location.origin);
        if (leagueId && leagueId !== 'all') {
          url.searchParams.append('leagueId', leagueId);
        }
        const res = await fetch(url.toString());
        const data = await res.json();

        setPlayers(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchPlayers();
  }, [teamId, leagueId]);

  if (loading) return <div>Loading players...</div>;

  const toggleExpanded = (playerId) => {
    setExpandedPlayers(prev => ({
      ...prev,
      [playerId]: !prev[playerId],
    }));
  };

  return (
    <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Player</th>
            <th style={thStyle}>Games Played</th>
            <th style={thStyle}>Kills</th>
            <th style={thStyle}>Deaths</th>
            <th style={thStyle}>Assists</th>
            <th style={thStyle}>Last Hits</th>
            <th style={thStyle}>GPM</th>
            <th style={thStyle}>XPM</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <React.Fragment key={p.PlayerId}>
              <tr
                onClick={() => toggleExpanded(p.PlayerId)}
                style={{
                  cursor: 'pointer',
                  backgroundColor: expandedPlayers[p.PlayerId] ? '#f9f9f9' : 'white',
                }}
              >
                <td style={tdStyle}>
                  <Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link>
                </td>
                <td style={tdStyle}>{p.GamesPlayed}</td>
                <td style={tdStyle}>{p.AvgKills.toFixed(2)}</td>
                <td style={tdStyle}>{p.AvgDeaths.toFixed(2)}</td>
                <td style={tdStyle}>{p.AvgAssists.toFixed(2)}</td>
                <td style={tdStyle}>{p.AvgLastHits.toFixed(2)}</td>
                <td style={tdStyle}>{p.AvgGPM.toFixed(2)}</td>
                <td style={tdStyle}>{p.AvgXPM.toFixed(2)}</td>
              </tr>

              {expandedPlayers[p.PlayerId] && (
                <tr>
                  <td colSpan="8" style={{ paddingLeft: '2rem', background: '#f5f5f5' }}>
                    <strong>Top Heroes:</strong>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Hero</th>
                          <th style={thStyle}>Games</th>
                          <th style={thStyle}>Win %</th>
                          <th style={thStyle}>Kills</th>
                            <th style={thStyle}>Deaths</th>
                            <th style={thStyle}>Assists</th>
                            <th style={thStyle}>Last Hits</th>
                            <th style={thStyle}>GPM</th>
                            <th style={thStyle}>XPM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.heroes?.map((h, idx) => (
                          <tr key={idx}> 
                            <td style={tdStyle}>
                                <Link to={`/hero/${h.HeroId}`}>{h.HeroName}</Link>
                            </td>
                            <td style={tdStyle}>{h.GamesPlayed}</td>
                            <td style={tdStyle}>{h.WinPercentage.toFixed(2)}</td>
                            <td style={tdStyle}>{h.AvgKills.toFixed(2)}</td>
                            <td style={tdStyle}>{h.AvgDeaths.toFixed(2)}</td>
                            <td style={tdStyle}>{h.AvgAssists.toFixed(2)}</td>
                            <td style={tdStyle}>{h.AvgLastHits.toFixed(2)}</td>
                            <td style={tdStyle}>{h.AvgGPM.toFixed(2)}</td>
                            <td style={tdStyle}>{h.AvgXPM.toFixed(2)}</td>
                          </tr>
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

const thStyle = {
  border: '1px solid #ccc',
  padding: '8px',
  textAlign: 'center',
};

const tdStyle = {
  border: '1px solid #ccc',
  padding: '12px 16px', // bigger padding
  textAlign: 'center',
};
