import React from 'react';
import '../css/MarketCard.css';
 

export default function MarketCard({ market, selectedOptions, onSelectOption }) {
    const { id: marketId, title, close_time, status, options } = market;
    
    // Check if the market is closed or pending
    const isBettingAvailable = (status === 'OPEN' || status === 'PENDING');
    
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

    return (
        <div className={`market-card ${isBettingAvailable ? '' : 'locked'}`}>
            <h3>{title}</h3>
            <p className="status">Status: <strong>{status}</strong></p>
            {isBettingAvailable && close_time && (
                <p className="close-time">Closes: {new Date(close_time).toLocaleTimeString()}</p>
            )}

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
            {!isBettingAvailable && <div className="overlay-locked">LOCKED</div>}
        </div>
    );
}