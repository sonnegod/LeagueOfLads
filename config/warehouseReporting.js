import { gunzipSync } from 'node:zlib';
import { toHeroSlug } from './heroNames.js';

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const mean = values => {
  const known = values.filter(v => number(v) !== null);
  return { value: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null, samples: known.length };
};
const rate = (value, seconds, scale = 60) => number(value) !== null && seconds > 0 ? value / seconds * scale : null;
const sideOf = slot => slot != null && slot >= 0 && slot <= 4 ? 0 : slot >= 128 && slot <= 132 ? 1 : null;
const placeholders = ids => JSON.stringify(ids);
const parse = (json, fallback = {}) => { try { return JSON.parse(json); } catch { return fallback; } };
const playerMetrics = ['gold10', 'xp10', 'lh10', 'gold20', 'xp20', 'lh20', 'damagePerMinute', 'healingPerMinute', 'damageShare',
  'wards10', 'sentries10', 'dewards10', 'stacks10', 'stuns10', 'Denies', 'FinalLevel', 'killParticipation', 'towerDamagePerMinute'];
const teamMetrics = ['gold10', 'gold20', 'xp10', 'xp20', 'wards10', 'dewards10', 'stacks10', 'damagePerMinute', 'healingPerMinute'];
const groupMatches = data => {
  const groups = new Map();
  for (const row of data) {
    const key = row.MatchId ?? row.matchId, group = groups.get(key) || [];
    group.push(row); groups.set(key, group);
  }
  return groups;
};
const summarizeTeamGames = games => {
  const summary = Object.fromEntries(teamMetrics.map(key => [key, mean(games.map(g => g[key]))]));
  const conversion = (key, ahead) => {
    const eligible = games.filter(g => g.won !== null && number(g[key]) !== null && (ahead ? g[key] > 0 : g[key] < 0));
    const wins = eligible.filter(g => g.won).length;
    return { value: eligible.length ? wins / eligible.length * 100 : null, samples: eligible.length, wins };
  };
  const firstRate = key => {
    const available = games.filter(g => g[key] !== null);
    return { value: available.length ? available.filter(g => g[key]).length / available.length * 100 : null, samples: available.length };
  };
  return { summary, conversions: { ahead10: conversion('gold10', true), behind10: conversion('gold10', false),
    ahead20: conversion('gold20', true), behind20: conversion('gold20', false) },
    objectives: { firstTower: firstRate('firstTower'), firstRoshan: firstRate('firstRoshan'),
      firstTowerTime: mean(games.filter(g => g.firstTower).map(g => g.firstTowerTime)),
      firstRoshanTime: mean(games.filter(g => g.firstRoshan).map(g => g.firstRoshanTime)),
      roshanShare: { value: games.reduce((n, g) => n + g.totalRoshans, 0)
        ? games.reduce((n, g) => n + g.roshans, 0) / games.reduce((n, g) => n + g.totalRoshans, 0) * 100 : null,
        samples: games.filter(g => g.totalRoshans > 0).length } } };
};
export { mean, number, playerMetrics, summarizeTeamGames, groupMatches };

// Source slots take priority over legacy membership rows, which can be duplicated
// or retain a former team ID. Ambiguous legacy memberships remain unassigned.
export function getReportingPlayers(db, matchId) {
  return db.prepare(`SELECT p.*,COALESCE(CAST(i.PlayerName AS TEXT),'Player '||p.PlayerId) PlayerName,
    COALESCE(CAST(h.HeroName AS TEXT),'Hero '||p.HeroId) HeroName,
    CASE WHEN p.PlayerSlot BETWEEN 0 AND 4 THEN 0 WHEN p.PlayerSlot BETWEEN 128 AND 132 THEN 1
      ELSE (SELECT CASE WHEN MIN(t.TeamId)=MAX(t.TeamId) THEN CASE WHEN MIN(t.TeamId)=m.TeamRad THEN 0 ELSE 1 END END
        FROM MatchTeamPlayer t WHERE t.MatchId=p.MatchId AND t.PlayerId=p.PlayerId AND t.TeamId IN(m.TeamRad,m.TeamDire)) END TeamSide
    FROM MatchPlayer p JOIN MatchTeam m ON m.MatchId=p.MatchId
    LEFT JOIN PlayerInfo i ON i.PlayerId=p.PlayerId LEFT JOIN HeroInfo h ON h.HeroId=p.HeroId
    WHERE p.MatchId=? AND p.rowid=(SELECT MAX(x.rowid) FROM MatchPlayer x WHERE x.MatchId=p.MatchId AND x.PlayerId=p.PlayerId)
    ORDER BY TeamSide IS NULL,TeamSide,p.PlayerSlot,p.PlayerId`).all(matchId);
}

export function describeObjective(row) {
  const raw = parse(row.SourceJson), target = row.Target || raw.key || '';
  let teamSide = row.TeamSide, label = row.Type, denied = false, category = 'other';
  if (row.Type === 'building_kill') {
    const destroyedSide = String(target).includes('goodguys') ? 0 : String(target).includes('badguys') ? 1 : null;
    denied = destroyedSide !== null && teamSide === destroyedSide;
    if (teamSide == null && destroyedSide !== null) teamSide = 1 - destroyedSide;
    category = /tower\d/.test(target) ? 'tower' : /rax/.test(target) ? 'barracks' : 'building';
    const lane = /_(top|mid|bot)$/.exec(target)?.[1];
    const tier = /tower(\d)/.exec(target)?.[1];
    label = category === 'tower' ? `Tier ${tier} ${lane || ''} tower ${denied ? 'denied' : 'destroyed'}`
      : category === 'barracks' ? `Barracks ${denied ? 'denied' : 'destroyed'}` : 'Building destroyed';
  } else {
    const descriptions = {
      CHAT_MESSAGE_FIRSTBLOOD: ['firstBlood', 'First blood'], CHAT_MESSAGE_ROSHAN_KILL: ['roshan', 'Roshan killed'],
      CHAT_MESSAGE_AEGIS: ['aegis', 'Aegis claimed'], CHAT_MESSAGE_AEGIS_STOLEN: ['aegis', 'Aegis stolen'],
      CHAT_MESSAGE_MINIBOSS_KILL: ['tormentor', 'Tormentor killed'], CHAT_MESSAGE_COURIER_LOST: ['courier', 'Courier lost'],
    };
    [category, label] = descriptions[row.Type] || ['other', row.Type];
  }
  return { index: row.EventIndex, time: row.TimeSeconds, category, label, teamSide,
    playerId: row.PlayerId, target, denied };
}

