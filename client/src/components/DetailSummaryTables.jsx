import { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';

const tableStyle = { width: '100%', borderCollapse: 'collapse', minWidth: '700px' };
const cellStyle = { border: '1px solid #ccc', padding: '8px', textAlign: 'center' };
const compareNames = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined,
  { sensitivity: 'base', numeric: true });

function useSortedRows(rows, nameKey, idKey) {
  const [sort, setSort] = useState({ key: 'GamesPlayed', direction: 'desc' });
  const sorted = [...rows].sort((a, b) => {
    let comparison;
    if (sort.key === nameKey) comparison = compareNames(a[sort.key], b[sort.key]);
    else {
      const aValue = a[sort.key], bValue = b[sort.key];
      const aMissing = aValue == null || !Number.isFinite(Number(aValue));
      const bMissing = bValue == null || !Number.isFinite(Number(bValue));
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      comparison = aMissing ? 0 : Number(aValue) - Number(bValue);
    }
    return (sort.direction === 'asc' ? comparison : -comparison)
      || Number(b.GamesPlayed) - Number(a.GamesPlayed)
      || compareNames(a[nameKey], b[nameKey]) || Number(a[idKey]) - Number(b[idKey]);
  });
  const changeSort = key => setSort(current => ({ key,
    direction: current.key === key ? (current.direction === 'desc' ? 'asc' : 'desc')
      : key === nameKey ? 'asc' : 'desc',
  }));
  return { sorted, sort, changeSort };
}

function SortButton({ column, label, sort, changeSort, title }) {
  return <button className="detail-sort-button" type="button" onClick={() => changeSort(column)} title={title} aria-label={title}>
    {label}<span aria-hidden="true">{sort.key === column ? sort.direction === 'asc' ? '▲' : '▼' : '↕'}</span>
  </button>;
}

