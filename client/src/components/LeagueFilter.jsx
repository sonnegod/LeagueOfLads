import { useLeagues } from '../context/LeagueContext';

export default function LeagueFilter({ value, onChange, leagues: customLeagues }) {
  const { leagues: globalLeagues, loading } = useLeagues();

  // If parent passes custom leagues, use those; otherwise use global list
  const leagues = customLeagues && customLeagues.length > 0 ? customLeagues : globalLeagues;


  if (loading && !customLeagues) {
    return (
      <select disabled>
        <option>Loading...</option>
      </select>
    );
  }

  return (
    <select
      className="league-filter"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ background: 'black', color: 'white', border: '1px solid var(--border, #222428)', padding: '6px', borderRadius: 6 }}
    >
      <option value="all">All Leagues</option>
      {leagues.map((league) => (
        <option key={league.LeagueId} value={league.LeagueId}>
          {league.LeagueName}
        </option>
      ))}
    </select>
  );
}
