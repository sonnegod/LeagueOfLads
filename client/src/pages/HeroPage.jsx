import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import HeroStatsTable from "../components/HeroStatsTable";
import HeroDisplay from '../components/HeroDisplay';
import { HeroBreakdownTable } from '../components/DetailSummaryTables';
import './DetailPages.css';


export default function HeroPage() {
  const { hero_id } = useParams();
  const [heroData, setHeroData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('heroMatches'); // default tab

  useEffect(() => {
    async function fetchHero() {
      setLoading(true);
      try {
        const res = await fetch(`/api/hero/${hero_id}`);
        if (!res.ok) throw new Error('Hero not found');
        const data = await res.json();

        setHeroData(data);
      } catch (err) {
        console.error(err);
        setHeroData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchHero();
  }, [hero_id]);

  if (loading) return <div>Loading hero info...</div>;
  if (!heroData) return <div>Hero not found.</div>;

  const { hero, heroPlayerStats, heroTeamStats, leagueHeroStats } = heroData;

  return (
    <div className="ui-page">
      {/* Dark page container to avoid white panels */}
      <div className="ui-panel">
        <h1 style={{ marginTop: 0 }}>
          <HeroDisplay heroId={hero_id} heroName={hero[0]?.HeroName || hero_id} iconSize={64} link={false} />
        </h1>

        {/* Tabs */}
        <div className="ui-tabs">
          <button className="ui-tab" aria-pressed={activeTab === 'heroMatches'} onClick={() => setActiveTab('heroMatches')} style={activeTab === 'heroMatches' ? activeTabStyleDark : tabStyleDark}>Recent Matches</button>
          <button className="ui-tab" aria-pressed={activeTab === 'players'} onClick={() => setActiveTab('players')} style={activeTab === 'players' ? activeTabStyleDark : tabStyleDark}>Players</button>
          <button className="ui-tab" aria-pressed={activeTab === 'teams'} onClick={() => setActiveTab('teams')} style={activeTab === 'teams' ? activeTabStyleDark : tabStyleDark}>Teams</button>
          <button className="ui-tab" aria-pressed={activeTab === 'leagues'} onClick={() => setActiveTab('leagues')} style={activeTab === 'leagues' ? activeTabStyleDark : tabStyleDark}>Leagues</button>
        </div>

        {/* Tab Content */}
        {activeTab === 'heroMatches' && <HeroStatsTable data={hero} />}
        
        {activeTab === 'players' && <HeroBreakdownTable rows={heroPlayerStats} type="players" />}
        {activeTab === 'teams' && <HeroBreakdownTable rows={heroTeamStats} type="teams" />}
        {activeTab === 'leagues' && <HeroBreakdownTable rows={leagueHeroStats} type="leagues" />}
      </div>
    </div>
  );
}

// Styles
const tabStyleDark = { padding: "0.5rem 1rem", cursor: "pointer", background: '#0b0b0b', color: '#e6e6e6', border: '1px solid #222428', borderRadius: 6 };
const activeTabStyleDark = { ...tabStyleDark, fontWeight: "bold", boxShadow: '0 0 0 2px rgba(255,255,255,0.04)'};
