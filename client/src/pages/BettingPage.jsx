// src/components/BettingPage.js

import { useAuth } from '../context/AuthContext';

import React, { useState, useMemo, useCallback } from 'react';
import MarketCard from '../components/MarketCard';
import BettingSlip from '../components/BettingSlip';
import BettingLeaderboard from '../components/BettingLeaderboard';

import { useMarketData } from '../hooks/useMarketData';
import { useWalletData } from '../hooks/useWalletData'; // Assumed hook for balance

import '../css/BettingPage.css';

// Assume API function exists to handle the fetch request
const placeBetApi = async (payload) => {
    const response = await fetch('/api/parlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return response.json();
};

export default function BettingPage() {
    const { user } = useAuth();
    const { markets, loading, error } = useMarketData();
    const { balance, refreshWallet } = useWalletData();
    
    const [bettingSlip, setBettingSlip] = useState([]); 
    const [wagerAmount, setWagerAmount] = useState(100);

    // --- Core Logic ---

    // Total Odds Calculation
    const totalOdds = useMemo(() => {
        if (bettingSlip.length === 0) return 1.0;
        return bettingSlip.reduce((acc, leg) => acc * leg.odds, 1.0);
    }, [bettingSlip]);

    // Add or remove a bet leg
    const handleSelectOption = useCallback((market, option) => {
    const newLeg = {
        marketId: market.id,
        marketType: market.type,
        optionId: option.id,
        odds: option.odds,
        name: option.name,
    };

    // Use the functional update form to guarantee access to the absolute latest state (currentSlip)
    setBettingSlip(currentSlip => {
        const marketId = market.id;
        const optionId = option.id;

        // 1. Check for Toggle Action: If the user clicks an option already on the slip
        const optionExists = currentSlip.some(leg => leg.optionId === optionId);
        if (optionExists) {
            // Remove the existing option (toggle off)
            return currentSlip.filter(leg => leg.optionId !== optionId); 
        }

        // 2. Enforce Restriction: One option per market.
        const marketAlreadySelected = currentSlip.find(leg => leg.marketId === marketId);
        
        if (marketAlreadySelected) {
            
            // a) Filter out the old option
            const filteredSlip = currentSlip.filter(leg => leg.marketId !== marketId);
            
            // b) Add the new option
            return [...filteredSlip, newLeg];
        }

        // 3. Enforce General Restriction: Parlay Mix/Match Rule
        if (currentSlip.length > 0 && currentSlip[0].marketType !== newLeg.marketType) {
            alert('❌ Parlay Rule: You cannot mix Matchup and Player Stat bets.');
            return currentSlip; // Return the current slip unchanged
        }

        // 4. Add the new leg if all checks pass
        return [...currentSlip, newLeg];
    });

}, []);
    
    const removeLeg = (optionId) => {
        setBettingSlip(bettingSlip.filter(leg => leg.optionId !== optionId));
    };

    // Submits the bet to the backend API
    const handlePlaceBet = async () => {
        if (!user || bettingSlip.length === 0 || wagerAmount <= 0) {
            alert("Invalid bet details.");
            return;
        }
        if (wagerAmount > balance) {
            alert("Wager exceeds your current balance.");
            return;
        }

        const payload = {
            user,
            totalWager: wagerAmount,
            // Backend will calculate the amount per leg based on totalWager and number of legs
            betLegs: bettingSlip.map(leg => ({
                marketId: leg.marketId,
                optionId: leg.optionId,
            })),
        };

        try {
            const result = await placeBetApi(payload);

            if (result.success) {
                alert(`Bet placed successfully! Ticket ID: ${result.ticketId}`);
                setBettingSlip([]); 
                setWagerAmount(100);
                refreshWallet(); // Update wallet balance immediately
            } else {
                alert(`Bet failed: ${result.message}`);
            }
        } catch (error) {
            console.error('Bet submission error:', error);
            alert('An error occurred during submission.');
        }
    };

    // --- RENDER LOGIC ---
    
    if (loading) return <div className="container">Loading Live Markets...</div>;
    if (error) return <div className="container error">Error loading markets: {error}</div>;

    return (
        <div className="betting-page-layout">
            <div className="leaderboard-column">
                <BettingLeaderboard/>
            </div>

            <div className="market-list-column">
                <h1>Playoff Markets</h1>
                <div className="market-cards-grid">    
                    {/* Markets render for everyone */}
                    {markets.map(market => (
                        <MarketCard 
                            key={market.id}
                            market={market}
                            selectedOptions={bettingSlip}
                            onSelectOption={handleSelectOption}
                        />
                    ))}
                </div>
            </div>
            
            <div className="betting-slip-column">
                <BettingSlip 
                    slip={bettingSlip} 
                    totalOdds={totalOdds}
                    wager={wagerAmount}
                    setWager={setWagerAmount}
                    placeBet={handlePlaceBet}
                    removeLeg={removeLeg}
                    userBalance={balance}
                    // Pass login status to the slip to disable the button
                    isLoggedIn={!!user} 
                />
            </div>
        </div>
    );
}