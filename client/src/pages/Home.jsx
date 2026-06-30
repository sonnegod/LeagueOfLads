import { useEffect, useState } from 'react';
import LeaguePage from './LeaguePage';

export default function Home() {
  const [activeLeagueId, setActiveLeagueId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveLeague() {
      try {
        const response = await fetch('/api/leagueStage');
        const data = await response.json();
        const stageInfo = data[0] || data.stageInfo || null;
        const leagueId = stageInfo?.LeagueId || data.leagueId || null;

        if (!cancelled) setActiveLeagueId(leagueId);
      } catch (error) {
        console.error('Failed to load the active league', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadActiveLeague();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div>Loading current league...</div>;
  if (!activeLeagueId) return <div>No active league is available.</div>;

  return (
    <LeaguePage
      leagueIdOverride={activeLeagueId}
      stageTabsFirst
      defaultToCurrentStage
      alwaysShowGroups
    />
  );
}
