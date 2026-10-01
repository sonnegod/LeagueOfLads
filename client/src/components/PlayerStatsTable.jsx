import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';

const columns = [
  { key: 'MatchId', label: 'Match ID' },
  { key: 'HeroName', label: 'Hero Name' },
  { key: 'Kills', label: 'Kills' },
  { key: 'Deaths', label: 'Deaths' },
  { key: 'Assists', label: 'Assists' },
  { key: 'Lasthits', label: 'Last Hits' },
  { key: 'HeroDamage', label: 'Hero Damage' },
  { key: 'TowerDamage', label: 'Tower Damage' },
  { key: 'Healing', label: 'Healing' },
  { key: 'GPM', label: 'GPM' },
  { key: 'XPM', label: 'XPM' },
  { key: 'Winner', label: 'Win' },
  { key: 'LeagueName', label: 'League' },
];

export default function PlayerStatsTable({ data }) {
  const [sortConfig, setSortConfig] = useState({ key: 'MatchId', direction: 'desc' });

  const sortedData = useMemo(() => {
    return [...(data || [])].sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      // Convert to uppercase for string comparison to make it case insensitive
      if (typeof aVal === 'string') aVal = aVal.toUpperCase();
      if (typeof bVal === 'string') bVal = bVal.toUpperCase();

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  const onSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key
        ? (current.direction === 'desc' ? 'asc' : 'desc')
        : (key === 'HeroName' || key === 'LeagueName' ? 'asc' : 'desc'),
    }));
  };

  if (!data || data.length === 0) return <div>No player data available.</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{columns.map(column => <th key={column.key} style={thStyle}
          aria-sort={sortConfig.key === column.key
            ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
          <button className="detail-sort-button" type="button" onClick={() => onSort(column.key)}>
            {column.label}<span aria-hidden="true">{sortConfig.key === column.key
              ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
          </button>
        </th>)}</tr>
      </thead>
      <tbody>
        {sortedData.map(player => (
          <tr key={player.MatchId}>
            <td style={tdCenter}>
              <Link to={`/match/${player.MatchId}`}>{player.MatchId}</Link>
            </td>
            <td style={tdStyle}>
              <HeroDisplay heroId={player.HeroId} heroName={player.HeroName} />
            </td>
            <td style={tdCenter}>{player.Kills}</td>
            <td style={tdCenter}>{player.Deaths}</td>
            <td style={tdCenter}>{player.Assists}</td>
            <td style={tdCenter}>{player.Lasthits}</td>
            <td style={tdCenter}>{player.HeroDamage}</td>
            <td style={tdCenter}>{player.TowerDamage}</td>
            <td style={tdCenter}>{player.Healing}</td>
            <td style={tdCenter}>{player.GPM}</td>
            <td style={tdCenter}>{player.XPM}</td>
            <td style={tdCenter}>{player.Winner === 1 ? 'Yes' : 'No'}</td>
            <td style={tdStyle}>
              <Link to={`/league/${player.LeagueId}`}>{player.LeagueName}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle = {
  border: '1px solid #ccc',
  padding: '8px',
  textAlign: 'center',
};

const tdStyle = {
  border: '1px solid #ccc',
  padding: '8px',
  textAlign: 'left',
};

const tdCenter = {
  border: '1px solid #ccc',
  padding: '8px',
  textAlign: 'center',
};
