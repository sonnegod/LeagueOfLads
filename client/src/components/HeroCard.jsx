export function HeroCard({ hero }) {
  return (
    <>
      {hero ? (
        <>
          <div className="text-center">{hero.HeroName}</div>
          {/* add image */}
          <div className="text-center">
            Average Kills: {hero.AvgKills} Average Deaths: {hero.AvgDeaths}
          </div>
          <div className="text-center">
            Games played {hero.GamesPlayed} Win Percentage: {hero.WinPercentage}
          </div>
        </>
      ) : (
        <div className="text-center">N/A</div>
      )}
    </>
  );
}