export function draftPhases(rows) {
  const entries = [...new Map(rows.map(e => [`${e.OrderNum}:${e.Team}:${e.IsPick}:${e.HeroId}`, e])).values()]
    .sort((a, b) => a.OrderNum - b.OrderNum);
  // Missing/conflicting actions can shift every later phase; do not guess them.
  const complete = entries.length >= 20 && entries.every((e, i) => e.OrderNum === i && [0, 1].includes(e.IsPick)
    && [0, 1].includes(e.Team)) && new Set(entries.map(e => e.HeroId)).size === entries.length
    && [0, 1].every(side => entries.filter(e => e.IsPick === 1 && e.Team === side).length === 5);
  const phases = [0, 0]; let previous = null;
  return { complete, entries: entries.map(e => {
    if (!complete) return { ...e, phase: null, phaseKey: null };
    if (e.IsPick !== previous) phases[e.IsPick]++;
    previous = e.IsPick;
    return { ...e, phase: `${e.IsPick ? 'Pick' : 'Ban'} phase ${phases[e.IsPick]}`,
      phaseKey: `${e.IsPick}:${phases[e.IsPick]}` };
  }) };
}

export class WarehouseReporting {
  constructor(db, { ttl = 60000, maxEntries = 48, now = Date.now } = {}) {
    this.db = db; this.ttl = ttl; this.maxEntries = maxEntries; this.now = now; this.cache = new Map();
  }

