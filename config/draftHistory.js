import { metaWeight } from '../shared/metaPolicy.js';

const empty = () => ({ games: 0, wins: 0, effectiveGames: 0, effectiveWins: 0, practiceGames: 0, currentGames: 0, unknownGames: 0 });
export function addSignal(row, won, weight, current) {
  row.games++; row.wins += won; row.effectiveGames += weight.outcome; row.effectiveWins += won * weight.outcome;
  row.practiceGames += weight.practice; row.currentGames += Number(current); row.unknownGames += Number(weight.unknown);
}
export function buildDraftHistory(db, leagueId, asOf, meta, mode) {
  const params = { league: leagueId, asOf };
  const valid = `ml.LeagueId<=@league AND ml.DatePlayed IS NOT NULL AND
    CASE WHEN length(ml.DatePlayed)<=10 THEN substr(ml.DatePlayed,1,10)<substr(@asOf,1,10)
    ELSE datetime(ml.DatePlayed)<datetime(@asOf) END
    AND datetime(ml.DatePlayed)>=datetime(@asOf,'-5 years')
    AND m.WinnerId IN (m.TeamRad,m.TeamDire) AND m.TeamRad<>m.TeamDire AND COALESCE(m.Rehost,0)=0`;
  const matches = db.prepare(`SELECT m.MatchId id,ml.LeagueId leagueId,m.TeamRad rad,m.TeamDire dire,m.WinnerId winner,
    m.Duration duration,ml.DatePlayed date,t.StartAt kickoff,t.SummaryJson telemetryJson
    FROM MatchLeague ml JOIN MatchTeam m ON m.MatchId=ml.MatchId
    LEFT JOIN DraftGodMatchTelemetry t ON t.MatchId=m.MatchId WHERE ${valid}
    AND (t.StartAt IS NULL OR datetime(t.StartAt)<datetime(@asOf)) ORDER BY datetime(ml.DatePlayed),m.MatchId`).all(params);
  const byId = new Map(matches.map(m => [m.id, m]));
  const fields = ['Kills','Deaths','Assists','Networth','Lasthits','HeroDamage','GPM','XPM','Healing','TowerDamage'];
  const rows = db.prepare(`WITH memberships AS (
    SELECT MatchId,PlayerId,MIN(TeamId) TeamId FROM MatchTeamPlayer GROUP BY MatchId,PlayerId HAVING COUNT(DISTINCT TeamId)=1
  ) SELECT mp.MatchId,mp.PlayerId,MIN(mp.HeroId) HeroId,t.TeamId,${fields.map(f => `MIN(mp.${f}) ${f}`).join(',')}
    FROM MatchLeague ml JOIN MatchTeam m ON m.MatchId=ml.MatchId JOIN MatchPlayer mp ON mp.MatchId=m.MatchId
    JOIN memberships t ON t.MatchId=mp.MatchId AND t.PlayerId=mp.PlayerId
    WHERE ${valid} AND mp.PlayerId>0 AND t.TeamId IN (m.TeamRad,m.TeamDire)
    GROUP BY mp.MatchId,mp.PlayerId HAVING COUNT(DISTINCT mp.HeroId)=1`).all(params);
  const players = {}, teams = {}, matchups = {}, heroRates = {}, patchCounts = {};
  const weights=new Map();
  const weight = (m, heroes = []) => {
    const key=`${m.id}:${[...heroes].sort((a,b)=>a-b).join(':')}`;
    if(!weights.has(key)) weights.set(key,metaWeight(meta, { date: m.kickoff && Date.parse(m.kickoff) < Date.parse(asOf) ? m.kickoff : m.date,
      precise: Boolean(m.kickoff && Date.parse(m.kickoff) < Date.parse(asOf)) || m.date.length > 10, heroes, mode }));
    return weights.get(key);
  };
  for (const m of matches) {
    m.weight = weight(m); m.patch = m.weight.patch; m.players = []; m.draft = [];
    m.telemetry = m.telemetryJson ? JSON.parse(m.telemetryJson) : null; delete m.telemetryJson;
    const bucket = patchCounts[m.patch || 'unknown'] ||= { games: 0, effectiveGames: 0 }; bucket.games++; bucket.effectiveGames += m.weight.outcome;
    for (const id of [m.rad,m.dire]) {
      const team = teams[id] ||= { ...empty(), heroes: {}, pairs: {}, bans: {} };
      addSignal(team, Number(m.winner===id), m.weight, m.patch===meta.current?.key);
    }
  }
  for (const row of rows) {
    const m = byId.get(row.MatchId); if (!m) continue;
    m.players.push(row);
    const p = players[row.PlayerId] ||= { ...empty(), heroes: {} };
    const hero = p.heroes[row.HeroId] ||= { id: row.HeroId, ...empty(), patches: {} };
    const w = weight(m, [row.HeroId]), won = Number(row.TeamId===m.winner), current = w.patch===meta.current?.key;
    addSignal(p,won,w,current); addSignal(hero,won,w,current);
    const patch = hero.patches[w.patch || 'unknown'] ||= { games: 0, wins: 0 }; patch.games++; patch.wins += won;
  }
  const drafts = db.prepare(`SELECT DISTINCT p.MatchId,p.Hero_Id heroId,p.Team side,p.IsPick isPick,p.OrderNum draftOrder
    FROM MatchLeague ml JOIN MatchTeam m ON m.MatchId=ml.MatchId JOIN PickInfo p ON p.MatchId=m.MatchId
    WHERE ${valid} ORDER BY p.MatchId,p.OrderNum`).all(params);
  const seen = new Map();
  for (const row of drafts) {
    const m = byId.get(row.MatchId); if (!m || ![0,1].includes(row.side)) continue;
    const used = seen.get(m.id) || new Set(); seen.set(m.id,used);
    // Repeated/contradictory entries do not count twice.
    if (used.has(row.heroId)) continue; used.add(row.heroId); m.draft.push(row);
    const teamId = row.side===0 ? m.rad : m.dire, team = teams[teamId], won = Number(m.winner===teamId);
    if (row.isPick) {
      const hero = team.heroes[row.heroId] ||= { ...empty(), picks: 0, firstPicks: 0 };
      hero.picks++; if (m.draft.filter(r => r.isPick).length===1) hero.firstPicks++;
      const w = weight(m,[row.heroId]); addSignal(hero,won,w,w.patch===meta.current?.key);
      addSignal(heroRates[row.heroId] ||= empty(),won,w,w.patch===meta.current?.key);
    } else team.bans[row.heroId] = (team.bans[row.heroId] || 0)+1;
  }
  for (const m of matches) for (const side of [0,1]) {
    const teamId = side===0 ? m.rad : m.dire, won = Number(m.winner===teamId);
    const own = m.draft.filter(r => r.side===side && r.isPick).map(r => r.heroId);
    const enemy = m.draft.filter(r => r.side!==side && r.isPick).map(r => r.heroId);
    for (const a of own) for (const b of enemy) {
      const w = weight(m,[a,b]); addSignal(matchups[`${a}:${b}`] ||= empty(),won,w,w.patch===meta.current?.key);
    }
    for (let a=0;a<own.length;a++) for (let b=a+1;b<own.length;b++) {
      const w = weight(m,[own[a],own[b]]), key = [own[a],own[b]].sort((x,y)=>x-y).join(':');
      const pair=teams[teamId].pairs[key] ||= {...empty(),patches:{}};
      addSignal(pair,won,w,w.patch===meta.current?.key);
      const patch=pair.patches[w.patch||'unknown'] ||= {games:0,wins:0};patch.games++;patch.wins+=won;
    }
  }
  const excludedUndated = db.prepare(`SELECT COUNT(*) n FROM MatchLeague WHERE LeagueId<=? AND (DatePlayed IS NULL OR datetime(DatePlayed) IS NULL)`).get(leagueId).n;
  return { players, teams, matchups, heroRates, leagues: [...new Set(matches.map(m => m.leagueId))], excludedUndated,
    matches: matches.length, raw: matches, patchCounts };
}
