import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import HeroStatsTable from "../components/HeroStatsTable";
import { Link } from 'react-router-dom';
import HeroDisplay from '../components/HeroDisplay';


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
    <div style={{ padding: '1rem' }}>
      {/* Dark page container to avoid white panels */}
      <div style={{ padding: '1rem', backgroundColor: '#0f1112', color: '#e6e6e6', borderRadius: 8 }}>
        <h1 style={{ marginTop: 0 }}>
          <HeroDisplay heroId={hero_id} heroName={hero[0]?.HeroName || hero_id} iconSize={64} link={false} />
        </h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <button onClick={() => setActiveTab('heroMatches')} style={activeTab === 'heroMatches' ? activeTabStyleDark : tabStyleDark}>Recent Matches</button>
          <button onClick={() => setActiveTab('players')} style={activeTab === 'players' ? activeTabStyleDark : tabStyleDark}>Players</button>
          <button onClick={() => setActiveTab('teams')} style={activeTab === 'teams' ? activeTabStyleDark : tabStyleDark}>Teams</button>
          <button onClick={() => setActiveTab('leagues')} style={activeTab === 'leagues' ? activeTabStyleDark : tabStyleDark}>Leagues</button>
        </div>

        {/* Tab Content */}
        {activeTab === 'heroMatches' && <HeroStatsTable data={hero} />}
        
        {activeTab === 'players' && (
          <table style={tableStyleDark}>
            <thead>
              <tr>
                <th style={thStyleDark}>Player</th>
                <th style={thStyleDark}>Games</th>
                <th style={thStyleDark}>Win %</th>
                <th style={thStyleDark}>Avg K/D/A</th>
                <th style={thStyleDark}>Avg Last Hits</th>
                <th style={thStyleDark}>Avg GPM</th>
                <th style={thStyleDark}>Avg XPM</th>
              </tr>
            </thead>
            <tbody>
              {heroPlayerStats.map(player => (
                <tr key={player.HeroId}>
                  <td style={tdStyleDark}>
                    <Link to={`/player/${player.PlayerId}`} style={{ color: '#9fb0ff' }}>{player.PlayerName}</Link>
                  </td>
                  <td style={tdStyleDark}>{player.GamesPlayed}</td>
                  <td style={tdStyleDark}>{player.WinPercentage?.toFixed(2)}%</td>
                  <td style={tdStyleDark}>{player.AvgKills.toFixed(1)}/{player.AvgDeaths.toFixed(1)}/{player.AvgAssists.toFixed(1)}</td>
                  <td style={tdStyleDark}>{player.AvgLastHits.toFixed(1)}</td>
                  <td style={tdStyleDark}>{player.AvgGPM.toFixed(1)}</td>
                  <td style={tdStyleDark}>{player.AvgXPM.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'teams' && (
          <table style={tableStyleDark}>
            <thead>
              <tr>
                <th style={thStyleDark}>Team</th>
                <th style={thStyleDark}>Games</th>
                <th style={thStyleDark}>Win %</th>
                <th style={thStyleDark}>Avg K/D/A</th>
                <th style={thStyleDark}>Avg Last Hits</th>
                <th style={thStyleDark}>Avg GPM</th>
                <th style={thStyleDark}>Avg XPM</th>
              </tr>
            </thead>
            <tbody>
              {heroTeamStats.map(team => (
                <tr key={team.TeamId}>
                  <td style={tdStyleDark}><Link to={`/team/${team.TeamId}`} style={{ color: '#9fb0ff' }}>{team.TeamName}</Link></td>
                  <td style={tdStyleDark}>{team.GamesPlayed}</td>
                  <td style={tdStyleDark}>{team.WinPercentage?.toFixed(2)}%</td>
                  <td style={tdStyleDark}>{team.AvgKills.toFixed(1)}/{team.AvgDeaths.toFixed(1)}/{team.AvgAssists.toFixed(1)}</td>
                  <td style={tdStyleDark}>{team.AvgLastHits?.toFixed(2)}</td>
                  <td style={tdStyleDark}>{team.AvgGPM?.toFixed(2)}</td>
                  <td style={tdStyleDark}>{team.AvgXPM?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === 'leagues' && (
          <table style={tableStyleDark}>
            <thead>
              <tr>
                <th style={thStyleDark}>League</th>
                <th style={thStyleDark}>Games</th>
                <th style={thStyleDark}>Win %</th>
                <th style={thStyleDark}>Avg K/D/A</th>
                <th style={thStyleDark}>Avg Last Hits</th>
                <th style={thStyleDark}>Avg GPM</th>
                <th style={thStyleDark}>Avg XPM</th>
              </tr>
            </thead>
            <tbody>
              {leagueHeroStats.map(league => (
                <tr key={league.LeagueId}>
                  <td style={tdStyleDark}><Link to={`/league/${league.LeagueId}`} style={{ color: '#9fb0ff' }}>{league.LeagueName}</Link></td>
                  <td style={tdStyleDark}>{league.GamesPlayed}</td>
                  <td style={tdStyleDark}>{league.WinPercentage?.toFixed(2)}%</td>
                  <td style={tdStyleDark}>{league.AvgKills.toFixed(1)}/{league.AvgDeaths.toFixed(1)}/{league.AvgAssists.toFixed(1)}</td>
                  <td style={tdStyleDark}>{league.AvgLastHits?.toFixed(2)}</td>
                  <td style={tdStyleDark}>{league.AvgGPM?.toFixed(2)}</td>
                  <td style={tdStyleDark}>{league.AvgXPM?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Styles
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "700px" };
const tableStyleDark = { width: "100%", borderCollapse: "collapse", minWidth: "700px", background: 'transparent' };
const thStyleDark = { border: "1px solid #222428", padding: "8px", textAlign: "center", color: '#e6e6e6', background: '#0f1112' };
const tdStyleDark = { border: "1px solid #222428", padding: "8px", textAlign: "center", color: '#e6e6e6' };
const tabStyleDark = { padding: "0.5rem 1rem", cursor: "pointer", background: '#0b0b0b', color: '#e6e6e6', border: '1px solid #222428', borderRadius: 6 };
const activeTabStyleDark = { ...tabStyleDark, fontWeight: "bold", boxShadow: '0 0 0 2px rgba(255,255,255,0.04)'};
