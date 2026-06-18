import React from "react";
import { Link } from "react-router-dom";
import HeroDisplay from "./HeroDisplay";

const PLAYER_LEADER_MIN_GAMES = 5;

export default function LeagueHomeTab({
  league,
  teams = [],
  matches = [],
  players = [],
  heroes = [],
  stageInfo,
  stageExists
}) {
  const topTeams = getTopTeams(teams);
  const kdaLeaders = getKdaLeaders(players);
  const gpmLeaders = getStatLeaders(players, "AvgGPM");
  const topHeroes = getTopHeroes(heroes);
  const bestWinRateHeroes = getBestWinRateHeroes(heroes);
  const recentMatches = matches.slice(0, 6);
  const stageLabel = getStageLabel(stageInfo, stageExists);

  return (
    <div style={homeStyle}>
      <div style={heroPanelStyle}>
        <div>
          <div style={eyebrowStyle}>{stageLabel}</div>
          <h2 style={{ margin: "0.25rem 0" }}>{league?.LeagueName} Home</h2>
          <p style={subtleTextStyle}>
            A quick pulse check for the league: standings, player heaters, hero trends, and recent games.
          </p>
        </div>
        {league?.WinnerTeamId && (
          <div style={winnerCardStyle}>
            <div style={eyebrowStyle}>Champion</div>
            <Link to={`/team/${league.WinnerTeamId}`} style={featureLinkStyle}>
              {league.WinnerTeamName}
            </Link>
          </div>
        )}
      </div>

      <div style={metricGridStyle}>
        <MetricCard label="Teams" value={teams.length} />
        <MetricCard label="Matches" value={matches.length} />
        <MetricCard label="Players" value={players.length} />
        <MetricCard label="Heroes Picked" value={heroes.length} />
      </div>

      <div style={featureGridStyle}>
        <FeatureCard title="Table Boss">
          {topTeams.length > 0 ? (
            <div style={leaderListStyle}>
              {topTeams.map((team, index) => (
                <LeaderRow
                  key={team.TeamId}
                  rank={index + 1}
                  href={`/team/${team.TeamId}`}
                  name={team.TeamName}
                  detail={`${formatPercent(team.WinPercentage)} win rate, ${formatNumber(team.GamesPlayed)} games`}
                />
              ))}
            </div>
          ) : (
            <EmptyState>No team data yet.</EmptyState>
          )}
        </FeatureCard>

        <FeatureCard title="KDA Leader">
          {kdaLeaders.length > 0 ? (
            <div style={leaderListStyle}>
              {kdaLeaders.map((player, index) => (
                <LeaderRow
                  key={player.PlayerId}
                  rank={index + 1}
                  href={`/player/${player.PlayerId}`}
                  name={player.PlayerName}
                  detail={`${formatNumber(getKda(player), 2)} KDA, ${formatNumber(player.GamesPlayed)} games`}
                />
              ))}
            </div>
          ) : (
            <EmptyState>No player has at least 5 games yet.</EmptyState>
          )}
        </FeatureCard>

        <FeatureCard title="Economy King">
          {gpmLeaders.length > 0 ? (
            <div style={leaderListStyle}>
              {gpmLeaders.map((player, index) => (
                <LeaderRow
                  key={player.PlayerId}
                  rank={index + 1}
                  href={`/player/${player.PlayerId}`}
                  name={player.PlayerName}
                  detail={`${formatNumber(player.AvgGPM, 0)} average GPM, ${formatNumber(player.GamesPlayed)} games`}
                />
              ))}
            </div>
          ) : (
            <EmptyState>No player has at least 5 games yet.</EmptyState>
          )}
        </FeatureCard>

        <FeatureCard title="Top 5 Heroes">
          {topHeroes.length > 0 ? (
            <div style={topHeroListStyle}>
              {topHeroes.map((hero, index) => (
                <div key={hero.HeroId} style={topHeroRowStyle}>
                  <span style={rankBadgeStyle}>{index + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} />
                    <div style={subtleTextStyle}>
                      {formatNumber(hero.GamesPlayed)} games, {formatPercent(hero.WinPercentage)} win rate
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No hero data yet.</EmptyState>
          )}
        </FeatureCard>
      </div>

      <div style={sectionGridStyle}>
        <section style={panelStyle}>
          <h3 style={sectionHeaderStyle}>Recent Matches</h3>
          {recentMatches.length > 0 ? (
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {recentMatches.map(match => (
                <div key={match.MatchId} style={recentMatchStyle}>
                  <div style={teamLineStyle}>
                    <Link to={`/team/${match.RadiantTeamId}`}>{match.RadiantTeamName}</Link>
                    {match.WinnerSide === "r" && <span style={winnerMarkStyle}>Winner</span>}
                  </div>
                  <div style={teamLineStyle}>
                    <Link to={`/team/${match.DireTeamId}`}>{match.DireTeamName}</Link>
                    {match.WinnerSide === "d" && <span style={winnerMarkStyle}>Winner</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No matches have landed here yet.</EmptyState>
          )}
        </section>

        <section style={panelStyle}>
          <h3 style={sectionHeaderStyle}>Hero Watch</h3>
          {bestWinRateHeroes.length > 0 ? (
            <div style={topHeroListStyle}>
              {bestWinRateHeroes.map((hero, index) => (
                <div key={hero.HeroId} style={topHeroRowStyle}>
                  <span style={rankBadgeStyle}>{index + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} />
                    <div style={subtleTextStyle}>
                      {formatPercent(hero.WinPercentage)} across {formatNumber(hero.GamesPlayed)} games
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No hero win rate leader yet.</EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricValueStyle}>{formatNumber(value)}</div>
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

function getTopTeams(teams) {
  return [...teams].sort((a, b) => {
    const winDiff = toNumber(b.WinPercentage) - toNumber(a.WinPercentage);
    if (winDiff !== 0) return winDiff;
    return toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed);
  }).slice(0, 5);
}

function getKdaLeaders(players) {
  return [...players]
    .filter(player => toNumber(player.GamesPlayed) >= PLAYER_LEADER_MIN_GAMES)
    .sort((a, b) => getKda(b) - getKda(a))
    .slice(0, 5);
}

function getStatLeaders(players, statKey) {
  return [...players]
    .filter(player => toNumber(player.GamesPlayed) >= PLAYER_LEADER_MIN_GAMES)
    .sort((a, b) => toNumber(b[statKey]) - toNumber(a[statKey]))
    .slice(0, 5);
}

function getTopHeroes(heroes) {
  return [...heroes]
    .sort((a, b) => toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed))
    .slice(0, 5);
}

function getBestWinRateHeroes(heroes) {
  const qualifiedHeroes = heroes.filter(hero => toNumber(hero.GamesPlayed) >= 2);
  const heroPool = qualifiedHeroes.length > 0 ? qualifiedHeroes : heroes;

  return [...heroPool].sort((a, b) => {
    const winDiff = toNumber(b.WinPercentage) - toNumber(a.WinPercentage);
    if (winDiff !== 0) return winDiff;
    return toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed);
  }).slice(0, 5);
}

function getKda(player) {
  return (toNumber(player.AvgKills) + toNumber(player.AvgAssists)) / Math.max(1, toNumber(player.AvgDeaths));
}

function getStageLabel(stageInfo, stageExists) {
  if (!stageExists || !stageInfo) return "League Dashboard";
  if (stageInfo.GroupEndMatchId && stageInfo.TieBreakerEndMatchId) return "Playoff Push";
  if (stageInfo.GroupEndMatchId) return "Tiebreaker Watch";
  return "Group Stage";
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

function formatPercent(value) {
  return `${formatNumber(value, 2)}%`;
}

const homeStyle = {
  display: "grid",
  gap: "1rem"
};

const heroPanelStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  alignItems: "stretch",
  padding: "1.25rem",
  border: "1px solid #334155",
  borderRadius: "12px",
  background: "linear-gradient(135deg, #111827, #1e1b4b)",
  color: "#f8fafc",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.22)"
};

const winnerCardStyle = {
  minWidth: "180px",
  padding: "1rem",
  border: "1px solid rgba(129, 140, 248, 0.45)",
  borderRadius: "10px",
  background: "rgba(15, 23, 42, 0.72)"
};

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

const metricValueStyle = {
  fontSize: "1.8rem",
  fontWeight: "700",
  lineHeight: 1
};

const featureGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.75rem"
};

const sectionGridStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 2fr) minmax(220px, 1fr)",
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

const sectionHeaderStyle = {
  marginTop: 0,
  marginBottom: "0.75rem"
};

const eyebrowStyle = {
  color: "#a5b4fc",
  fontSize: "0.75rem",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const subtleTextStyle = {
  color: "#cbd5e1",
  fontSize: "0.92rem"
};

const featureLinkStyle = {
  fontSize: "1.1rem",
  fontWeight: "700",
  color: "#bfdbfe"
};

const topHeroListStyle = {
  display: "grid",
  gap: "0.65rem"
};

const leaderListStyle = {
  display: "grid",
  gap: "0.65rem"
};

const topHeroRowStyle = {
  display: "grid",
  gridTemplateColumns: "28px 1fr",
  gap: "0.6rem",
  alignItems: "center"
};

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
  gridTemplateColumns: "1fr 1fr",
  gap: "0.75rem",
  alignItems: "center",
  padding: "0.65rem",
  border: "1px solid #334155",
  borderRadius: "8px",
  background: "#0f172a"
};

const teamLineStyle = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  minWidth: 0
};

const winnerMarkStyle = {
  padding: "0.15rem 0.4rem",
  borderRadius: "999px",
  background: "#dcfce7",
  color: "#166534",
  fontSize: "0.75rem",
  fontWeight: "700"
};
