// src/components/RecentMatchTable.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';


import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
} from '@tanstack/react-table';

export default function RecentMatchTable() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch match data on mount
  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      try {
        const res = await fetch('/api/matches/recentMatches');
        const data = await res.json();
        setMatches(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchMatches();
  }, []);

  const columns = useMemo(() => [
    {
      id: 'expander',
      header: () => null,
      cell: ({ row }) =>
        row.getCanExpand() ? (
          <button onClick={row.getToggleExpandedHandler()}>
            {row.getIsExpanded() ? '▾' : '▸'}
          </button>
        ) : null,
    },
    {
      accessorKey: 'MatchId',
      header: 'Match ID',
      cell: info => {
        const winner = info.row.original.WinnerSide;
        const isWinner = winner === 'r';
        return (
          <Link to={`/match/${info.row.original.MatchId}`}>
            {info.getValue()}
          </Link>
        );
      },
    },
    {
      accessorKey: 'rad_team_name',
      header: 'Radiant Team',
      cell: info => {
        const winner = info.row.original.WinnerSide;
        const isWinner = winner === 'r';
        return (
          <Link to={`/team/${info.row.original.rad_team_id}`}>
            {info.getValue()} {isWinner && '♔'}
          </Link>
        );
      },
    },
    {
      accessorKey: 'dire_team_name',
      header: 'Dire Team',
      cell: info => {
        const winner = info.row.original.WinnerSide;
        const isWinner = winner === 'd';
        return (
          <Link to={`/team/${info.row.original.dire_team_id}`}>
            {info.getValue()} {isWinner && '♔'}
          </Link>
        );
      },
    },
    {
      accessorKey: 'LeagueName',
      header: 'League Name',
      cell: info => {
        return (
          <Link to={`/league/${info.row.original.LeagueId}`}>
            {info.getValue()}
          </Link>
        );
      },
    },
  ], []);

  const table = useReactTable({
    data: matches,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: row => !!row.original.players?.length,
  });

  return (
    <div style={{
    width: '80vw',
    padding: '1rem',
    boxSizing: 'border-box',
    flex: 1 // allows it to grow
      }}>
      {loading && <div>Loading...</div>}
      {!loading && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} style={{ border: '1px solid #ccc', padding: '8px' }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <React.Fragment key={row.id}>
                <tr>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={{ border: '1px solid #ccc', padding: '8px' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {row.getIsExpanded() && (
                    <tr>
                        <td
                        colSpan={columns.length}
                        style={{
                            background: '#f9f9f9',
                            padding: '10px 20px',
                            borderTop: '2px solid #ccc',    // upper border
                            //borderBottom: '2px solid #ccc', // lower border
                            paddingLeft: '60px',             // indent nested content a bit
                            boxSizing: 'border-box',
                        }}
                        >
                        <PlayerTable players={row.original.players} />
                        </td>
                    </tr>
                    )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlayerTable({ players }) {
  if (!players?.length) return <div>No player data</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th>Player</th>
          <th>Hero</th>
          <th>Kills</th>
          <th>Deaths</th>
          <th>Assists</th>
          <th>Last Hits</th>
          <th>Hero Damage</th>
          <th>Tower Damage</th>
          <th>Healing</th>
          <th>GPM</th>
          <th>XPM</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, idx) => (
          <React.Fragment key={idx}>
            {idx === 0 && (
              <tr>
                <td colSpan={11} style={{
                  textAlign: 'center',
                  fontWeight: 'bold',
                  background: '#e0f7fa',
                  padding: '6px 0'
                }}>
                  Radiant
                </td>
              </tr>
            )}
            <tr
              key={idx}
              style={{
                borderTop: '1px solid #ccc',
                borderBottom: '1px solid #ccc',
              }}>
              <td >
                  <Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link>
              </td>
              <td style={{ textAlign: 'center' }}>
                  <Link to={`/hero/${p.HeroId}`}>{p.HeroName}</Link>
              </td>
              <td style={{ textAlign: 'center' }}>{p.Kills}</td>
              <td style={{ textAlign: 'center' }}>{p.Deaths}</td>
              <td style={{ textAlign: 'center' }}>{p.Assists}</td>
              <td style={{ textAlign: 'center' }}>{p.LastHits}</td>
              <td style={{ textAlign: 'center' }}>{p.HeroDamage}</td>
              <td style={{ textAlign: 'center' }}>{p.TowerDamage}</td>
              <td style={{ textAlign: 'center' }}>{p.Healing}</td>
              <td style={{ textAlign: 'center' }}>{p.GPM}</td>
              <td style={{ textAlign: 'center' }}>{p.XPM}</td>
            </tr>
            {idx === 4 && (
            <tr>
              <td colSpan={11} style={{
                textAlign: 'center',
                fontWeight: 'bold',
                background: '#ffebee',
                padding: '6px 0'
              }}>
                Dire
              </td>
            </tr>
          )}
        </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}
