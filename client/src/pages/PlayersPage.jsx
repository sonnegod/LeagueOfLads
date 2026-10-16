import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LeagueFilter from '../components/LeagueFilter';
import { useLeagues } from '../context/LeagueContext';
import HeroDisplay from '../components/HeroDisplay';
import './DataListPages.css';
import './DetailPages.css';

const playerColumns = [
  { key: 'PlayerName', label: 'Player', mobileLabel: 'Name' },
  { key: 'GamesPlayed', label: 'Games Played', mobileLabel: 'Games' },
  { key: 'WinPercentage', label: 'Win %', mobileLabel: 'Win %' },
];

export default function PlayersPage() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [expandedPlayers, setExpandedPlayers] = useState({});
  const [sort, setSort] = useState({ key: 'GamesPlayed', direction: 'desc' });
  const [customLeagues] = useState([]);
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

  function changeSort(key) {
    setSort(current => ({ key, direction: current.key === key
      ? current.direction === 'desc' ? 'asc' : 'desc'
      : key === 'PlayerName' ? 'asc' : 'desc' }));
  }

  const sortArrow = key => sort.key === key ? sort.direction === 'asc' ? '▲' : '▼' : '↕';
  const compareNames = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined,
    { sensitivity: 'base', numeric: true });
  const sortedPlayers = [...players].sort((a, b) => {
    let comparison;
    if (sort.key === 'PlayerName') comparison = compareNames(a.PlayerName, b.PlayerName);
    else {
      const aValue = a[sort.key], bValue = b[sort.key];
      const aMissing = aValue == null || !Number.isFinite(Number(aValue));
      const bMissing = bValue == null || !Number.isFinite(Number(bValue));
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      comparison = aMissing ? 0 : Number(aValue) - Number(bValue);
    }
    return (sort.direction === 'asc' ? comparison : -comparison)
      || Number(b.GamesPlayed) - Number(a.GamesPlayed)
      || compareNames(a.PlayerName, b.PlayerName) || Number(a.PlayerId) - Number(b.PlayerId);
  });

  if (loading || leaguesLoading) return <div>Loading players...</div>;

  return (
    <div className="data-list-page players-list-page" style={{ padding: "1rem", overflowX: "auto", background: "var(--surface, #000)", borderRadius: "8px" }}>
      <h1 style={{ color: "var(--text, #e6e6e6)" }}>Players</h1>
      <LeagueFilter
        leagues={leagues}
        value={selectedLeague}
        onChange={setSelectedLeague}
      />

      <div className="mobile-sort-controls" aria-label="Sort players">
        <span>Sort by</span>
        {playerColumns.map(column => <button key={column.key} type="button"
          aria-pressed={sort.key === column.key} onClick={() => changeSort(column.key)}>
          {column.mobileLabel} <span aria-hidden="true">{sortArrow(column.key)}</span>
        </button>)}
      </div>

      <table className="responsive-data-table players-data-table" style={{ width: "100%", minWidth: "1200px", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {playerColumns.map(column => <th key={column.key} style={thStyle}
              aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
              <button type="button" className="detail-sort-button" onClick={() => changeSort(column.key)}>
                {column.label}<span aria-hidden="true">{sortArrow(column.key)}</span>
              </button>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map(player => (
            <React.Fragment key={player.PlayerId}>
              <tr
                onClick={() => toggleExpanded(player.PlayerId)}
                style={{ cursor: "pointer", backgroundColor: expandedPlayers[player.PlayerId] ? "var(--surface, #0b0b0b)" : "transparent" }}
              >
                <td data-label="Player" style={tdStyle}><Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link></td>
                <td data-label="Games" style={tdStyle}>{player.GamesPlayed}</td>
                <td data-label="Win rate" style={tdStyle}>{player.WinPercentage?.toFixed(2)}%</td>
              </tr>

              {expandedPlayers[player.PlayerId] && (
                <tr>
                  <td className="data-table-expanded" colSpan="3" style={{ paddingLeft: "2rem", background: "var(--surface, #0b0b0b)" }}>
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
                                <HeroDisplay heroId={h.HeroId} heroName={h.HeroName} />
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
  border: "1px solid var(--border, #222428)",
  padding: "8px",
  textAlign: "center",
  color: "var(--text, #e6e6e6)",
  background: "transparent",
};

const tdStyle = {
  border: "1px solid var(--border, #222428)",
  padding: "12px 16px",
  textAlign: "center",
  color: 'var(--text, #e6e6e6)'
};
