import React, { lazy, Suspense, useEffect, useState } from 'react';
import { trackSiteEvent } from '../utils/siteAnalytics';
import { useParams } from 'react-router-dom';
import PlayerStatsTable from "../components/PlayerStatsTable";
import { Link } from 'react-router-dom';
import { PlayerHeroesTable, PlayerTeamsTable } from '../components/DetailSummaryTables';
import PlayerHomeTab from '../components/PlayerHomeTab';
import LeagueFilter from '../components/LeagueFilter';
import DotabuffLink from '../components/DotabuffLink';
import PlayerAwards, { PlayerAwardHighlights, PlayerChampionshipTrophies } from '../components/PlayerAwards';
import './DetailPages.css';
const PerformancePanel = lazy(() => import('../components/PerformancePanel'));

export default function PlayerPage() {
  const { player_id } = useParams(); // gets :player_id from URL
  const [playerData, setPlayerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [teammatesData, setTeammatesData] = useState(null);
  const [awardsData, setAwardsData] = useState(null);
  const [awardsAttempt, setAwardsAttempt] = useState(0);
  const currentSeasonPlayerData = playerData?.playerStats?.filter(stat => stat.LeagueId === playerData.LeagueId);
  
  useEffect(() => {
    const controller = new AbortController();
    async function fetchPlayer() {
      setLoading(true);
      try {
        const res = await fetch(`/api/player/${player_id}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Player not found');
        const data = await res.json();

        if (!controller.signal.aborted) setPlayerData(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error(err);
        setPlayerData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchPlayer();
    return () => controller.abort();
  }, [player_id]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/player/${player_id}/awards`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load player awards');
        return result;
      }).then(data => {
        if (!controller.signal.aborted) setAwardsData({ playerId: player_id, ...data });
      }).catch(error => {
        if (!controller.signal.aborted) setAwardsData({ playerId: player_id, error: error.message, awards: [] });
      });
    return () => controller.abort();
  }, [player_id, awardsAttempt]);

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
  const currentAwards = awardsData?.playerId === player_id ? awardsData : null;
  const selectedAwards = (currentAwards?.awards || []).filter(award => selectedLeague === 'all'
    || String(award.leagueId) === String(selectedLeague));

  return (
    <div className='p-4 detail-page player-detail-page'>
      <div className="player-page-heading">
        <h1>{playerStats[0]?.PlayerName || player_id}</h1>
        <PlayerChampionshipTrophies awards={currentAwards?.awards || []} />
        <DotabuffLink playerId={player_id} name={playerStats[0]?.PlayerName || player_id} />
      </div>

      <PlayerAwardHighlights awards={selectedAwards} loading={!currentAwards} error={currentAwards?.error}
        onViewAll={() => setActiveTab('awards')} />

      {(activeTab === 'home' || activeTab === 'season' || activeTab === 'allMatches' || activeTab === 'heroes' || activeTab === 'teammates' || activeTab === 'awards') && (
        <div className="detail-page-filter">
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
        <button className="ui-tab" aria-pressed={activeTab === 'performance'} onClick={() => setActiveTab('performance')}>Performance</button>
        <button className="ui-tab" aria-pressed={activeTab === 'season'} onClick={() => setActiveTab('season')} style={activeTab === 'season' ? activeTabStyle : tabStyle}>Season Stats</button>
        <button className="ui-tab" aria-pressed={activeTab === 'allMatches'} onClick={() => setActiveTab('allMatches')} style={activeTab === 'allMatches' ? activeTabStyle : tabStyle}>Total Matches</button>
        <button className="ui-tab" aria-pressed={activeTab === 'heroes'} onClick={() => setActiveTab('heroes')} style={activeTab === 'heroes' ? activeTabStyle : tabStyle}>Heroes</button>
        <button className="ui-tab" aria-pressed={activeTab === 'teammates'} onClick={() => {
          if (activeTab !== 'teammates') trackSiteEvent('teammates_opened');
          setActiveTab('teammates');
        }} style={activeTab === 'teammates' ? activeTabStyle : tabStyle}>Teammates</button>
        <button className="ui-tab" aria-pressed={activeTab === 'teams'} onClick={() => setActiveTab('teams')} style={activeTab === 'teams' ? activeTabStyle : tabStyle}>Teams</button>
        <button className="ui-tab" aria-pressed={activeTab === 'awards'} onClick={() => setActiveTab('awards')} style={activeTab === 'awards' ? activeTabStyle : tabStyle}>Awards</button>
      </div>

      {/* Tab content */}
      {activeTab === 'performance' && <Suspense fallback={<p role="status">Loading performance…</p>}>
        <PerformancePanel key={`${player_id}:${selectedLeague}`} type="player" id={player_id} leagueId={selectedLeague} seasons={playerLeagues} onLeagueChange={setSelectedLeague} />
      </Suspense>}
      {activeTab === 'awards' && <PlayerAwards awards={selectedAwards} criteria={currentAwards?.criteria}
        loading={!currentAwards} error={currentAwards?.error} selectedLeague={selectedLeague}
        onRetry={() => { setAwardsData(null); setAwardsAttempt(value => value + 1); }} />}
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
      {activeTab === 'heroes' && <PlayerHeroesTable rows={selectedHeroStats} />}
      {activeTab === 'teams' && <PlayerTeamsTable rows={playerTeamStats} />}

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
