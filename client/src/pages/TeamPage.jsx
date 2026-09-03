import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import TeamRecentMatches from '../components/TeamRecentMatches';
import TeamPlayers from '../components/TeamPlayers';
import LeagueFilter from '../components/LeagueFilter';
import HeroDisplay from '../components/HeroDisplay';
import TeamHomeTab from '../components/TeamHomeTab';
import TeamDrafts from '../components/TeamDrafts';
import './DetailPages.css';


export default function TeamPage() {
  const { teamId } = useParams();
  const [teamName, setTeamName] = useState('');
  const [matches, setMatches] = useState([]);
  const [heroes, setHeroes] = useState([]); // New: hero stats
  const [players, setPlayers] = useState([]);
  const [draftData, setDraftData] = useState({ matches: [], topPicks: [], topBans: [] });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [teamLeagues, setTeamLeagues] = useState([]);
  const loadedTeamIdRef = useRef(null);

  useEffect(() => {
    async function fetchTeamInfo() {
      const hasLoadedTeam = String(loadedTeamIdRef.current) === String(teamId);
      if (hasLoadedTeam) {
        setUpdating(true);
      } else {
        setLoading(true);
      }

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

        const playerUrl = new URL(`/api/teams/${teamId}/players`, window.location.origin);
        if (selectedLeague !== 'all') {
          playerUrl.searchParams.append('leagueId', selectedLeague);
        }
        const playersRes = await fetch(playerUrl.toString());
        const playersData = await playersRes.json();
        setPlayers(playersData || []);

        const draftsUrl = new URL(`/api/teams/${teamId}/drafts`, window.location.origin);
        if (selectedLeague !== 'all') {
          draftsUrl.searchParams.append('leagueId', selectedLeague);
        }
        const draftsRes = await fetch(draftsUrl.toString());
        const draftsData = await draftsRes.json();
        setDraftData({
          matches: draftsData.matches || [],
          topPicks: draftsData.topPicks || [],
          topBans: draftsData.topBans || [],
        });
        loadedTeamIdRef.current = teamId;

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
        setUpdating(false);
      }
    }
    fetchTeamInfo();
  }, [teamId, selectedLeague]);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="detail-page team-detail-page" style={{ padding: '1rem' }}>
      <h1>{teamName}</h1>

      {(activeTab === 'home' || activeTab === 'recent' || activeTab === 'players' || activeTab === 'heroes' || activeTab === 'drafts') && (
        <div className="detail-page-filter" style={{ marginBottom: '1rem' }}>
          <LeagueFilter
            leagues={teamLeagues}
            value={selectedLeague}
            onChange={setSelectedLeague}
          />
          {updating && <span style={{ marginLeft: '0.75rem', color: '#9ca3af' }}>Updating...</span>}
        </div>
      )}

      {/* Tab Buttons */}
      <div className="detail-page-tabs" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={() => setActiveTab('home')}>Home</button>
        <button onClick={() => setActiveTab('recent')}>Recent Matches</button>
        <button onClick={() => setActiveTab('players')}>Players</button>
        {/*<button onClick={() => setActiveTab('averages')}>Averages</button>*/}
        <button onClick={() => setActiveTab('heroes')}>Heroes</button>
        <button onClick={() => setActiveTab('drafts')}>Drafts</button>
      </div>

      {/* Tab Content */}
      {activeTab === 'home' && (
        <TeamHomeTab
          teamId={teamId}
          matches={matches}
          heroes={heroes}
          players={players}
        />
      )}
      {activeTab === 'recent' && <div className="detail-table-scroll"><TeamRecentMatches matches={matches} leagueId={selectedLeague} /></div>}
      {activeTab === 'players' && <div className="detail-table-scroll"><TeamPlayers teamId={teamId} leagueId={selectedLeague} /></div>}
      {/*activeTab === 'averages' && <TeamAverages teamId={teamId} />*/}
      {activeTab === 'heroes' && (
        <div className="detail-table-scroll"><table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse' }}>
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
                  <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} />
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
        </table></div>
      )}
      {activeTab === 'drafts' && <TeamDrafts draftData={draftData} />}
    </div>
  );
}

// Styles
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdStyle = { border: "1px solid var(--border, #222428)", padding: "8px", textAlign: "left", color: 'var(--text, #e6e6e6)' };
const tdCenter = { border: "1px solid #ccccccff", padding: "8px", textAlign: "center" };
