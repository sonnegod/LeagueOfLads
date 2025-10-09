// src/context/LeagueContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';

const LeagueContext = createContext();

export function LeagueProvider({ children }) {
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeagues() {
      try {
        const res = await fetch('/api/leagueData');
        const data = await res.json();

        setLeagues(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeagues();
  }, []); // runs only once

  return (
    <LeagueContext.Provider value={{ leagues, loading }}>
      {children}
    </LeagueContext.Provider>
  );
}

export function useLeagues() {
  return useContext(LeagueContext);
}
