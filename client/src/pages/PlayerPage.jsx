import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PlayerStatsTable from "../components/PlayerStatsTable";
import { Link } from 'react-router-dom';

export default function PlayerPage() {
  const { player_id } = useParams(); // gets :player_id from URL
  const [playerData, setPlayerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('season'); // stats, heroes, teams
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

  if (loading) return <div>Loading player info...</div>;
  if (!playerData) return <div>Player not found.</div>;

  const { playerStats, playerHeroStats, playerTeamStats } = playerData;

  return (
    <div className='p-4'>
      <h1 className="mb-4">{playerStats[0]?.PlayerName || player_id}</h1>

      {/* Tabs */}
      <div className='flex gap-2 mb-4'>
        <button onClick={() => setActiveTab('season')} style={activeTab === 'season' ? activeTabStyle : tabStyle}>Season Stats</button>
        <button onClick={() => setActiveTab('allMatches')} style={activeTab === 'allMatches' ? activeTabStyle : tabStyle}>Total Matches</button>
        <button onClick={() => setActiveTab('heroes')} style={activeTab === 'heroes' ? activeTabStyle : tabStyle}>Heroes</button>
        <button onClick={() => setActiveTab('teams')} style={activeTab === 'teams' ? activeTabStyle : tabStyle}>Teams</button>
      </div>

      {/* Tab content */}
      {activeTab === 'season' && <PlayerStatsTable data={currentSeasonPlayerData} />}
      {activeTab === 'allMatches' && <PlayerStatsTable data={playerStats} />}
      {activeTab === 'heroes' && (
        <table style={tableStyle}>
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
            {playerHeroStats.map(hero => (
              <tr key={hero.HeroId}>
                <td style={tdStyle}>
                  <Link to={`/hero/${hero.HeroId}`}>{hero.HeroName}</Link>
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
        </table>
      )}

      {activeTab === 'teams' && (
        <table style={tableStyle}>
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
        </table>
      )}
    </div>
  );
}

// Styles
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "700px" };
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center"};
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center"};
const tabStyle = { padding: "0.5rem 1rem", cursor: "pointer" };
const activeTabStyle = { ...tabStyle, fontWeight: "bold", backgroundColor: "#9c9898ff" };
