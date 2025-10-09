// src/pages/MatchPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function MatchPage() {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMatch() {
      setLoading(true);
      try {
        const res = await fetch(`/api/matches/${matchId}`);
        const data = await res.json();
        console.log(data)
        setMatch(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchMatch();
  }, [matchId]);

  if (loading) return <div>Loading match...</div>;
  if (!match) return <div>Match not found</div>;

  const radiantPlayers = match.matchPlayers.slice(0, 5);
  const direPlayers = match.matchPlayers.slice(5, 10);

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    border: '1px solid #ccc',
  };

  const thTdStyle = {
    border: '1px solid #ccc',
    padding: '6px',
    textAlign: 'center',
  };

  return (
    <div style={{ width: '100%', margin: '0 auto', padding: '1rem' }}>
      <h1>Match {match.match[0].MatchId}</h1>
      <p><strong>Date:</strong> {match.match[0].DatePlayed}</p>
      <p><strong>League:</strong><Link to={`/league/${match.match[0].LeagueId}`}> {match.match[0].LeagueName}</Link></p>
      <p><strong>Duration:</strong> {Math.floor(match.match[0].Duration / 60)}:{(match.match[0].Duration % 60).toString().padStart(2, '0')}</p>
      {/* Teams side by side */}
      <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem' }}>
        {/* Radiant */}
        <div style={{ flex: 1, border: '2px solid #00796b', borderRadius: '8px', background: '#e0f7fa' }}>
          <div style={{ textAlign: 'center', padding: '0.5rem', fontWeight: 'bold', borderBottom: '2px solid #00796b' }}>
            <Link to={`/team/${match.match[0].rad_team_id}`}>{match.match[0].rad_team_name}{match.match[0].WinnerSide === 'r' && '♔'}</Link>
          </div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thTdStyle}>Player</th>
                <th style={thTdStyle}>Hero</th>
                <th style={thTdStyle}>K</th>
                <th style={thTdStyle}>D</th>
                <th style={thTdStyle}>A</th>
                <th style={thTdStyle}>LH</th>
                <th style={thTdStyle}>Hero Dmg</th>
                <th style={thTdStyle}>Healing</th>
                <th style={thTdStyle}>Tower Dmg</th>
                <th style={thTdStyle}>GPM</th>
                <th style={thTdStyle}>XPM</th>
              </tr>
            </thead>
            <tbody>
              {radiantPlayers.map(p => (
                <tr key={p.PlayerId}>
                  <td style={thTdStyle}><Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link></td>
                  <td style={thTdStyle}><Link to={`/hero/${p.HeroId}`}>{p.HeroName}</Link></td>
                  <td style={thTdStyle}>{p.Kills}</td>
                  <td style={thTdStyle}>{p.Deaths}</td>
                  <td style={thTdStyle}>{p.Assists}</td>
                  <td style={thTdStyle}>{p.Lasthits}</td>
                  <td style={thTdStyle}>{p.HeroDamage}</td>
                  <td style={thTdStyle}>{p.Healing}</td>
                  <td style={thTdStyle}>{p.TowerDamage}</td>
                  <td style={thTdStyle}>{p.GPM}</td>
                  <td style={thTdStyle}>{p.XPM}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Dire */}
        <div style={{ flex: 1, border: '2px solid #c62828', borderRadius: '8px', background: '#ffebee' }}>
          <div style={{ textAlign: 'center', padding: '0.5rem', fontWeight: 'bold', borderBottom: '2px solid #c62828' }}>
            <Link to={`/team/${match.match[0].dire_team_id}`}>{match.match[0].dire_team_name}{match.match[0].WinnerSide === 'd' && '♔'}</Link>
          </div>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thTdStyle}>Player</th>
                <th style={thTdStyle}>Hero</th>
                <th style={thTdStyle}>K</th>
                <th style={thTdStyle}>D</th>
                <th style={thTdStyle}>A</th>
                <th style={thTdStyle}>LH</th>
                <th style={thTdStyle}>Hero Dmg</th>
                <th style={thTdStyle}>Healing</th>
                <th style={thTdStyle}>Tower Dmg</th>
                <th style={thTdStyle}>GPM</th>
                <th style={thTdStyle}>XPM</th>
              </tr>
            </thead>
            <tbody>
              {direPlayers.map(p => (
                <tr key={p.PlayerId}>
                  <td style={thTdStyle}><Link to={`/player/${p.PlayerId}`}>{p.PlayerName}</Link></td>
                  <td style={thTdStyle}><Link to={`/hero/${p.HeroId}`}>{p.HeroName}</Link></td>
                  <td style={thTdStyle}>{p.Kills}</td>
                  <td style={thTdStyle}>{p.Deaths}</td>
                  <td style={thTdStyle}>{p.Assists}</td>
                  <td style={thTdStyle}>{p.Lasthits}</td>
                  <td style={thTdStyle}>{p.HeroDamage}</td>
                  <td style={thTdStyle}>{p.Healing}</td>
                  <td style={thTdStyle}>{p.TowerDamage}</td>
                  <td style={thTdStyle}>{p.GPM}</td>
                  <td style={thTdStyle}>{p.XPM}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: '2rem', marginBottom: '2rem' }}> 
            <h2 style={{ textAlign: 'center', marginBottom: '1rem' }}> 
                Picks and Bans 
                </h2> 
                <table style={tableStyle}> 
                    <thead> 
                    <tr> 
                        <th style={thTdStyle}>
                            Team
                        </th> 
                        <th style={thTdStyle}>
                            Action
                        </th> 
                        <th style={thTdStyle}>
                            Hero
                        </th> 
                    </tr> 
                    </thead> 
                    <tbody>
                      {match.matchPicksBans.map((pb, index) => (
                        <tr key={index}>
                          <td style={thTdStyle}>
                            {pb.Team === 0 ? (
                              <span style={{ color: '#00796b', fontWeight: 'bold' }}>Radiant</span>
                            ) : (
                              <span style={{ color: '#b71c1c', fontWeight: 'bold' }}>Dire</span>
                            )}
                          </td>
                          <td style={thTdStyle}>{pb.IsPick ? 'Pick' : 'Ban'}</td>
                          <td style={thTdStyle}>
                            <Link to={`/hero/${pb.HeroId}`}>{pb.HeroName}</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                </table> 
            </div> 

      {/* Teams summary */}
      <h2 style={{ marginTop: '2rem' }}>Teams</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thTdStyle}>Team</th>
            <th style={thTdStyle}>Games Played</th>
            <th style={thTdStyle}>Win %</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={thTdStyle}><Link to={`/team/${match.match[0].rad_team_id}`}>{match.match[0].rad_team_name}</Link></td>
            <td style={thTdStyle}>{match.teamSeasonRad[0].GamesPlayed}</td>
            <td style={thTdStyle}>{match.teamSeasonRad[0].WinPercentage?.toFixed(2)}</td>
          </tr>
          <tr>
            <td style={thTdStyle}><Link to={`/team/${match.match[0].dire_team_id}`}>{match.match[0].dire_team_name}</Link></td>
            <td style={thTdStyle}>{match.teamSeasonDire[0].GamesPlayed}</td>
            <td style={thTdStyle}>{match.teamSeasonDire[0].WinPercentage?.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
