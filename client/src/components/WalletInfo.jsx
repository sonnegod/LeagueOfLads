// components/WalletInfo.js
import React, { useState, useEffect } from 'react';

// Define the API endpoint root (adjust if necessary)
const WALLET_API_URL = '/api/wallet'; 

const WalletInfo = ({ userId }) => {
    // Note: We use the accountId from the user object here, matching your fetch logic
    const accountId = userId ? userId : null;
    
    const [balance, setBalance] = useState(0);
    const [totalWagered, setTotalWagered] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Only fetch if a user is logged in and we have the accountId
        if (!accountId) {
            setBalance(0);
            setTotalWagered(0);
            setIsLoading(false);
            return;
        }

        let isMounted = true;
        
        const fetchWallet = async () => {
            setIsLoading(true);
            setError(null);
            
            try {
                // Fetch wallet data using the logged-in user's accountId
                const response = await fetch(`${WALLET_API_URL}/${accountId}`);
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch wallet (Status: ${response.status})`);
                }
                
                const data = await response.json();

                if (isMounted) {
                    // Assuming the API returns an array where the first element holds the data
                    setBalance(data[0].balance || 0);
                    setTotalWagered(data[0].totalWagered || 0);
                    setIsLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                    setIsLoading(false);
                    setBalance(0); 
                    setTotalWagered(0);
                }
            }
        };

        fetchWallet();

        // Cleanup function
        return () => {
            isMounted = false;
        };
    }, [accountId]); // Dependency on accountId

    if (isLoading) return <p>Loading wallet data...</p>;
    if (error) return <p className="error">Error loading wallet: {error}</p>;

    return (
        <div className="wallet-card">
            <h3>Current Balance: <span className="balance">${balance.toFixed(2)}</span></h3>
            <p>Total Wagered: ${totalWagered.toFixed(2)}</p>
            {/* Add Total Won if you fetch that data as well */}
        </div>
    );
};

export default WalletInfo;