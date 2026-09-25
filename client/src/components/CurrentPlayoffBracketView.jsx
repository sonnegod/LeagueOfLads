// SECTION: Read-Only Sub-Components
// These components are self-contained and only display data.
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './CurrentPlayoffBracketView.css';

const ReadOnlyRoundColumn = ({ title, children, styles }) => (
    <div style={styles.column}>
        <h4 style={styles.colTitle}>{title}</h4>
        <div style={styles.colBody}>{children}</div>
    </div>
);

const ReadOnlyTeamRow = ({ teamName, score, placeholder, styles, isWinner }) => {
    // Style adjustments for read-only view
    const winnerStyle = isWinner ? { backgroundColor: 'rgba(34, 197, 94, .16)', borderColor: 'rgba(74, 222, 128, .5)', fontWeight: 'bold' } : {};
    
    return (
        <div style={{ ...styles.teamRow, ...winnerStyle }}>
            <div style={styles.teamName}>
                <span style={{ color: teamName ? styles.scoreInput.color : 'var(--muted-text)', fontSize: '12px' }}>
                    {teamName || placeholder}
                </span>
            </div>
            {/* Score is a display span, not an input */}
            <span style={{ ...styles.scoreInput, border: 'none' }}>
                {score || 0}
            </span>
        </div>
    );
};

const ReadOnlyMatchCard = ({ match, isGrandFinal, styles, onMatchClick }) => {
    // Logic to determine winner (purely for visual cue)
    const s1 = parseInt(match.team1Score || 0);
    const s2 = parseInt(match.team2Score || 0);
    const isTeam1Winner = s1 > s2;
    const isTeam2Winner = s2 > s1;

    const isClickable = !!match.seriesId;

    // Visual cues
    const isDropRound = match.isDropRound;
    const cardStyle = {
        ...styles.card,
        border: isGrandFinal ? '1px solid #d4a72c' : '1px solid var(--border)',
        borderLeft: isDropRound ? '4px solid #f87171' : '4px solid #60a5fa',

        cursor: isClickable ? 'pointer' : 'default',
    };

    const handleClick = () => {
        if (isClickable && onMatchClick) {
            onMatchClick(match.seriesId);
        }
    };
    
    // Determine placeholder based on current match status
    const getPlaceholder = (bracket, round, slot) => {
        if (match.team1Id || match.team2Id) {
            return "TBD"; // Placeholder shouldn't show if a team is assigned
        }
        if (bracket === 'lower' && slot === 1 && round > 1) return "Winner LB";
        if (isDropRound && slot === 2) return "UB Loser";
        return "TBD";
    };

    return (
        <div style={cardStyle} onClick={handleClick}>
            <div style={styles.cardHeader}>
                <span>M{match.matchNum}</span>
                {isDropRound && <span style={styles.dropLabel}>UB Drop</span>}
            </div>

            {/* TEAM 1 ROW */}
            <ReadOnlyTeamRow 
                teamName={match.team1Name}
                score={match.team1Score}
                placeholder={getPlaceholder(match.bracket, match.round, 1)}
                styles={styles}
                isWinner={isTeam1Winner}
            />

            {/* TEAM 2 ROW */}
            <ReadOnlyTeamRow 
                teamName={match.team2Name}
                score={match.team2Score}
                placeholder={getPlaceholder(match.bracket, match.round, 2)}
                styles={styles}
                isWinner={isTeam2Winner}
            />
        </div>
    );
};

