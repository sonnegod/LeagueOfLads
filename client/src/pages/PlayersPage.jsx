import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LeagueFilter from '../components/LeagueFilter';
import { useLeagues } from '../context/LeagueContext';

export default function PlayersPage() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [expandedPlayers, setExpandedPlayers] = useState({});
  const [customLeagues, setCustomLeagues] = useState([]);
  const { leagues: globalLeagues, loading: leaguesLoading } = useLeagues();

  const leagues = customLeagues.length > 0 ? customLeagues : globalLeagues;

  useEffect(() => {
    async function fetchPlayers() {
      setLoading(true);
      setExpandedPlayers({});
      try {
        const url = new URL("/api/players", window.location.origin);
        if (selectedLeague !== 'all') url.searchParams.append('leagueId', selectedLeague);
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
  }, [selectedLeague]);

  const toggleExpanded = async (playerId) => {
    setExpandedPlayers(prev => ({
      ...prev,
      [playerId]: !prev[playerId],
    }));

    if (!expandedPlayers[playerId]) {
      try {
        const url = new URL(`/api/players/${playerId}/details`, window.location.origin);
        if (selectedLeague !== 'all') url.searchParams.append('leagueId', selectedLeague);
        const res = await fetch(url.toString());
        const details = await res.json();

        setPlayers((prev) =>
          prev.map((p) =>
            p.PlayerId === playerId
              ? selectedLeague === "all"
                ? { ...p, teams: details }  // attach as teams if all leagues
                : { ...p, heroes: details } // attach as heroes if specific league
              : p
          )
        );
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (loading || leaguesLoading) return <div>Loading players...</div>;

  return (
    <div style={{ padding: "1rem", overflowX: "auto" }}>
      <h1>Players</h1>
      <LeagueFilter
        leagues={leagues}
        value={selectedLeague}
        onChange={setSelectedLeague}
      />

      <table style={{ width: "100%", minWidth: "1200px", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Player</th>
            <th style={thStyle}>Games Played</th>
            <th style={thStyle}>Win %</th>
          </tr>
        </thead>
        <tbody>
          {players.map(player => (
            <React.Fragment key={player.PlayerId}>
              <tr
                onClick={() => toggleExpanded(player.PlayerId)}
                style={{ cursor: "pointer", backgroundColor: expandedPlayers[player.PlayerId] ? "#f9f9f9" : "white" }}
              >
                <td style={tdStyle}><Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link></td>
                <td style={tdStyle}>{player.GamesPlayed}</td>
                <td style={tdStyle}>{player.WinPercentage?.toFixed(2)}%</td>
              </tr>

              {expandedPlayers[player.PlayerId] && (
                <tr>
                  <td colSpan="3" style={{ paddingLeft: "2rem", background: "#f5f5f5" }}>
                    {selectedLeague === "all" ? (
                      // Show teams
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Team</th>
                            <th style={thStyle}>Games Played</th>
                            <th style={thStyle}>Win %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {player.teams?.map((t) => (
                            <tr key={t.TeamId}>
                              <td style={tdStyle}>
                                <Link to={`/team/${t.TeamId}`}>{t.TeamName}</Link>
                              </td>
                              <td style={tdStyle}>{t.GamesPlayed}</td>
                              <td style={tdStyle}>{t.WinPercentage?.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      // Show top heroes
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Hero</th>
                            <th style={thStyle}>Games</th>
                            <th style={thStyle}>Win %</th>
                            <th style={thStyle}>K/D/A</th>
                            <th style={thStyle}>Last Hits</th>
                            <th style={thStyle}>GPM</th>
                            <th style={thStyle}>XPM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {player.heroes?.map((h) => (
                            <tr key={h.HeroId}>
                              <td style={tdStyle}>
                                <Link to={`/hero/${h.HeroId}`}>{h.HeroName}</Link>
                              </td>
                              <td style={tdStyle}>{h.GamesPlayed}</td>
                              <td style={tdStyle}>{h.WinPercentage?.toFixed(2)}%</td>
                              <td style={tdStyle}>{h.AvgKills.toFixed(1)}/{h.AvgDeaths.toFixed(1)}/{h.AvgAssists.toFixed(1)}</td>
                              <td style={tdStyle}>{h.AvgLastHits.toFixed(2)}</td>
                              <td style={tdStyle}>{h.AvgGPM.toFixed(2)}</td>
                              <td style={tdStyle}>{h.AvgXPM.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
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
};

const tdStyle = {
  border: "1px solid #ccc",
  padding: "12px 16px",
  textAlign: "center",
  color: 'black'
};
