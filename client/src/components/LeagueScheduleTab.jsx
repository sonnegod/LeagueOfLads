import { useEffect, useState } from 'react';
import LeagueScheduleView from './LeagueScheduleView';

export default function LeagueScheduleTab({ leagueId }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/schedule`, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load the suggested matchups');
        const data = await response.json();
        if (!controller.signal.aborted) setPlan(data);
      } catch (err) { if (!controller.signal.aborted) setError(err.message); }
    }
    load();
    return () => controller.abort();
  }, [leagueId]);
  if (error) return <p role="alert">{error}</p>;
  if (!plan) return <p role="status">Loading matchups...</p>;
  return <section><h2>Regular Season Matchups</h2><LeagueScheduleView plan={plan} /></section>;
}
