import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';

// --- NEW COMPONENT: EXTRACTED MATCH DETAIL VIEW ---
// This component displays the stats for a single game.
const MatchDetailsTable = ({ matchData, matchNum, styles }) => {
    // Note: matchData here is expected to be a single item from the series matches array
    const match = matchData; // Access the main match info
    
    // Safety check for players/picks/bans before slicing
    if (!matchData.matchPlayers || !matchData.matchPicksBans) {
        return <div style={{ textAlign: 'center', padding: '20px' }}>Loading match details...</div>;
    }
    
    const radiantPlayers = matchData.matchPlayers.slice(0, 5);
    const direPlayers = matchData.matchPlayers.slice(5, 10);

    // Reusing styles from the parent scope
    const { tableStyle, thTdStyle } = styles;
    
    // Helper to format duration
    const durationMinutes = Math.floor(match.Duration / 60);
    const durationSeconds = (match.Duration % 60).toString().padStart(2, '0');

    return (
        <div style={{ marginTop: '2rem' }}>
            <h3 style={{ marginBottom: '1rem', textAlign: 'center' }}>
                Duration:
                <span style={{ fontSize: '0.8em', color: '#666', marginLeft: '10px' }}>
                    ({durationMinutes}:{durationSeconds})
                </span>
            </h3>
            
            {/* Link to the dedicated Match Page */}
            <p style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <Link to={`/match/${match.MatchId}`} style={{ color: '#007bff', fontWeight: 'bold' }}>
                    View Full Match Details ({match.MatchId}) →
                </Link>
            </p>

            {/* Teams side by side - Match Player Stats */}
            <div style={{ display: 'flex', gap: '2rem' }}>
                {/* Radiant */}
                <div style={{ flex: 1, border: '2px solid #00796b', borderRadius: '8px', background: '#e0f7fa' }}>
                    <div style={{ textAlign: 'center', padding: '0.5rem', fontWeight: 'bold', borderBottom: '2px solid #00796b' }}>
                        <Link to={`/team/${match.rad_team_id}`}>{match.rad_team_name}{match.WinnerSide === 'r' && ' 👑'}</Link>
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
                        <Link to={`/team/${match.dire_team_id}`}>{match.dire_team_name}{match.WinnerSide === 'd' && ' 👑'}</Link>
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

            {/* Picks and Bans Table */}
            <div style={{ marginTop: '2rem', marginBottom: '2rem' }}> 
                <h3 style={{ textAlign: 'center', marginBottom: '1rem' }}> 
                    Picks and Bans 
                </h3> 
                <table style={{...tableStyle, maxWidth: '600px', margin: '0 auto'}}> 
                    <thead> 
                    <tr> 
                        <th style={thTdStyle}>Team</th> 
                        <th style={thTdStyle}>Action</th> 
                        <th style={thTdStyle}>Hero</th> 
                    </tr> 
                    </thead> 
                    <tbody>
                        {matchData.matchPicksBans.map((pb, index) => (
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
        </div>
    );
};
// --- END MATCH DETAIL COMPONENT ---


export default function SeriesPage() {
    const { seriesId } = useParams();
    const [seriesData, setSeriesData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeMatchIndex, setActiveMatchIndex] = useState(0); 

    // --- Data Fetching ---
    useEffect(() => {
        async function fetchSeries() {
            setLoading(true);
            try {
                const res = await fetch(`/api/series/${seriesId}`);
                const data = await res.json();
                console.log(data);
                setSeriesData(data);
                setActiveMatchIndex(0); 

            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        fetchSeries();
    }, [seriesId]);


    // --- Loading and Error States ---
    if (loading) return <div>Loading series...</div>;
    if (!seriesData) return <div>Series not found or no matches recorded.</div>;

    const currentMatchData = seriesData.seriesMatchesWithData[activeMatchIndex];


    // Styles for tables and cells (reused from MatchPage)
    const styles = {
        tableStyle: {
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #ccc',
        },
        thTdStyle: {
            border: '1px solid #ccc',
            padding: '6px',
            textAlign: 'center',
        },
        button: {
            padding: '10px 15px',
            border: '1px solid #ccc',
            backgroundColor: '#f8f8f8',
            cursor: 'pointer',
            borderRadius: '4px'
        },
        activeButton: {
            padding: '10px 15px',
            border: '1px solid #007bff',
            backgroundColor: '#007bff',
            color: 'white',
            cursor: 'default',
            borderRadius: '4px'
        }
    };


    // --- Render ---
    return (
        <div style={{ width: '100%', margin: '0 auto', padding: '1rem' }}>
            
            {/* 1. MATCHUP HEADER */}
            <h1 style={{ textAlign: 'center', fontSize: '2rem', marginBottom: '0.5rem' }}>
                <Link to={`/team/${seriesData.series[0].Team1}`}>{seriesData.series[0].Team1Name}</Link> ({seriesData.series[0].Team1Wins}) vs. ({seriesData.series[0].Team2Wins}) <Link to={`/team/${seriesData.series[0].Team2}`}>{seriesData.series[0].Team2Name}</Link>
            </h1>

            
            <hr style={{ margin: '2rem 0', borderColor: '#ddd' }} />

            {/* 2. MATCH TABS (Buttons to select which game to view) */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                {seriesData.seriesMatchesWithData.map((matchData, index) => (
                    <button 
                        key={matchData.MatchId} 
                        onClick={() => setActiveMatchIndex(index)}
                        style={index === activeMatchIndex ? styles.activeButton : styles.button}
                    >
                        Game {index + 1}
                    </button>
                ))}
            </div>

            {/* 3. MATCH DETAILS TABLE (Content for the active game) */}
            {currentMatchData && (
                <MatchDetailsTable 
                    matchData={currentMatchData} 
                    matchNum={activeMatchIndex + 1} 
                    styles={styles}
                />
            )}
        </div>
    );
}