import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

const columns = [
  { key: 'MatchId', label: 'Match ID' },
  { key: 'PlayerName', label: 'Player Name' },
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
  { key: 'LeagueName', label: 'League Name' },
];

export default function HeroStatsTable({ data }) {
  const [sortConfig, setSortConfig] = useState({ key: 'MatchId', direction: 'desc' });

  const sortedData = useMemo(() => {
    return [...(data || [])].sort((a, b) => {
      const aValue = a[sortConfig.key], bValue = b[sortConfig.key];
      let comparison;
      if (sortConfig.key === 'PlayerName' || sortConfig.key === 'LeagueName') {
        comparison = String(aValue ?? '').localeCompare(String(bValue ?? ''), undefined,
          { sensitivity: 'base', numeric: true });
      } else {
        const aMissing = aValue == null || !Number.isFinite(Number(aValue));
        const bMissing = bValue == null || !Number.isFinite(Number(bValue));
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        comparison = aMissing ? 0 : Number(aValue) - Number(bValue);
      }
      return (sortConfig.direction === 'asc' ? comparison : -comparison)
        || Number(b.MatchId) - Number(a.MatchId) || Number(a.PlayerId) - Number(b.PlayerId);
    });
  }, [data, sortConfig]);

  const onSort = (key) => {
    setSortConfig(current => ({ key, direction: current.key === key
      ? current.direction === 'desc' ? 'asc' : 'desc'
      : key === 'PlayerName' || key === 'LeagueName' ? 'asc' : 'desc' }));
  };

  if (!data || data.length === 0) return <div>No player data available.</div>;

  return (
    <div className="detail-table-scroll" style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', minWidth: '1100px', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{columns.map(column => <th key={column.key} style={thStyle}
          aria-sort={sortConfig.key === column.key
            ? sortConfig.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
          <button type="button" className="detail-sort-button" onClick={() => onSort(column.key)}>
            {column.label}<span aria-hidden="true">{sortConfig.key === column.key
              ? sortConfig.direction === 'asc' ? '▲' : '▼' : '↕'}</span>
          </button>
        </th>)}</tr>
      </thead>
      <tbody>
        {sortedData.map(player => (
          <tr key={`${player.MatchId}:${player.PlayerId}`}>
            <td style={tdStyle}>
                <Link to={`/match/${player.MatchId}`}>{player.MatchId}</Link>
            </td>
            <td style={tdStyle}>
                <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link>
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
    </div>
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
  color: 'var(--text, #e6e6e6)'
};

const tdCenter = {
  border: '1px solid #ccc',
  padding: '8px',
  textAlign: 'center',
};
