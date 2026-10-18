import { WarehouseReporting, mean, number, playerMetrics, summarizeTeamGames, groupMatches, draftPhases } from './warehouseReporting.js';

const enriched = match => ['ready', 'partial'].includes(match.Status);
const median = values => {
  const sorted = values.filter(v => number(v) !== null).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { value: sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null, samples: sorted.length };
};
const metrics = [...playerMetrics, 'networthShare', 'GPM', 'XPM', 'Kills', 'Deaths', 'Assists'];
const aggregate = games => Object.fromEntries(metrics.map(key => [key, mean(games.map(g => g[key]))]));
const record = games => {
  const resolved = games.filter(g => g.won !== null), wins = resolved.filter(g => g.won).length;
  return { games: games.length, wins, losses: resolved.length - wins, resolved: resolved.length,
    winRate: { value: resolved.length ? wins / resolved.length * 100 : null, samples: resolved.length } };
};
const percentile = (metric, peers, entity, higherIsBetter = true) => {
  const values = peers.filter(p => p?.samples >= 5 && number(p.value) !== null).map(p => p.value);
  return { value: metric?.samples >= 5 && number(metric.value) !== null && values.length >= 2
    ? (values.filter(v => higherIsBetter ? v < metric.value : v > metric.value).length + values.filter(v => v === metric.value).length / 2) / values.length * 100 : null,
    entities: values.length, entity, minimumGames: 5, higherIsBetter };
};
const annotate = (rows, keys, entity) => rows.map(row => ({ ...row, percentiles: Object.fromEntries(keys.map(key =>
  [key, percentile(row[key], rows.map(r => r[key]), entity, !['Deaths', 'firstTowerTime', 'firstRoshanTime'].includes(key))])) }));
const groups = (rows, key) => {
  const result = new Map();
  for (const row of rows) { const id = key(row), group = result.get(id) || []; group.push(row); result.set(id, group); }
  return result;
};

export class ExpandedPerformanceReporting extends WarehouseReporting {
  selection({ leagueId = null, patchId = null, stage = 'all' } = {}) {
    const base = [...new Map(this.matches('league', null, { leagueId }).map(m => [m.MatchId, m])).values()];
    const boundaries = new Map(this.db.prepare('SELECT * FROM LeagueStageBoundaries').all().map(b => [b.LeagueId, b]));
    const explicit = new Map();
    for (const row of this.db.prepare(`SELECT DISTINCT sm.MatchId,s.Stage FROM SeriesMatch sm JOIN SeriesInfo s ON s.SeriesId=sm.SeriesId
      WHERE sm.MatchId IN(SELECT value FROM json_each(?)) AND s.Stage IS NOT NULL`).all(JSON.stringify(base.map(m => m.MatchId)))) {
      const label = String(row.Stage).toLowerCase().replace(/[ _-]/g, '');
      const value = /tiebreak/.test(label) ? 'tiebreakers' : /playoff|final|upper|lower/.test(label) ? 'playoffs'
        : /group|regular/.test(label) ? 'regular' : null;
      if (value) { const stages = explicit.get(row.MatchId) || new Set(); stages.add(value); explicit.set(row.MatchId, stages); }
    }
    const stageFor = match => {
      const saved = explicit.get(match.MatchId);
      if (saved) return saved.size === 1 ? [...saved][0] : 'unknown';
      const boundary = boundaries.get(match.LeagueId);
      if (!boundary?.GroupEndMatchId) return 'unknown';
      if (match.MatchId <= boundary.GroupEndMatchId) return 'regular';
      if (boundary.TieBreakerEndMatchId == null) return 'unknown';
      return match.MatchId <= boundary.TieBreakerEndMatchId ? 'tiebreakers' : 'playoffs';
    };
    const matches = base.map(m => ({ ...m, stage: stageFor(m) })).filter(m => (patchId == null || m.PatchId === patchId) && (stage === 'all' || m.stage === stage));
    return { matches, options: { patches: [...new Map(base.filter(m => m.PatchId != null).map(m => [m.PatchId, { id: m.PatchId, name: m.PatchKey }])).values()] },
      unknownStages: matches.filter(m => m.stage === 'unknown').length };
  }

