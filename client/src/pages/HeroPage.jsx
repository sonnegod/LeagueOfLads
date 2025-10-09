import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import HeroStatsTable from "../components/HeroStatsTable";
import { Link } from 'react-router-dom';


export default function HeroPage() {
  const { hero_id } = useParams();
  const [heroData, setHeroData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('heroMatches'); // default tab

  useEffect(() => {
    async function fetchHero() {
      setLoading(true);
      try {
        const res = await fetch(`/api/hero/${hero_id}`);
        if (!res.ok) throw new Error('Hero not found');
        const data = await res.json();

        setHeroData(data);
      } catch (err) {
        console.error(err);
        setHeroData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchHero();
  }, [hero_id]);

  if (loading) return <div>Loading hero info...</div>;
  if (!heroData) return <div>Hero not found.</div>;

  const { hero, heroPlayerStats, heroTeamStats, leagueHeroStats } = heroData;

  return (
    <div>
      <h1>{hero[0]?.HeroName || hero_id}</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={() => setActiveTab('heroMatches')} style={activeTab === 'heroMatches' ? activeTabStyle : tabStyle}>Recent Matches</button>
        <button onClick={() => setActiveTab('players')} style={activeTab === 'players' ? activeTabStyle : tabStyle}>Players</button>
        <button onClick={() => setActiveTab('teams')} style={activeTab === 'teams' ? activeTabStyle : tabStyle}>Teams</button>
        <button onClick={() => setActiveTab('leagues')} style={activeTab === 'leagues' ? activeTabStyle : tabStyle}>Leagues</button>
      </div>

      {/* Tab Content */}
      {activeTab === 'heroMatches' && <HeroStatsTable data={hero} />}
      
      {activeTab === 'players' && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Player</th>
              <th style={thStyle}>Games</th>
              <th style={thStyle}>Win %</th>
              <th style={thStyle}>Avg K/D/A</th>
              <th style={thStyle}>Avg Last Hits</th>
              <th style={thStyle}>Avg GPM</th>
              <th style={thStyle}>Avg XPM</th>
            </tr>
          </thead>
          <tbody>
            {heroPlayerStats.map(player => (
              <tr key={player.HeroId}>
                <td style={tdStyle}>
                  <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link>
                </td>
                <td style={tdStyle}>{player.GamesPlayed}</td>
                <td style={tdStyle}>{player.WinPercentage?.toFixed(2)}%</td>
                <td style={tdStyle}>{player.AvgKills.toFixed(1)}/{player.AvgDeaths.toFixed(1)}/{player.AvgAssists.toFixed(1)}</td>
                <td style={tdStyle}>{player.AvgLastHits.toFixed(1)}</td>
                <td style={tdStyle}>{player.AvgGPM.toFixed(1)}</td>
                <td style={tdStyle}>{player.AvgXPM.toFixed(1)}</td>
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
              <th style={thStyle}>Avg K/D/A</th>
              <th style={thStyle}>Avg Last Hits</th>
              <th style={thStyle}>Avg GPM</th>
              <th style={thStyle}>Avg XPM</th>
            </tr>
          </thead>
          <tbody>
            {heroTeamStats.map(team => (
              <tr key={team.TeamId}>
                <td style={tdStyle}><Link to={`/team/${team.TeamId}`}>{team.TeamName}</Link></td>
                <td style={tdStyle}>{team.GamesPlayed}</td>
                <td style={tdStyle}>{team.WinPercentage?.toFixed(2)}%</td>
                <td style={tdStyle}>{team.AvgKills.toFixed(1)}/{team.AvgDeaths.toFixed(1)}/{team.AvgAssists.toFixed(1)}</td>
                <td style={tdStyle}>{team.AvgLastHits?.toFixed(2)}</td>
                <td style={tdStyle}>{team.AvgGPM?.toFixed(2)}</td>
                <td style={tdStyle}>{team.AvgXPM?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {activeTab === 'leagues' && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>League</th>
              <th style={thStyle}>Games</th>
              <th style={thStyle}>Win %</th>
              <th style={thStyle}>Avg K/D/A</th>
              <th style={thStyle}>Avg Last Hits</th>
              <th style={thStyle}>Avg GPM</th>
              <th style={thStyle}>Avg XPM</th>
            </tr>
          </thead>
          <tbody>
            {leagueHeroStats.map(league => (
              <tr key={league.LeagueId}>
                <td style={tdStyle}><Link to={`/league/${league.LeagueId}`}>{league.LeagueName}</Link></td>
                <td style={tdStyle}>{league.GamesPlayed}</td>
                <td style={tdStyle}>{league.WinPercentage?.toFixed(2)}%</td>
                <td style={tdStyle}>{league.AvgKills.toFixed(1)}/{league.AvgDeaths.toFixed(1)}/{league.AvgAssists.toFixed(1)}</td>
                <td style={tdStyle}>{league.AvgLastHits?.toFixed(2)}</td>
                <td style={tdStyle}>{league.AvgGPM?.toFixed(2)}</td>
                <td style={tdStyle}>{league.AvgXPM?.toFixed(2)}</td>
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
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tabStyle = { padding: "0.5rem 1rem", cursor: "pointer" };
const activeTabStyle = { ...tabStyle, fontWeight: "bold"};