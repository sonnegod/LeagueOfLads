// src/pages/HeroesPage.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function HeroesPage() {
  const [heroes, setHeroes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHeroes() {
      setLoading(true);
      try {
        const res = await fetch('/api/heroes'); // your endpoint to get all heroes
        if (!res.ok) throw new Error('Failed to fetch heroes');
        const data = await res.json();

        setHeroes(data);
    } catch (err) {
        console.error(err);
        setHeroes([]);
      } finally {
        setLoading(false);
      }
    }
    fetchHeroes();
  }, []);

  if (loading) return <div>Loading heroes...</div>;

  return (
    <div style={{ padding: '1rem' }}>
      <h1>Heroes</h1>
      <div style={gridStyle}>
        {heroes.map(hero => (
          <Link key={hero.HeroId} to={`/hero/${hero.HeroId}`} style={heroLinkStyle}>
            {hero.HeroName}
          </Link>
        ))}
      </div>
    </div>
  );
}

// Grid styles
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(8, 1fr)', // 4 columns
  gap: '1rem', // space between items
  marginTop: '1rem',
};

const heroLinkStyle = {
  padding: '0.5rem',
  border: '1px solid #ccc',
  borderRadius: '6px',
  textAlign: 'center',
  textDecoration: 'none',
  color: '#646cff',
  fontWeight: 500,
  backgroundColor: '#f4ddddff',
};