function SortHeader({ column, label, sort, changeSort, style = cellStyle }) {
  return <th style={style} aria-sort={sort.key === column
    ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <SortButton column={column} label={label} sort={sort} changeSort={changeSort} />
  </th>;
}

const heroColumns = [
  ['HeroName', 'Hero'], ['GamesPlayed', 'Games'], ['WinPercentage', 'Win %'],
  ['AvgLastHits', 'Avg Last Hits'], ['AvgGPM', 'Avg GPM'], ['AvgXPM', 'Avg XPM'],
];
const kdaColumns = [['AvgKills', 'K', 'kills'], ['AvgDeaths', 'D', 'deaths'], ['AvgAssists', 'A', 'assists']];

function KdaHeader({ sort, changeSort, style = cellStyle }) {
  return <th style={style} aria-label="Average kills, deaths, and assists"
    aria-sort={kdaColumns.some(([column]) => sort.key === column)
      ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <div className="detail-kda-sort"><span>Avg</span>{kdaColumns.map(([column, label, name], index) =>
      <span className="detail-kda-sort-part" key={column}>
        {index > 0 && <span aria-hidden="true">/</span>}
        <SortButton column={column} label={label} sort={sort} changeSort={changeSort}
          title={`Sort by average ${name}`} />
      </span>)}</div>
  </th>;
}

export function PlayerHeroesTable({ rows }) {
  const { sorted, sort, changeSort } = useSortedRows(rows, 'HeroName', 'HeroId');
  return <div className="detail-table-scroll"><table style={tableStyle}>
    <thead><tr>
      {heroColumns.slice(0, 3).map(([column, label]) => <SortHeader key={column} column={column}
        label={label} sort={sort} changeSort={changeSort} />)}
      <KdaHeader sort={sort} changeSort={changeSort} />
      {heroColumns.slice(3).map(([column, label]) => <SortHeader key={column} column={column}
        label={label} sort={sort} changeSort={changeSort} />)}
    </tr></thead>
    <tbody>{sorted.map(hero => <tr key={hero.HeroId}>
      <td style={cellStyle}><HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} /></td>
      <td style={cellStyle}>{hero.GamesPlayed}</td>
      <td style={cellStyle}>{hero.WinPercentage?.toFixed(2)}%</td>
      <td style={cellStyle}>{hero.AvgKills.toFixed(1)}/{hero.AvgDeaths.toFixed(1)}/{hero.AvgAssists.toFixed(1)}</td>
      <td style={cellStyle}>{hero.AvgLastHits.toFixed(1)}</td>
      <td style={cellStyle}>{hero.AvgGPM.toFixed(1)}</td>
      <td style={cellStyle}>{hero.AvgXPM.toFixed(1)}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function PlayerTeamsTable({ rows }) {
  const { sorted, sort, changeSort } = useSortedRows(rows, 'TeamName', 'TeamId');
  return <div className="detail-table-scroll"><table style={tableStyle}>
    <thead><tr>{[['TeamName', 'Team'], ['GamesPlayed', 'Games'], ['WinPercentage', 'Win %']]
      .map(([column, label]) => <SortHeader key={column} column={column} label={label}
        sort={sort} changeSort={changeSort} />)}</tr></thead>
    <tbody>{sorted.map(team => <tr key={team.TeamId}>
      <td style={cellStyle}><Link to={`/team/${team.TeamId}`}>{team.TeamName}</Link></td>
      <td style={cellStyle}>{team.GamesPlayed}</td>
      <td style={cellStyle}>{team.WinPercentage?.toFixed(2)}%</td>
    </tr>)}</tbody>
  </table></div>;
}

const darkCellStyle = { border: '1px solid #222428', padding: '8px', textAlign: 'center', color: '#e6e6e6' };
const darkHeaderStyle = { ...darkCellStyle, background: '#0f1112' };
const breakdownTypes = { players: ['Player', 'PlayerName', 'PlayerId', 'player'],
  teams: ['Team', 'TeamName', 'TeamId', 'team'], leagues: ['League', 'LeagueName', 'LeagueId', 'league'] };
const formatStat = (value, places) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(places);

export function HeroBreakdownTable({ rows = [], type }) {
  const [label, nameKey, idKey, route] = breakdownTypes[type];
  const { sorted, sort, changeSort } = useSortedRows(rows, nameKey, idKey);
  const precision = type === 'players' ? 1 : 2;
  return <div className="detail-table-scroll" style={{ overflowX: 'auto' }}><table style={{ ...tableStyle, background: 'transparent' }}>
    <thead><tr>
      {[[nameKey, label], ['GamesPlayed', 'Games'], ['WinPercentage', 'Win %']].map(([column, heading]) =>
        <SortHeader key={column} column={column} label={heading} sort={sort}
          changeSort={changeSort} style={darkHeaderStyle} />)}
      <KdaHeader sort={sort} changeSort={changeSort} style={darkHeaderStyle} />
      {heroColumns.slice(3).map(([column, heading]) => <SortHeader key={column} column={column}
        label={heading} sort={sort} changeSort={changeSort} style={darkHeaderStyle} />)}
    </tr></thead>
    <tbody>{sorted.map(row => <tr key={row[idKey]}>
      <td style={darkCellStyle}><Link to={`/${route}/${row[idKey]}`} style={{ color: '#9fb0ff' }}>{row[nameKey]}</Link></td>
      <td style={darkCellStyle}>{row.GamesPlayed}</td>
      <td style={darkCellStyle}>{row.WinPercentage == null ? '—' : `${formatStat(row.WinPercentage, 2)}%`}</td>
      <td style={darkCellStyle}>{formatStat(row.AvgKills, 1)}/{formatStat(row.AvgDeaths, 1)}/{formatStat(row.AvgAssists, 1)}</td>
      <td style={darkCellStyle}>{formatStat(row.AvgLastHits, precision)}</td>
      <td style={darkCellStyle}>{formatStat(row.AvgGPM, precision)}</td>
      <td style={darkCellStyle}>{formatStat(row.AvgXPM, precision)}</td>
    </tr>)}{!sorted.length && <tr><td style={darkCellStyle} colSpan="7">No {type} recorded for this hero.</td></tr>}</tbody>
  </table></div>;
}
