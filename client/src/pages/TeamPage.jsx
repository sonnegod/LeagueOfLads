import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import TeamRecentMatches from '../components/TeamRecentMatches';
import TeamPlayers from '../components/TeamPlayers';
import LeagueFilter from '../components/LeagueFilter';
import HeroDisplay from '../components/HeroDisplay';
import TeamHomeTab from '../components/TeamHomeTab';
import TeamDrafts from '../components/TeamDrafts';
import TeamRosterHistory from '../components/TeamRosterHistory';
import DotabuffLink from '../components/DotabuffLink';
import './DetailPages.css';
const PerformancePanel = lazy(() => import('../components/PerformancePanel'));


export default function TeamPage() {
  const { teamId: routeTeamId, teamSubmissionId } = useParams();
  const [resolvedTeamId, setResolvedTeamId] = useState(null);
  const teamId = routeTeamId || resolvedTeamId;
  const [teamName, setTeamName] = useState('');
  const [roster, setRoster] = useState(null);
  const [latestLineup, setLatestLineup] = useState(null);
  const [error, setError] = useState('');
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
    const controller = new AbortController();
    const pageKey = teamSubmissionId ? `submission:${teamSubmissionId}` : `team:${routeTeamId}`;
    async function request(url) {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load team');
      return data;
    }
    async function fetchTeamInfo() {
      const hasLoadedTeam = loadedTeamIdRef.current === pageKey;
      if (hasLoadedTeam) {
        setUpdating(true);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        let signupRoster = null;
        let effectiveTeamId = routeTeamId;
        if (teamSubmissionId) {
          signupRoster = (await request(`/api/teamRosters/${teamSubmissionId}`)).roster;
          effectiveTeamId = signupRoster.TeamId;
        }
        if (!effectiveTeamId) {
          if (controller.signal.aborted) return;
          setResolvedTeamId(null);
          setRoster(signupRoster);
          setLatestLineup(null);
          setTeamName(signupRoster.TeamName);
          setMatches([]);
          setTeamLeagues([]);
          setHeroes([]);
          setPlayers([]);
          setDraftData({ matches: [], topPicks: [], topBans: [] });
          loadedTeamIdRef.current = pageKey;
          return;
        }
        const query = selectedLeague === 'all' ? '' : `?leagueId=${encodeURIComponent(selectedLeague)}`;
        const [data, playersData, draftsData] = await Promise.all([
          request(`/api/teams/${effectiveTeamId}${query}`),
          request(`/api/teams/${effectiveTeamId}/players${query}`),
          request(`/api/teams/${effectiveTeamId}/drafts${query}`),
        ]);
        if (controller.signal.aborted) return;
        const selectedRoster = signupRoster && (selectedLeague === 'all'
          || String(signupRoster.LeagueId) === String(selectedLeague)) ? signupRoster : data.roster;
        setResolvedTeamId(effectiveTeamId);
        setRoster(selectedRoster);
        setLatestLineup(data.latestLineup || null);
        setTeamName(selectedRoster?.TeamName || data.teamName[0]?.TeamName || `Team ${effectiveTeamId}`);
        setMatches(data.teamMatches);
        setTeamLeagues(data.teamLeagues);
        setHeroes(data.teamHeroes || []);
        setPlayers(playersData || []);
        setDraftData({
          matches: draftsData.matches || [],
          topPicks: draftsData.topPicks || [],
          topBans: draftsData.topBans || [],
        });
        loadedTeamIdRef.current = pageKey;

      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setUpdating(false);
        }
      }
    }
    fetchTeamInfo();
    return () => controller.abort();
  }, [routeTeamId, teamSubmissionId, selectedLeague]);

  if (loading) return <div>Loading...</div>;
  if (error) return <p role="alert">{error}</p>;

  return (
    <div className="detail-page team-detail-page" style={{ padding: '1rem' }}>
      <div className="team-page-heading">
        <div className="team-page-title"><h1>{teamName}</h1>
          {roster?.SeasonStatus==='active'&&roster.CaptainId>0&&<p className="team-page-captain">Captain: <Link to={`/player/${roster.CaptainId}`}>{roster.CaptainName||`Player ${roster.CaptainId}`}</Link></p>}
        </div>
        <DotabuffLink teamId={teamId} name={teamName} />
      </div>
      {(roster || teamId) && <TeamRosterHistory roster={roster || { TeamId: teamId }} leagueId={selectedLeague} />}
      {!teamId && <p>No matches recorded yet.</p>}

      {teamId && (activeTab === 'home' || activeTab === 'recent' || activeTab === 'players' || activeTab === 'heroes' || activeTab === 'drafts') && (
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
      {teamId && <div className="detail-page-tabs ui-tabs" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button className="ui-tab" aria-pressed={activeTab === 'home'} onClick={() => setActiveTab('home')}>Home</button>
        <button className="ui-tab" aria-pressed={activeTab === 'performance'} onClick={() => setActiveTab('performance')}>Performance</button>
        <button className="ui-tab" aria-pressed={activeTab === 'recent'} onClick={() => setActiveTab('recent')}>Recent Matches</button>
        <button className="ui-tab" aria-pressed={activeTab === 'players'} onClick={() => setActiveTab('players')}>Players</button>
        {/*<button onClick={() => setActiveTab('averages')}>Averages</button>*/}
        <button className="ui-tab" aria-pressed={activeTab === 'heroes'} onClick={() => setActiveTab('heroes')}>Heroes</button>
        <button className="ui-tab" aria-pressed={activeTab === 'drafts'} onClick={() => setActiveTab('drafts')}>Drafts</button>
      </div>}

      {/* Tab Content */}
      {teamId && activeTab === 'performance' && <Suspense fallback={<p role="status">Loading performance…</p>}>
        <PerformancePanel key={`${teamId}:${selectedLeague}`} type="team" id={teamId} leagueId={selectedLeague} seasons={teamLeagues} onLeagueChange={setSelectedLeague} />
      </Suspense>}
      {(teamId || roster) && activeTab === 'home' && (
        <TeamHomeTab
          teamId={teamId}
          roster={roster || latestLineup}
          matches={matches}
          heroes={heroes}
          players={players}
        />
      )}
      {teamId && activeTab === 'recent' && <div className="detail-table-scroll"><TeamRecentMatches matches={matches} leagueId={selectedLeague} /></div>}
      {teamId && activeTab === 'players' && <div className="detail-table-scroll"><TeamPlayers teamId={teamId} leagueId={selectedLeague} /></div>}
      {/*activeTab === 'averages' && <TeamAverages teamId={teamId} />*/}
      {teamId && activeTab === 'heroes' && (
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
      {teamId && activeTab === 'drafts' && <TeamDrafts draftData={draftData} />}
    </div>
  );
}

// Styles
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdStyle = { border: "1px solid var(--border, #222428)", padding: "8px", textAlign: "left", color: 'var(--text, #e6e6e6)' };
const tdCenter = { border: "1px solid #ccccccff", padding: "8px", textAlign: "center" };
