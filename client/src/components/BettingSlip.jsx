// src/components/BettingSlip.js

import React from 'react';

export default function BettingSlip({ slip, totalOdds, wager, setWager, placeBet, removeLeg, userBalance, isLoggedIn }) {
    const potentialPayout = (wager * totalOdds).toFixed(0);
    
    // Determine if the place bet button should be active
    const isDisabled = !isLoggedIn || wager > userBalance || wager === 0 || slip.length === 0;

    const handleWagerChange = (e) => {
        const value = parseInt(e.target.value) || 0;
        setWager(Math.max(1, value)); // Ensure minimum wager of 1
    };

    return (
        <div className="betting-slip-container">
            <h2>Your Slip ({slip.length} Legs)</h2>
            <p>Wallet Balance: **{userBalance.toLocaleString()}** Coins</p>
            
            {slip.length === 0 ? (
                <p>Select an odd to start building your parlay.</p>
            ) : (
                <>
                    <ul className="slip-list">
                        {slip.map((leg) => (
                            <li key={leg.optionId}>
                                <button className="remove-btn" onClick={() => removeLeg(leg.optionId)}>X</button>
                                <strong>{leg.name}</strong> @ {leg.odds.toFixed(2)}
                            </li>
                        ))}
                    </ul>

                    <div className="wager-details">
                        <label>Total Wager:</label>
                        <input
                            type="number"
                            value={wager}
                            onChange={handleWagerChange}
                            min="1"
                            max={userBalance} // Restrict wager to current balance
                        />
                        <p>Total Parlay Odds: **{totalOdds}**</p>
                        <p>Potential Return: **{potentialPayout.toLocaleString()}** Coins</p>
                    </div>
                    
                    <button 
                        className="place-bet-btn" 
                        onClick={placeBet} 
                        disabled={isDisabled} // Use the combined disabled status
                    >
                        {isLoggedIn ? "Place Bet" : "Log In to Bet"}
                    </button>
                    {!isLoggedIn && <p className="error-text">You must log in to submit a wager.</p>}
                    {wager > userBalance && isLoggedIn && <p className="error-text">Wager exceeds balance!</p>}
                </>
            )}
        </div>
    );
}