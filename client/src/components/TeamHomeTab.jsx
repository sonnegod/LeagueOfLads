import { Link } from "react-router-dom";
import HeroDisplay from "./HeroDisplay";

const PLAYER_LEADER_MIN_GAMES = 5;

export default function TeamHomeTab({
  teamName,
  teamId,
  selectedLeague,
  matches = [],
  heroes = [],
  players = []
}) {
  const teamMatches = matches || [];
  const teamHeroes = heroes || [];
  const teamPlayers = players || [];
  const wins = teamMatches.filter(match => didTeamWin(match, teamId)).length;
  const winRate = teamMatches.length ? (wins / teamMatches.length) * 100 : 0;
  const topKdaPlayers = getKdaLeaders(teamPlayers);
  const topGpmPlayers = getStatLeaders(teamPlayers, "AvgGPM");
  const topHeroes = getTopHeroes(teamHeroes);
  const bestWinRateHeroes = getBestWinRateHeroes(teamHeroes);
  const recentMatches = teamMatches.slice(0, 6);

  return (
    <div style={homeStyle}>
      <section style={heroPanelStyle}>
        <div>
          <div style={eyebrowStyle}>{selectedLeague === "all" ? "All Leagues" : "Filtered League"}</div>
          <h2 style={{ margin: "0.25rem 0" }}>{teamName} Home</h2>
          <p style={subtleTextStyle}>
            A quick look at form, player production, comfort heroes, and recent matches.
          </p>
        </div>
      </section>

      <div style={metricGridStyle}>
        <MetricCard label="Matches" value={teamMatches.length} />
        <MetricCard label="Wins" value={wins} />
        <MetricCard label="Win Rate" value={`${formatNumber(winRate, 2)}%`} />
        <MetricCard label="Heroes Played" value={teamHeroes.length} />
      </div>

      <div style={featureGridStyle}>
        <FeatureCard title="KDA Leaders">
          {topKdaPlayers.length > 0 ? (
            <div style={leaderListStyle}>
              {topKdaPlayers.map((player, index) => (
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

        <FeatureCard title="GPM Leaders">
          {topGpmPlayers.length > 0 ? (
            <div style={leaderListStyle}>
              {topGpmPlayers.map((player, index) => (
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
          <HeroList heroes={topHeroes} detailMode="games" />
        </FeatureCard>

        <FeatureCard title="Hero Watch">
          <HeroList heroes={bestWinRateHeroes} detailMode="winRate" />
        </FeatureCard>
      </div>

      <section style={panelStyle}>
        <h3 style={sectionHeaderStyle}>Recent Matches</h3>
        {recentMatches.length > 0 ? (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {recentMatches.map(match => (
              <div key={match.MatchId} style={recentMatchStyle}>
                <TeamResult match={match} side="r" />
                <TeamResult match={match} side="d" />
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

function TeamResult({ match, side }) {
  const isRadiant = side === "r";
  const teamId = isRadiant ? match.rad_team_id : match.dire_team_id;
  const teamName = isRadiant ? match.rad_team_name : match.dire_team_name;
  const won = match.WinnerSide === side;

  return (
    <div style={teamLineStyle}>
      <Link to={`/team/${teamId}`} style={featureLinkStyle}>{teamName}</Link>
      {won && <span style={winnerMarkStyle}>Winner</span>}
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

function didTeamWin(match, teamId) {
  const stringTeamId = String(teamId);
  return (
    (match.WinnerSide === "r" && String(match.rad_team_id) === stringTeamId) ||
    (match.WinnerSide === "d" && String(match.dire_team_id) === stringTeamId)
  );
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

  return [...heroPool]
    .sort((a, b) => {
      const winDiff = toNumber(b.WinPercentage) - toNumber(a.WinPercentage);
      if (winDiff !== 0) return winDiff;
      return toNumber(b.GamesPlayed) - toNumber(a.GamesPlayed);
    })
    .slice(0, 5);
}

function getKda(player) {
  return (toNumber(player.AvgKills) + toNumber(player.AvgAssists)) / Math.max(1, toNumber(player.AvgDeaths));
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

const heroPanelStyle = {
  padding: "1.25rem",
  border: "1px solid #334155",
  borderRadius: "12px",
  background: "linear-gradient(135deg, #111827, #1e1b4b)",
  color: "#f8fafc",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.22)"
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

const metricValueStyle = { fontSize: "1.8rem", fontWeight: "700", lineHeight: 1 };

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
const eyebrowStyle = {
  color: "#a5b4fc",
  fontSize: "0.75rem",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};
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
  gridTemplateColumns: "1fr 1fr minmax(130px, 0.6fr)",
  gap: "0.75rem",
  alignItems: "center",
  padding: "0.65rem",
  border: "1px solid #334155",
  borderRadius: "8px",
  background: "#0f172a"
};
const teamLineStyle = { display: "flex", gap: "0.5rem", alignItems: "center", minWidth: 0 };
const winnerMarkStyle = {
  padding: "0.15rem 0.4rem",
  borderRadius: "999px",
  background: "#dcfce7",
  color: "#166534",
  fontSize: "0.75rem",
  fontWeight: "700"
};
