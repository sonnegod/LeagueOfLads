import { useEffect, useState } from 'react';
import MatchResultsTable from './MatchResultsTable';

export default function RecentMatchTable() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function fetchMatches() {
      try {
        const response = await fetch('/api/matches/recentMatches', { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error('Unable to load recent matches');
        setMatches(data.map(match => ({
          ...match,
          RadiantTeamId: match.rad_team_id,
          RadiantTeamName: match.rad_team_name,
          DireTeamId: match.dire_team_id,
          DireTeamName: match.dire_team_name,
          matchPlayers: match.players,
        })));
      } catch (err) {
        if (!controller.signal.aborted) setError('Unable to load recent matches. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchMatches();
    return () => controller.abort();
  }, []);

  if (loading) return <div>Loading matches...</div>;
  if (error) return <div role="alert">{error}</div>;
  if (!matches.length) return <div>No recent matches available.</div>;

  return <div className="recent-matches">
    <MatchResultsTable matches={matches} showLeague showDate />
  </div>;
}