  playerRecords(games, { byTeam = false } = {}) {
    return [...groups(games, g => byTeam ? `${g.PlayerId}:${g.teamId}:${g.leagueId}` : g.PlayerId)].map(([key, rows]) => ({
      key, playerId: rows[0].PlayerId, teamId: rows[0].teamId, teamName: rows[0].teamName,
      leagueId: rows[0].leagueId, name: rows[0].PlayerName || this.playerName(rows[0].PlayerId),
      ...record(rows), ...aggregate(rows)
    })).sort((a, b) => b.games - a.games);
  }

  playerName(id) { return this.db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=?').get(id)?.PlayerName || `Player ${id}`; }

  heroTrends(matches, games) {
    // Played heroes include valid remakes with no draft. Bans/contest/phase use complete drafts only.
    const metadata = new Map(matches.map(m => [m.MatchId, m])), lineups = groupMatches(games);
    const played = new Map(), counts = new Map(), phases = new Map();
    let playedGames = 0, completeDrafts = 0;
    for (const lineup of lineups.values()) {
      if (lineup.length !== 10 || new Set(lineup.map(p => p.HeroId)).size !== 10) continue;
      playedGames++;
      for (const p of lineup) played.set(p.HeroId, (played.get(p.HeroId) || 0) + 1);
    }
    const actions = this.db.prepare(`SELECT DISTINCT MatchId,Hero_Id HeroId,IsPick,OrderNum,Team FROM PickInfo
      WHERE MatchId IN(SELECT value FROM json_each(?)) ORDER BY MatchId,OrderNum`).all(JSON.stringify(matches.map(m => m.MatchId)));
    for (const entries of groupMatches(actions).values()) {
      const draft = draftPhases(entries);
      if (!draft.complete) continue;
      completeDrafts++;
      for (const entry of draft.entries) {
        const count = counts.get(entry.HeroId) || { picks: 0, bans: 0 };
        count[entry.IsPick ? 'picks' : 'bans']++; counts.set(entry.HeroId, count);
        const key = `${entry.HeroId}:${entry.phaseKey}`, phase = phases.get(key) || { key, heroId: entry.HeroId,
          phase: entry.phase, picks: 0, bans: 0, wins: 0, resolved: 0 };
        phase[entry.IsPick ? 'picks' : 'bans']++;
        const match = metadata.get(entry.MatchId);
        if (entry.IsPick && match.WinnerSide != null) { phase.resolved++; if (match.WinnerSide === entry.Team) phase.wins++; }
        phases.set(key, phase);
      }
    }
    const names = new Map(this.db.prepare('SELECT HeroId,HeroName FROM HeroInfo').all().map(h => [h.HeroId, h.HeroName]));
    const appearances = groups(games, g => g.HeroId);
    const heroes = [...new Set([...played.keys(), ...counts.keys(), ...appearances.keys()])].map(heroId => {
      const rows = appearances.get(heroId) || [], count = counts.get(heroId) || { picks: 0, bans: 0 };
      return { key: heroId, heroId, name: names.get(heroId) || `Hero ${heroId}`, ...record(rows),
        picks: played.get(heroId) || 0, bans: count.bans, contestCount: count.picks + count.bans,
        pickRate: { value: playedGames ? (played.get(heroId) || 0) / playedGames * 100 : null, samples: playedGames },
        banRate: { value: completeDrafts ? count.bans / completeDrafts * 100 : null, samples: completeDrafts },
        contestRate: { value: completeDrafts ? (count.picks + count.bans) / completeDrafts * 100 : null, samples: completeDrafts } };
    }).sort((a, b) => b.picks - a.picks);
    return { heroes, playedGames, completeDrafts,
      phases: [...phases.values()].map(p => ({ ...p, actions: p.picks + p.bans,
        rate: { value: completeDrafts ? (p.picks + p.bans) / completeDrafts * 100 : null, samples: completeDrafts },
        winRate: { value: p.resolved ? p.wins / p.resolved * 100 : null, samples: p.resolved } })) };
  }

  heroPerformance(heroId, filters = {}) {
    return this.cached(`expanded-hero:${heroId}:${JSON.stringify(filters)}`, () => {
      const name = this.db.prepare('SELECT HeroName FROM HeroInfo WHERE HeroId=?').get(heroId)?.HeroName;
      if (!name) return null;
      const selection = this.selection(filters), data = this.performanceGames(selection.matches, { includeLegacy: true, basicOnly: true });
      const all = data.playerGames, heroGames = this.performanceGames(selection.matches, { heroId }).playerGames;
      const played = all.filter(g => g.HeroId === heroId);
      const trends = this.heroTrends(selection.matches, all), hero = trends.heroes.find(h => h.heroId === heroId);
      const players = annotate(this.playerRecords(heroGames), [...metrics, 'winRate'], 'players');
      const patches = [...groups(played, g => g.patch || 'Unknown patch')].map(([key, rows]) => ({ key, name: key, ...record(rows) }));
      const purchaseMatches = new Map(heroGames.map(g => [g.matchId, g]));
      const matchMetadata = new Map(selection.matches.map(m => [m.MatchId, m]));
      const purchases = this.rows('MatchPlayerPurchases', [...purchaseMatches.keys()],
        'AND (MatchId,PlayerId) IN(SELECT json_extract(value,\'$[0]\'),json_extract(value,\'$[1]\') FROM json_each(?))',
        [JSON.stringify(heroGames.map(g => [g.matchId, g.PlayerId]))]);
      const firstPurchase = new Map();
      for (const p of purchases) {
        const game = purchaseMatches.get(p.MatchId), match = matchMetadata.get(p.MatchId);
        if (p.PlayerId !== game.PlayerId || p.TimeSeconds < 0 || p.TimeSeconds > match.Duration || /^recipe_/.test(p.ItemKey)) continue;
        const key = `${p.MatchId}:${p.ItemKey}`;
        if (!firstPurchase.has(key) || firstPurchase.get(key).time > p.TimeSeconds) firstPurchase.set(key, { item: p.ItemKey, time: p.TimeSeconds, game });
      }
      const items = [...groups([...firstPurchase.values()], p => p.item)].map(([key, rows]) => ({ key,
        games: rows.length, timing: median(rows.map(p => p.time)), ...record(rows.map(p => p.game)) })).sort((a, b) => b.games - a.games);
      const purchaseCoverage = selection.matches.filter(m => purchaseMatches.has(m.MatchId)
        && JSON.parse(m.SectionsJson || '{}').purchases?.players === 10).length;
      return { name, heroId, options: selection.options, unknownStages: played.filter(g => matchMetadata.get(g.matchId).stage === 'unknown').length,
        coverage: { total: played.length, enriched: heroGames.length },
        record: record(played), players, patches, items, purchaseCoverage,
        draft: { ...(hero || {}), playedGames: trends.playedGames, completeDrafts: trends.completeDrafts,
          phases: trends.phases.filter(p => p.heroId === heroId) } };
    });
  }

  leaguePerformance(leagueId, filters = {}) {
    return this.cached(`expanded-league:${leagueId}:${JSON.stringify(filters)}`, () => {
      if (!this.db.prepare('SELECT 1 FROM LeagueInfo WHERE LeagueId=?').get(leagueId)) return null;
      const selection = this.selection({ ...filters, leagueId }), data = this.performanceGames(selection.matches);
      const { games: teamGames, checkpointMinutes } = this.teamPerformanceGames(data);
      const teams = [...groups(teamGames, g => g.teamId)].map(([teamId, games]) => {
        const aggregate = summarizeTeamGames(games), first = data.enriched.find(m => m.TeamRad === teamId || m.TeamDire === teamId);
        const later = Object.fromEntries(checkpointMinutes.filter(minute => minute >= 30).flatMap(minute => {
          const conversion = ahead => {
            const rows = games.filter(g => g.won !== null && number(g[`gold${minute}`]) !== null && (ahead ? g[`gold${minute}`] > 0 : g[`gold${minute}`] < 0));
            return { value: rows.length ? rows.filter(g => g.won).length / rows.length * 100 : null, samples: rows.length };
          };
          return [[`gold${minute}`, mean(games.map(g => g[`gold${minute}`]))], [`xp${minute}`, mean(games.map(g => g[`xp${minute}`]))],
            [`ahead${minute}`, conversion(true)], [`behind${minute}`, conversion(false)]];
        }));
        return { key: teamId, teamId, name: first.TeamRad === teamId ? first.RadiantTeamName : first.DireTeamName,
          ...record(games), ...aggregate.summary, ...aggregate.conversions, ...aggregate.objectives,
          ...later,
          comebacks: games.filter(g => g.won === true && g.worstDeficit <= -10000).length,
          leadsLost: games.filter(g => g.won === false && g.largestLead >= 10000).length };
      }).sort((a, b) => b.games - a.games);
      const teamKeys = [...new Set(teams.flatMap(t => Object.keys(t).filter(key => typeof t[key] === 'object' && t[key]?.samples != null)))];
      const players = annotate(this.playerRecords(data.playerGames, { byTeam: true }), [...metrics, 'winRate'], 'players');
      const legacyData = this.performanceGames(selection.matches, { includeLegacy: true, basicOnly: true });
      const trends = this.heroTrends(selection.matches, legacyData.playerGames);
      const resolved = selection.matches.filter(m => m.WinnerSide != null);
      const kills = m => number(m.RadiantScore) !== null && number(m.DireScore) !== null ? m.RadiantScore + m.DireScore : null;
      const summary = { duration: mean(selection.matches.map(m => m.Duration)), kills: mean(data.enriched.map(kills)),
        firstTowerTime: mean(teamGames.filter(g => g.firstTower).map(g => g.firstTowerTime)),
        firstRoshanTime: mean(teamGames.filter(g => g.firstRoshan).map(g => g.firstRoshanTime)),
        radiantWins: { value: resolved.length ? resolved.filter(m => m.WinnerSide === 0).length / resolved.length * 100 : null, samples: resolved.length },
        direWins: { value: resolved.length ? resolved.filter(m => m.WinnerSide === 1).length / resolved.length * 100 : null, samples: resolved.length } };
      const matchMeta = new Map(selection.matches.map(m => [m.MatchId, m]));
      const matchLink = (m, extra = {}) => ({ matchId: m.MatchId, radiant: m.RadiantTeamName, dire: m.DireTeamName,
        duration: m.Duration, stage: m.stage, ...extra });
      const bigComebacks = teamGames.filter(g => g.won === true && g.worstDeficit <= -10000).sort((a, b) => a.worstDeficit - b.worstDeficit)
        .slice(0, 10).map(g => matchLink(matchMeta.get(g.matchId), { comeback: -g.worstDeficit }));
      const finalLeads = groupMatches(this.rows('MatchTeamTimeline', data.ids, 'ORDER BY TimeSeconds'));
      const close = data.enriched.flatMap(m => {
        const points = (finalLeads.get(m.MatchId) || []).filter(p => p.TimeSeconds <= m.Duration && number(p.RadiantGoldAdvantage) !== null);
        const final = points.at(-1);
        return final && m.Duration - final.TimeSeconds <= 60 ? [matchLink(m, { finalLead: Math.abs(final.RadiantGoldAdvantage) })] : [];
      }).sort((a, b) => a.finalLead - b.finalLead).slice(0, 10);
      const standout = key => data.playerGames.filter(g => number(g[key]) !== null).sort((a, b) => b[key] - a[key]).slice(0, 5)
        .map(g => ({ matchId: g.matchId, playerId: g.PlayerId, name: data.names.get(g.PlayerId), heroId: g.HeroId, heroName: g.HeroName, value: g[key] }));
      return { options: selection.options, unknownStages: selection.unknownStages, coverage: { total: selection.matches.length, enriched: data.enriched.length },
        summary, checkpointMinutes, teams: annotate(teams, teamKeys, 'teams'), players, draft: trends,
        notable: { comebacks: bigComebacks, closest: close,
          longest: [...selection.matches].filter(m => number(m.Duration) !== null).sort((a, b) => b.Duration - a.Duration).slice(0, 10).map(m => matchLink(m)),
          damage: standout('damagePerMinute'), healing: standout('healingPerMinute'), farming: standout('lh10') } };
    });
  }

}
