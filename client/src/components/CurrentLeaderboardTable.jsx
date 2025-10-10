import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

export default function CurrentLeagueSeries({ seriesList }) {

  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch match data on mount
  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      try {
        const res = await fetch('/api/currentLeaderboard');
        const data = await res.json();
        setMatches(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchMatches();
  }, []);
}