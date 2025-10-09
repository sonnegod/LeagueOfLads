import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import TeamRecentMatches from '../components/TeamRecentMatches';
import TeamAverages from '../components/TeamAverages';
import TeamPlayers from '../components/TeamPlayers';
import LeagueFilter from '../components/LeagueFilter';


export default function TeamPage() {
  const { teamId } = useParams();
  const [teamName, setTeamName] = useState('');
  const [matches, setMatches] = useState([]);
  const [heroes, setHeroes] = useState([]); // New: hero stats
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('recent');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [teamLeagues, setTeamLeagues] = useState([]);

  useEffect(() => {
    async function fetchTeamInfo() {
      setLoading(true);
      try {
        const url = new URL(`/api/teams/${teamId}`, window.location.origin);
        if (selectedLeague !== 'all') {
          url.searchParams.append('leagueId', selectedLeague);
        }
        const res = await fetch(url.toString());
        const data = await res.json();


        setTeamName(data.teamName[0].TeamName);
        setMatches(data.teamMatches);
        setTeamLeagues(data.teamLeagues);

        if (data.teamHeroes) {
          setHeroes(data.teamHeroes); // Populate hero data if returned
        }

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTeamInfo();
  }, [teamId, selectedLeague]);

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ padding: '1rem' }}>
      <h1>{teamName}</h1>

      {(activeTab === 'recent' || activeTab === 'players') && (
        <div style={{ marginBottom: '1rem' }}>
          <LeagueFilter
            leagues={teamLeagues}
            value={selectedLeague}
            onChange={setSelectedLeague}
          />
        </div>
      )}

      {/* Tab Buttons */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={() => setActiveTab('recent')}>Recent Matches</button>
        <button onClick={() => setActiveTab('players')}>Players</button>
        {/*<button onClick={() => setActiveTab('averages')}>Averages</button>*/}
        <button onClick={() => setActiveTab('heroes')}>Heroes</button>
      </div>

      {/* Tab Content */}
      {activeTab === 'recent' && <TeamRecentMatches matches={matches} leagueId={selectedLeague} />}
      {activeTab === 'players' && <TeamPlayers teamId={teamId} leagueId={selectedLeague} />}
      {/*activeTab === 'averages' && <TeamAverages teamId={teamId} />*/}
      {activeTab === 'heroes' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
            {heroes.map(hero => (
              <tr key={hero.HeroId}>
                <td style={tdStyle}>
                  <Link to={`/hero/${hero.HeroId}`}>{hero.HeroName}</Link>
                  </td>
                <td style={tdCenter}>{hero.GamesPlayed}</td>
                <td style={tdCenter}>{hero.WinPercentage?.toFixed(2)}%</td>
                <td style={tdCenter}>
                  {hero.AvgKills.toFixed(1)}/{hero.AvgDeaths.toFixed(1)}/{hero.AvgAssists.toFixed(1)}
                </td>
                <td style={tdCenter}>{hero.AvgLastHits.toFixed(2)}</td>
                <td style={tdCenter}>{hero.AvgGPM.toFixed(2)}</td>
                <td style={tdCenter}>{hero.AvgXPM.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Styles
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "left",color: 'black' };
const tdCenter = { border: "1px solid #ccccccff", padding: "8px", textAlign: "center" };
