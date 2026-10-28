import { useState } from 'react';
import { Link } from "react-router-dom";
import HeroDisplay from "./HeroDisplay";
import DotabuffLink from './DotabuffLink';
import {rosterDisplayMembers} from '../utils/rosterDisplayMembers';
import LeagueSeriesTab from './LeagueSeriesTab';
import { seriesMatchesForDisplay } from '../utils/leagueSeries';

const PLAYER_LEADER_MIN_GAMES = 5;

export default function TeamHomeTab({
  teamId,
  roster = null,
  matches = [],
  series = [],
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
  const recentSeries = series.slice(0, 6);

  if (!teamId) return <RosterCard roster={roster} />;

  return (
    <div className="detail-home" style={homeStyle}>
      <div className="detail-metric-grid" style={metricGridStyle}>
        <MetricCard label="Matches" value={teamMatches.length} />
        <MetricCard label="Wins" value={wins} />
        <MetricCard label="Win Rate" value={`${formatNumber(winRate, 2)}%`} />
        <MetricCard label="Heroes Played" value={teamHeroes.length} />
      </div>

      <div className="detail-feature-grid" style={featureGridStyle}>
        <RosterCard roster={roster} />
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
        <h3 style={sectionHeaderStyle}>Recent Series</h3>
        {recentSeries.length > 0 ? (
          <LeagueSeriesTab series={recentSeries} matches={seriesMatchesForDisplay(recentSeries)} />
        ) : (
          <EmptyState>No recent series available.</EmptyState>
        )}
      </section>
    </div>
  );
}

function RosterCard({ roster }) {
  const [copyResult,setCopyResult]=useState(null);
  const members=roster?rosterDisplayMembers(roster):[];
  const copyText=members.map((player,index)=>[
    index+1,
    player.pending?'Player TBD':String(player.PlayerName||`Player ${player.PlayerId}`).replace(/[\t\r\n]+/g,' '),
    !player.pending&&Number.isSafeInteger(Number(player.PlayerId))&&Number(player.PlayerId)>0
      ?`https://www.dotabuff.com/players/${player.PlayerId}`:'',
  ].join('\t')).join('\n');
  const copyStatus=copyResult?.text===copyText?copyResult.status:null;
  async function copyRoster() {
    setCopyResult({text:copyText,status:'copying'});
    try {
      await navigator.clipboard.writeText(copyText);
      setCopyResult({text:copyText,status:'copied'});
    }catch {
      setCopyResult({text:copyText,status:'error'});
    }
  }
  return <FeatureCard title="Roster" action={<button type="button" className="team-roster-copy"
    aria-label="Copy roster" aria-live="polite" title="Copy row numbers, player names and Dotabuff links"
    disabled={!members.length||copyStatus==='copying'} onClick={copyRoster}>
    {copyStatus==='copied'?'Copied!':copyStatus==='copying'?'Copying…':'Copy'}
  </button>}>
    {copyStatus==='error'&&<p className="team-roster-copy-error" role="alert">Could not copy the roster. Please try again.</p>}
    {roster ?
      <ul className="team-home-roster-players">{members.map((player,index) => <li key={player.pending?`pending:${player.Slot}`:player.PlayerId}>
        {roster.Source==='signup'&&roster.SeasonStatus==='active'&&<span className="team-roster-position">Pos {index+1}</span>}
        {player.pending?<span>Player TBD</span>:<><Link to={`/player/${player.PlayerId}`} target="_blank" rel="noopener noreferrer">{player.PlayerName}</Link>
        <DotabuffLink playerId={player.PlayerId} name={player.PlayerName} /></>}
      </li>)}</ul>
      : <EmptyState>No roster recorded yet.</EmptyState>}
  </FeatureCard>;
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

function FeatureCard({ title, children, action }) {
  return (
    <section style={panelStyle}>
      {action?<div className="detail-feature-heading"><h3 style={{...sectionHeaderStyle,marginBottom:0}}>{title}</h3>{action}</div>
        :<h3 style={sectionHeaderStyle}>{title}</h3>}
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

const homeStyle = { display: "grid", gap: "var(--ui-content-gap)" };

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "var(--space-4)"
};

const metricCardStyle = {
  padding: "var(--space-4)",
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
  gap: "var(--space-4)"
};

const panelStyle = {
  padding: "var(--ui-card-inset)",
  border: "1px solid #334155",
  borderRadius: "10px",
  background: "#111827",
  color: "#f8fafc",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.16)"
};

const sectionHeaderStyle = { marginTop: 0, marginBottom: "var(--space-4)" };
const subtleTextStyle = { color: "#cbd5e1", fontSize: "0.92rem" };
const featureLinkStyle = { fontSize: "1rem", fontWeight: "700", color: "#bfdbfe" };
const leaderListStyle = { display: "grid", gap: "var(--space-3)" };
const leaderRowStyle = {
  display: "grid",
  gridTemplateColumns: "28px 1fr",
  gap: "var(--space-3)",
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
