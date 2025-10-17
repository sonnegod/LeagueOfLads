import { useEffect, useState } from "react";
import { HeroCard } from "./HeroCard";

export function PersonalStats({ accountId }) {
  const [playerData, setPlayerData] = useState(null);
  const { mostSuccessfulHero, currentSeasonMSH } = playerData || {};

  useEffect(() => {
    async function fetchPlayer() {
      try {
        const res = await fetch(`/api/playerDashboard/${accountId}`);
        if (!res.ok) throw new Error("Player not found");
        const data = await res.json();
        console.log(data);
        setPlayerData(data);
      } catch (err) {
        console.error(err);
        setPlayerData(null);
      }
    }
    fetchPlayer();
  }, [accountId]);

  return (
    <div>
      {playerData ? (
        <>
          <div className="flex">
            <h2 className="text-yellow-500 mr-8 text-lg">
              Your Recent Matches
            </h2>
            <div className="flex flex-row">
              {playerData.recentLeagueStats.map((match) =>
                match.Winner === 0 ? (
                  <div className="p-2">L</div>
                ) : (
                  <div className="p-2">W</div>
                )
              )}
            </div>
            <div className="flex-col">
              <div className="text-orange-600 text-lg text-center">
                Most successful Hero
              </div>
                <HeroCard hero={mostSuccessfulHero} />
            </div>
            <div className="flex-col">
              <div className="text-orange-600 text-lg text-center">
                Most successful Hero This Season
              </div>
              <HeroCard hero={currentSeasonMSH} />
            </div>
          </div>
        </>
      ) : (
        <div>No player data available.</div>
      )}
    </div>
  );
}