  cached(key, build) {
    const revision = `${this.db.pragma('data_version', { simple: true })}:${this.db.prepare('SELECT total_changes() n').get().n}`;
    if (revision !== this.revision) { this.cache.clear(); this.revision = revision; }
    const old = this.cache.get(key);
    if (old && old.until > this.now()) { this.cache.delete(key); this.cache.set(key, old); return old.value; }
    const value = this.db.transaction(build)();
    this.cache.delete(key); this.cache.set(key, { value, until: this.now() + this.ttl });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  matches(type, id, { leagueId = null, patchId = null, heroId = null } = {}) {
    const where = type === 'match' ? [] : ['m.Rehost=0', 'm.TeamRad<>m.TeamDire'], params = [];
    if (type === 'player') { where.push('EXISTS(SELECT 1 FROM MatchPlayer p WHERE p.MatchId=m.MatchId AND p.PlayerId=?)'); params.push(id); }
    if (type === 'team') { where.push('(m.TeamRad=? OR m.TeamDire=?)'); params.push(id, id); }
    if (type === 'match') { where.push('m.MatchId=?'); params.push(id); }
    if (leagueId != null) { where.push('l.LeagueId=?'); params.push(leagueId); }
    if (patchId != null) { where.push('m.PatchId=?'); params.push(patchId); }
    if (heroId != null && type === 'player') {
      where.push('EXISTS(SELECT 1 FROM MatchPlayer p WHERE p.MatchId=m.MatchId AND p.PlayerId=? AND p.HeroId=?)'); params.push(id, heroId);
    }
    return this.db.prepare(`SELECT m.*,l.LeagueId,l.DatePlayed,i.LeagueName,p.PatchKey,
      COALESCE(r.TeamName,'Team '||m.TeamRad) RadiantTeamName,COALESCE(d.TeamName,'Team '||m.TeamDire) DireTeamName,
      s.Status,s.SectionsJson,CASE WHEN m.WinnerId=m.TeamRad THEN 0 WHEN m.WinnerId=m.TeamDire THEN 1 END WinnerSide
      FROM MatchTeam m JOIN MatchLeague l ON l.MatchId=m.MatchId JOIN LeagueInfo i ON i.LeagueId=l.LeagueId
      LEFT JOIN TeamInfo r ON r.TeamId=m.TeamRad LEFT JOIN TeamInfo d ON d.TeamId=m.TeamDire
      LEFT JOIN Patches p ON p.PatchId=m.PatchId LEFT JOIN MatchIngestionState s ON s.MatchId=m.MatchId
      WHERE ${where.join(' AND ')} ORDER BY COALESCE(m.StartTimeUtc,0) DESC,m.MatchId DESC`).all(...params);
  }

  rows(table, ids, extra = '', params = [], columns = '*') {
    if (!ids.length) return [];
    return this.db.prepare(`SELECT ${columns} FROM ${table} WHERE MatchId IN(SELECT value FROM json_each(?)) ${extra}`)
      .all(placeholders(ids), ...params);
  }

  match(matchId) {
    return this.cached(`match:${matchId}`, () => {
      const match = this.matches('match', matchId)[0];
      if (!match) return null;
      const available = ['ready', 'partial'].includes(match.Status) && !match.Rehost && match.TeamRad !== match.TeamDire;
      return { match, available, sections: parse(match.SectionsJson), players: getReportingPlayers(this.db, matchId),
        timeline: available ? this.rows('MatchTeamTimeline', [matchId], 'ORDER BY TimeSeconds') : [],
        playerTimeline: available ? this.rows('MatchPlayerTimeline', [matchId], 'ORDER BY TimeSeconds,PlayerId') : [],
        objectives: available ? this.rows('MatchObjectives', [matchId], 'ORDER BY TimeSeconds,EventIndex').map(describeObjective) : [] };
    });
  }

  skillBuilds(matchId) {
    return this.cached(`match:${matchId}:skills`, () => {
      const match = this.matches('match', matchId)[0];
      if (!match) return null;
      const players = getReportingPlayers(this.db, matchId);
      const builds = new Map(players.map(p => [p.PlayerId, []]));
      if (!match.Rehost && match.TeamRad !== match.TeamDire) {
        for (const row of this.rows('MatchPlayerAbilityUpgrades', [matchId], 'ORDER BY PlayerId,UpgradeIndex')) {
          builds.get(row.PlayerId)?.push({ index: row.UpgradeIndex, abilityId: row.AbilityId });
        }
      }
      return { available: [...builds.values()].some(upgrades => upgrades.length > 0),
        players: players.map(p => ({ playerId: p.PlayerId, upgrades: builds.get(p.PlayerId) })) };
    });
  }

  inventories(matchId) {
    return this.cached(`match:${matchId}:inventories`, () => {
      const overview = this.match(matchId);
      if (!overview) return null;
      const archive = overview.available ? this.db.prepare('SELECT GameplayData FROM MatchSourceResponses WHERE MatchId=?').get(matchId) : null;
      const sources = new Map((archive ? parse(gunzipSync(archive.GameplayData).toString('utf8')).players || [] : [])
        .map(player => [player.account_id, player]));
      const startingItems = new Map();
      if (overview.available) for (const purchase of this.rows('MatchPlayerPurchases', [matchId],
        'AND TimeSeconds<=0 ORDER BY PlayerId,TimeSeconds,EventIndex')) {
        if (!startingItems.has(purchase.PlayerId)) startingItems.set(purchase.PlayerId, []);
        startingItems.get(purchase.PlayerId).push(purchase.ItemKey);
      }
      return { available: overview.available, players: overview.players.map(player => {
        const source = sources.get(player.PlayerId);
        return { playerId: player.PlayerId,
          startingItems: Array.isArray(source?.purchase_log) ? startingItems.get(player.PlayerId) || [] : null,
          inventory: source ? {
          items: Array.from({ length: 6 }, (_, i) => source[`item_${i}`] ?? null),
          backpack: Array.from({ length: 3 }, (_, i) => source[`backpack_${i}`] ?? null), neutral: source.item_neutral ?? null,
        } : null };
      }) };
    });
  }

  events(matchId) {
    return this.cached(`match:${matchId}:events`, () => {
      const overview = this.match(matchId);
      if (!overview) return null;
      const archive = overview.available ? this.db.prepare('SELECT GameplayData FROM MatchSourceResponses WHERE MatchId=?').get(matchId) : null;
      const sources = archive ? parse(gunzipSync(archive.GameplayData).toString('utf8')).players || [] : [];
      const players = new Map(overview.players.map(p => [p.PlayerId, p]));
      const heroes = new Map(overview.players.map(p => [`npc_dota_hero_${toHeroSlug(p.HeroName)}`, p]));
      const deaths = [];
      for (const source of sources) {
        const killer = players.get(source.account_id);
        if (!killer || !Array.isArray(source.kills_log)) continue;
        source.kills_log.forEach((entry, index) => {
          const victim = heroes.get(entry.key);
          if (!victim || number(entry.time) == null || entry.time < 0 || entry.time > overview.match.Duration) return;
          deaths.push({ index: `death:${source.account_id}:${index}`, time: entry.time, category: 'death',
            heroId: victim.HeroId, heroName: victim.HeroName, playerId: victim.PlayerId,
            victimSide: victim.TeamSide, teamSide: victim.TeamSide == null ? null : 1 - victim.TeamSide,
            label: `${victim.HeroName} killed by ${killer.HeroName} (${killer.PlayerName})` });
        });
      }
      deaths.sort((a, b) => a.time - b.time || a.index.localeCompare(b.index));
      return { available: sources.some(p => Array.isArray(p.kills_log)), deaths };
    });
  }

  draftViews(matchId) {
    return this.cached(`match:${matchId}:draftViews`, () => {
      const full = this.draft(matchId);
      if (!full) return null;
      return { season: { full, before: this.draft(matchId, { beforeMatch: true }) },
        patch: full.history.patchAvailable ? {
          full: this.draft(matchId, { samePatch: true }),
          before: this.draft(matchId, { samePatch: true, beforeMatch: true }),
        } : null };
    });
  }

  draft(matchId, { samePatch = false, beforeMatch = false } = {}) {
    return this.cached(`match:${matchId}:draft:${samePatch}:${beforeMatch}`, () => {
      const match = this.matches('match', matchId)[0];
      if (!match) return null;
      const players = getReportingPlayers(this.db, matchId);
      const currentDraft = draftPhases(this.db.prepare(`SELECT DISTINCT p.IsPick,p.Hero_Id HeroId,p.OrderNum,p.Team,
        COALESCE(h.HeroName,'Hero '||p.Hero_Id) HeroName FROM PickInfo p
        LEFT JOIN HeroInfo h ON h.HeroId=p.Hero_Id WHERE p.MatchId=? ORDER BY p.OrderNum`).all(matchId));
      const playedLineupOnly = currentDraft.entries.length === 0;
      const entries = playedLineupOnly ? players.map(p => ({ IsPick: 1, HeroId: p.HeroId, HeroName: p.HeroName,
        Team: p.TeamSide, OrderNum: null, phase: null, phaseKey: null, playedOnly: true })) : currentDraft.entries;
      const history = this.matches('league', null, { leagueId: match.LeagueId,
        patchId: samePatch ? match.PatchId : null }).filter(m => (!beforeMatch || (m.MatchId < matchId
          && (match.StartTimeUtc == null || m.StartTimeUtc == null || m.StartTimeUtc < match.StartTimeUtc)))
          && (!samePatch || match.PatchId != null));
      const ids = history.map(m => m.MatchId), metadata = new Map(history.map(m => [m.MatchId, m]));
      const rows = this.db.prepare(`SELECT MatchId,PlayerId,HeroId,PlayerSlot FROM MatchPlayer
        WHERE MatchId IN(SELECT value FROM json_each(?)) AND rowid IN(SELECT MAX(rowid) FROM MatchPlayer
        WHERE MatchId IN(SELECT value FROM json_each(?)) GROUP BY MatchId,PlayerId)`).all(placeholders(ids), placeholders(ids));
      const memberships = new Map();
      for (const row of this.rows('MatchTeamPlayer', ids)) {
        const m = metadata.get(row.MatchId);
        if (![m.TeamRad, m.TeamDire].includes(row.TeamId)) continue;
        const key = `${row.MatchId}:${row.PlayerId}`, teams = memberships.get(key) || new Set();
        teams.add(row.TeamId); memberships.set(key, teams);
      }
      const heroGames = new Map(), familiarity = new Map();
      const summary = (map, key) => {
        if (!map.has(key)) map.set(key, { games: new Set(), resolved: new Set(), wins: new Set(), bans: new Set() });
        return map.get(key);
      };
      for (const p of rows) {
        const m = metadata.get(p.MatchId), member = memberships.get(`${p.MatchId}:${p.PlayerId}`);
        let side = sideOf(p.PlayerSlot);
        if (side == null && member?.size === 1) side = member.has(m.TeamRad) ? 0 : 1;
        p.TeamSide = side;
        for (const stats of [summary(heroGames, p.HeroId), summary(familiarity, `${p.PlayerId}:${p.HeroId}`)]) {
          stats.games.add(p.MatchId);
          if (side != null && m.WinnerSide != null) {
            stats.resolved.add(p.MatchId);
            if (side === m.WinnerSide) stats.wins.add(p.MatchId);
          }
        }
      }
      for (const ban of this.db.prepare(`SELECT DISTINCT MatchId,Hero_Id HeroId FROM PickInfo
        WHERE IsPick=0 AND MatchId IN(SELECT value FROM json_each(?))`).all(placeholders(ids))) {
        summary(heroGames, ban.HeroId).bans.add(ban.MatchId);
      }
      const stats = value => ({ games: value?.games.size || 0, resolvedGames: value?.resolved.size || 0,
        wins: value?.wins.size || 0, bans: value?.bans.size || 0,
        winRate: value?.resolved.size ? value.wins.size / value.resolved.size * 100 : null });
      const lineups = new Map(), playedHeroes = new Map(), teamPlayed = new Map();
      let playedGames = 0;
      for (const player of rows) {
        const lineup = lineups.get(player.MatchId) || []; lineup.push(player); lineups.set(player.MatchId, lineup);
      }
      for (const [id, lineup] of lineups) {
        // Unknown lineups cannot be treated as games where a hero was not picked.
        if (lineup.length === 10 && new Set(lineup.map(p => p.HeroId)).size === 10) {
          playedGames++;
          for (const p of lineup) playedHeroes.set(p.HeroId, (playedHeroes.get(p.HeroId) || 0) + 1);
        }
        const m = metadata.get(id);
        for (const side of [0, 1]) {
          const teamId = side === 0 ? m.TeamRad : m.TeamDire;
          if (![match.TeamRad, match.TeamDire].includes(teamId)) continue;
          const teamLineup = lineup.filter(p => p.TeamSide === side);
          if (teamLineup.length !== 5 || new Set(teamLineup.map(p => p.HeroId)).size !== 5) continue;
          const sample = teamPlayed.get(teamId) || { games: 0, heroes: new Map() };
          sample.games++;
          for (const p of teamLineup) sample.heroes.set(p.HeroId, (sample.heroes.get(p.HeroId) || 0) + 1);
          teamPlayed.set(teamId, sample);
        }
      }
      const drafts = new Map(), frequency = new Map(), phaseSamples = new Map(), teamSamples = new Map();
      const addFrequency = (target, entry) => {
        const counts = target.get(entry.HeroId) || { picks: 0, bans: 0, phases: new Map() };
        counts[entry.IsPick ? 'picks' : 'bans']++;
        counts.phases.set(entry.phaseKey, (counts.phases.get(entry.phaseKey) || 0) + 1);
        target.set(entry.HeroId, counts);
      };
      for (const row of this.db.prepare(`SELECT DISTINCT MatchId,IsPick,Hero_Id HeroId,OrderNum,Team FROM PickInfo
        WHERE MatchId IN(SELECT value FROM json_each(?)) ORDER BY MatchId,OrderNum`).all(placeholders(ids))) {
        const list = drafts.get(row.MatchId) || []; list.push(row); drafts.set(row.MatchId, list);
      }
      let completeDrafts = 0;
      for (const rows of drafts.values()) {
        const draft = draftPhases(rows);
        if (!draft.complete) continue;
        completeDrafts++;
        for (const phase of new Set(draft.entries.map(e => e.phaseKey))) phaseSamples.set(phase, (phaseSamples.get(phase) || 0) + 1);
        for (const entry of draft.entries) addFrequency(frequency, entry);
        const historicalMatch = metadata.get(rows[0].MatchId);
        for (const side of [0, 1]) {
          const teamId = side === 0 ? historicalMatch.TeamRad : historicalMatch.TeamDire;
          if (![match.TeamRad, match.TeamDire].includes(teamId)) continue;
          const sample = teamSamples.get(teamId) || { games: 0, phases: new Map(), frequency: new Map() };
          sample.games++;
          const actions = draft.entries.filter(e => e.Team === side);
          for (const phase of new Set(actions.map(e => e.phaseKey))) sample.phases.set(phase, (sample.phases.get(phase) || 0) + 1);
          for (const entry of actions) addFrequency(sample.frequency, entry);
          teamSamples.set(teamId, sample);
        }
      }
      const frequencyStats = (counts, games, phaseGames, phaseKey, picks, pickGames) => {
        const draftPicks = counts?.picks || 0, bans = counts?.bans || 0, phaseCount = counts?.phases.get(phaseKey) || 0;
        const contestCount = draftPicks + bans;
        return { picks, pickGames, bans, games, pickRate: pickGames ? picks / pickGames * 100 : null,
          banRate: games ? bans / games * 100 : null, contestCount, contestRate: games ? contestCount / games * 100 : null,
          phaseCount, phaseGames, phaseRate: phaseGames ? phaseCount / phaseGames * 100 : null };
      };
      const enrichedEntries = entries.map(entry => {
        const teamId = entry.Team === 0 ? match.TeamRad : entry.Team === 1 ? match.TeamDire : null;
        const sample = teamId == null ? null : teamSamples.get(teamId);
        const played = teamId == null ? null : teamPlayed.get(teamId);
        const opponentId = entry.Team === 0 ? match.TeamDire : entry.Team === 1 ? match.TeamRad : null;
        const opponent = opponentId == null ? null : teamPlayed.get(opponentId);
        const opponentPicks = opponent?.heroes.get(entry.HeroId) || 0;
        return { ...entry, frequency: frequencyStats(frequency.get(entry.HeroId), completeDrafts, phaseSamples.get(entry.phaseKey) || 0, entry.phaseKey,
            playedHeroes.get(entry.HeroId) || 0, playedGames),
          teamFrequency: { teamId, ...frequencyStats(sample?.frequency.get(entry.HeroId), sample?.games || 0,
            sample?.phases.get(entry.phaseKey) || 0, entry.phaseKey, played?.heroes.get(entry.HeroId) || 0, played?.games || 0) },
          opponentPickFrequency: entry.IsPick === 0 && opponentId != null ? {
            teamId: opponentId, teamName: entry.Team === 0 ? match.DireTeamName : match.RadiantTeamName,
            picks: opponentPicks, games: opponent?.games || 0,
            pickRate: opponent?.games ? opponentPicks / opponent.games * 100 : null,
          } : null };
      });
      return { history: { games: history.length, leagueName: match.LeagueName, patchKey: match.PatchKey,
        samePatch, beforeMatch, patchAvailable: match.PatchId != null, playedGames, completeDrafts, playedLineupOnly, phasesAvailable: currentDraft.complete,
        usesMatchOrder: beforeMatch && (history.some(m => m.StartTimeUtc == null) || match.StartTimeUtc == null) },
        entries: enrichedEntries, teams: [0, 1].map(side => ({ side,
          name: side === 0 ? match.RadiantTeamName : match.DireTeamName,
          players: players.filter(p => p.TeamSide === side).map(p => ({ playerId: p.PlayerId, playerName: p.PlayerName,
            heroId: p.HeroId, heroName: p.HeroName,
            pickOrder: entries.find(e => e.IsPick === 1 && e.Team === side && e.HeroId === p.HeroId)?.OrderNum ?? null,
            familiarity: stats(familiarity.get(`${p.PlayerId}:${p.HeroId}`)), leagueHero: stats(heroGames.get(p.HeroId)) })) })),
        bans: enrichedEntries.filter(e => e.IsPick === 0).map(e => ({ ...e, leagueHero: stats(heroGames.get(e.HeroId)),
          opponents: e.Team == null || ![0, 1].includes(e.Team) ? [] : players.filter(p => p.TeamSide === 1 - e.Team)
            .map(p => ({ playerId: p.PlayerId, playerName: p.PlayerName, ...stats(familiarity.get(`${p.PlayerId}:${e.HeroId}`)) }))
            .filter(p => p.games > 0).sort((a, b) => b.games - a.games || a.playerName.localeCompare(b.playerName)) })) };
    });
  }

  playerMatch(matchId, playerId) {
    return this.cached(`match:${matchId}:player:${playerId}`, () => {
      const overview = this.match(matchId);
      if (!overview?.players.some(p => p.PlayerId === playerId)) return null;
      if (!overview.available) return { available: false, timeline: [], purchases: [], inventory: null };
      const inventory = this.inventories(matchId).players.find(p => p.playerId === playerId)?.inventory ?? null;
      return { available: true, inventory,
        timeline: this.rows('MatchPlayerTimeline', [matchId], 'AND PlayerId=? ORDER BY TimeSeconds', [playerId]),
        purchases: this.rows('MatchPlayerPurchases', [matchId], 'AND PlayerId=? ORDER BY TimeSeconds,EventIndex', [playerId]) };
    });
  }

  fights(matchId) {
    return this.cached(`match:${matchId}:fights`, () => {
      const overview = this.match(matchId);
      if (!overview) return null;
      const players = new Map(overview.players.map(p => [p.PlayerId, p]));
      const details = this.rows('MatchTeamfightPlayers', overview.available ? [matchId] : []);
      const objectiveTypes = new Set(['tower', 'barracks', 'building', 'roshan', 'tormentor', 'aegis']);
      const objectives = overview.objectives.filter(o => objectiveTypes.has(o.category) && !o.denied);
      return { available: overview.available && overview.sections.fights?.available === true,
        fights: this.rows('MatchTeamfights', overview.available ? [matchId] : [], 'ORDER BY StartSeconds,FightIndex').map((fight, index, fights) => {
          const observations = details.filter(p => p.FightIndex === fight.FightIndex).map(p => ({
            playerId: p.PlayerId, playerName: players.get(p.PlayerId)?.PlayerName || `Player ${p.PlayerId}`,
            heroId: players.get(p.PlayerId)?.HeroId, heroName: players.get(p.PlayerId)?.HeroName,
            teamSide: sideOf(p.PlayerSlot), deaths: p.Deaths, damage: p.Damage,
            gold: p.GoldDelta, xp: p.XpDelta, healing: number(parse(p.SourceJson).healing), buybacks: number(parse(p.SourceJson).buybacks),
          }));
          const totals = [0, 1].map(side => {
            const sidePlayers = observations.filter(p => p.teamSide === side);
            return Object.fromEntries(['deaths', 'damage', 'gold', 'xp', 'healing', 'buybacks'].map(key => [key,
              sidePlayers.length === 5 && sidePlayers.every(p => number(p[key]) !== null) ? sidePlayers.reduce((n, p) => n + p[key], 0) : null]));
          });
          for (const p of observations) {
            const teamDamage = totals[p.teamSide]?.damage;
            p.damageShare = teamDamage > 0 && number(p.damage) !== null ? p.damage / teamDamage * 100 : null;
          }
          const edge = key => totals.every(t => number(t[key]) !== null) ? totals[0][key] - totals[1][key] : null;
          const leaders = Object.fromEntries(['damage', 'healing'].map(key => {
            const highest = Math.max(0, ...observations.map(p => p[key]).filter(v => number(v) !== null));
            return [key, highest > 0 ? observations.filter(p => p[key] === highest).map(p => p.playerId) : []];
          }));
          const start = fight.StartSeconds, end = fight.EndSeconds;
          const validWindow = number(start) !== null && number(end) !== null && end >= start;
          const afterUntil = validWindow ? Math.max(end, Math.min(end + 90, fights[index + 1]?.StartSeconds ?? Infinity, overview.match.Duration ?? Infinity)) : null;
          return { index: fight.FightIndex, start, end, duration: validWindow ? end - start : null,
            players: observations, totals, goldEdge: edge('gold'), xpEdge: edge('xp'), deathEdge: edge('deaths') == null ? null : -edge('deaths'), leaders,
            objectives: { available: overview.sections.objectives?.available === true,
              during: validWindow ? objectives.filter(o => o.time != null && o.time >= start && o.time <= end) : [],
              after: validWindow ? objectives.filter(o => o.time != null && o.time > end && o.time < (fights[index + 1]?.StartSeconds ?? Infinity) && o.time <= afterUntil) : [],
              afterSeconds: validWindow ? afterUntil - end : null } };
        }) };
    });
  }

  performanceGames(matches, { playerId = null, heroId = null, includeLegacy = false, basicOnly = false } = {}) {
      const enriched = matches.filter(m => includeLegacy || ['ready', 'partial'].includes(m.Status));
      const ids = enriched.map(m => m.MatchId), metadata = new Map(enriched.map(m => [m.MatchId, m]));
      const rows = this.rows('MatchPlayer', ids, `AND rowid IN(SELECT MAX(rowid) FROM MatchPlayer
        WHERE MatchId IN(SELECT value FROM json_each(?)) GROUP BY MatchId,PlayerId)`, [placeholders(ids)],
        basicOnly ? 'MatchId,PlayerId,HeroId,PlayerSlot,Kills,Deaths,Assists,GPM,XPM' : '*');
      const names = new Map(this.db.prepare('SELECT PlayerId,PlayerName FROM PlayerInfo').all().map(p => [p.PlayerId, p.PlayerName]));
      const heroes = new Map(this.db.prepare('SELECT HeroId,HeroName FROM HeroInfo').all().map(h => [h.HeroId, h.HeroName]));
      const members = new Map();
      for (const p of this.rows('MatchTeamPlayer', ids)) {
        const match = metadata.get(p.MatchId);
        if (![match.TeamRad, match.TeamDire].includes(p.TeamId)) continue;
        const key = `${p.MatchId}:${p.PlayerId}`, set = members.get(key) || new Set(); set.add(p.TeamId); members.set(key, set);
      }
      for (const p of rows) {
        const m = metadata.get(p.MatchId), member = members.get(`${p.MatchId}:${p.PlayerId}`);
        p.TeamSide = sideOf(p.PlayerSlot);
        if (p.TeamSide === null && member?.size === 1) p.TeamSide = member.has(m.TeamRad) ? 0 : 1;
        p.HeroName = heroes.get(p.HeroId) || `Hero ${p.HeroId}`;
      }
      const byMatchSide = new Map();
      for (const p of rows) {
        const key = `${p.MatchId}:${p.TeamSide}`, group = byMatchSide.get(key) || [];
        group.push(p); byMatchSide.set(key, group);
      }
      const checkpoints = basicOnly ? [] : this.rows('MatchPlayerTimeline', ids, `AND TimeSeconds IN(600,1200) ${playerId != null ? 'AND PlayerId=?' : ''}`, playerId != null ? [playerId] : []);
      const sample = new Map(checkpoints.map(p => [`${p.MatchId}:${p.PlayerId}:${p.TimeSeconds}`, p]));
      const playerGames = rows.filter(p => (playerId == null || p.PlayerId === playerId) && (heroId == null || p.HeroId === heroId)).map(p => {
        const m = metadata.get(p.MatchId), teamPlayers = p.TeamSide === null ? [] : byMatchSide.get(`${p.MatchId}:${p.TeamSide}`) || [];
        const context = { PlayerName: names.get(p.PlayerId) || `Player ${p.PlayerId}`, matchId: m.MatchId, leagueId: m.LeagueId, leagueName: m.LeagueName, patch: m.PatchKey,
          teamId: p.TeamSide === null ? null : p.TeamSide === 0 ? m.TeamRad : m.TeamDire,
          teamName: p.TeamSide === null ? 'Unassigned side' : p.TeamSide === 0 ? m.RadiantTeamName : m.DireTeamName,
          won: p.TeamSide === null || m.WinnerSide === null ? null : p.TeamSide === m.WinnerSide };
        if (basicOnly) return { ...p, ...context };
        const teamDamage = teamPlayers.length === 5 && teamPlayers.every(p => number(p.HeroDamage) !== null)
          ? teamPlayers.reduce((n, p) => n + p.HeroDamage, 0) : null;
        const teamNetworth = teamPlayers.length === 5 && teamPlayers.every(p => number(p.Networth) !== null)
          ? teamPlayers.reduce((n, p) => n + p.Networth, 0) : null;
        const teamKills = teamPlayers.length === 5 && teamPlayers.every(p => number(p.Kills) !== null)
          ? teamPlayers.reduce((n, p) => n + p.Kills, 0) : null;
        const point10 = m.Duration >= 600 ? sample.get(`${p.MatchId}:${p.PlayerId}:600`) : null;
        const point20 = m.Duration >= 1200 ? sample.get(`${p.MatchId}:${p.PlayerId}:1200`) : null;
        return { ...p, ...context,
          gold10: point10?.Gold ?? null, xp10: point10?.Experience ?? null, lh10: point10?.LastHits ?? null,
          gold20: point20?.Gold ?? null, xp20: point20?.Experience ?? null, lh20: point20?.LastHits ?? null,
          damagePerMinute: rate(p.HeroDamage, m.Duration), healingPerMinute: rate(p.Healing, m.Duration),
          towerDamagePerMinute: rate(p.TowerDamage, m.Duration),
          killParticipation: teamKills > 0 && number(p.Kills) !== null && number(p.Assists) !== null ? (p.Kills + p.Assists) / teamKills * 100 : null,
          damageShare: teamDamage > 0 ? p.HeroDamage / teamDamage * 100 : null,
          networthShare: teamNetworth > 0 ? p.Networth / teamNetworth * 100 : null,
          wards10: rate(p.ObserversPlaced, m.Duration, 600), sentries10: rate(p.SentriesPlaced, m.Duration, 600),
          dewards10: rate(p.ObserversKilled == null || p.SentriesKilled == null ? null : p.ObserversKilled + p.SentriesKilled, m.Duration, 600),
          stacks10: rate(p.CampsStacked, m.Duration, 600), stuns10: rate(p.StunSeconds, m.Duration, 600) };
      }).sort((a, b) => (metadata.get(b.matchId).StartTimeUtc || 0) - (metadata.get(a.matchId).StartTimeUtc || 0) || b.matchId - a.matchId);
      return { enriched, ids, names, playerGames };
  }

  performanceBenchmarks(filters) {
    return this.cached(`performance-benchmarks:${JSON.stringify(filters)}`, () => {
      const { playerGames } = this.performanceGames(this.matches('league', null, filters), { heroId: filters.heroId });
      const players = new Map();
      for (const game of playerGames) {
        const games = players.get(game.PlayerId) || [];
        games.push(game); players.set(game.PlayerId, games);
      }
      return Object.fromEntries(playerMetrics.map(key => [key, [...players.values()]
        .map(games => mean(games.map(g => g[key]))).filter(metric => metric.samples >= 5).map(metric => metric.value).sort((a, b) => a - b)]));
    });
  }

  performance(type, id, filters = {}) {
    return this.cached(`${type}:${id}:${JSON.stringify(filters)}`, () => {
      const unfiltered = this.matches(type, id, { leagueId: filters.leagueId });
      const matches = this.matches(type, id, filters);
      const { enriched, ids, names, playerGames } = this.performanceGames(matches, { playerId: type === 'player' ? id : null, heroId: type === 'player' ? filters.heroId : null });
      const patches = [...new Map(unfiltered.filter(m => m.PatchId != null).map(m => [m.PatchId, { id: m.PatchId, name: m.PatchKey }])).values()];
      const coverage = { total: matches.length, enriched: enriched.length };
      if (type === 'player') {
        const metrics = playerMetrics;
        const aggregate = games => Object.fromEntries(metrics.map(key => [key, mean(games.map(g => g[key]))]));
        const group = key => [...new Set(playerGames.map(g => g[key]))].map(value => {
          const games = playerGames.filter(g => g[key] === value);
          return { key: value, name: key === 'HeroId' ? games[0].HeroName : key === 'teamId' ? games[0].teamName : value || 'Unknown patch',
            games: games.length, ...aggregate(games) };
        }).sort((a, b) => b.games - a.games);
        const notable = ['lh10', 'damagePerMinute', 'healingPerMinute', 'wards10', 'stuns10'].map(key => ({ key,
          games: playerGames.filter(g => number(g[key]) !== null).sort((a, b) => b[key] - a[key]).slice(0, 3)
            .map(g => ({ matchId: g.matchId, heroId: g.HeroId, heroName: g.HeroName, value: g[key] })) }));
        const heroOptions = this.db.prepare(`SELECT DISTINCT p.HeroId id,COALESCE(h.HeroName,'Hero '||p.HeroId) name
          FROM MatchPlayer p LEFT JOIN HeroInfo h ON h.HeroId=p.HeroId WHERE p.PlayerId=?
          AND p.MatchId IN(SELECT value FROM json_each(?)) ORDER BY name`).all(id, placeholders(unfiltered.map(m => m.MatchId)));
        const summary = aggregate(playerGames), benchmarks = this.performanceBenchmarks(filters);
        const percentiles = Object.fromEntries(metrics.map(key => {
          const metric = summary[key], peers = benchmarks[key];
          const eligible = metric.samples >= 5 && peers.length >= 2;
          return [key, { value: eligible ? (peers.filter(v => v < metric.value).length + peers.filter(v => v === metric.value).length / 2) / peers.length * 100 : null,
            players: peers.length, minimumGames: 5 }];
        }));
        return { coverage, patches, heroes: heroOptions, summary, percentiles, byHero: group('HeroId'),
          byPatch: group('patch'), byTeam: group('teamId'), recent: playerGames.slice(0, 30), notable };
      }
      const { games, checkpointMinutes } = this.teamPerformanceGames({ enriched, ids, names, playerGames }, id);
      const aggregate = summarizeTeamGames(games), benchmarks = this.teamPerformanceBenchmarks(filters);
      const percentiles = Object.fromEntries(Object.entries({ ...aggregate.summary, ...aggregate.conversions, ...aggregate.objectives }).map(([key, metric]) => {
        const peers = benchmarks[key] || [], higherIsBetter = !['firstTowerTime', 'firstRoshanTime'].includes(key);
        const eligible = metric.samples >= 5 && peers.length >= 2;
        return [key, { value: eligible ? (peers.filter(v => higherIsBetter ? v < metric.value : v > metric.value).length
          + peers.filter(v => v === metric.value).length / 2) / peers.length * 100 : null,
          teams: peers.length, minimumGames: 5, higherIsBetter }];
      }));
      const conversion = (key, ahead) => {
        const eligible = games.filter(g => g.won !== null && number(g[key]) !== null && (ahead ? g[key] > 0 : g[key] < 0));
        const wins = eligible.filter(g => g.won).length;
        return { value: eligible.length ? wins / eligible.length * 100 : null, samples: eligible.length, wins };
      };
      const notable = [
        { key: 'comebacks', games: games.filter(g => g.won === true && g.worstDeficit <= -10000).sort((a, b) => a.worstDeficit - b.worstDeficit).slice(0, 5) },
        { key: 'leadsLost', games: games.filter(g => g.won === false && g.largestLead >= 10000).sort((a, b) => b.largestLead - a.largestLead).slice(0, 5) },
      ];
      const appearances = games.flatMap(g => g.players);
      const distribution = [...new Set(appearances.map(p => p.playerId))].map(playerId => {
        const group = appearances.filter(p => p.playerId === playerId);
        return { playerId, name: group[0].name, games: group.length,
          damageShare: mean(group.map(p => p.damageShare)), networthShare: mean(group.map(p => p.networthShare)), wards: mean(group.map(p => p.wards)), stacks: mean(group.map(p => p.stacks)) };
      }).sort((a, b) => b.games - a.games);
      return { coverage, patches, ...aggregate, percentiles,
        checkpoints: checkpointMinutes.map(minute => ({ minute, gold: mean(games.map(g => g[`gold${minute}`])),
          xp: mean(games.map(g => g[`xp${minute}`])), ahead: conversion(`gold${minute}`, true), behind: conversion(`gold${minute}`, false) }))
          .filter(point => point.gold.samples || point.xp.samples),
        recent: games.slice(0, 50), notable, distribution };
    });
  }

  teamPerformanceGames({ enriched, ids, names, playerGames }, teamId = null) {
      const timeline = this.rows('MatchTeamTimeline', ids), objectives = this.rows('MatchObjectives', ids);
      const timelinesByMatch = groupMatches(timeline), objectivesByMatch = groupMatches(objectives), playersByMatch = groupMatches(playerGames);
      const checkpointMinutes = [...new Set([10, 20, ...timeline.filter(p => p.TimeSeconds >= 600 && p.TimeSeconds % 600 === 0)
        .map(p => p.TimeSeconds / 60)])].sort((a, b) => a - b);
      const games = enriched.flatMap(m => (teamId == null ? [m.TeamRad, m.TeamDire] : [teamId]).map(id => {
        const side = m.TeamRad === id ? 0 : 1, direction = side === 0 ? 1 : -1;
        const points = timelinesByMatch.get(m.MatchId) || [];
        const gold = points.filter(p => p.TimeSeconds <= m.Duration && number(p.RadiantGoldAdvantage) !== null).map(p => p.RadiantGoldAdvantage * direction);
        const events = (objectivesByMatch.get(m.MatchId) || []).map(describeObjective).sort((a, b) => a.time - b.time);
        const firstTower = events.find(e => e.category === 'tower' && !e.denied);
        const firstRoshan = events.find(e => e.category === 'roshan');
        const roshans = events.filter(e => e.category === 'roshan' && e.teamSide !== null);
        const teamPlayers = (playersByMatch.get(m.MatchId) || []).filter(p => p.TeamSide === side);
        const sum = key => teamPlayers.length === 5 && teamPlayers.every(p => number(p[key]) !== null)
          ? teamPlayers.reduce((n, p) => n + p[key], 0) : null;
        const lead = (p, key) => p && number(p[key]) !== null ? p[key] * direction : null;
        const checkpointValues = Object.fromEntries(checkpointMinutes.flatMap(minute => {
          const point = m.Duration >= minute * 60 ? points.find(p => p.TimeSeconds === minute * 60) : null;
          return [[`gold${minute}`, lead(point, 'RadiantGoldAdvantage')], [`xp${minute}`, lead(point, 'RadiantXpAdvantage')]];
        }));
        return { teamId: id, matchId: m.MatchId, opponentId: side === 0 ? m.TeamDire : m.TeamRad,
          opponent: side === 0 ? m.DireTeamName : m.RadiantTeamName, patch: m.PatchKey,
          won: m.WinnerSide === null ? null : m.WinnerSide === side,
          ...checkpointValues,
          worstDeficit: gold.length ? Math.min(...gold) : null, largestLead: gold.length ? Math.max(...gold) : null,
          firstTower: firstTower?.teamSide != null ? firstTower.teamSide === side : null, firstTowerTime: firstTower?.time ?? null,
          firstRoshan: firstRoshan?.teamSide != null ? firstRoshan.teamSide === side : null, firstRoshanTime: firstRoshan?.time ?? null,
          roshans: roshans.filter(e => e.teamSide === side).length, totalRoshans: roshans.length,
          wards10: sum('wards10'), dewards10: sum('dewards10'), stacks10: sum('stacks10'),
          damagePerMinute: sum('damagePerMinute'), healingPerMinute: sum('healingPerMinute'),
          players: teamPlayers.map(p => ({ playerId: p.PlayerId, name: names.get(p.PlayerId) || `Player ${p.PlayerId}`,
            heroId: p.HeroId, damage: p.HeroDamage, damageShare: p.damageShare, networthShare: p.networthShare, wards: p.ObserversPlaced, stacks: p.CampsStacked })) };
      }));
      return { games, checkpointMinutes };
  }

  teamPerformanceBenchmarks({ leagueId = null, patchId = null } = {}) {
    return this.cached(`team-performance-benchmarks:${leagueId}:${patchId}`, () => {
      const data = this.performanceGames(this.matches('league', null, { leagueId, patchId }));
      const { games } = this.teamPerformanceGames(data);
      const teams = new Map();
      for (const game of games) {
        const group = teams.get(game.teamId) || [];
        group.push(game); teams.set(game.teamId, group);
      }
      const benchmarks = {};
      for (const group of teams.values()) {
        const { summary, conversions, objectives } = summarizeTeamGames(group);
        for (const [key, metric] of Object.entries({ ...summary, ...conversions, ...objectives })) {
          const pool = benchmarks[key] ||= [];
          if (metric.samples >= 5 && number(metric.value) !== null) pool.push(metric.value);
        }
      }
      return benchmarks;
    });
  }
}
