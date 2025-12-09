// src/hooks/useWalletData.js

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const WALLET_API_URL = '/api/wallet';

/**
 * Custom hook to fetch and manage the user's betting wallet data.
 * It is designed to be refreshed manually after any transaction.
 */
export function useWalletData() {
    const { user } = useAuth(); // Get the currently logged-in user ID
    
    const [balance, setBalance] = useState(0);
    const [totalWagered, setTotalWagered] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // State trigger used to manually refresh the data
    const [refreshTrigger, setRefreshTrigger] = useState(0); 

    // Function to manually trigger a data refresh (used after transactions)
    const refreshWallet = useCallback(() => {
        setRefreshTrigger(prev => prev + 1);
    }, []);

    useEffect(() => {
        // Only fetch if a user is logged in
        if (!user) {
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
                // Fetch wallet data using the logged-in userId

                const response = await fetch(`${WALLET_API_URL}/${user.accountId}`);
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch wallet (Status: ${response.status})`);
                }
                
                const data = await response.json();

                if (isMounted) {
                    // Assuming the API returns: { balance: number, totalWagered: number, ... }
                    setBalance(data[0].balance);
                    setTotalWagered(data[0].totalWagered);
                    setIsLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                    setIsLoading(false);
                    // If fetching fails, reset balance to avoid confusion
                    setBalance(0); 
                }
            }
        };

        fetchWallet();

        // Cleanup function
        return () => {
            isMounted = false;
        };
    // Dependency array includes userId and the refreshTrigger
    }, [user, refreshTrigger]); 

    return { 
        balance, 
        totalWagered, 
        isLoading, 
        error, 
        refreshWallet 
    };
}