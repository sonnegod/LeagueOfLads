import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LeagueFilter from '../components/LeagueFilter';
import { useLeagues } from '../context/LeagueContext';

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [customLeagues, setCustomLeagues] = useState([]);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [expandedPlayers, setExpandedPlayers] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: 'GamesPlayed', direction: 'desc' });

  const { leagues: globalLeagues, loading: leaguesLoading } = useLeagues();

  const leagues =
    customLeagues && customLeagues.length > 0 ? customLeagues : globalLeagues;

  useEffect(() => {
    async function fetchTeams() {
      setLoading(true);
      setExpandedTeams({});
      setExpandedPlayers({});
      try {
        const url = new URL('/api/teams', window.location.origin);
        if (selectedLeague !== 'all') {
          url.searchParams.append('leagueId', selectedLeague);
        }
        const res = await fetch(url.toString());
        const data = await res.json();


        
        setTeams(data.teams || []);

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTeams();
  }, [selectedLeague]);

  useEffect(() => {
    setExpandedTeams({});
    setExpandedPlayers({});
  }, [sortConfig]);


  const toggleTeamExpanded = async (teamId) => {
    setExpandedTeams((prev) => ({
      ...prev,
      [teamId]: !prev[teamId],
    }));

    // lazy load players when expanding a team
    if (!expandedTeams[teamId]) {
      try {
        const url = new URL(`/api/teams/${teamId}/players`, window.location.origin);
        if (selectedLeague && selectedLeague !== "all") {
          url.searchParams.append("leagueId", selectedLeague);
        }
        const res = await fetch(url.toString());
        const players = await res.json();
        setTeams((prev) =>
          prev.map((t) =>
            t.TeamId === teamId ? { ...t, players } : t
          )
        );
      } catch (err) {
        console.error(err);
      }
    }
  };

  const togglePlayerExpanded = (playerId) => {
    setExpandedPlayers((prev) => ({
      ...prev,
      [playerId]: !prev[playerId],
    }));
  };

    const sortedTeams = [...teams].sort((a, b) => {
    const { key, direction } = sortConfig;
    if (key === 'TeamName') {
      // sort alphabetically
      return direction === 'asc'
        ? a.TeamName.localeCompare(b.TeamName)
        : b.TeamName.localeCompare(a.TeamName);
    } else {
      // sort numerically
      return direction === 'asc'
        ? (a[key] || 0) - (b[key] || 0)
        : (b[key] || 0) - (a[key] || 0);
    }
  });


  if (loading || leaguesLoading) return <div>Loading...</div>;

  return (
    <div style={{ padding: '1rem' }}>
      <h1>Teams</h1>
      <LeagueFilter
        leagues={leagues}
        value={selectedLeague}
        onChange={setSelectedLeague}
      />
      <table style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', cursor: 'pointer' }}>
        <thead>
          <tr>
            <th style={thStyle} onClick={() => setSortConfig({ key: 'TeamName', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
              Team
            </th>
            <th style={thStyle} onClick={() => setSortConfig({ key: 'GamesPlayed', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
              Games Played
            </th>
            <th style={thStyle} onClick={() => setSortConfig({ key: 'WinPercentage', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
              Win %
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((team) => (
            <React.Fragment key={team.TeamId}>
              <tr
                onClick={() => toggleTeamExpanded(team.TeamId)}
                style={{
                  cursor: "pointer",
                  backgroundColor: expandedTeams[team.TeamId] ? "#f9f9f9" : "white",
                }}
              >
                <td style={tdStyle}>
                  <Link to={`/team/${team.TeamId}`}> 
                    {team.TeamName}
                  </Link>              
                </td>
                <td style={tdStyle}>{team.GamesPlayed}</td>
                <td style={tdStyle}>{team.WinPercentage?.toFixed(2)}%</td>
              </tr>

              {expandedTeams[team.TeamId] && (
                <tr>
                  <td colSpan="3" style={{ paddingLeft: "2rem", background: "#f5f5f5" }}>
                    {/* Nested Player Table */}
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Player</th>
                          <th style={thStyle}>Games</th>
                          <th style={thStyle}>K/D/A</th>
                          <th style={thStyle}>Last Hits</th>
                          <th style={thStyle}>GPM</th>
                          <th style={thStyle}>XPM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.players?.map((p) => (
                          <React.Fragment key={p.PlayerId}>
                            <tr
                              onClick={() => togglePlayerExpanded(p.PlayerId)}
                              style={{
                                cursor: "pointer",
                                backgroundColor: expandedPlayers[p.PlayerId] ? "#f0f0f0" : "white",
                              }}
                            >
                              <td style={tdStyle}>
                                <Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link>
                              </td>
                              <td style={tdStyle}>{p.GamesPlayed}</td>
                              <td style={tdStyle}>{p.AvgKills.toFixed(1)}/{p.AvgDeaths.toFixed(1)}/{p.AvgAssists.toFixed(1)}</td>
                              <td style={tdStyle}>{p.AvgLastHits.toFixed(2)}</td>
                              <td style={tdStyle}>{p.AvgGPM.toFixed(2)}</td>
                              <td style={tdStyle}>{p.AvgXPM.toFixed(2)}</td>
                            </tr>

                            {expandedPlayers[p.PlayerId] && (
                              <tr>
                                <td colSpan="8" style={{ paddingLeft: "2rem", background: "#fafafa" }}>
                                  <strong>Top Heroes:</strong>
                                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
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
                                          <td style={tdStyle}>{h.WinPercentage.toFixed(2)}%</td>
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
  border: "1px solid #ccc",
  padding: "8px",
  textAlign: "center",
  background: "#eee",
};

const tdStyle = {
  border: "1px solid #ccc",
  padding: "12px 16px",
  textAlign: "center",
};
