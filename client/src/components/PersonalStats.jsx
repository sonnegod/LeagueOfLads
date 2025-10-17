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
            <div className="flex-col">
              <h2 className="text-yellow-500 mr-8 text-lg text-center">
                Your Recent Matches
              </h2>
              <div className="flex">
                {playerData.recentLeagueStats.map((match) => {
                  const {
                    HeroName,
                    Kills,
                    Deaths,
                    Assists,
                    GPM,
                    XPM,
                    MatchId,
                  } = match;
                  return (
                    <div className="flex-col mr-4">
                      <div className="text-center">
                        <a
                          href={`https://www.dotabuff.com/matches/${MatchId}`}
                          className="text-center"
                        >
                          {HeroName}
                        </a>
                      </div>
                      <div className="text-center">
                        K/D/A: {Kills}/{Deaths}/{Assists}
                      </div>
                      <div className="text-center">
                        GPM: {GPM} XPM: {XPM}
                      </div>
                      <div className="p-2 text-center">{match.Winner === 0 ? 'L' : 'W'}</div>
                    </div>
                  )
                })}
              </div>
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
