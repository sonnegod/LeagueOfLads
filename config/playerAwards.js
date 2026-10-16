export const PLAYER_AWARD_CRITERIA = Object.freeze({
  allTimeHeroGames: 15,
  playerGames: 15,
});

const emptyRecord = playerId => ({ playerId, games: 0, wins: 0 });
const winRate = record => Math.round(record.wins / record.games * 10000) / 100;

// Count one completed league appearance per player, even if an importer wrote duplicates.
// Conflicting hero/team records are omitted rather than choosing an arbitrary value.
const APPEARANCES = `WITH player_games AS (
    SELECT MatchId, PlayerId, MIN(HeroId) HeroId FROM MatchPlayer
    WHERE PlayerId > 0 GROUP BY MatchId, PlayerId HAVING COUNT(DISTINCT HeroId) = 1
  ), player_teams AS (
    SELECT p.MatchId, p.PlayerId, MIN(p.TeamId) TeamId FROM MatchTeamPlayer p
    JOIN MatchTeam m ON m.MatchId = p.MatchId AND p.TeamId IN (m.TeamRad, m.TeamDire)
    GROUP BY p.MatchId, p.PlayerId HAVING COUNT(DISTINCT p.TeamId) = 1
  ), appearances AS (
    SELECT ml.LeagueId, p.MatchId, p.PlayerId, p.HeroId, t.TeamId,
      CASE WHEN t.TeamId = m.WinnerId THEN 1 ELSE 0 END Won
    FROM player_games p
    JOIN player_teams t ON t.MatchId = p.MatchId AND t.PlayerId = p.PlayerId
    JOIN MatchTeam m ON m.MatchId = p.MatchId
    JOIN MatchLeague ml ON ml.MatchId = p.MatchId
    WHERE m.WinnerId IN (m.TeamRad, m.TeamDire) AND m.TeamRad <> m.TeamDire
  )`;

function awardLeaders(records, minimum, compare, create) {
  const eligible = [...records.values()].filter(record => record.games >= minimum);
  if (!eligible.length) return [];
  let best = eligible[0];
  for (const record of eligible) if (compare(record, best) > 0) best = record;
  const leaders = eligible.filter(record => compare(record, best) === 0);
  return leaders.map(record => ({ ...create(record), shared: leaders.length > 1,
    tiedPlayers: leaders.length, minimumGames: minimum,
    games: record.games, wins: record.wins, winRate: winRate(record) }));
}

const byRate = (a, b) => a.wins * b.games - b.wins * a.games;
const byGames = (a, b) => a.games - b.games;

export default class PlayerAwardsStore {
  constructor(db, { now = () => Date.now(), maxAgeMs = 60000 } = {}) {
    this.db = db;
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.revision = db.prepare('SELECT total_changes() changes');
  }

  forPlayer(playerId) {
    const revision = `${this.db.pragma('data_version', { simple: true })}:${this.revision.get().changes}`;
    if (!this.cache || revision !== this.cache.revision || this.now() - this.cache.time >= this.maxAgeMs) {
      this.cache = { ...this.build(), revision, time: this.now() };
    }
    return { awards: this.cache.players.get(Number(playerId)) || [],
      criteria: PLAYER_AWARD_CRITERIA, generatedAt: new Date(this.cache.time).toISOString() };
  }

