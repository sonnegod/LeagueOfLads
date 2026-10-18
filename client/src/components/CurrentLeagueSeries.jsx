import { useEffect, useMemo, useState } from 'react';
import LeagueSeriesTab from './LeagueSeriesTab';

export default function CurrentLeagueSeries({ leagueId }) {
  const [seriesList, setSeriesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function fetchSeries() {
      setLoading(true);
      setError('');
      try {
        const url = leagueId
          ? '/api/homepageSeries?leagueId=' + encodeURIComponent(leagueId)
          : '/api/homepageSeries';
        const response = await fetch(url, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error('Unable to load series');
        setSeriesList(data);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError('Unable to load series. Please try again.');
          setSeriesList([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchSeries();
    return () => controller.abort();
  }, [leagueId]);

  const matches = useMemo(() => seriesList.flatMap(series => (series.seriesMatches || []).map(match => ({
    ...match,
    SeriesId: series.SeriesId,
    RadiantTeamId: match.rad_team_id,
    RadiantTeamName: match.rad_team_name,
    DireTeamId: match.dire_team_id,
    DireTeamName: match.dire_team_name,
  }))), [seriesList]);

  if (loading) return <div>Loading series...</div>;
  if (error) return <div role="alert">{error}</div>;
  return <LeagueSeriesTab key={leagueId || 'current'} series={seriesList} matches={matches} />;
}
