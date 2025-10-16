import { useEffect, useState } from "react";

export function PersonalStats({ accountId }) {
    const [playerData, setPlayerData] = useState(null);
    console.log(accountId)
      useEffect(() => {
        async function fetchPlayer() {
          try {
            const res = await fetch(`/api/player/${accountId}`);
            if (!res.ok) throw new Error('Player not found');
            const data = await res.json();
            console.log(data)
            setPlayerData(data);
          } catch (err) {
            console.error(err);
            setPlayerData(null);
          }
        }
        fetchPlayer();

        console.log('running')
      }, [accountId]);
      const mostSuccessfulHero = playerData?.playerHeroStats.filter(hero => hero.GamesPlayed >= 3 && hero.WinPercentage >= 60).sort((a, b) => a.WinPercentage - b.WinPercentage).pop();
      return (
        <div style={{ padding: "1rem" }}>
          <h2>Your Recent Matches</h2>
          {playerData ? (
            <div> Stats Available </div>
          ) : (
            <p>No player data available.</p>
          )}
        </div>
      );
    }