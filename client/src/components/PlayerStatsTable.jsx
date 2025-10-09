import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

export default function PlayerStatsTable({ data }) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  if (!data || data.length === 0) return <div>No player data available.</div>;

  // Sorting function
  const sortedData = useMemo(() => {
    if (!sortConfig.key) return data;

    return [...data].sort((a, b) => {
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

  // Handle header click to sort
  const onSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Display sort arrow
  const getSortArrow = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' 🔼' : ' 🔽';
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={thStyle} onClick={() => onSort('MatchId')}>Match ID{getSortArrow('MatchId')}</th>
          <th style={thStyle} onClick={() => onSort('HeroName')}>Hero Name{getSortArrow('HeroName')}</th>
          <th style={thStyle} onClick={() => onSort('Kills')}>Kills{getSortArrow('Kills')}</th>
          <th style={thStyle} onClick={() => onSort('Deaths')}>Deaths{getSortArrow('Deaths')}</th>
          <th style={thStyle} onClick={() => onSort('Assists')}>Assists{getSortArrow('Assists')}</th>
          <th style={thStyle} onClick={() => onSort('Lasthits')}>Last Hits{getSortArrow('Lasthits')}</th>
          <th style={thStyle} onClick={() => onSort('HeroDamage')}>Hero Damage{getSortArrow('HeroDamage')}</th>
          <th style={thStyle} onClick={() => onSort('TowerDamage')}>Tower Damage{getSortArrow('TowerDamage')}</th>
          <th style={thStyle} onClick={() => onSort('Healing')}>Healing{getSortArrow('Healing')}</th>
          <th style={thStyle} onClick={() => onSort('GPM')}>GPM{getSortArrow('GPM')}</th>
          <th style={thStyle} onClick={() => onSort('XPM')}>XPM{getSortArrow('XPM')}</th>
          <th style={thStyle} onClick={() => onSort('Winner')}>Win{getSortArrow('Winner')}</th>
          <th style={thStyle} onClick={() => onSort('LeagueName')}>League{getSortArrow('LeagueName')}</th>
        </tr>
      </thead>
      <tbody>
        {sortedData.map((player, idx) => (
          <tr>
            <td style={tdCenter}>
              <Link to={`/match/${player.MatchId}`}>{player.MatchId}</Link>
            </td>
            <td style={tdStyle}>
              <Link to={`/hero/${player.HeroId}`}>{player.HeroName}</Link>
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
  cursor: 'pointer', // show pointer cursor for clickable header
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
