import { Link } from "react-router-dom";
import HeroDisplay from "./HeroDisplay";

export default function PlayerHomeTab({
  playerStats = [],
  currentSeasonPlayerData = [],
  playerHeroStats = [],
  playerTeamStats = []
}) {
  const totalWins = playerStats.filter(match => Number(match.Winner) === 1).length;
  const totalWinRate = playerStats.length ? (totalWins / playerStats.length) * 100 : 0;
  const seasonWins = currentSeasonPlayerData.filter(match => Number(match.Winner) === 1).length;
  const seasonWinRate = currentSeasonPlayerData.length ? (seasonWins / currentSeasonPlayerData.length) * 100 : 0;
  const topHeroes = getTopHeroes(playerHeroStats);
  const bestHeroes = getBestWinRateHeroes(playerHeroStats);
  const topTeams = getTopTeams(playerTeamStats);
  const recentMatches = playerStats.slice(0, 6);
  const averages = getAverages(playerStats);

  return (
    <div className="detail-home" style={homeStyle}>
      <div className="detail-metric-grid" style={metricGridStyle}>
        <MetricCard label="Total Matches" value={playerStats.length} />
        <MetricCard label="Total Win Rate" value={`${formatNumber(totalWinRate, 2)}%`} />
        <MetricCard label="Current Season" value={`${formatNumber(seasonWinRate, 2)}%`} />
        <MetricCard label="Unique Heroes" value={playerHeroStats.length} />
      </div>

      <div className="detail-feature-grid" style={featureGridStyle}>
        <FeatureCard title="Average Line">
          <div style={featureValueStyle}>
            {formatNumber(averages.kills, 1)}/{formatNumber(averages.deaths, 1)}/{formatNumber(averages.assists, 1)}
          </div>
          <div style={subtleTextStyle}>
            {formatNumber(averages.gpm, 0)} GPM, {formatNumber(averages.xpm, 0)} XPM
          </div>
        </FeatureCard>

        <FeatureCard title="Top 5 Heroes">
          <HeroList heroes={topHeroes} detailMode="games" />
        </FeatureCard>

        <FeatureCard title="Hero Watch">
          <HeroList heroes={bestHeroes} detailMode="winRate" />
        </FeatureCard>

        <FeatureCard title="Teams">
          {topTeams.length > 0 ? (
            <div style={leaderListStyle}>
              {topTeams.map((team, index) => (
                <LeaderRow
                  key={team.TeamId}
                  rank={index + 1}
                  href={`/team/${team.TeamId}`}
                  name={team.TeamName}
                  detail={`${formatNumber(team.GamesPlayed)} games, ${formatNumber(team.WinPercentage, 2)}% win rate`}
                />
              ))}
            </div>
          ) : (
            <EmptyState>No team history yet.</EmptyState>
          )}
        </FeatureCard>
      </div>

      <section style={panelStyle}>
        <h3 style={sectionHeaderStyle}>Recent Matches</h3>
        {recentMatches.length > 0 ? (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {recentMatches.map(match => (
              <div className="detail-recent-match" key={match.MatchId} style={recentMatchStyle}>
                <Link to={`/match/${match.MatchId}`} style={featureLinkStyle}>
                  <HeroDisplay heroId={match.HeroId} heroName={match.HeroName} />
                </Link>
                <div style={subtleTextStyle}>
                  {match.Kills}/{match.Deaths}/{match.Assists} · {match.GPM} GPM · {match.Winner === 1 ? "Win" : "Loss"}
                </div>
                <Link to={`/league/${match.LeagueId}`} style={smallLinkStyle}>{match.LeagueName}</Link>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No recent matches available.</EmptyState>
        )}
      </section>
    </div>
  );
}

function HeroList({ heroes, detailMode }) {
  if (!heroes.length) return <EmptyState>No hero data yet.</EmptyState>;

  return (
    <div style={leaderListStyle}>
      {heroes.map((hero, index) => (
        <div key={hero.HeroId} style={leaderRowStyle}>
          <span style={rankBadgeStyle}>{index + 1}</span>
          <div style={{ minWidth: 0 }}>
            <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} />
            <div style={subtleTextStyle}>
              {detailMode === "winRate"
                ? `${formatNumber(hero.WinPercentage, 2)}% across ${formatNumber(hero.GamesPlayed)} games`
                : `${formatNumber(hero.GamesPlayed)} games, ${formatNumber(hero.WinPercentage, 2)}% win rate`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricValueStyle}>{value}</div>
      <div style={subtleTextStyle}>{label}</div>
    </div>
  );
}

function FeatureCard({ title, children }) {
  return (
    <section style={panelStyle}>
      <h3 style={sectionHeaderStyle}>{title}</h3>
      {children}
    </section>
  );
}

function LeaderRow({ rank, href, name, detail }) {
  return (
    <div style={leaderRowStyle}>
      <span style={rankBadgeStyle}>{rank}</span>
      <div style={{ minWidth: 0 }}>
        <Link to={href} style={featureLinkStyle}>{name}</Link>
        <div style={subtleTextStyle}>{detail}</div>
      </div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div style={subtleTextStyle}>{children}</div>;
}

function getTopHeroes(heroes) {
  return [...heroes]
    .sort((a, b) => toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed))
    .slice(0, 5);
}

function getBestWinRateHeroes(heroes) {
  const qualifiedHeroes = heroes.filter(hero => toNumber(hero.GamesPlayed) >= 2);
  const heroPool = qualifiedHeroes.length > 0 ? qualifiedHeroes : heroes;

  return [...heroPool]
    .sort((a, b) => {
      const winDiff = toNumber(b.WinPercentage) - toNumber(a.WinPercentage);
      if (winDiff !== 0) return winDiff;
      return toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed);
    })
    .slice(0, 5);
}

function getTopTeams(teams) {
  return [...teams]
    .sort((a, b) => {
      const gamesDiff = toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed);
      if (gamesDiff !== 0) return gamesDiff;
      return toNumber(b.WinPercentage) - toNumber(a.WinPercentage);
    })
    .slice(0, 5);
}

function getAverages(matches) {
  const count = matches.length || 1;
  return {
    kills: sum(matches, "Kills") / count,
    deaths: sum(matches, "Deaths") / count,
    assists: sum(matches, "Assists") / count,
    gpm: sum(matches, "GPM") / count,
    xpm: sum(matches, "XPM") / count
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + toNumber(row[key]), 0);
}

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatNumber(value, fractionDigits = 0) {
  return toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

const homeStyle = { display: "grid", gap: "1rem" };

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "0.75rem"
};

const metricCardStyle = {
  padding: "1rem",
  border: "1px solid #334155",
  borderRadius: "10px",
  background: "#111827",
  color: "#f8fafc",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.16)"
};

const metricValueStyle = { fontSize: "1.8rem", fontWeight: "700", lineHeight: 1 };
const featureValueStyle = { fontSize: "1.35rem", fontWeight: "700", color: "#f8fafc" };

const featureGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.75rem"
};

const panelStyle = {
  padding: "1rem",
  border: "1px solid #334155",
  borderRadius: "10px",
  background: "#111827",
  color: "#f8fafc",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.16)"
};

const sectionHeaderStyle = { marginTop: 0, marginBottom: "0.75rem" };
const subtleTextStyle = { color: "#cbd5e1", fontSize: "0.92rem" };
const featureLinkStyle = { fontSize: "1rem", fontWeight: "700", color: "#bfdbfe" };
const smallLinkStyle = { color: "#bfdbfe", fontSize: "0.9rem" };
const leaderListStyle = { display: "grid", gap: "0.65rem" };
const leaderRowStyle = {
  display: "grid",
  gridTemplateColumns: "28px 1fr",
  gap: "0.6rem",
  alignItems: "center"
};
const rankBadgeStyle = {
  display: "inline-flex",
  justifyContent: "center",
  alignItems: "center",
  width: "24px",
  height: "24px",
  borderRadius: "999px",
  background: "#312e81",
  color: "#e0e7ff",
  fontSize: "0.8rem",
  fontWeight: "700"
};
const recentMatchStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 1fr) minmax(130px, 0.6fr)",
  gap: "0.75rem",
  alignItems: "center",
  padding: "0.65rem",
  border: "1px solid #334155",
  borderRadius: "8px",
  background: "#0f172a"
};
