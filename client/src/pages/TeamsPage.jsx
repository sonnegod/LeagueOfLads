import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LeagueFilter from '../components/LeagueFilter';
import { useLeagues } from '../context/LeagueContext';
import HeroDisplay from '../components/HeroDisplay';
import './DataListPages.css';
import './DetailPages.css';

const teamColumns = [
  { key: 'TeamName', label: 'Team', mobileLabel: 'Name' },
  { key: 'GamesPlayed', label: 'Games Played', mobileLabel: 'Games' },
  { key: 'WinPercentage', label: 'Win %', mobileLabel: 'Win %' },
];

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [customLeagues] = useState([]);
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

  function changeSort(key) {
    setSortConfig(current => ({ key, direction: current.key === key
      ? current.direction === 'desc' ? 'asc' : 'desc'
      : key === 'TeamName' ? 'asc' : 'desc' }));
  }

  const sortArrow = key => sortConfig.key === key ? sortConfig.direction === 'asc' ? '▲' : '▼' : '↕';
  const compareNames = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined,
    { sensitivity: 'base', numeric: true });
  const sortedTeams = [...teams].sort((a, b) => {
    const { key, direction } = sortConfig;
    let comparison;
    if (key === 'TeamName') comparison = compareNames(a.TeamName, b.TeamName);
    else {
      const aValue = a[key], bValue = b[key];
      const aMissing = aValue == null || !Number.isFinite(Number(aValue));
      const bMissing = bValue == null || !Number.isFinite(Number(bValue));
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      comparison = aMissing ? 0 : Number(aValue) - Number(bValue);
    }
    return (direction === 'asc' ? comparison : -comparison)
      || Number(b.GamesPlayed) - Number(a.GamesPlayed)
      || compareNames(a.TeamName, b.TeamName) || Number(a.TeamId) - Number(b.TeamId);
  });


  if (loading || leaguesLoading) return <div>Loading...</div>;

  return (
    <div className="data-list-page teams-list-page" style={{ padding: '1rem' }}>
      <h1>Teams</h1>
      <LeagueFilter
        leagues={leagues}
        value={selectedLeague}
        onChange={setSelectedLeague}
      />
      <div className="mobile-sort-controls" aria-label="Sort teams">
        <span>Sort by</span>
        {teamColumns.map(column => <button key={column.key} type="button"
          aria-pressed={sortConfig.key === column.key} onClick={() => changeSort(column.key)}>
          {column.mobileLabel} <span aria-hidden="true">{sortArrow(column.key)}</span>
        </button>)}
      </div>
      <table className="responsive-data-table teams-data-table" style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', cursor: 'pointer' }}>
        <thead>
          <tr>
            {teamColumns.map(column => <th key={column.key} style={thStyle}
              aria-sort={sortConfig.key === column.key ? sortConfig.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
              <button type="button" className="detail-sort-button" onClick={() => changeSort(column.key)}>
                {column.label}<span aria-hidden="true">{sortArrow(column.key)}</span>
              </button>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((team) => (
            <React.Fragment key={team.TeamId}>
              <tr
                onClick={() => toggleTeamExpanded(team.TeamId)}
                style={{
                  cursor: "pointer",
                }}
              >
                <td data-label="Team" style={tdStyle}>
                  <Link to={`/team/${team.TeamId}`}> 
                    {team.TeamName}
                  </Link>              
                </td>
                <td data-label="Games" style={tdStyle}>{team.GamesPlayed}</td>
                <td data-label="Win rate" style={tdStyle}>{team.WinPercentage?.toFixed(2)}%</td>
              </tr>

              {expandedTeams[team.TeamId] && (
                <tr>
                  <td className="data-table-expanded" colSpan="3" style={{ paddingLeft: "2rem"}}>
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
                                <td colSpan="8" style={{ paddingLeft: "2rem"}}>
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
                                            <HeroDisplay heroId={h.HeroId} heroName={h.HeroName} />
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
};

const tdStyle = {
  border: "1px solid #ccc",
  padding: "12px 16px",
  textAlign: "center",
};
