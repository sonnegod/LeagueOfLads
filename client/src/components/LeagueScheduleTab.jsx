import { useEffect, useState } from 'react';
import LeagueScheduleView from './LeagueScheduleView';
import {useAuth} from '../context/AuthContext';

export default function LeagueScheduleTab({ leagueId }) {
  const {user,loading:authLoading}=useAuth();
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if(authLoading)return;
    setPlan(null);setError('');
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
  }, [leagueId,user?.accountId,authLoading]);
  if (error) return <p role="alert">{error}</p>;
  if (!plan) return <p role="status">Loading matchups...</p>;
  return <section><h2>Regular Season Matchups</h2><LeagueScheduleView key={`${leagueId}:${user?.accountId||'guest'}`}
    plan={plan} defaultTeamEntryId={plan.viewerTeamEntryId} /></section>;
}
