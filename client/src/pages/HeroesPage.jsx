// src/pages/HeroesPage.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from '../components/HeroDisplay';

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
      {/* Dark wrapper to remove any white panels for this page */}
      <div style={{ padding: '1rem', backgroundColor: '#0f1112', color: '#e6e6e6', borderRadius: 8 }}>
        <h1 style={{ marginTop: 0 }}>Heroes</h1>
        <div style={gridStyle}>
          {heroes.map(hero => (
            <Link key={hero.HeroId} to={`/hero/${hero.HeroId}`} style={heroLinkStyleDark}>
              <HeroDisplay
                heroId={hero.HeroId}
                heroName={hero.HeroName}
                iconSize={48}
                link={false}
                style={{ flexDirection: 'column' }}
              />
            </Link>
          ))}
        </div>
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

// Dark variant used on Heroes page to ensure white border / dark bg
const heroLinkStyleDark = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.6rem',
  border: '1px solid #ffffff',
  borderRadius: '6px',
  textAlign: 'center',
  textDecoration: 'none',
  backgroundColor: '#000000',
  color: '#ffffff',
  fontWeight: 600,
};
