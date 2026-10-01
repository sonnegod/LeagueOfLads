import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PlayerStatsTable from "../components/PlayerStatsTable";
import { Link } from 'react-router-dom';
import HeroDisplay from '../components/HeroDisplay';
import PlayerHomeTab from '../components/PlayerHomeTab';
import LeagueFilter from '../components/LeagueFilter';
import './DetailPages.css';

export default function PlayerPage() {
  const { player_id } = useParams(); // gets :player_id from URL
  const [playerData, setPlayerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [teammatesData, setTeammatesData] = useState(null);
  const currentSeasonPlayerData = playerData?.playerStats?.filter(stat => stat.LeagueId === playerData.LeagueId);
  
  useEffect(() => {
    async function fetchPlayer() {
      setLoading(true);
      try {
        const res = await fetch(`/api/player/${player_id}`);
        if (!res.ok) throw new Error('Player not found');
        const data = await res.json();

        setPlayerData(data);
      } catch (err) {
        console.error(err);
        setPlayerData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchPlayer();
  }, [player_id]);

  useEffect(() => {
    if (activeTab !== 'teammates') return undefined;
    const controller = new AbortController();
    const key = `${player_id}:${selectedLeague}`;
    setTeammatesData({ key, loading: true, rows: [], error: '' });
    const query = selectedLeague === 'all' ? '' : `?leagueId=${encodeURIComponent(selectedLeague)}`;
    fetch(`/api/player/${player_id}/teammates${query}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load teammates');
        return result.teammates;
      })
      .then(rows => setTeammatesData({ key, loading: false, rows, error: '' }))
      .catch(error => {
        if (!controller.signal.aborted) {
          setTeammatesData({ key, loading: false, rows: [], error: error.message });
        }
      });
    return () => controller.abort();
  }, [activeTab, player_id, selectedLeague]);

  if (loading) return <div>Loading player info...</div>;
  if (!playerData) return <div>Player not found.</div>;

  const { playerStats, playerTeamStats } = playerData;
  const playerLeagues = getPlayerLeagues(playerStats);
  const selectedPlayerStats = selectedLeague === 'all'
    ? playerStats
    : playerStats.filter(stat => String(stat.LeagueId) === String(selectedLeague));
  const selectedSeasonStats = selectedLeague === 'all' ? currentSeasonPlayerData : selectedPlayerStats;
  const selectedHeroStats = getHeroStatsFromMatches(selectedPlayerStats);
  const teammateKey = `${player_id}:${selectedLeague}`;
  const selectedTeammates = teammatesData?.key === teammateKey ? teammatesData : null;

  return (
    <div className='p-4 detail-page player-detail-page'>
      <h1 className="mb-4">{playerStats[0]?.PlayerName || player_id}</h1>

      {(activeTab === 'home' || activeTab === 'season' || activeTab === 'allMatches' || activeTab === 'heroes' || activeTab === 'teammates') && (
        <div className="detail-page-filter" style={{ marginBottom: '1rem' }}>
          <LeagueFilter
            leagues={playerLeagues}
            value={selectedLeague}
            onChange={setSelectedLeague}
          />
        </div>
      )}

      {/* Tabs */}
      <div className='flex gap-2 mb-4 detail-page-tabs ui-tabs'>
        <button className="ui-tab" aria-pressed={activeTab === 'home'} onClick={() => setActiveTab('home')} style={activeTab === 'home' ? activeTabStyle : tabStyle}>Home</button>
        <button className="ui-tab" aria-pressed={activeTab === 'season'} onClick={() => setActiveTab('season')} style={activeTab === 'season' ? activeTabStyle : tabStyle}>Season Stats</button>
        <button className="ui-tab" aria-pressed={activeTab === 'allMatches'} onClick={() => setActiveTab('allMatches')} style={activeTab === 'allMatches' ? activeTabStyle : tabStyle}>Total Matches</button>
        <button className="ui-tab" aria-pressed={activeTab === 'heroes'} onClick={() => setActiveTab('heroes')} style={activeTab === 'heroes' ? activeTabStyle : tabStyle}>Heroes</button>
        <button className="ui-tab" aria-pressed={activeTab === 'teammates'} onClick={() => setActiveTab('teammates')} style={activeTab === 'teammates' ? activeTabStyle : tabStyle}>Teammates</button>
        <button className="ui-tab" aria-pressed={activeTab === 'teams'} onClick={() => setActiveTab('teams')} style={activeTab === 'teams' ? activeTabStyle : tabStyle}>Teams</button>
      </div>

      {/* Tab content */}
      {activeTab === 'home' && (
        <PlayerHomeTab
          playerStats={selectedPlayerStats}
          currentSeasonPlayerData={selectedSeasonStats}
          playerHeroStats={selectedHeroStats}
          playerTeamStats={playerTeamStats}
        />
      )}
      {activeTab === 'season' && <div className="detail-table-scroll"><PlayerStatsTable data={selectedSeasonStats} /></div>}
      {activeTab === 'allMatches' && <div className="detail-table-scroll"><PlayerStatsTable data={selectedPlayerStats} /></div>}
      {activeTab === 'heroes' && (
        <div className="detail-table-scroll"><table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Hero</th>
              <th style={thStyle}>Games</th>
              <th style={thStyle}>Win %</th>
              <th style={thStyle}>Avg K/D/A</th>
              <th style={thStyle}>Avg Last Hits</th>
              <th style={thStyle}>Avg GPM</th>
              <th style={thStyle}>Avg XPM</th>
            </tr>
          </thead>
          <tbody>
            {selectedHeroStats.map(hero => (
              <tr key={hero.HeroId}>
                <td style={tdStyle}>
                  <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} />
                </td>
                <td style={tdStyle}>{hero.GamesPlayed}</td>
                <td style={tdStyle}>{hero.WinPercentage?.toFixed(2)}%</td>
                <td style={tdStyle}>{hero.AvgKills.toFixed(1)}/{hero.AvgDeaths.toFixed(1)}/{hero.AvgAssists.toFixed(1)}</td>
                <td style={tdStyle}>{hero.AvgLastHits.toFixed(1)}</td>
                <td style={tdStyle}>{hero.AvgGPM.toFixed(1)}</td>
                <td style={tdStyle}>{hero.AvgXPM.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {activeTab === 'teams' && (
        <div className="detail-table-scroll"><table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Team</th>
              <th style={thStyle}>Games</th>
              <th style={thStyle}>Win %</th>
            </tr>
          </thead>
          <tbody>
            {playerTeamStats.map(team => (
              <tr key={team.TeamId}>
                <td style={tdStyle}>
                  <Link to={`/team/${team.TeamId}`}>{team.TeamName}</Link>
                  </td>
                <td style={tdStyle}>{team.GamesPlayed}</td>
                <td style={tdStyle}>{team.WinPercentage?.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {activeTab === 'teammates' && (
        !selectedTeammates || selectedTeammates.loading ? <p>Loading teammates...</p>
          : selectedTeammates.error ? <p role="alert">{selectedTeammates.error}</p>
            : selectedTeammates.rows.length === 0
              ? <p>No teammates have played at least 5 games together{selectedLeague === 'all' ? '.' : ' in this league.'}</p>
              : <TeammatesTable rows={selectedTeammates.rows} />
      )}
    </div>
  );
}

const teammateColumns = [
  { key: 'PlayerName', label: 'Teammate' },
  { key: 'GamesPlayed', label: 'Games together' },
  { key: 'Wins', label: 'Wins' },
  { key: 'Losses', label: 'Losses' },
  { key: 'WinPercentage', label: 'Win %' },
];

function TeammatesTable({ rows }) {
  const [sort, setSort] = useState({ key: 'GamesPlayed', direction: 'desc' });
  const sortedRows = [...rows].sort((a, b) => {
    const aValue = sort.key === 'Losses' ? a.GamesPlayed - a.Wins : a[sort.key];
    const bValue = sort.key === 'Losses' ? b.GamesPlayed - b.Wins : b[sort.key];
    const comparison = sort.key === 'PlayerName'
      ? aValue.localeCompare(bValue, undefined, { sensitivity: 'base' })
      : aValue - bValue;
    if (comparison) return sort.direction === 'asc' ? comparison : -comparison;
    return b.GamesPlayed - a.GamesPlayed
      || a.PlayerName.localeCompare(b.PlayerName, undefined, { sensitivity: 'base' })
      || a.PlayerId - b.PlayerId;
  });

  function changeSort(key) {
    setSort(current => ({
      key,
      direction: current.key === key
        ? (current.direction === 'desc' ? 'asc' : 'desc')
        : (key === 'PlayerName' ? 'asc' : 'desc'),
    }));
  }

  return <div className="detail-table-scroll"><table style={tableStyle}>
    <thead><tr>{teammateColumns.map(column => <th key={column.key} style={thStyle}
      aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="detail-sort-button" type="button" onClick={() => changeSort(column.key)}>
        {column.label}<span aria-hidden="true">{sort.key === column.key
          ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>)}</tr></thead>
    <tbody>{sortedRows.map(teammate => <tr key={teammate.PlayerId}>
      <td style={tdStyle}><Link to={`/player/${teammate.PlayerId}`}>{teammate.PlayerName}</Link></td>
      <td style={tdStyle}>{teammate.GamesPlayed}</td>
      <td style={tdStyle}>{teammate.Wins}</td>
      <td style={tdStyle}>{teammate.GamesPlayed - teammate.Wins}</td>
      <td style={tdStyle}>{teammate.WinPercentage.toFixed(2)}%</td>
    </tr>)}</tbody>
  </table></div>;
}

// Styles
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "700px" };
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center"};
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center"};
const tabStyle = { padding: "0.5rem 1rem", cursor: "pointer" };
const activeTabStyle = { ...tabStyle, fontWeight: "bold", backgroundColor: "#9c9898ff" };

function getPlayerLeagues(playerStats = []) {
  const leagueMap = new Map();

  playerStats.forEach(stat => {
    if (stat.LeagueId && stat.LeagueName) {
      leagueMap.set(String(stat.LeagueId), {
        LeagueId: stat.LeagueId,
        LeagueName: stat.LeagueName
      });
    }
  });

  return [...leagueMap.values()].sort((a, b) => Number(b.LeagueId) - Number(a.LeagueId));
}

function getHeroStatsFromMatches(matches = []) {
  const heroMap = new Map();

  matches.forEach(match => {
    if (!heroMap.has(match.HeroId)) {
      heroMap.set(match.HeroId, {
        HeroId: match.HeroId,
        HeroName: match.HeroName,
        GamesPlayed: 0,
        Wins: 0,
        Kills: 0,
        Deaths: 0,
        Assists: 0,
        LastHits: 0,
        GPM: 0,
        XPM: 0
      });
    }

    const hero = heroMap.get(match.HeroId);
    hero.GamesPlayed += 1;
    hero.Wins += Number(match.Winner) === 1 ? 1 : 0;
    hero.Kills += toNumber(match.Kills);
    hero.Deaths += toNumber(match.Deaths);
    hero.Assists += toNumber(match.Assists);
    hero.LastHits += toNumber(match.Lasthits);
    hero.GPM += toNumber(match.GPM);
    hero.XPM += toNumber(match.XPM);
  });

  return [...heroMap.values()]
    .map(hero => ({
      HeroId: hero.HeroId,
      HeroName: hero.HeroName,
      GamesPlayed: hero.GamesPlayed,
      WinPercentage: hero.GamesPlayed ? (hero.Wins / hero.GamesPlayed) * 100 : 0,
      AvgKills: hero.Kills / hero.GamesPlayed,
      AvgDeaths: hero.Deaths / hero.GamesPlayed,
      AvgAssists: hero.Assists / hero.GamesPlayed,
      AvgLastHits: hero.LastHits / hero.GamesPlayed,
      AvgGPM: hero.GPM / hero.GamesPlayed,
      AvgXPM: hero.XPM / hero.GamesPlayed
    }))
    .sort((a, b) => b.GamesPlayed - a.GamesPlayed);
}

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
