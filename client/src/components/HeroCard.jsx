import HeroDisplay from './HeroDisplay';

export function HeroCard({ hero }) {
  return (
    <>
      {hero ? (
        <>
          <div className="text-center">
            <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} iconSize={64} />
          </div>
          <div className="text-center">
            Average Kills: {hero.AvgKills} Average Deaths: {hero.AvgDeaths}
          </div>
          <div className="text-center">
            Games played: {hero.GamesPlayed} Win Percentage: {hero.WinPercentage}
          </div>
        </>
      ) : (
        <div className="text-center">N/A</div>
      )}
    </>
  );
}
