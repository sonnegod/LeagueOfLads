// src/pages/LeaguePage.jsx
import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";

export default function LeaguePage() {
  const { leagueId } = useParams();
  const [data, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("teams");
  const [expandedMatches, setExpandedMatches] = useState({});
  const [expandedHeroes, setExpandedHeroes] = useState({});
  
  useEffect(() => {
    async function fetchLeague() {
      setLoading(true);
      try {
        const res = await fetch(`/api/leagues/${leagueId}`);
        const data = await res.json();

        console.log(data);

        setLeague(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeague();
  }, [leagueId]);

  const toggleMatchExpanded = (matchId) => {
    setExpandedMatches(prev => ({ ...prev, [matchId]: !prev[matchId] }));
  };
  const toggleHeroExpanded = async (heroId) => {
    setExpandedHeroes(prev => ({ ...prev, [heroId]: !prev[heroId] }));
  }

  if (loading || !data) return <div>Loading league...</div>;

  const { league, matchesWithPlayers, players, heroesWithPlayers, teams } = data;

  return (
    <div style={{ padding: "1rem", overflowX: "auto" }}>
      <h1>{league[0].LeagueName}</h1>
      <h2>Winner: <Link to={`/team/${league[0].WinnerTeamId}`}>{league[0].WinnerTeamName}</Link></h2>

      {/* Tabs */}
      <div style={{ marginBottom: "1rem" }}>
        <button onClick={() => setActiveTab("teams")} style={activeTab === "teams" ? activeTabStyle : tabStyle}>Teams</button>
        <button onClick={() => setActiveTab("matches")} style={activeTab === "matches" ? activeTabStyle : tabStyle}>Matches</button>
        <button onClick={() => setActiveTab("players")} style={activeTab === "players" ? activeTabStyle : tabStyle}>Players</button>
        <button onClick={() => setActiveTab("heroes")} style={activeTab === "heroes" ? activeTabStyle : tabStyle}>Heroes</button>
      </div>

      {/* Teams Tab */}
      {activeTab === "teams" && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>TeamName</th>
              <th style={thStyle}>Games Played</th>
              <th style={thStyle}>Win Percentage</th>
            </tr>
          </thead>
          <tbody>
            {teams.map(t => (
              <React.Fragment key={t.TeamId}>
                <tr>
                  <td style={tdStyle}><Link to={`/team/${t.TeamId}`}>{t.TeamName}</Link></td>
                  <td style={tdStyle}>{t.GamesPlayed}</td>
                  <td style={tdStyle}>{t.WinPercentage}%</td>
                </tr>
              </React.Fragment>))}
          </tbody>
        </table>
      )}

      {/* Matches Tab */}
      {activeTab === "matches" && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Match ID</th>
              <th style={thStyle}>Radiant Team</th>
              <th style={thStyle}>Dire Team</th>
            </tr>
          </thead>
          <tbody>
            {matchesWithPlayers.map(m => (
              <React.Fragment key={m.MatchId}>
                <tr
                  onClick={() => toggleMatchExpanded(m.MatchId)}
                  style={{ cursor: "pointer"}}
                >
                  <td style={tdStyle}><Link to={`/match/${m.MatchId}`}>{m.MatchId}</Link></td>
                  <td style={tdStyle}><Link to={`/team/${m.RadiantTeamId}`}>{m.RadiantTeamName}{m.WinnerSide === 'r' && ' ♔'}</Link></td>
                  <td style={tdStyle}><Link to={`/team/${m.DireTeamId}`}>{m.DireTeamName}{m.WinnerSide === 'd' && ' ♔'}</Link></td>
                </tr>

                {expandedMatches[m.MatchId] && m.matchPlayers && (
                  <tr>
                    <td colSpan="3" style={{ paddingLeft: "2rem" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Player</th>
                            <th style={thStyle}>Hero</th>
                            <th style={thStyle}>Kills</th>
                            <th style={thStyle}>Deaths</th>
                            <th style={thStyle}>Assists</th>
                            <th style={thStyle}>Last Hits</th>
                            <th style={thStyle}>GPM</th>
                            <th style={thStyle}>XPM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.matchPlayers.map((p, idx) => (
                            <React.Fragment key={p.PlayerId}>
                              {idx === 0 && (
                                <tr>
                                  <td colSpan="8" style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                    Radiant {m.WinnerSide === 'r' && '♔'}
                                  </td>
                                </tr>
                              )}
                              {idx === 5 && (
                                <tr>
                                  <td colSpan="8" style={{ textAlign: 'center', fontWeight: 'bold'}}>
                                    Dire {m.WinnerSide === 'd' && '♔'}
                                  </td>
                                </tr>
                              )}
                              <tr>
                                <td style={tdStyle}><Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link></td>
                                <td style={tdStyle}><Link to={`/hero/${p.HeroId}`}>{p.HeroName}</Link></td>
                                <td style={tdCenter}>{p.Kills}</td>
                                <td style={tdCenter}>{p.Deaths}</td>
                                <td style={tdCenter}>{p.Assists}</td>
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
      )}

      {/* Players Tab */}
      {activeTab === "players" && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Player</th>
              <th style={thStyle}>Games Played</th>
              <th style={thStyle}>Win %</th>
              <th style={thStyle}>K/D/A</th>
              <th style={thStyle}>Average Last Hits</th>
              <th style={thStyle}>Average GPM</th>
              <th style={thStyle}>Average XPM</th>
            </tr>
          </thead>
          <tbody>
            {players.map(player => (
              <React.Fragment key={player.PlayerId}>
                <tr>
                  <td style={tdStyle}><Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link></td>
                  <td style={tdStyle}>{player.GamesPlayed}</td>
                  <td style={tdStyle}>{player.WinPercentage?.toFixed(2)}%</td>
                  <td style={tdStyle}>{player.AvgKills?.toFixed(1)}/{player.AvgDeaths?.toFixed(1)}/{player.AvgAssists?.toFixed(1)}</td>
                  <td style={tdStyle}>{player.AvgLastHits?.toFixed(2)}</td>
                  <td style={tdStyle}>{player.AvgGPM?.toFixed(2)}</td>
                  <td style={tdStyle}>{player.AvgXPM?.toFixed(2)}</td>

                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* Heroes Tab */}
      {activeTab === "heroes" && (
        <table style={tableStyle}>
            <thead>
            <tr>
                <th style={thStyle}>Hero</th>
                <th style={thStyle}>Games</th>
                <th style={thStyle}>Win %</th>
                <th style={thStyle}>K/D/A</th>
                <th style={thStyle}>Avg Last Hits</th>
                <th style={thStyle}>Avg GPM</th>
                <th style={thStyle}>Avg XPM</th>
            </tr>
            </thead>
            <tbody>
            {heroesWithPlayers.map(hero => (
                <React.Fragment key={hero.HeroId}>
                <tr
                    onClick={() => toggleHeroExpanded(hero.HeroId)}
                    style={{ cursor: 'pointer'}}
                >
                    <td style={tdStyle}>
                        <Link to={`/hero/${hero.HeroId}`}>{hero.HeroName}</Link>
                    </td>
                    <td style={tdStyle}>{hero.GamesPlayed}</td>
                    <td style={tdStyle}>{hero.WinPercentage?.toFixed(2)}%</td>
                    <td style={tdStyle}>{hero.AvgKills.toFixed(1)}/{hero.AvgDeaths.toFixed(1)}{hero.AvgAssists.toFixed(1)}</td>
                    <td style={tdStyle}>{hero.AvgLastHits.toFixed(2)}</td>
                    <td style={tdStyle}>{hero.AvgGPM.toFixed(2)}</td>
                    <td style={tdStyle}>{hero.AvgXPM.toFixed(2)}</td>
                </tr>

                {expandedHeroes[hero.HeroId] && hero.heroPlayers && (
                    <tr>
                    <td colSpan="7" style={{ paddingLeft: '2rem'}}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                        <thead>
                            <tr>
                            <th style={thStyle}>Player</th>
                            <th style={thStyle}>Games</th>
                            <th style={thStyle}>Win %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {hero.heroPlayers.map(p => (
                            <tr key={p.PlayerId}>
                                <td style={tdStyle}>
                                <Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link>
                                </td>
                                <td style={tdStyle}>{p.GamesPlayed}</td>
                                <td style={tdStyle}>{p.WinPercentage?.toFixed(2)}%</td>
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
        )}
    </div>
  );
}

// Styles
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "900px" };
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center"};
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdCenter = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tabStyle = { padding: "0.5rem 1rem", marginRight: "0.5rem", cursor: "pointer" };
const activeTabStyle = { ...tabStyle, fontWeight: "bold"};