  build() {
    const heroes = new Map(this.db.prepare('SELECT HeroId, HeroName FROM HeroInfo').all()
      .map(hero => [hero.HeroId, hero.HeroName]));
    const career = { scope: 'all-time', leagueId: null, leagueName: null,
      provisional: false, players: new Map(), heroes: new Map() };
    const rows = this.db.prepare(`${APPEARANCES}
      SELECT a.PlayerId, a.HeroId, COUNT(*) Games, SUM(a.Won) Wins
      FROM appearances a JOIN LeagueInfo l ON l.LeagueId = a.LeagueId
      GROUP BY a.PlayerId, a.HeroId`).all();
    for (const row of rows) {
      const player = career.players.get(row.PlayerId) || emptyRecord(row.PlayerId);
      player.games += row.Games;
      player.wins += row.Wins;
      career.players.set(row.PlayerId, player);
      if (row.HeroId > 0) {
        if (!career.heroes.has(row.HeroId)) career.heroes.set(row.HeroId, new Map());
        career.heroes.get(row.HeroId).set(row.PlayerId,
          { playerId: row.PlayerId, games: row.Games, wins: row.Wins });
      }
    }

    const players = new Map();
    const add = award => {
      if (!players.has(award.playerId)) players.set(award.playerId, []);
      const { playerId, ...publicAward } = award;
      players.get(playerId).push(publicAward);
    };
    const create = (type, title, extra = {}) => record => ({
      scope: 'all-time', leagueId: null, leagueName: null, provisional: false, ...extra,
      id: `all-time:${type}${extra.heroId ? `:${extra.heroId}` : ''}`,
      type, title, playerId: record.playerId,
    });
    awardLeaders(career.players, PLAYER_AWARD_CRITERIA.playerGames, byRate,
      create('winningest', 'Winningest Player')).forEach(add);
    awardLeaders(career.players, PLAYER_AWARD_CRITERIA.playerGames, byGames,
      create('veteran', 'League Veteran')).forEach(add);
    const minimum = PLAYER_AWARD_CRITERIA.allTimeHeroGames;
    for (const [heroId, heroPlayers] of career.heroes) {
      const hero = { heroId, heroName: heroes.get(heroId) || `Hero ${heroId}` };
      awardLeaders(heroPlayers, minimum, byRate, create('hero_specialist', 'Hero Specialist', hero)).forEach(add);
      awardLeaders(heroPlayers, minimum, byGames, create('hero_loyalist', 'Hero Loyalist', hero)).forEach(add);
    }
    this.champions().forEach(add);
    const priority = award => award.type === 'champion' ? 0 : 1;
    const typePriority = { champion: 0, winningest: 1, hero_specialist: 2, veteran: 3, hero_loyalist: 4 };
    for (const awards of players.values()) awards.sort((a, b) => priority(a) - priority(b)
      || (b.leagueId || 0) - (a.leagueId || 0)
      || typePriority[a.type] - typePriority[b.type] || (a.heroName || '').localeCompare(b.heroName || ''));
    return { players };
  }

  champions() {
    return this.db.prepare(`${APPEARANCES}, champion_teams AS (
        SELECT s.SeasonId, s.ExternalLeagueId LeagueId, s.LeagueName, s.ChampionTeamId TeamId,
          COALESCE(n.DisplayName, t.TeamName, 'Team ' || s.ChampionTeamId) TeamName
        FROM LeagueSeasons s LEFT JOIN TeamInfo t ON t.TeamId = s.ChampionTeamId
        LEFT JOIN LeagueTeamNames n ON n.LeagueId = s.ExternalLeagueId AND n.TeamId = s.ChampionTeamId
        WHERE s.Status = 'ended' AND s.ChampionTeamId > 0
      ), team_games AS (
        SELECT c.LeagueId, COUNT(DISTINCT m.MatchId) Games FROM champion_teams c
        JOIN MatchLeague ml ON ml.LeagueId = c.LeagueId
        JOIN MatchTeam m ON m.MatchId = ml.MatchId AND c.TeamId IN (m.TeamRad, m.TeamDire)
        WHERE m.WinnerId IN (m.TeamRad, m.TeamDire) AND m.TeamRad <> m.TeamDire GROUP BY c.LeagueId
      ), declared_rosters AS (
        SELECT c.LeagueId, p.PlayerId FROM champion_teams c
        JOIN SeasonTeams t ON t.SeasonId = c.SeasonId AND t.ExternalTeamId = c.TeamId
        JOIN TeamRosterPlayers p ON p.TeamSubmissionId = t.TeamSubmissionId
      )
      SELECT c.LeagueId, c.LeagueName, c.TeamId, c.TeamName, a.PlayerId,
        COUNT(*) Games, SUM(a.Won) Wins, tg.Games TeamGames,
        EXISTS (SELECT 1 FROM declared_rosters r WHERE r.LeagueId = c.LeagueId) HasRoster
      FROM champion_teams c JOIN team_games tg ON tg.LeagueId = c.LeagueId
      JOIN appearances a ON a.LeagueId = c.LeagueId AND a.TeamId = c.TeamId
      WHERE NOT EXISTS (SELECT 1 FROM declared_rosters r WHERE r.LeagueId = c.LeagueId)
        OR EXISTS (SELECT 1 FROM declared_rosters r WHERE r.LeagueId = c.LeagueId AND r.PlayerId = a.PlayerId)
      GROUP BY c.LeagueId, a.PlayerId HAVING COUNT(*) * 2 > tg.Games`).all().map(row => ({
      id: `${row.LeagueId}:champion`, type: 'champion', title: 'League Champion', scope: 'season',
      playerId: row.PlayerId, leagueId: row.LeagueId, leagueName: row.LeagueName,
      teamId: row.TeamId, teamName: row.TeamName, teamGames: row.TeamGames,
      games: row.Games, wins: row.Wins, winRate: winRate({ games: row.Games, wins: row.Wins }),
      provisional: false, shared: false,
      rosterSource: row.HasRoster ? 'signup' : 'majority-lineup',
    }));
  }
}
