// src/pages/LeaguePage.jsx
import React, { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import CurrentLeagueSeries from "../components/CurrentLeagueSeries";
import CurrentLeaderboardTable from "../components/CurrentLeaderboardTable";
import TieBreakerView from "../components/TieBreakerView";
import CurrentPlayoffBracketView from "../components/CurrentPlayoffBracketView";
import HeroDisplay from "../components/HeroDisplay";
import LeagueHomeTab from "../components/LeagueHomeTab";
import './LeaguePage.css';

export default function LeaguePage({
  leagueIdOverride,
  stageTabsFirst = false,
  defaultToCurrentStage = false,
  alwaysShowGroups = false
}) {
  const { leagueId: routeLeagueId } = useParams();
  const leagueId = leagueIdOverride || routeLeagueId;
  const [data, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("home");
  const [expandedMatches, setExpandedMatches] = useState({});
  const [expandedHeroes, setExpandedHeroes] = useState({});
  const [stageInfo, setStageInfo] = useState(null);
  const [stageExists, setStageExists] = useState(false);
  const defaultedLeagueRef = useRef(null);
  
  useEffect(() => {
    async function fetchLeague() {
      setLoading(true);
      try {
        const res = await fetch(`/api/leagues/${leagueId}`);
        const data = await res.json();

        setLeague(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeague();
  }, [leagueId]);

  useEffect(() => {
    defaultedLeagueRef.current = null;
  }, [leagueId]);

  useEffect(() => {
    if (!defaultToCurrentStage || !stageInfo || defaultedLeagueRef.current === String(leagueId)) return;

    if (stageInfo.GroupEndMatchId && stageInfo.TieBreakerEndMatchId) {
      setActiveTab("playoffs");
    } else if (stageInfo.GroupEndMatchId) {
      setActiveTab("tiebreakers");
    } else {
      setActiveTab("group");
    }
    defaultedLeagueRef.current = String(leagueId);
  }, [defaultToCurrentStage, leagueId, stageInfo]);

  useEffect(() => {
    async function fetchStageInfo() {
      try {
        const res = await fetch(`/api/leagueStage?leagueId=${leagueId}`);
        const data = await res.json();
        setStageInfo(data[0] || data.stageInfo || null);
        setStageExists(Boolean(data.exists));
      } catch (err) {
        console.error("Failed to load league stage info", err);
        setStageInfo(null);
        setStageExists(false);
      }
    }

    fetchStageInfo();
  }, [leagueId]);

  const toggleMatchExpanded = (matchId) => {
    setExpandedMatches(prev => ({ ...prev, [matchId]: !prev[matchId] }));
  };
  const toggleHeroExpanded = async (heroId) => {
    setExpandedHeroes(prev => ({ ...prev, [heroId]: !prev[heroId] }));
  }

  if (loading || !data) return <div>Loading league...</div>;

  const { league, matchesWithPlayers, players, heroesWithPlayers, teams } = data;

  const inTiebreakers =
    stageInfo?.GroupEndMatchId &&
    !stageInfo?.TieBreakerEndMatchId;

  const inPlayoffs =
    stageInfo?.GroupEndMatchId &&
    stageInfo?.TieBreakerEndMatchId;

  const noSeparateTiebreaker =
    stageInfo?.GroupEndMatchId === stageInfo?.TieBreakerEndMatchId;

  const showGroups = stageExists || alwaysShowGroups;

  const stageButtons = (
    <>
      {stageExists && inPlayoffs && (
        <button onClick={() => setActiveTab("playoffs")} style={activeTab === "playoffs" ? activeTabStyle : tabStyle}>Playoffs</button>
      )}
      {stageExists && inPlayoffs && !noSeparateTiebreaker && (
        <button onClick={() => setActiveTab("tiebreakers")} style={activeTab === "tiebreakers" ? activeTabStyle : tabStyle}>Tiebreakers</button>
      )}
      {stageExists && inTiebreakers && (
        <button onClick={() => setActiveTab("tiebreakers")} style={activeTab === "tiebreakers" ? activeTabStyle : tabStyle}>Tiebreakers</button>
      )}
      {showGroups && (
        <button onClick={() => setActiveTab("group")} style={activeTab === "group" ? activeTabStyle : tabStyle}>Groups</button>
      )}
    </>
  );

  return (
    <div className="league-page" style={{ padding: "1rem", overflowX: "auto" }}>
      <h1>{league[0].LeagueName}</h1>

      {/* Tabs */}
      <div className="league-page-tabs" style={{ marginBottom: "1rem" }}>
        {stageTabsFirst && stageButtons}
        <button onClick={() => setActiveTab("home")} style={activeTab === "home" ? activeTabStyle : tabStyle}>Home</button>
        {!stageTabsFirst && stageButtons}
        <button onClick={() => setActiveTab("teams")} style={activeTab === "teams" ? activeTabStyle : tabStyle}>Teams</button>
        <button onClick={() => setActiveTab("matches")} style={activeTab === "matches" ? activeTabStyle : tabStyle}>Matches</button>
        <button onClick={() => setActiveTab("players")} style={activeTab === "players" ? activeTabStyle : tabStyle}>Players</button>
        <button onClick={() => setActiveTab("heroes")} style={activeTab === "heroes" ? activeTabStyle : tabStyle}>Heroes</button>
      </div>

      {/* Home Tab */}
      {activeTab === "home" && (
        <LeagueHomeTab
          league={league[0]}
          teams={teams}
          matches={matchesWithPlayers}
          players={players}
          heroes={heroesWithPlayers}
        />
      )}

      {/* Groups Tab */}
      {activeTab === "group" && showGroups && (
        <div>
          <CurrentLeaderboardTable leagueId={leagueId} />
          <hr style={{ margin: "2rem 0" }} />
          <h2>Recent Series</h2>
          <CurrentLeagueSeries leagueId={leagueId} />
        </div>
      )}

      {/* Tiebreakers Tab */}
      {activeTab === "tiebreakers" && stageExists && (
        <TieBreakerView leagueId={leagueId} />
      )}

      {/* Playoffs Tab */}
      {activeTab === "playoffs" && stageExists && (
        <CurrentPlayoffBracketView leagueId={leagueId} />
      )}

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
                                <td style={tdStyle}><HeroDisplay heroId={p.HeroId} heroName={p.HeroName} /></td>
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
                        <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} />
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
