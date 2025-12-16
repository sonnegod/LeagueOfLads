import { useState, useEffect } from 'react';

const API_URL = '/api/markets'; // Endpoint to fetch all active markets

const sortMarkets = (marketsArray) => {
    // Return a new sorted array
    return [...marketsArray].sort((a, b) => {
        
        // Define sorting priority values: OPEN < PENDING < others
        const statusPriority = (status) => {
            if (status === 'OPEN') return 1;
            if (status === 'PENDING') return 2;
            return 3; // For 'SETTLED', 'VOIDED', etc.
        };

        const priorityA = statusPriority(a.status);
        const priorityB = statusPriority(b.status);

        // 1. Sort by Status Priority (OPEN before PENDING)
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }

        // 2. If priorities are the same (i.e., both are 'OPEN' or both are 'PENDING'):
        //    Sort by 'close_time' (Ascending: earliest closing time first)
        if (a.close_time && b.close_time) {
            const dateA = new Date(a.close_time).getTime();
            const dateB = new Date(b.close_time).getTime();
            // Markets with earlier close times (smaller timestamps) come first
            return dateA - dateB; 
        }
        
        // If close_time is null for both or sorting is otherwise ambiguous,
        // fall back to default behavior (stable sort or ID sort if possible)
        return 0; 
    });
};

export function useMarketData() {
    const [markets, setMarkets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        
        const fetchMarkets = async () => {
            try {
                // Fetch the list of all OPEN markets and their options
                const response = await fetch(API_URL);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const data = await response.json();

                const sortedData = sortMarkets(data);
                console.log(sortedData)
                
                if (isMounted) {
                    setMarkets(sortedData);
                    setLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                    setLoading(false);
                }
            }
        };

        // Initial fetch
        fetchMarkets();

        // Polling setup (fetch every 30 seconds for dynamic odds updates)
        const intervalId = setInterval(fetchMarkets, 3000); 
        return () => {
            isMounted = false;
            clearInterval(intervalId); // Cleanup interval on unmount
        };
    }, []);

    return { markets, loading, error };
}