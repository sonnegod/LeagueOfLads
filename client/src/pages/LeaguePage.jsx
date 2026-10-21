// src/pages/LeaguePage.jsx
import React, { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { leagueTeamLink } from '../utils/leagueTeamLink';
import CurrentLeagueSeries from "../components/CurrentLeagueSeries";
import CurrentLeaderboardTable from "../components/CurrentLeaderboardTable";
import TieBreakerView from "../components/TieBreakerView";
import CurrentPlayoffBracketView from "../components/CurrentPlayoffBracketView";
import HeroDisplay from "../components/HeroDisplay";
import LeagueHomeTab from "../components/LeagueHomeTab";
import LeagueHighlightsFeed from "../components/LeagueHighlightsFeed";
import LeagueSeriesTab from "../components/LeagueSeriesTab";
import LeagueScheduleTab from "../components/LeagueScheduleTab";
import LeagueTeamsTab from "../components/LeagueTeamsTab";
import './LeaguePage.css';
const LeaguePerformance = React.lazy(() => import('../components/LeaguePerformance'));

export default function LeaguePage({
  leagueIdOverride,
  stageTabsFirst = false,
  defaultToCurrentStage = false,
  alwaysShowGroups = false,
  showRecentSeries = true,
  showHighlights = false
}) {
  const { leagueId: routeLeagueId } = useParams();
  const leagueId = leagueIdOverride || routeLeagueId;
  const [data, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState("home");
  const [expandedHeroes, setExpandedHeroes] = useState({});
  const [stageInfo, setStageInfo] = useState(null);
  const [stageExists, setStageExists] = useState(false);
  const defaultedLeagueRef = useRef(null);
  
  useEffect(() => {
    const controller = new AbortController();
    async function fetchLeague() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/leagues/${leagueId}`, { signal: controller.signal });
        if (!res.ok) throw new Error(res.status === 404 ? 'League not found.'
          : 'Unable to load this league. Please try again.');
        const data = await res.json();
        if (controller.signal.aborted) return;

        setLeague(data);
        if (Number(data.league?.[0]?.Active) !== 1) {
          setActiveTab(current => current === 'schedule' ? 'home' : current);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(err);
          setLeague(null);
          setError(err.message || 'Unable to load this league. Please try again.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchLeague();
    return () => controller.abort();
  }, [leagueId, loadAttempt]);

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

  const toggleHeroExpanded = async (heroId) => {
    setExpandedHeroes(prev => ({ ...prev, [heroId]: !prev[heroId] }));
  }

  if (loading) return <div>Loading league...</div>;
  if (error) return <div role="alert"><p>{error}</p>
    <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry</button></div>;
  if (!data?.league?.length) return <div>League not found.</div>;

  const { league, matchesWithPlayers, players, heroesWithPlayers, teams } = data;

  const inTiebreakers =
    stageInfo?.GroupEndMatchId &&
    !stageInfo?.TieBreakerEndMatchId;

  const inPlayoffs =
    stageInfo?.GroupEndMatchId &&
    stageInfo?.TieBreakerEndMatchId;

  const noSeparateTiebreaker =
    stageInfo?.GroupEndMatchId === stageInfo?.TieBreakerEndMatchId;

  const showGroups = stageExists || alwaysShowGroups || data.hasGroups;
  const showSchedule = Number(league[0].Active) === 1;

  const stageButtons = (
    <>
      {stageExists && inPlayoffs && (
        <button className="ui-tab" aria-pressed={activeTab === "playoffs"} onClick={() => setActiveTab("playoffs")} style={activeTab === "playoffs" ? activeTabStyle : tabStyle}>Playoffs</button>
      )}
      {stageExists && inPlayoffs && !noSeparateTiebreaker && (
        <button className="ui-tab" aria-pressed={activeTab === "tiebreakers"} onClick={() => setActiveTab("tiebreakers")} style={activeTab === "tiebreakers" ? activeTabStyle : tabStyle}>Tiebreakers</button>
      )}
      {stageExists && inTiebreakers && (
        <button className="ui-tab" aria-pressed={activeTab === "tiebreakers"} onClick={() => setActiveTab("tiebreakers")} style={activeTab === "tiebreakers" ? activeTabStyle : tabStyle}>Tiebreakers</button>
      )}
    </>
  );

  return (
    <div className="league-page" style={{ padding: "1rem", overflowX: "auto" }}>
      <h1>{league[0].LeagueName}</h1>
      {showHighlights && <LeagueHighlightsFeed key={leagueId} leagueId={leagueId} />}

      {/* Tabs */}
      <div className="league-page-tabs ui-tabs" style={{ marginBottom: "1rem" }}>
        <button className="ui-tab" aria-pressed={activeTab === "home"} onClick={() => setActiveTab("home")} style={activeTab === "home" ? activeTabStyle : tabStyle}>Home</button>
        {showGroups && <button className="ui-tab" aria-pressed={activeTab === "group"} onClick={() => setActiveTab("group")} style={activeTab === "group" ? activeTabStyle : tabStyle}>Groups</button>}
        <button className="ui-tab" aria-pressed={activeTab === "teams"} onClick={() => setActiveTab("teams")} style={activeTab === "teams" ? activeTabStyle : tabStyle}>Teams</button>
        <button className="ui-tab" aria-pressed={activeTab === "series"} onClick={() => setActiveTab("series")} style={activeTab === "series" ? activeTabStyle : tabStyle}>Series</button>
        {showSchedule && <button className="ui-tab" aria-pressed={activeTab === 'schedule'} onClick={() => setActiveTab('schedule')}>Schedule</button>}
        {stageTabsFirst && stageButtons}
        <button className="ui-tab" aria-pressed={activeTab === "performance"} onClick={() => setActiveTab("performance")}>Performance</button>
        {!stageTabsFirst && stageButtons}
        <button className="ui-tab" aria-pressed={activeTab === "players"} onClick={() => setActiveTab("players")} style={activeTab === "players" ? activeTabStyle : tabStyle}>Players</button>
        <button className="ui-tab" aria-pressed={activeTab === "heroes"} onClick={() => setActiveTab("heroes")} style={activeTab === "heroes" ? activeTabStyle : tabStyle}>Heroes</button>
      </div>

      {/* Home Tab */}
      {activeTab === 'performance' && <React.Suspense fallback={<p role="status">Loading performance…</p>}>
        <LeaguePerformance key={leagueId} leagueId={leagueId} />
      </React.Suspense>}
      {activeTab === "home" && (
        <LeagueHomeTab
          league={league[0]}
          teams={teams}
          matches={matchesWithPlayers}
          players={players}
          heroes={heroesWithPlayers}
        />
      )}

      {showSchedule && activeTab === 'schedule' && <LeagueScheduleTab key={leagueId} leagueId={leagueId} />}

      {/* Groups Tab */}
      {activeTab === "group" && showGroups && (
        <div>
          <CurrentLeaderboardTable key={leagueId} leagueId={leagueId} />
          {showRecentSeries && (
            <>
              <hr style={{ margin: "2rem 0" }} />
              <h2>Recent Series</h2>
              <CurrentLeagueSeries leagueId={leagueId} />
            </>
          )}
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
        <LeagueTeamsTab key={leagueId} leagueId={leagueId} />
      )}

      {/* Series Tab */}
      {activeTab === "series" && (
        <LeagueSeriesTab key={leagueId} series={data.series} matches={matchesWithPlayers} />
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
              <React.Fragment key={`${player.PlayerId}:${player.EntryId != null ? `entry:${player.EntryId}` : `team:${player.TeamId}`}`}>
                <tr>
                  <td style={tdStyle}>
                    <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link><br />
                    <small>{leagueTeamLink(player) ? <Link to={leagueTeamLink(player)}>{player.TeamName}</Link> : player.TeamName}</small>
                  </td>
                  <td style={tdStyle}>{player.GamesPlayed}</td>
                  <td style={tdStyle}>{player.WinPercentage == null ? '—' : `${player.WinPercentage.toFixed(2)}%`}</td>
                  <td style={tdStyle}>{player.GamesPlayed ? `${player.AvgKills?.toFixed(1)}/${player.AvgDeaths?.toFixed(1)}/${player.AvgAssists?.toFixed(1)}` : '—'}</td>
                  <td style={tdStyle}>{player.AvgLastHits?.toFixed(2) ?? '—'}</td>
                  <td style={tdStyle}>{player.AvgGPM?.toFixed(2) ?? '—'}</td>
                  <td style={tdStyle}>{player.AvgXPM?.toFixed(2) ?? '—'}</td>

                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* Heroes Tab */}
      {activeTab === "heroes" && (
        <table className="league-heroes-table" style={tableStyle}>
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
const tabStyle = { padding: "0.5rem 1rem", marginRight: "0.5rem", cursor: "pointer" };
const activeTabStyle = { ...tabStyle, fontWeight: "bold"};
