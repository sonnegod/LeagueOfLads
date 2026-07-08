import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';

export default function TeamDrafts({ draftData }) {
  const matches = draftData?.matches || [];
  const topPicks = draftData?.topPicks || [];
  const topBans = draftData?.topBans || [];

  if (!matches.length) {
    return <p style={{ color: 'var(--muted, #9ca3af)' }}>No draft data found for this team.</p>;
  }

  return (
    <div className="team-drafts-layout">
      <div className="team-drafts-main">
        {matches.map((match) => (
          <article className="team-draft-card" key={match.MatchId}>
            <div className="team-draft-card-header">
              <div>
                <Link to={`/match/${match.MatchId}`} className="team-draft-match-link">
                  Match {match.MatchId}
                </Link>
                <div className="team-draft-meta">
                  {match.LeagueName}
                  {match.DatePlayed ? ` | ${formatDate(match.DatePlayed)}` : ''}
                </div>
              </div>
              <span className={Number(match.SelectedTeamWon) === 1 ? 'team-draft-result win' : 'team-draft-result loss'}>
                {Number(match.SelectedTeamWon) === 1 ? 'Win' : 'Loss'}
              </span>
            </div>

            <div className="team-draft-columns">
              <DraftSide team={match.selectedTeam} />
              <DraftSide team={match.enemyTeam} />
            </div>
          </article>
        ))}
      </div>

      <aside className="team-drafts-stats" aria-label="Draft hero stats">
        <StatPanel title="Top Picks" rows={topPicks} countLabel="Picks" winLabel="Win Rate" />
        <StatPanel title="Top Bans" rows={topBans} countLabel="Bans" winLabel="Win Rate When Banned" />
      </aside>
    </div>
  );
}

function DraftSide({ team }) {
  return (
    <section className="team-draft-side">
      <div className="team-draft-side-header">
        <h3 className="team-draft-team-name">
          {team?.TeamName || 'Unknown Team'} <span>{team?.Side}</span>
        </h3>
      </div>

      <DraftHeroGroup label="Picks" heroes={team?.picks || []} />
      <DraftHeroGroup label="Bans" heroes={team?.bans || []} compact />
    </section>
  );
}

function DraftHeroGroup({ label, heroes, compact = false }) {
  return (
    <div className={compact ? 'team-draft-group compact' : 'team-draft-group'}>
      <div className="team-draft-group-label">{label}</div>
      <div className="team-draft-heroes">
        {heroes.length > 0 ? (
          heroes.map((hero, index) => (
            <div className="team-draft-hero" key={`${hero.HeroId}-${hero.OrderNum}-${index}`}>
              <span className="team-draft-hero-number">{formatOrderNum(hero.OrderNum)}</span>
              <HeroDisplay
                heroId={hero.HeroId}
                heroName={hero.HeroName}
                iconSize={compact ? 28 : 34}
                showName={false}
                style={{ gap: 0 }}
              />
            </div>
          ))
        ) : (
          <span className="team-draft-empty">None recorded</span>
        )}
      </div>
    </div>
  );
}

function StatPanel({ title, rows, countLabel, winLabel }) {
  return (
    <section className="team-draft-stat-panel">
      <h3>{title}</h3>
      <div className="team-draft-stat-table">
        <div className="team-draft-stat-row head">
          <span>Hero</span>
          <span>{countLabel}</span>
          <span>{winLabel}</span>
        </div>
        {rows.slice(0, 10).map((row) => (
          <div className="team-draft-stat-row" key={`${title}-${row.HeroId}`}>
            <span className="team-draft-stat-hero">
              <HeroDisplay heroId={row.HeroId} heroName={row.HeroName} iconSize={24} />
            </span>
            <span>{row.TimesUsed}</span>
            <span>{formatPercent(row.WinRate)}</span>
          </div>
        ))}
        {!rows.length && <div className="team-draft-empty stat-empty">No data</div>}
      </div>
    </section>
  );
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.0%';
  return `${number.toFixed(1)}%`;
}

function formatOrderNum(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
