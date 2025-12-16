// BettingLeaderboard.js
import React, { useState, useEffect } from 'react';
import '../css/BettingLeaderboard.css';

// =========================================================
// !!! PLACEHOLDER: REPLACE WITH YOUR ACTUAL API CALL !!!
// This function simulates fetching data from your backend.
// =========================================================
const fetchLeaderboardData = async () => {
    // Example using native fetch:
    const response = await fetch('/api/bettingLeaderboard');
    if (!response.ok) {
        throw new Error('Network response was not ok');
    }
    return response.json();
};
// =========================================================


export default function BettingLeaderboard() {
    const [performanceData, setPerformanceData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // useEffect hook to call the API when the component mounts
    useEffect(() => {
        const loadData = async () => {
            try {
                const data = await fetchLeaderboardData();
                setPerformanceData(data);
            } catch (err) {
                console.error("Failed to fetch leaderboard data:", err);
                setError("Failed to load player data. Please try again.");
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, []); // Runs only once on mount

    // --- Loading and Error States ---

    if (isLoading) {
        return (
            <div className="leaderboard-card">
                <h4>🏆 Top Bettors (Net Gain)</h4>
                <p>Loading player performance data...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="leaderboard-card">
                <h4>Top Bettors (Net Gain)</h4>
                <p className="error-message">{error}</p>
            </div>
        );
    }
    
    // --- Data Checks ---

    // Note: The data is now `performanceData` from state, not a prop.
    if (!performanceData || performanceData.length === 0) {
        return (
            <div className="leaderboard-card">
                <h4>Player Performance</h4>
                <p>No betting data available for the leaderboard.</p>
            </div>
        );
    }

    // Function to format net gain/loss with color
    const formatNetGain = (amount) => {
        const sign = amount >= 0 ? '' : '-'; 
        const colorClass = amount >= 0 ? 'gain' : 'loss';
        const formattedAmount = Math.abs(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
        
        return <span className={colorClass}>{sign}{formattedAmount}</span>;
    };

    // --- Final Render ---

    return (
        <div className="leaderboard-card">
            <h4>Top Bettors (Net Gain)</h4>
            <table className="leaderboard-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Name</th> 
                        <th>Net Gain</th>
                    </tr>
                </thead>
                <tbody>
                    {/* Show top 5 players */}
                    {performanceData.map((player, index) => ( 
                        <tr key={player.user_id}>
                            <td>{index + 1}</td><td>{player.name}</td><td>{formatNetGain(player.NetGain)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="leaderboard-note">Data aggregated across all open markets.</p>
        </div>
    );
}