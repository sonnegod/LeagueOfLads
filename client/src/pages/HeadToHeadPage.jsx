import React from 'react';
import HeadToHead from '../components/HeadToHead';

const HeadToHeadPage = () => {
  return (
    /* 1. flex-1: Tells the page to grow and fill the sidebar's remaining space.
      2. min-w-0: Critical flexbox fix to prevent content from pushing width past 100%.
      3. bg-slate-950: The page owns its background color here.
    */
    <div className="flex-1 min-w-0 min-h-full bg-slate-950 text-white flex flex-col">
      
      {/* Header - Owned by the page */}
      <header className="w-full bg-slate-900/50 backdrop-blur-md border-b border-slate-800 p-6 shrink-0">
        <h1 className="text-2xl font-bold text-blue-400 uppercase tracking-widest">
          Analytics <span className="text-white">Hub</span>
        </h1>
      </header>

      {/* Main Content Area */}
        <div className="mb-8">
          <h2 className="text-4xl font-black italic mb-2 tracking-tight uppercase">
            Head To Head
          </h2>
          <p className="text-slate-400 max-w-2xl">
            Compare historical performance and direct matchup statistics between players.
          </p>
        </div>

        {/* Wrapper for the component:
          Using w-full ensures the HeadToHead component stays within the page bounds.
        */}
        <div className="w-full">
          <HeadToHead />
        </div>
    </div>
  );
};

export default HeadToHeadPage;