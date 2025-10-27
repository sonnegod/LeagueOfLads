import React, { useEffect, useRef } from "react";
import { BracketsManager } from "brackets-manager";

export default function PlayoffBracket({ seriesList }) {
  const containerRef = useRef();

  useEffect(() => {
    if (!seriesList || seriesList.length === 0) return;

    // --- Prepare teams and matches for the manager
    const teams = [];
    const teamMap = new Map();
    const matches = [];

    seriesList.forEach((s) => {
      if (!teamMap.has(s.Team1)) {
        teamMap.set(s.Team1, { id: s.Team1, name: s.Team1Name });
        teams.push({ id: s.Team1, name: s.Team1Name });
      }
      if (!teamMap.has(s.Team2)) {
        teamMap.set(s.Team2, { id: s.Team2, name: s.Team2Name });
        teams.push({ id: s.Team2, name: s.Team2Name });
      }

      matches.push({
        id: s.id,
        team1: s.Team1,
        team2: s.Team2,
        winner: s.WinnerId,
        loser: s.LoserId,
        winnerTo: s.winnerTo || null,
        loserTo: s.loserTo || null,
      });
    });

    // --- Create manager
    const manager = new BracketsManager({ teams, matches });
    manager.create.stage();


    // --- Cleanup on unmount
  }, [seriesList]);

  return <div className="brackets-viewer"/>;
}
