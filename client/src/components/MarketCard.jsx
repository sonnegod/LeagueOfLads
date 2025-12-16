import React from 'react';
import '../css/MarketCard.css';

export default function MarketCard({ market, selectedOptions, onSelectOption }) {
    // Destructure properties from market
    const { 
        id: marketId, 
        title, 
        close_time, 
        status, 
        options,
        // Assuming the pool array is here:
        pools 
    } = market;
    
    // Check if the market is closed or pending
    const isBettingAvailable = (status === 'OPEN');
    
    // Group options by type (Moneyline, Score, etc.) for clean display
    const groupedOptions = options.reduce((acc, option) => {
        const type = option.name.includes('Moneyline') ? 'Moneyline' : 
                     option.name.includes('Win 2-') ? 'Score' : 
                     'Other';
        if (!acc[type]) acc[type] = [];
        acc[type].push(option);
        return acc;
    }, {});

    const isOptionSelected = (optionId) => 
        selectedOptions.some(leg => leg.optionId === optionId);

    // --- REVISED LOGIC FOR BETTING BAR BASED ON market.pools ---
    
    // 1. Safely extract the pool object from the array (if it exists)
    const poolObject = pools && pools.length > 0 ? pools[0] : null;

    let poolData = null;
    
    // 2. Check for existence and validity (i.e., not null)
    if (poolObject !== null && poolObject.PoolA !== null && poolObject.PoolB !== null) {
        
        // Use the fetched values, which we know are not null at this point
        const poolA = poolObject.PoolA;
        const poolB = poolObject.PoolB;
        const totalPool = poolA + poolB;

        // 3. Only proceed if there is a positive total pool
        if (totalPool > 0) {
            const percentA = (poolA / totalPool) * 100;
            const percentB = (poolB / totalPool) * 100;

            // Get option names for labeling (fallback to 'Team A'/'Team B')
            const moneylineOptions = groupedOptions['Moneyline'] || [];
            const nameA = moneylineOptions[0] ? moneylineOptions[0].name : 'Team A';
            const nameB = moneylineOptions[1] ? moneylineOptions[1].name : 'Team B';

            poolData = {
                optionA: { name: nameA, pool: poolA, percent: percentA },
                optionB: { name: nameB, pool: poolB, percent: percentB },
                totalPool: totalPool
            };
        }
    }
    // -----------------------------------------------------------------

    return (
        <div className={`market-card ${isBettingAvailable ? '' : 'locked'}`}>
            
            <h3>{title}</h3>

            {/* --- BETTING BAR RENDER --- */}
            {/* The bar only renders if poolData is calculated and valid */}
            {poolData && (
                <div className="betting-bar-container">
                    
                    {/* Pool Values above the bar */}
                    <div className="labels">
                        <span className="label-a">
                            {poolData.optionA.pool.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}
                        </span>
                        <span className="label-b">
                            {poolData.optionB.pool.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}
                        </span>
                    </div>

                    {/* The Stacked Bar  */}
                    <div className="bar-wrapper">
                        {/* Segment A */}
                        <div className="bar-segment team-a" style={{ width: `${poolData.optionA.percent}%` }}>
                            <span className="percentage-label">{Math.round(poolData.optionA.percent)}%</span>
                        </div>
                        {/* Segment B */}
                        <div className="bar-segment team-b" style={{ width: `${poolData.optionB.percent}%` }}>
                            <span className="percentage-label">{Math.round(poolData.optionB.percent)}%</span>
                        </div>
                    </div>
                </div>
            )}
            {/* --------------------------- */}

            <p className="status">Status: <strong>{status}</strong></p>
            {isBettingAvailable && close_time && (
                <p className="close-time">
                    Closes: {new Date(close_time).toLocaleString('en-US', {
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
                    .replace(', ', ' ') // Replaces the comma/space separator
                    } 
                </p>
            )}

            {/* Option groups rendering remains the same */}
            {Object.entries(groupedOptions).map(([type, options]) => (
                <div key={type} className="option-group">
                    <h4>{type}</h4>
                    <div className="options-grid">
                        {options.map(option => (
                            <button
                                key={option.id}
                                className={`option-button ${isOptionSelected(option.id) ? 'selected' : ''}`}
                                onClick={() => onSelectOption(market, option)}
                                disabled={!isBettingAvailable}
                            >
                                <span className="option-name">{option.name}</span>
                                <span className="option-odds">@{option.odds.toFixed(2)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            {!isBettingAvailable && <div className="overlay-locked">LOCKED (Not scheduled or incorrect scheduling format)</div>}
        </div>
    );
}