// components/MyBets.js
import React, { useState, useEffect } from 'react';

// Define the API endpoint root (adjust if necessary)
const BETS_API_URL = '/api/bets';

const MyBets = ({ userId }) => {
    const [pendingBets, setPendingBets] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) {
            setPendingBets([]);
            setIsLoading(false);
            return;
        }

        let isMounted = true;
        
        const fetchBets = async () => {
            setIsLoading(true);
            setError(null);
            
            try {
                // Fetch bets data using the user's primary database ID
                const response = await fetch(`${BETS_API_URL}/${userId}`); 
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch bets (Status: ${response.status})`);
                }
                
                const data = await response.json(); // Expects an array of tickets/bets
    
                if (isMounted) {
                    setPendingBets(data); 
                    setIsLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                    setIsLoading(false);
                    setPendingBets([]);
                }
            }
        };

        fetchBets();

        // Cleanup function
        return () => {
            isMounted = false;
        };
    }, [userId]); // Dependency on userId

    if (isLoading) return <p>Loading pending bets...</p>;
    if (error) return <p className="error">Error loading bets: {error}</p>;

    return (
        <div className="bets-list">
            <h3>Your Active Bets ({pendingBets.length})</h3>
            <hr style={{ margin: '10px 0' }} />
            {pendingBets.length === 0 ? (
                <p>You have no pending bets.</p>
            ) : (
                pendingBets.map(bet => {
                    let legsArray = [];
                    try {
                        // Only attempt to parse if it's a non-empty string
                        if (typeof bet.legs === 'string' && bet.legs.length > 0) {
                            legsArray = JSON.parse(bet.legs);
                        }
                    } catch (e) {
                        console.error(`Error parsing bet legs for ticket ${bet.ticket_id}:`, e);
                        // If parsing fails, legsArray remains an empty array, preventing a crash.
                    }
                return (
                    <div key={bet.id} className="bet-item">
                        <h4>Ticket #{bet.ticket_id}</h4>
                        <p>Odds: ${bet.odds.toFixed(2)}</p>
                        <p>
                            Closes: {new Date(bet.created_at).toLocaleString('en-US', {
                                // Date options
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                
                                // Time options
                                hour: 'numeric',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: true,

                                // Timezone setting (Critical for UTC -> EST conversion)
                                timeZone: 'America/New_York' 
                            })
                            .replace(', ', ' ')} 
                        </p>
                        <p>Potential Payout: ${bet.payout.toFixed(2)}</p>

                            {/* --- Display Bet Legs --- */}
                            <div className="bet-legs-container">
                                <h5>Bet Legs ({legsArray.length}):</h5>
                                
                                {/* 2. --- MAP OVER THE PARSED ARRAY (legsArray) --- */}
                                {Array.isArray(legsArray) && legsArray.length > 0 ? (
                                    
                                    legsArray.map((leg, index) => (
                                        <div key={`${bet.ticket_id}-leg-${index}`} className="bet-leg">
                                            
                                            <p>
                                                <strong>Game:</strong> {leg.market_title}
                                            </p>
                                            
                                            <p style={{ marginLeft: '10px' }}>
                                                 Chosen: **{leg.option_name}** (@{leg.odds_taken.toFixed(2)})
                                            </p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="error-message">No specific bet leg details available.</p>
                                )}
                                <hr style={{ margin: '10px 0' }} />
                            </div>
                    </div>
                )})
            )}
        </div>
    );
};

export default MyBets;