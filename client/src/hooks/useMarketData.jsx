import { useState, useEffect } from 'react';

const API_URL = '/api/markets'; // Endpoint to fetch all active markets

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

                if (isMounted) {
                    setMarkets(data);
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