const CurrentPlayoffBracketView = ({ leagueId }) => {
    const [bracket, setBracket] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    const navigate = useNavigate(); 
    
    // Function to handle the click and navigation
    const handleMatchClick = (seriesId) => {
        if (seriesId) {
            // Adjust this path to match your actual series page route
            navigate(`/series/${seriesId}`); 
        }
    };

    useEffect(() => {
        const fetchBracket = async () => {
            try {
                setIsLoading(true);
                setError(null);

                // Use the correct dedicated API endpoint
                const url = leagueId
                    ? `/api/getCurrentBracket?leagueId=${leagueId}`
                    : "/api/getCurrentBracket";
                const response = await fetch(url);
                const data = await response.json();
                
                // The API should handle non-200 responses, but good to check status
                if (!response.ok) {
                     throw new Error(`Server returned status ${response.status}`);
                }

                // Assuming the API returns the structure under data.playoffBracket
                if (data.playoffBracket) {
                    setBracket(data.playoffBracket);
                } else {
                    setError("No active playoff bracket found.");
                }
            } catch (err) {
                console.error("Failed to fetch bracket data:", err);
                setError("Error loading the bracket. Please check back later.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchBracket();
    }, [leagueId]);

    // --- Loading and Error States ---
    if (isLoading) {
        return <div style={styles.loading}>Loading the playoff bracket...</div>;
    }

    if (error) {
        return <div style={styles.errorMessage}>Error: {error}</div>;
    }

    if (!bracket) {
        return <div style={styles.message}>No current bracket data available.</div>;
    }

    // --- Rendering the Read-Only Bracket View ---
    return (
        <div className="current-playoff-bracket" style={styles.container}>

            <div className="current-playoff-board" style={styles.board}>
                {/* --- UPPER BRACKET ROW --- */}
                <div style={styles.bracketRow}>
                    <div style={styles.bracketLabel}>Upper Bracket</div>
                    <div style={styles.roundsContainer}>
                        {bracket.upperBracket.map((round) => (
                            <ReadOnlyRoundColumn key={round.round} title={`Round ${round.round}`} styles={styles}>
                                {round.matches.map(m => (
                                    <ReadOnlyMatchCard 
                                        key={m.id} 
                                        match={m} 
                                        styles={styles}
                                        onMatchClick={handleMatchClick}
                                    />
                                ))}
                            </ReadOnlyRoundColumn>
                        ))}
                        
                        {/* Grand Finals (Visual Placement) */}
                        <ReadOnlyRoundColumn title="Grand Finals" styles={styles}>
                            <ReadOnlyMatchCard 
                                match={bracket.grandFinals[0]} 
                                isGrandFinal={true}
                                styles={styles}
                                onMatchClick={handleMatchClick}
                            />
                        </ReadOnlyRoundColumn>
                    </div>
                </div>

                {/* --- DIVIDER --- */}
                <hr style={styles.separator} />

                {/* --- LOWER BRACKET ROW --- */}
                <div style={styles.bracketRow}>
                    <div style={styles.bracketLabel}>Lower Bracket</div>
                    <div style={styles.roundsContainer}>
                        {bracket.lowerBracket.map((round) => (
                            <ReadOnlyRoundColumn key={round.round} title={`Round ${round.round}`} styles={styles}>
                                {round.matches.map(m => (
                                    <ReadOnlyMatchCard 
                                        key={m.id} 
                                        match={m} 
                                        styles={styles}
                                        onMatchClick={handleMatchClick}
                                    />
                                ))}
                            </ReadOnlyRoundColumn>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// SECTION 3: STYLES (Copied and merged)
// ==========================================

const styles = {
    // ... (Copied styles remain the same, ensuring consistency) ...
    container: {
        padding: 'clamp(1rem, 2vw, 1.5rem)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh',
        overflowX: 'hidden'
    },
    header: {
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        marginBottom: '20px',
        padding: '10px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)'
    },
    board: {
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'auto',
        paddingBottom: '50px'
    },
    bracketRow: {
        marginBottom: '20px'
    },
    bracketLabel: {
        fontSize: '18px',
        fontWeight: 'bold',
        marginBottom: '10px',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: '#bfdbfe'
    },
    roundsContainer: {
        display: 'flex',
        gap: '40px'
    },
    column: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: '220px'
    },
    colTitle: {
        textAlign: 'center',
        marginBottom: '15px',
        color: 'var(--muted-text)'
    },
    colBody: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-around',
        flexGrow: 1
    },
    card: {
        borderRadius: '12px',
        background: 'var(--surface)',
        color: 'var(--text)',
        boxShadow: 'var(--ui-shadow)',
        marginBottom: '20px',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '5px'
    },
    cardHeader: {
        fontSize: '10px',
        color: 'var(--muted-text)',
        display: 'flex',
        justifyContent: 'space-between',
        textTransform: 'uppercase',
        fontWeight: 'bold',
        marginBottom: '4px'
    },
    dropLabel: {
        color: '#fca5a5'
    },
    teamRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'var(--surface-soft)',
        border: '1px solid var(--border)',
        padding: '6px 8px',
        borderRadius: '8px'
    },
    teamName: {
        flexGrow: 1,
        paddingRight: '10px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis'
    },
    scoreInput: {
        width: '40px',
        textAlign: 'center',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '4px',
        fontWeight: 'bold',
        // Read-only specific style adjustments:
        backgroundColor: 'transparent',
        color: 'var(--text)',
    },
    separator: {
        border: 'none',
        borderTop: '1px solid var(--border)',
        margin: '30px 0'
    },
    loading: {
        padding: '40px',
        textAlign: 'center',
        fontSize: '20px',
        color: 'var(--muted-text)'
    },
    errorMessage: {
        textAlign: 'center',
        padding: '20px',
        color: '#fca5a5',
        fontWeight: 'bold',
    },
    message: {
        textAlign: 'center',
        padding: '20px',
        color: 'var(--muted-text)',
    }
};

export default CurrentPlayoffBracketView;
