import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ADMIN_ACCOUNT_ID = '49219700';
const BASE_SCORE = 50;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

const BASE_DRAFT_ORDER = [
  { phase: 1, type: 'ban', actor: 'R' },
  { phase: 1, type: 'ban', actor: 'D' },
  { phase: 1, type: 'ban', actor: 'D' },
  { phase: 1, type: 'ban', actor: 'R' },
  { phase: 1, type: 'ban', actor: 'D' },
  { phase: 1, type: 'ban', actor: 'D' },
  { phase: 1, type: 'ban', actor: 'R' },
  { phase: 2, type: 'pick', actor: 'R' },
  { phase: 2, type: 'pick', actor: 'D' },
  { phase: 3, type: 'ban', actor: 'R' },
  { phase: 3, type: 'ban', actor: 'R' },
  { phase: 3, type: 'ban', actor: 'D' },
  { phase: 4, type: 'pick', actor: 'D' },
  { phase: 4, type: 'pick', actor: 'R' },
  { phase: 4, type: 'pick', actor: 'R' },
  { phase: 4, type: 'pick', actor: 'D' },
  { phase: 4, type: 'pick', actor: 'D' },
  { phase: 4, type: 'pick', actor: 'R' },
  { phase: 5, type: 'ban', actor: 'R' },
  { phase: 5, type: 'ban', actor: 'D' },
  { phase: 5, type: 'ban', actor: 'D' },
  { phase: 5, type: 'ban', actor: 'R' },
  { phase: 6, type: 'pick', actor: 'R' },
  { phase: 6, type: 'pick', actor: 'D' },
];

function swapActor(actor) {
  return actor === 'R' ? 'D' : 'R';
}

function buildDraftSequence(firstPickSide, ourDraftSide) {
  const invertActors = firstPickSide === 'D';
  const actorCounts = {
    R: { ban: 0, pick: 0 },
    D: { ban: 0, pick: 0 },
  };
  const sideCounts = {
    our: { ban: 0, pick: 0 },
    opponent: { ban: 0, pick: 0 },
  };
  let pickOrder = 0;

  return BASE_DRAFT_ORDER.map((step, index) => {
    const actor = invertActors ? swapActor(step.actor) : step.actor;
    const side = actor === ourDraftSide ? 'our' : 'opponent';
    actorCounts[actor][step.type] += 1;
    sideCounts[side][step.type] += 1;
    if (step.type === 'pick') pickOrder += 1;

    return {
      ...step,
      actor,
      side,
      slot: sideCounts[side][step.type],
      actorSlot: actorCounts[actor][step.type],
      pickOrder: step.type === 'pick' ? pickOrder : null,
      actionIndex: index,
      label: `${actor} ${step.type === 'ban' ? 'Ban' : 'Pick'} ${actorCounts[actor][step.type]}`,
    };
  });
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(2)}%`;
}

function formatNumber(value, digits = 2) {
  return toNumber(value).toFixed(digits);
}

function pairKey(a, b) {
  const x = toNumber(a);
  const y = toNumber(b);
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function heroName(heroMap, heroId) {
  return heroMap.get(toNumber(heroId)) || `Hero ${heroId}`;
}

function createEmptyDraftState(length = BASE_DRAFT_ORDER.length) {
  return Array.from({ length }, () => ({ heroId: null, playerId: '' }));
}

function createEmptyExcludedComfortBySide() {
  return { our: new Set(), opponent: new Set() };
}

function createEmptyExcludedRecommendationHeroesBySide() {
  return { our: new Set(), opponent: new Set() };
}

function nextActionIndex(draftState) {
  return draftState.findIndex((slot) => !toNumber(slot?.heroId, 0));
}

function getTeamIdBySide(row, side) {
  return side === 0
    ? toNumber(row.TeamRad ?? row.RadiantTeamId, null)
    : toNumber(row.TeamDire ?? row.DireTeamId, null);
}

function getWinnerSide(row) {
  const winner = toNumber(row.WinnerId, null);
  if (!winner) return null;
  const rad = getTeamIdBySide(row, 0);
  const dire = getTeamIdBySide(row, 1);
  if (winner === rad) return 0;
  if (winner === dire) return 1;
  return null;
}

function buildHeroMap(heroPool) {
  return new Map(
    (heroPool || [])
      .map((row) => [toNumber(row.HeroId, null), row.HeroName])
      .filter((row) => row[0])
  );
}

function buildLeagueWeights(recentLeagueIds, activeLeagueId) {
  const ids = Array.from(
    new Set(
      [...(recentLeagueIds || []), activeLeagueId]
        .map((id) => toNumber(id, null))
        .filter((id) => id)
    )
  ).sort((a, b) => b - a);
  const map = new Map();
  ids.forEach((id, index) => {
    map.set(id, index === 0 ? 3 : index === 1 ? 2 : 1);
  });
  return map;
}

function buildPlayerProfiles(playerRows, roster, leagueWeights) {
  const rosterOrder = new Map();
  const byPlayer = new Map();

  (roster || []).forEach((row, index) => {
    const playerId = toNumber(row.PlayerId, null);
    if (!playerId) return;
    rosterOrder.set(playerId, index);
    byPlayer.set(playerId, {
      PlayerId: playerId,
      PlayerName: row.PlayerName || `Player ${playerId}`,
      TotalGames: 0,
      TotalWins: 0,
      HeroMapRaw: new Map(),
      SeasonMapRaw: new Map(),
    });
  });

  function ensurePlayer(playerId, playerName) {
    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, {
        PlayerId: playerId,
        PlayerName: playerName || `Player ${playerId}`,
        TotalGames: 0,
        TotalWins: 0,
        HeroMapRaw: new Map(),
        SeasonMapRaw: new Map(),
      });
    }
    return byPlayer.get(playerId);
  }

  (playerRows || []).forEach((row) => {
    const playerId = toNumber(row.PlayerId, null);
    const heroId = toNumber(row.HeroId, null);
    const leagueId = toNumber(row.LeagueId, null);
    if (!playerId || !heroId || !leagueId) return;

    const profile = ensurePlayer(playerId, row.PlayerName);
    const won = toNumber(row.WonMatch) > 0 ? 1 : 0;
    const gpm = toNumber(row.GPM);
    const kda = toNumber(row.KDA);
    const damage = toNumber(row.HeroDamage);
    const weight = leagueWeights.get(leagueId) || 1;
    const perf = (gpm + kda * 100 + damage / 100) * weight;

    profile.TotalGames += 1;
    profile.TotalWins += won;

    if (!profile.HeroMapRaw.has(heroId)) {
      profile.HeroMapRaw.set(heroId, {
        HeroId: heroId,
        HeroName: row.HeroName || `Hero ${heroId}`,
        Games: 0,
        Wins: 0,
        SumGpm: 0,
        SumKda: 0,
        SumDamage: 0,
        WeightedPerf: 0,
        WeightTotal: 0,
      });
    }
    const hero = profile.HeroMapRaw.get(heroId);
    hero.Games += 1;
    hero.Wins += won;
    hero.SumGpm += gpm;
    hero.SumKda += kda;
    hero.SumDamage += damage;
    hero.WeightedPerf += perf;
    hero.WeightTotal += weight;

    if (!profile.SeasonMapRaw.has(leagueId)) {
      profile.SeasonMapRaw.set(leagueId, {
        LeagueId: leagueId,
        Games: 0,
        Wins: 0,
        SumGpm: 0,
        SumKda: 0,
        Heroes: new Map(),
      });
    }
    const season = profile.SeasonMapRaw.get(leagueId);
    season.Games += 1;
    season.Wins += won;
    season.SumGpm += gpm;
    season.SumKda += kda;
    if (!season.Heroes.has(heroId)) {
      season.Heroes.set(heroId, {
        HeroId: heroId,
        HeroName: row.HeroName || `Hero ${heroId}`,
        Games: 0,
        Wins: 0,
      });
    }
    const seasonHero = season.Heroes.get(heroId);
    seasonHero.Games += 1;
    seasonHero.Wins += won;
  });

  const leagueIdsDesc = [...leagueWeights.keys()].sort((a, b) => b - a);
  const list = [...byPlayer.values()].map((profile) => {
    const heroes = [...profile.HeroMapRaw.values()]
      .map((hero) => {
        const winRate = hero.Games > 0 ? (hero.Wins / hero.Games) * 100 : 0;
        const avgPerf = hero.WeightTotal > 0 ? hero.WeightedPerf / hero.WeightTotal : 0;
        const weighted = avgPerf * (0.6 + 0.4 * (winRate / 100));
        return {
          HeroId: hero.HeroId,
          HeroName: hero.HeroName,
          Games: hero.Games,
          WinRate: winRate,
          AvgGpm: hero.Games > 0 ? hero.SumGpm / hero.Games : 0,
          AvgKda: hero.Games > 0 ? hero.SumKda / hero.Games : 0,
          AvgDamage: hero.Games > 0 ? hero.SumDamage / hero.Games : 0,
          WeightedPerformance: weighted,
          Confidence: hero.Games >= 5 ? 'High' : hero.Games >= 2 ? 'Medium' : 'Low',
        };
      })
      .sort((a, b) => b.WeightedPerformance - a.WeightedPerformance);
    heroes.forEach((hero, idx) => {
      hero.Rank = idx + 1;
    });

    const seasons = leagueIdsDesc.map((leagueId) => {
      const season = profile.SeasonMapRaw.get(leagueId);
      if (!season) {
        return {
          LeagueId: leagueId,
          Played: false,
          Games: 0,
          WinRate: 0,
          AvgGpm: 0,
          AvgKda: 0,
          TopHeroes: [],
        };
      }
      const topHeroes = [...season.Heroes.values()]
        .map((hero) => ({
          HeroId: hero.HeroId,
          HeroName: hero.HeroName,
          Games: hero.Games,
          WinRate: hero.Games > 0 ? (hero.Wins / hero.Games) * 100 : 0,
        }))
        .sort((a, b) => b.Games - a.Games || b.WinRate - a.WinRate)
        .slice(0, 3);
      return {
        LeagueId: leagueId,
        Played: true,
        Games: season.Games,
        WinRate: season.Games > 0 ? (season.Wins / season.Games) * 100 : 0,
        AvgGpm: season.Games > 0 ? season.SumGpm / season.Games : 0,
        AvgKda: season.Games > 0 ? season.SumKda / season.Games : 0,
        TopHeroes: topHeroes,
      };
    });

    return {
      PlayerId: profile.PlayerId,
      PlayerName: profile.PlayerName,
      TotalGames: profile.TotalGames,
      OverallWinRate: profile.TotalGames > 0 ? (profile.TotalWins / profile.TotalGames) * 100 : 0,
      Heroes: heroes,
      HeroMap: new Map(heroes.map((hero) => [hero.HeroId, hero])),
      Seasons: seasons,
    };
  });

  list.sort((a, b) => {
    const orderA = rosterOrder.has(a.PlayerId) ? rosterOrder.get(a.PlayerId) : Number.MAX_SAFE_INTEGER;
    const orderB = rosterOrder.has(b.PlayerId) ? rosterOrder.get(b.PlayerId) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return b.TotalGames - a.TotalGames;
  });

  return {
    list,
    map: new Map(list.map((profile) => [profile.PlayerId, profile])),
  };
}

function buildTeammateHeroWinRateMap(playerRows, recentLeagueIds, seasonLimit = 2) {
  const leagueIds = Array.from(
    new Set((recentLeagueIds || []).map((id) => toNumber(id, null)).filter((id) => id))
  )
    .sort((a, b) => b - a)
    .slice(0, seasonLimit);
  if (!leagueIds.length) return new Map();

  const leagueSet = new Set(leagueIds);
  const raw = new Map();

  (playerRows || []).forEach((row) => {
    const leagueId = toNumber(row.LeagueId, null);
    const heroId = toNumber(row.HeroId, null);
    if (!leagueSet.has(leagueId) || !heroId) return;
    if (!raw.has(heroId)) raw.set(heroId, { Games: 0, Wins: 0 });
    const entry = raw.get(heroId);
    entry.Games += 1;
    if (toNumber(row.WonMatch, 0) > 0) entry.Wins += 1;
  });

  return new Map(
    [...raw.entries()]
      .filter(([, row]) => row.Games > 0)
      .map(([heroId, row]) => [heroId, row.Wins / row.Games])
  );
}

function emptyPublicTrendData() {
  return {
    Rows: [],
    ByPlayerHeroMap: new Map(),
    ByPlayerTopMap: new Map(),
    HeroScoreMap: new Map(),
    BestPlayerByHero: new Map(),
  };
}

function buildPublicTrendData(publicRows, roster, excludedPlayerIds = null) {
  const excluded = excludedPlayerIds instanceof Set ? excludedPlayerIds : null;
  const rosterMap = new Map(
    (roster || [])
      .map((row) => [toNumber(row.PlayerId, null), row.PlayerName || `Player ${toNumber(row.PlayerId)}`])
      .filter((row) => row[0])
  );

  const rows = [];
  const byPlayerHeroMap = new Map();
  const byPlayerMap = new Map();
  const heroScoreMap = new Map();
  const bestPlayerByHero = new Map();

  (publicRows || []).forEach((row) => {
    const playerId = toNumber(row.PlayerId, null);
    const heroId = toNumber(row.HeroId, null);
    const games = toNumber(row.Games, 0);
    const wins = toNumber(row.Wins, 0);
    if (!playerId || !heroId || games <= 0) return;
    if (excluded && excluded.has(playerId)) return;

    const rowWinRate = toNumber(row.WinRate, null);
    const winRate = rowWinRate === null ? (wins / games) * 100 : rowWinRate;
    const confidence = clamp(games / 10, 0, 1);
    const trendScore = clamp((winRate / 100) * (0.6 + 0.4 * confidence), 0, 1);
    const out = {
      PlayerId: playerId,
      PlayerName: rosterMap.get(playerId) || `Player ${playerId}`,
      HeroId: heroId,
      Games: games,
      Wins: wins,
      WinRate: winRate,
      TrendScore: trendScore,
      LastMatchDate: row.LastMatchDate || null,
    };

    rows.push(out);
    byPlayerHeroMap.set(`${playerId}|${heroId}`, out);

    if (!byPlayerMap.has(playerId)) byPlayerMap.set(playerId, []);
    byPlayerMap.get(playerId).push(out);

    const currentScore = heroScoreMap.get(heroId);
    if (currentScore === undefined || out.TrendScore > currentScore) {
      heroScoreMap.set(heroId, out.TrendScore);
      bestPlayerByHero.set(heroId, out);
    }
  });

  const byPlayerTopMap = new Map();
  byPlayerMap.forEach((playerRows, playerId) => {
    const sorted = [...playerRows].sort((a, b) => b.WinRate - a.WinRate || b.Games - a.Games);
    let top = sorted.filter((row) => row.Games >= 3 && row.WinRate >= 55);
    if (top.length === 0) top = sorted.filter((row) => row.Games >= 3);
    if (top.length === 0) top = sorted;
    byPlayerTopMap.set(playerId, top.slice(0, 3));
  });

  return {
    Rows: rows,
    ByPlayerHeroMap: byPlayerHeroMap,
    ByPlayerTopMap: byPlayerTopMap,
    HeroScoreMap: heroScoreMap,
    BestPlayerByHero: bestPlayerByHero,
  };
}

function emptyTeamStats() {
  return {
    PickRows: [],
    FirstPickRows: [],
    BanRows: [],
    PairRows: [],
    PairMap: new Map(),
    SeasonTopHeroes: new Map(),
    CurrentPickRateMap: new Map(),
    OverallHeroWinRateMap: new Map(),
    Recent2HeroWinRateMap: new Map(),
    TopWeightedHeroes: [],
    SignatureCurrent: [],
  };
}

function buildTeamStats(draftRows, teamId, leagueWeights, currentLeagueId, allDraftRows = []) {
  if (!teamId || !draftRows?.length) return emptyTeamStats();

  const picks = new Map();
  const firstPicks = new Map();
  const bans = new Map();
  const seasonTop = new Map();
  const recent2HeroRaw = new Map();
  const matchPicks = new Map();
  let totalCurrent = 0;
  let totalWeighted = 0;
  const recentLeagueIdsDesc = [...leagueWeights.keys()].sort((a, b) => b - a);
  const recent2LeagueSet = new Set(recentLeagueIdsDesc.slice(0, 2));

  (draftRows || []).forEach((row) => {
    const heroId = toNumber(row.HeroId, null);
    const isPick = toNumber(row.IsPick, null);
    const leagueId = toNumber(row.LeagueId, null);
    const matchId = toNumber(row.MatchId, null);
    if (!heroId || !leagueId || !matchId || (isPick !== 0 && isPick !== 1)) return;

    const weight = leagueWeights.get(leagueId) || 1;
    const winner = toNumber(row.WinnerId, null);
    const hasWinner = !!winner;
    const won = hasWinner && winner === teamId ? 1 : 0;
    const rowHeroName = row.HeroName || `Hero ${heroId}`;

    if (isPick === 1) {
      if (!picks.has(heroId)) {
        picks.set(heroId, {
          HeroId: heroId,
          HeroName: rowHeroName,
          Picks: 0,
          DecidedGames: 0,
          Wins: 0,
          CurrentSeasonPicks: 0,
          WeightedPicks: 0,
        });
      }
      const entry = picks.get(heroId);
      entry.Picks += 1;
      entry.WeightedPicks += weight;
      if (hasWinner) {
        entry.DecidedGames += 1;
        entry.Wins += won;
        if (recent2LeagueSet.has(leagueId)) {
          if (!recent2HeroRaw.has(heroId)) recent2HeroRaw.set(heroId, { DecidedGames: 0, Wins: 0 });
          const recent2 = recent2HeroRaw.get(heroId);
          recent2.DecidedGames += 1;
          recent2.Wins += won;
        }
      }
      if (leagueId === toNumber(currentLeagueId)) {
        entry.CurrentSeasonPicks += 1;
        totalCurrent += 1;
      }
      totalWeighted += weight;

      if (!seasonTop.has(leagueId)) seasonTop.set(leagueId, new Map());
      const seasonMap = seasonTop.get(leagueId);
      if (!seasonMap.has(heroId)) {
        seasonMap.set(heroId, { HeroId: heroId, HeroName: rowHeroName, Picks: 0, DecidedGames: 0, Wins: 0 });
      }
      const st = seasonMap.get(heroId);
      st.Picks += 1;
      if (hasWinner) {
        st.DecidedGames += 1;
        st.Wins += won;
      }

      if (!matchPicks.has(matchId)) {
        matchPicks.set(matchId, { MatchId: matchId, LeagueId: leagueId, Won: won === 1, HasWinner: hasWinner, Heroes: new Set() });
      }
      const mp = matchPicks.get(matchId);
      mp.Heroes.add(heroId);
      if (hasWinner) {
        mp.HasWinner = true;
        mp.Won = won === 1;
      }
    } else {
      if (!bans.has(heroId)) {
        bans.set(heroId, { HeroId: heroId, HeroName: rowHeroName, TimesBanned: 0, CurrentSeasonBans: 0 });
      }
      const ban = bans.get(heroId);
      ban.TimesBanned += 1;
      if (leagueId === toNumber(currentLeagueId)) ban.CurrentSeasonBans += 1;
    }
  });

  const firstPickOrderByMatch = new Map();
  (allDraftRows || []).forEach((row) => {
    if (toNumber(row.IsPick) !== 1) return;
    const matchId = toNumber(row.MatchId, null);
    const orderNum = toNumber(row.OrderNum, Number.MAX_SAFE_INTEGER);
    if (!matchId) return;
    const existing = firstPickOrderByMatch.get(matchId);
    if (!existing || orderNum < existing) {
      firstPickOrderByMatch.set(matchId, orderNum);
    }
  });

  const teamFirstPickByMatch = new Map();
  (draftRows || []).forEach((row) => {
    if (toNumber(row.IsPick) !== 1) return;
    const matchId = toNumber(row.MatchId, null);
    const heroId = toNumber(row.HeroId, null);
    const orderNum = toNumber(row.OrderNum, Number.MAX_SAFE_INTEGER);
    if (!matchId || !heroId) return;
    const existing = teamFirstPickByMatch.get(matchId);
    if (!existing || orderNum < existing.OrderNum) {
      teamFirstPickByMatch.set(matchId, {
        MatchId: matchId,
        HeroId: heroId,
        HeroName: row.HeroName || `Hero ${heroId}`,
        OrderNum: orderNum,
        WinnerId: toNumber(row.WinnerId, null),
      });
    }
  });

  teamFirstPickByMatch.forEach((row) => {
    const firstOrder = firstPickOrderByMatch.get(row.MatchId);
    if (firstOrder === undefined || row.OrderNum !== firstOrder) return;
    if (!firstPicks.has(row.HeroId)) {
      firstPicks.set(row.HeroId, {
        HeroId: row.HeroId,
        HeroName: row.HeroName,
        TimesPicked: 0,
        DecidedGames: 0,
        Wins: 0,
      });
    }
    const fp = firstPicks.get(row.HeroId);
    fp.TimesPicked += 1;
    if (row.WinnerId) {
      fp.DecidedGames += 1;
      if (row.WinnerId === teamId) fp.Wins += 1;
    }
  });

  const pickRows = [...picks.values()].map((row) => ({
    ...row,
    WinRate: row.DecidedGames > 0 ? (row.Wins / row.DecidedGames) * 100 : 0,
    CurrentPickRate: totalCurrent > 0 ? row.CurrentSeasonPicks / totalCurrent : 0,
    WeightedPickRate: totalWeighted > 0 ? row.WeightedPicks / totalWeighted : 0,
  }));

  const firstPickRows = [...firstPicks.values()]
    .map((row) => ({
      ...row,
      WinRateWhenPicked: row.DecidedGames > 0 ? (row.Wins / row.DecidedGames) * 100 : 0,
    }))
    .sort((a, b) => b.TimesPicked - a.TimesPicked || b.WinRateWhenPicked - a.WinRateWhenPicked);

  const banRows = [...bans.values()].sort((a, b) => b.TimesBanned - a.TimesBanned);

  const pairRaw = new Map();
  matchPicks.forEach((match) => {
    if (!match.HasWinner || match.Heroes.size < 2) return;
    const heroes = [...match.Heroes];
    for (let i = 0; i < heroes.length; i += 1) {
      for (let j = i + 1; j < heroes.length; j += 1) {
        const key = pairKey(heroes[i], heroes[j]);
        if (!pairRaw.has(key)) {
          pairRaw.set(key, { Key: key, HeroA: Math.min(heroes[i], heroes[j]), HeroB: Math.max(heroes[i], heroes[j]), DecidedGames: 0, Wins: 0 });
        }
        const pair = pairRaw.get(key);
        pair.DecidedGames += 1;
        pair.Wins += match.Won ? 1 : 0;
      }
    }
  });
  const pairRows = [...pairRaw.values()]
    .map((pair) => ({ ...pair, WinRate: pair.DecidedGames > 0 ? (pair.Wins / pair.DecidedGames) * 100 : 0 }))
    .sort((a, b) => b.WinRate - a.WinRate || b.DecidedGames - a.DecidedGames);

  const seasonTopHeroes = new Map();
  [...leagueWeights.keys()].sort((a, b) => b - a).forEach((leagueId) => {
    const seasonMap = seasonTop.get(leagueId);
    if (!seasonMap) {
      seasonTopHeroes.set(leagueId, []);
      return;
    }
    const rows = [...seasonMap.values()]
      .map((row) => ({
        ...row,
        WinRate: row.DecidedGames > 0 ? (row.Wins / row.DecidedGames) * 100 : 0,
      }))
      .sort((a, b) => b.Picks - a.Picks || b.WinRate - a.WinRate)
      .slice(0, 5);
    seasonTopHeroes.set(leagueId, rows);
  });

  return {
    PickRows: pickRows,
    FirstPickRows: firstPickRows,
    BanRows: banRows,
    PairRows: pairRows,
    PairMap: new Map(pairRows.map((row) => [row.Key, row])),
    SeasonTopHeroes: seasonTopHeroes,
    CurrentPickRateMap: new Map(pickRows.map((row) => [row.HeroId, row.CurrentPickRate])),
    OverallHeroWinRateMap: new Map(
      pickRows
        .filter((row) => row.DecidedGames > 0)
        .map((row) => [row.HeroId, row.WinRate / 100])
    ),
    Recent2HeroWinRateMap: new Map(
      [...recent2HeroRaw.entries()]
        .filter(([, row]) => row.DecidedGames > 0)
        .map(([heroId, row]) => [heroId, row.Wins / row.DecidedGames])
    ),
    TopWeightedHeroes: [...pickRows].sort((a, b) => b.WeightedPicks - a.WeightedPicks),
    SignatureCurrent: [...pickRows].sort((a, b) => b.CurrentSeasonPicks - a.CurrentSeasonPicks),
  };
}

function buildH2HData(leagueDraftRows) {
  const byMatch = new Map();
  (leagueDraftRows || []).forEach((row) => {
    if (toNumber(row.IsPick) !== 1) return;
    const side = toNumber(row.DraftSide, -1);
    if (side !== 0 && side !== 1) return;
    const matchId = toNumber(row.MatchId, null);
    const heroId = toNumber(row.HeroId, null);
    if (!matchId || !heroId) return;
    if (!byMatch.has(matchId)) {
      byMatch.set(matchId, { WinnerSide: getWinnerSide(row), Heroes: { 0: new Set(), 1: new Set() } });
    }
    const match = byMatch.get(matchId);
    match.Heroes[side].add(heroId);
    const winnerSide = getWinnerSide(row);
    if (winnerSide === 0 || winnerSide === 1) match.WinnerSide = winnerSide;
  });

  const raw = new Map();
  function upsert(heroA, heroB, heroAWon) {
    const key = `${heroA}|${heroB}`;
    if (!raw.has(key)) raw.set(key, { HeroA: heroA, HeroB: heroB, Games: 0, Wins: 0 });
    const row = raw.get(key);
    row.Games += 1;
    row.Wins += heroAWon ? 1 : 0;
  }

  byMatch.forEach((match) => {
    if (match.WinnerSide !== 0 && match.WinnerSide !== 1) return;
    const side0 = [...match.Heroes[0]];
    const side1 = [...match.Heroes[1]];
    side0.forEach((hero0) => {
      side1.forEach((hero1) => {
        upsert(hero0, hero1, match.WinnerSide === 0);
        upsert(hero1, hero0, match.WinnerSide === 1);
      });
    });
  });

  const pairMap = new Map();
  const byHero = new Map();
  raw.forEach((row, key) => {
    const out = { HeroA: row.HeroA, HeroB: row.HeroB, Games: row.Games, HeroAWinRate: row.Games > 0 ? (row.Wins / row.Games) * 100 : 0 };
    pairMap.set(key, out);
    if (!byHero.has(out.HeroA)) byHero.set(out.HeroA, []);
    byHero.get(out.HeroA).push(out);
  });
  byHero.forEach((rows) => rows.sort((a, b) => a.HeroAWinRate - b.HeroAWinRate || b.Games - a.Games));
  return { PairMap: pairMap, ByHeroA: byHero };
}

function buildContestedSet(rows, leagueId) {
  const matches = new Set();
  const counts = new Map();
  (rows || []).forEach((row) => {
    if (toNumber(row.LeagueId) !== toNumber(leagueId)) return;
    if (toNumber(row.IsPick) !== 1) return;
    if (toNumber(row.OrderNum, 999) > 3) return;
    const heroId = toNumber(row.HeroId, null);
    const matchId = toNumber(row.MatchId, null);
    if (!heroId || !matchId) return;
    matches.add(matchId);
    counts.set(heroId, (counts.get(heroId) || 0) + 1);
  });
  const total = matches.size || 1;
  const set = new Set();
  counts.forEach((count, heroId) => {
    if (count / total > 0.4) set.add(heroId);
  });
  return set;
}

function filledSlots(board, side, type) {
  const source = type === 'pick' ? board[side].picks : board[side].bans;
  return source.filter((slot) => slot && slot.heroId);
}

function buildBoard(draftState, heroMap, draftSequence) {
  const ourBanCount = draftSequence.filter((step) => step.side === 'our' && step.type === 'ban').length;
  const ourPickCount = draftSequence.filter((step) => step.side === 'our' && step.type === 'pick').length;
  const oppBanCount = draftSequence.filter((step) => step.side === 'opponent' && step.type === 'ban').length;
  const oppPickCount = draftSequence.filter((step) => step.side === 'opponent' && step.type === 'pick').length;

  const board = {
    our: { bans: Array(ourBanCount).fill(null), picks: Array(ourPickCount).fill(null) },
    opponent: { bans: Array(oppBanCount).fill(null), picks: Array(oppPickCount).fill(null) },
    usedHeroes: new Set(),
  };

  draftSequence.forEach((step, index) => {
    const entry = draftState[index] || {};
    const heroId = toNumber(entry.heroId, null);
    const slot = {
      ...step,
      actionIndex: index,
      heroId: heroId && heroId > 0 ? heroId : null,
      heroName: heroId && heroId > 0 ? heroName(heroMap, heroId) : '',
      playerId: entry.playerId || '',
    };

    const side = step.side === 'our' ? 'our' : 'opponent';
    if (step.type === 'pick') board[side].picks[step.slot - 1] = slot;
    else board[side].bans[step.slot - 1] = slot;
    if (slot.heroId) board.usedHeroes.add(slot.heroId);
  });

  return board;
}

function buildSelfScoutBanRows(currentLeagueRows, ourTeamId, ourPickRateMap) {
  const rows = (currentLeagueRows || []).filter((row) => {
    if (toNumber(row.IsPick) !== 0) return false;
    const side = toNumber(row.DraftSide, -1);
    if (side !== 0 && side !== 1) return false;
    const teamRad = getTeamIdBySide(row, 0);
    const teamDire = getTeamIdBySide(row, 1);
    return (teamRad === ourTeamId && side === 1) || (teamDire === ourTeamId && side === 0);
  });

  const byHero = new Map();
  rows.forEach((row) => {
    const heroId = toNumber(row.HeroId, null);
    if (!heroId) return;
    if (!byHero.has(heroId)) {
      byHero.set(heroId, {
        HeroId: heroId,
        HeroName: row.HeroName || `Hero ${heroId}`,
        BanCount: 0,
        OpponentWinsAfterBan: 0,
      });
    }
    const entry = byHero.get(heroId);
    entry.BanCount += 1;
    const winner = toNumber(row.WinnerId, null);
    const teamRad = getTeamIdBySide(row, 0);
    const teamDire = getTeamIdBySide(row, 1);
    const oppWon =
      (teamRad === ourTeamId && winner === teamDire) ||
      (teamDire === ourTeamId && winner === teamRad);
    if (oppWon) entry.OpponentWinsAfterBan += 1;
  });

  const totalBans = [...byHero.values()].reduce((sum, row) => sum + row.BanCount, 0);
  const weighted = [...byHero.values()].map((row) => {
    const rawRate = totalBans > 0 ? row.BanCount / totalBans : 0;
    const ourPickRate = ourPickRateMap.get(row.HeroId) || 0;
    const oppWinRate = row.BanCount > 0 ? row.OpponentWinsAfterBan / row.BanCount : 0;
    const weightedScore = rawRate * (0.15 + 0.55 * ourPickRate + 0.3 * (ourPickRate * oppWinRate));
    return {
      ...row,
      BanRate: rawRate * 100,
      OurPickRate: ourPickRate * 100,
      OpponentWinRateWhenBanned: oppWinRate * 100,
      WeightedScore: weightedScore,
    };
  });
  const totalWeighted = weighted.reduce((sum, row) => sum + row.WeightedScore, 0);
  return weighted
    .map((row) => ({
      ...row,
      WeightedBanRate: totalWeighted > 0 ? (row.WeightedScore / totalWeighted) * 100 : 0,
    }))
    .sort((a, b) => b.WeightedBanRate - a.WeightedBanRate)
    .slice(0, 15);
}

function buildSideStrength(profiles, excludedPlayerIds = null) {
  const excluded = excludedPlayerIds instanceof Set ? excludedPlayerIds : null;
  const raw = new Map();
  const bestPlayer = new Map();
  (profiles || []).forEach((profile) => {
    if (excluded && excluded.has(toNumber(profile.PlayerId))) return;
    (profile.Heroes || []).forEach((hero) => {
      const current = raw.get(hero.HeroId);
      if (current === undefined || hero.WeightedPerformance > current) {
        raw.set(hero.HeroId, hero.WeightedPerformance);
        bestPlayer.set(hero.HeroId, {
          PlayerId: profile.PlayerId,
          PlayerName: profile.PlayerName,
          Games: hero.Games,
          WinRate: hero.WinRate,
          Score: hero.WeightedPerformance,
        });
      }
    });
  });
  const maxScore = Math.max(1, ...raw.values(), 1);
  const scoreMap = new Map();
  raw.forEach((value, heroId) => scoreMap.set(heroId, clamp(value / maxScore, 0, 1)));
  return { ScoreMap: scoreMap, BestPlayerMap: bestPlayer };
}

function resolvePlayerHero(sideProfiles, heroId, playerId) {
  const parsedPlayerId = toNumber(playerId, null);
  if (parsedPlayerId && sideProfiles.map.has(parsedPlayerId)) {
    const profile = sideProfiles.map.get(parsedPlayerId);
    return { profile, hero: profile.HeroMap.get(heroId) || null, inferred: false, flexible: false };
  }
  let best = null;
  let candidateCount = 0;
  sideProfiles.list.forEach((profile) => {
    const hero = profile.HeroMap.get(heroId);
    if (!hero) return;
    candidateCount += 1;
    if (!best || hero.WeightedPerformance > best.hero.WeightedPerformance) {
      best = { profile, hero, inferred: true };
    }
  });
  if (best) return { ...best, flexible: candidateCount > 1 };
  return { profile: sideProfiles.list[0] || null, hero: null, inferred: true, flexible: true };
}

function applyDiminishing(contributions) {
  const rows = contributions.map((row) => ({ ...row }));
  const groups = new Map();

  rows.forEach((row, idx) => {
    if (row.actionIndex < 0 || row.delta === 0) return;
    const key = `${row.actionIndex}:${row.delta > 0 ? 'pos' : 'neg'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(idx);
  });

  groups.forEach((indexes) => {
    indexes.sort((a, b) => Math.abs(rows[b].delta) - Math.abs(rows[a].delta));
    indexes.forEach((index, order) => {
      if (order === 0) return;
      rows[index].delta = rows[index].delta * 0.6;
      rows[index].diminished = true;
    });
  });

  return rows;
}

function capSignals(contributions) {
  const rows = contributions.map((row) => ({ ...row }));
  const caps = { TeamTrend: 6, PhasePriority: 4 };
  Object.keys(caps).forEach((signal) => {
    const indexes = rows
      .map((row, idx) => ({ row, idx }))
      .filter((item) => item.row.signal === signal && item.row.delta !== 0)
      .map((item) => item.idx);
    const total = indexes.reduce((sum, idx) => sum + rows[idx].delta, 0);
    const cap = caps[signal];
    if (Math.abs(total) <= cap || total === 0) return;
    const factor = cap / Math.abs(total);
    indexes.forEach((idx) => {
      rows[idx].delta = rows[idx].delta * factor;
      rows[idx].capped = true;
    });
  });
  return rows;
}

function scoreBand(score) {
  if (score <= 25) return { color: '#8c1d18', label: 'Significant disadvantage' };
  if (score <= 40) return { color: '#b7791f', label: 'Slight disadvantage' };
  if (score <= 59) return { color: '#5f6f63', label: 'Even draft' };
  if (score <= 74) return { color: '#2f855a', label: 'Slight advantage' };
  return { color: '#1b5e20', label: 'Strong advantage' };
}

function computeScore(board, context, currentActionIndex) {
  const contributions = [];
  const ourPicks = filledSlots(board, 'our', 'pick');
  const oppPicks = filledSlots(board, 'opponent', 'pick');
  const ourBans = new Set(filledSlots(board, 'our', 'ban').map((slot) => slot.heroId));

  ourPicks.forEach((slot) => {
    const resolved = resolvePlayerHero(context.ourProfiles, slot.heroId, slot.playerId);
    const games = toNumber(resolved.hero?.Games);
    const rank = toNumber(resolved.hero?.Rank, 999);
    const winRate = toNumber(resolved.hero?.WinRate, 50);
    const overallHeroWr3 = context.ourTeamStats.OverallHeroWinRateMap.get(slot.heroId) ?? 0.5;
    const teammateHeroWr2 =
      context.teammateRecent2WinMap.our.get(slot.heroId) ??
      context.ourTeamStats.Recent2HeroWinRateMap.get(slot.heroId) ??
      overallHeroWr3;
    const blendedFlexWr = 0.45 * overallHeroWr3 + 0.55 * teammateHeroWr2;
    const resolvedPlayerId = toNumber(resolved.profile?.PlayerId, null);
    const pubRow = resolvedPlayerId
      ? context.ourPublicTrend.ByPlayerHeroMap.get(`${resolvedPlayerId}|${slot.heroId}`)
      : null;
    const pubTrendScore = pubRow?.TrendScore ?? context.ourPublicTrend.HeroScoreMap.get(slot.heroId) ?? 0.5;
    let delta = 0;
    if (games >= 5 && rank <= 3) delta = 7;
    else if (games >= 2 && rank <= 3) delta = 4;
    else if (games >= 2) delta = 1.5;
    else delta = -4;
    if (games > 0) delta *= 0.85 + 0.3 * (winRate / 100);
    if (resolved.inferred) {
      delta *= 0.75 + 0.5 * blendedFlexWr;
      if (teammateHeroWr2 < 0.45) delta -= 1.2;
    }
    delta *= 0.85 + 0.3 * pubTrendScore;
    contributions.push({
      signal: 'PlayerPool',
      actionIndex: slot.actionIndex,
      delta: clamp(delta, -8, 8),
      sampleOk: games >= 2,
      reason: resolved.inferred
        ? `${slot.heroName} flex: team WR3 ${formatPercent(overallHeroWr3 * 100)}, teammate WR2 ${formatPercent(teammateHeroWr2 * 100)}, pubs ${formatPercent((pubRow?.WinRate ?? pubTrendScore * 100))}`
        : games >= 2
        ? `${slot.heroName} is in player pool (pub trend ${formatPercent((pubRow?.WinRate ?? pubTrendScore * 100))})`
        : `${slot.heroName} is low sample`,
    });
  });

  oppPicks.forEach((slot) => {
    const resolved = resolvePlayerHero(context.opponentProfiles, slot.heroId, slot.playerId);
    const games = toNumber(resolved.hero?.Games);
    const rank = toNumber(resolved.hero?.Rank, 999);
    const winRate = toNumber(resolved.hero?.WinRate, 50);
    const overallHeroWr3 = context.opponentTeamStats.OverallHeroWinRateMap.get(slot.heroId) ?? 0.5;
    const teammateHeroWr2 =
      context.teammateRecent2WinMap.opponent.get(slot.heroId) ??
      context.opponentTeamStats.Recent2HeroWinRateMap.get(slot.heroId) ??
      overallHeroWr3;
    const blendedFlexWr = 0.45 * overallHeroWr3 + 0.55 * teammateHeroWr2;
    const resolvedPlayerId = toNumber(resolved.profile?.PlayerId, null);
    const pubRow = resolvedPlayerId
      ? context.opponentPublicTrend.ByPlayerHeroMap.get(`${resolvedPlayerId}|${slot.heroId}`)
      : null;
    const pubTrendScore =
      pubRow?.TrendScore ?? context.opponentPublicTrend.HeroScoreMap.get(slot.heroId) ?? 0.5;
    let delta = 0;
    if (games >= 5 && rank <= 3) delta = -5;
    else if (games >= 2 && rank <= 3) delta = -3.5;
    else if (games >= 2) delta = -1.5;
    else delta = 1.5;
    if (games > 0) delta *= 0.85 + 0.3 * (winRate / 100);
    if (resolved.inferred) {
      delta *= 0.75 + 0.5 * blendedFlexWr;
      if (teammateHeroWr2 < 0.45) delta += 1.2;
      if (teammateHeroWr2 > 0.58) delta -= 1.2;
    }
    delta *= 0.85 + 0.3 * pubTrendScore;
    contributions.push({
      signal: 'PlayerPool',
      actionIndex: slot.actionIndex,
      delta: clamp(delta, -8, 8),
      sampleOk: games >= 2,
      reason: resolved.inferred
        ? `Opponent flex ${slot.heroName}: team WR3 ${formatPercent(overallHeroWr3 * 100)}, teammate WR2 ${formatPercent(teammateHeroWr2 * 100)}, pubs ${formatPercent((pubRow?.WinRate ?? pubTrendScore * 100))}`
        : games >= 2
        ? `Opponent comfort on ${slot.heroName} (pub trend ${formatPercent((pubRow?.WinRate ?? pubTrendScore * 100))})`
        : `Opponent low sample on ${slot.heroName}`,
    });
  });

  let lowSamplePairs = 0;
  ourPicks.forEach((our) => {
    oppPicks.forEach((opp) => {
      const h2h = context.h2h.PairMap.get(`${our.heroId}|${opp.heroId}`);
      if (!h2h || h2h.Games < 5) {
        lowSamplePairs += 1;
        return;
      }
      let delta = 0;
      if (h2h.HeroAWinRate > 60) delta = 4.5;
      else if (h2h.HeroAWinRate >= 55) delta = 1.8;
      else if (h2h.HeroAWinRate < 40) delta = -4.5;
      else if (h2h.HeroAWinRate <= 45) delta = -1.8;
      if (delta !== 0) {
        contributions.push({
          signal: 'H2H',
          actionIndex: Math.max(our.actionIndex, opp.actionIndex),
          delta,
          sampleOk: true,
          reason: `${our.heroName} vs ${opp.heroName}: ${formatNumber(h2h.HeroAWinRate)}%`,
        });
      }
    });
  });
  if (lowSamplePairs > 0) {
    contributions.push({
      signal: 'H2H',
      actionIndex: -1,
      delta: 0,
      sampleOk: false,
      reason: `${lowSamplePairs} H2H pairings below sample`,
    });
  }

  const topOppFirst = context.opponentTeamStats.FirstPickRows[0];
  const oppPickSet = new Set(oppPicks.map((slot) => slot.heroId));
  if (topOppFirst && ourBans.has(topOppFirst.HeroId) && !oppPickSet.has(topOppFirst.HeroId)) {
    contributions.push({
      signal: 'TeamTrend',
      actionIndex: currentActionIndex,
      delta: 5,
      sampleOk: topOppFirst.TimesPicked >= 3,
      reason: `Forced opponent off top phase-1 hero: ${topOppFirst.HeroName}`,
    });
  }
  if (oppPicks.length >= 3) {
    const topSet = new Set(context.opponentTeamStats.TopWeightedHeroes.slice(0, 10).map((row) => row.HeroId));
    const outside = oppPicks.filter((slot) => !topSet.has(slot.heroId)).length;
    if (outside >= 2) {
      contributions.push({
        signal: 'TeamTrend',
        actionIndex: currentActionIndex,
        delta: 2.5,
        sampleOk: true,
        reason: `Opponent is outside 3-season comfort pattern`,
      });
    }
  }
  if (ourPicks.length >= 2) {
    const topSet = new Set(context.ourTeamStats.TopWeightedHeroes.slice(0, 5).map((row) => row.HeroId));
    const overlap = ourPicks.filter((slot) => topSet.has(slot.heroId)).length;
    if (overlap >= 2) {
      contributions.push({
        signal: 'TeamTrend',
        actionIndex: currentActionIndex,
        delta: 3,
        sampleOk: true,
        reason: 'Our signature lineup is forming',
      });
    }
  }

  const usedHeroes = new Set([
    ...filledSlots(board, 'our', 'pick').map((slot) => slot.heroId),
    ...filledSlots(board, 'opponent', 'pick').map((slot) => slot.heroId),
    ...filledSlots(board, 'our', 'ban').map((slot) => slot.heroId),
    ...filledSlots(board, 'opponent', 'ban').map((slot) => slot.heroId),
  ]);
  ourPicks.forEach((slot) => {
    if (slot.pickOrder && slot.pickOrder <= 2 && context.contestedSet.has(slot.heroId)) {
      contributions.push({
        signal: 'PhasePriority',
        actionIndex: slot.actionIndex,
        delta: 3.5,
        sampleOk: true,
        reason: `Secured contested phase-1 hero: ${slot.heroName}`,
      });
    }
  });
  if (currentActionIndex >= context.postEarlyPickIndex) {
    const openContested = [...context.contestedSet].filter((heroId) => !usedHeroes.has(heroId));
    if (openContested.length > 0) {
      contributions.push({
        signal: 'PhasePriority',
        actionIndex: currentActionIndex,
        delta: -1.5,
        sampleOk: true,
        reason: `${openContested.length} contested heroes still open in phase 2`,
      });
    }
  }
  const ourHasLastPick = context.lastPickSide === 'our';
  const ourLastPickFilled = board.our.picks.some(
    (slot) => slot?.actionIndex === context.lastPickActionIndex && slot.heroId
  );
  if (ourHasLastPick && ourLastPickFilled) {
    contributions.push({
      signal: 'PhasePriority',
      actionIndex: context.lastPickActionIndex,
      delta: 1.5,
      sampleOk: true,
      reason: 'Last-pick advantage secured',
    });
  }

  const withDiminishing = applyDiminishing(contributions);
  const finalContribs = capSignals(withDiminishing);
  const totalDelta = finalContribs.reduce((sum, row) => sum + row.delta, 0);
  const score = clamp(Math.round(BASE_SCORE + totalDelta), SCORE_MIN, SCORE_MAX);

  const signalTotals = {};
  finalContribs.forEach((row) => {
    signalTotals[row.signal] = (signalTotals[row.signal] || 0) + row.delta;
  });
  const lowSampleCount = finalContribs.filter((row) => row.sampleOk === false).length;
  const confidence = lowSampleCount >= 3 ? 'Low' : lowSampleCount >= 1 ? 'Medium' : 'High';
  const scoreRange =
    confidence === 'High'
      ? `${score}`
      : confidence === 'Medium'
      ? `${clamp(score - 4, SCORE_MIN, SCORE_MAX)}-${clamp(score + 4, SCORE_MIN, SCORE_MAX)}`
      : `${clamp(score - 8, SCORE_MIN, SCORE_MAX)}-${clamp(score + 8, SCORE_MIN, SCORE_MAX)}`;

  return {
    Score: score,
    ScoreRange: scoreRange,
    Confidence: confidence,
    Band: scoreBand(score),
    SignalTotals: signalTotals,
    Contributions: [...finalContribs].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  };
}

function averageH2H(heroId, enemyHeroes, h2hMap) {
  let sum = 0;
  let count = 0;
  enemyHeroes.forEach((enemyHeroId) => {
    const row = h2hMap.get(`${heroId}|${enemyHeroId}`);
    if (!row || row.Games < 5) return;
    sum += row.HeroAWinRate / 100;
    count += 1;
  });
  return count > 0 ? sum / count : 0.5;
}

function buildRecommendations(
  currentAction,
  board,
  context,
  availableHeroes,
  selfScoutMap,
  excludedComfortBySide,
  excludedRecommendationHeroesBySide
) {
  if (!currentAction) {
    return { title: 'Draft complete', rows: [] };
  }
  if (currentAction.type === 'pick') {
    const side = currentAction.side;
    const teamStats = side === 'our' ? context.ourTeamStats : context.opponentTeamStats;
    const sideProfiles = side === 'our' ? context.ourProfiles.list : context.opponentProfiles.list;
    const sidePublicTrend = side === 'our' ? context.ourPublicTrend : context.opponentPublicTrend;
    const excludedComfortPlayers = side === 'our'
      ? excludedComfortBySide?.our || new Set()
      : excludedComfortBySide?.opponent || new Set();
    const strength = buildSideStrength(sideProfiles, excludedComfortPlayers);
    const enemyPicks = filledSlots(board, side === 'our' ? 'opponent' : 'our', 'pick').map((slot) => slot.heroId);
    const rows = (availableHeroes || [])
      .map((hero) => {
        const heroId = toNumber(hero.HeroId);
        const teamRate = teamStats.CurrentPickRateMap.get(heroId) || 0;
        const playerScore = strength.ScoreMap.get(heroId) || 0;
        const publicScore = sidePublicTrend.HeroScoreMap.get(heroId) || 0;
        const publicBest = sidePublicTrend.BestPlayerByHero.get(heroId);
        const h2h = averageH2H(heroId, enemyPicks, context.h2h.PairMap);
        const contested =
          currentAction.type === 'pick' &&
          currentAction.pickOrder !== null &&
          currentAction.pickOrder <= 2 &&
          context.contestedSet.has(heroId)
            ? 1
            : 0;
        const score = 0.22 * teamRate + 0.28 * playerScore + 0.32 * publicScore + 0.13 * h2h + 0.05 * contested;
        let reason = 'Balanced pick';
        const best = strength.BestPlayerMap.get(heroId);
        if (publicScore >= playerScore && publicScore >= teamRate && publicScore >= h2h) {
          reason = publicBest
            ? `High 30-day public trend on ${publicBest.PlayerName}`
            : 'High 30-day public trend';
        } else if (playerScore >= teamRate && playerScore >= h2h) {
          reason = best ? `${best.PlayerName} comfort hero` : 'Strong player comfort';
        } else if (teamRate >= playerScore && teamRate >= h2h) {
          reason = 'High current season pick rate';
        } else if (h2h >= playerScore && h2h >= teamRate) {
          reason = 'Good into current enemy picks';
        }
        return {
          HeroId: heroId,
          HeroName: hero.HeroName,
          Score: score,
          Reason: reason,
          ComfortPlayerId: best?.PlayerId || null,
          ComfortPlayerName: best?.PlayerName || '',
          ComfortPlayerGames: best?.Games || 0,
          ComfortPlayerWinRate: best?.WinRate || 0,
          ComfortPercent: playerScore * 100,
          PublicTrendPlayerId: publicBest?.PlayerId || null,
          PublicTrendPlayerName: publicBest?.PlayerName || '',
          PublicTrendGames: publicBest?.Games || 0,
          PublicTrendWinRate: publicBest?.WinRate || 0,
          PublicTrendPercent: publicScore * 100,
        };
      })
      .sort((a, b) => b.Score - a.Score)
      .slice(0, 3);
    return {
      title: side === 'our' ? 'Top 3 Pick Recommendations' : 'Expected Opponent Picks',
      rows,
    };
  }

  const banningSide = currentAction.side;
  const targetSide = banningSide === 'our' ? 'opponent' : 'our';
  const targetStats = targetSide === 'our' ? context.ourTeamStats : context.opponentTeamStats;
  const targetProfiles = targetSide === 'our' ? context.ourProfiles.list : context.opponentProfiles.list;
  const targetPublicTrend = targetSide === 'our' ? context.ourPublicTrend : context.opponentPublicTrend;
  const excludedTargetPlayers = targetSide === 'our'
    ? excludedComfortBySide?.our || new Set()
    : excludedComfortBySide?.opponent || new Set();
  const targetStrength = buildSideStrength(targetProfiles, excludedTargetPlayers);
  const ownPicks = filledSlots(board, banningSide, 'pick').map((slot) => slot.heroId);
  const excludedHeroIds = banningSide === 'our'
    ? excludedRecommendationHeroesBySide?.our || new Set()
    : excludedRecommendationHeroesBySide?.opponent || new Set();
  const rows = (availableHeroes || [])
    .filter((hero) => !excludedHeroIds.has(toNumber(hero.HeroId)))
    .map((hero) => {
      const heroId = toNumber(hero.HeroId);
      const targetRate = targetStats.CurrentPickRateMap.get(heroId) || 0;
      const targetPlayer = targetStrength.ScoreMap.get(heroId) || 0;
      const targetPublic = targetPublicTrend.HeroScoreMap.get(heroId) || 0;
      let h2hThreat = 0.5;
      if (ownPicks.length > 0) {
        let sum = 0;
        let count = 0;
        ownPicks.forEach((ourHeroId) => {
          const row = context.h2h.PairMap.get(`${ourHeroId}|${heroId}`);
          if (!row || row.Games < 5) return;
          sum += 1 - row.HeroAWinRate / 100;
          count += 1;
        });
        if (count > 0) h2hThreat = sum / count;
      }
      const selfScout = banningSide === 'our' ? selfScoutMap.get(heroId) || 0 : 0;
      const score = 0.24 * targetRate + 0.22 * targetPlayer + 0.30 * targetPublic + 0.19 * h2hThreat + 0.05 * selfScout;
      const targetBest = targetStrength.BestPlayerMap.get(heroId);
      const targetPublicBest = targetPublicTrend.BestPlayerByHero.get(heroId);
      const reason =
        targetPublic >= targetPlayer && targetPublic >= targetRate
          ? 'Denies high 30-day public trend hero'
          : targetPlayer >= targetRate
          ? 'Denies top player comfort'
          : 'Denies high-frequency target hero';
      return {
        HeroId: heroId,
        HeroName: hero.HeroName,
        Score: score,
        Reason: reason,
        ComfortPlayerId: targetBest?.PlayerId || null,
        ComfortPlayerName: targetBest?.PlayerName || '',
        ComfortPlayerGames: targetBest?.Games || 0,
        ComfortPlayerWinRate: targetBest?.WinRate || 0,
        ComfortPercent: targetPlayer * 100,
        PublicTrendPlayerId: targetPublicBest?.PlayerId || null,
        PublicTrendPlayerName: targetPublicBest?.PlayerName || '',
        PublicTrendGames: targetPublicBest?.Games || 0,
        PublicTrendWinRate: targetPublicBest?.WinRate || 0,
        PublicTrendPercent: targetPublic * 100,
      };
    })
    .sort((a, b) => b.Score - a.Score)
    .slice(0, 3);

  return {
    title: banningSide === 'our' ? 'Top 3 Ban Recommendations' : 'Expected Opponent Bans',
    rows,
  };
}

function buildThreatAlerts(board, context, scoreModel, currentAction) {
  const alerts = [];
  const oppPicks = filledSlots(board, 'opponent', 'pick').map((slot) => slot.heroId);
  const signature = context.opponentTeamStats.SignatureCurrent.slice(0, 3).map((row) => row.HeroId);
  const overlap = signature.filter((heroId) => oppPicks.includes(heroId)).length;
  if (overlap >= 2) {
    alerts.push({
      severity: 3,
      title: 'Signature picks detected',
      detail: `Opponent has ${overlap} of their top 3 current-season picks.`,
    });
  }

  if (oppPicks.length >= 2) {
    let bestPair = null;
    for (let i = 0; i < oppPicks.length; i += 1) {
      for (let j = i + 1; j < oppPicks.length; j += 1) {
        const pair = context.opponentTeamStats.PairMap.get(pairKey(oppPicks[i], oppPicks[j]));
        if (!pair || pair.DecidedGames < 4 || pair.WinRate < 65) continue;
        if (!bestPair || pair.WinRate > bestPair.WinRate) bestPair = pair;
      }
    }
    if (bestPair) {
      alerts.push({
        severity: 3,
        title: 'Opponent combo threat',
        detail: `${heroName(context.heroMap, bestPair.HeroA)} + ${heroName(context.heroMap, bestPair.HeroB)} has ${formatPercent(bestPair.WinRate)}.`,
      });
    }
  }

  if (currentAction && currentAction.actionIndex >= context.postEarlyPickIndex) {
    const used = new Set([
      ...filledSlots(board, 'our', 'pick').map((slot) => slot.heroId),
      ...filledSlots(board, 'opponent', 'pick').map((slot) => slot.heroId),
      ...filledSlots(board, 'our', 'ban').map((slot) => slot.heroId),
      ...filledSlots(board, 'opponent', 'ban').map((slot) => slot.heroId),
    ]);
    const openContested = [...context.contestedSet].filter((heroId) => !used.has(heroId));
    if (openContested.length > 0) {
      alerts.push({
        severity: 2,
        title: 'Contested hero still open',
        detail: `${openContested.length} contested heroes remain available in phase 2.`,
      });
    }
  }

  if (scoreModel.Confidence === 'Low') {
    alerts.push({
      severity: 2,
      title: 'Low confidence score',
      detail: 'Active signals include low-sample data. Treat score as a range.',
    });
  }

  return alerts.sort((a, b) => b.severity - a.severity).slice(0, 3);
}

function buildBannedAgainstMap(rows, teamId) {
  const map = new Map();
  if (!teamId) return map;
  (rows || []).forEach((row) => {
    if (toNumber(row.IsPick) !== 0) return;
    const draftSide = toNumber(row.DraftSide, -1);
    if (draftSide !== 0 && draftSide !== 1) return;
    const rad = getTeamIdBySide(row, 0);
    const dire = getTeamIdBySide(row, 1);
    const teamSide = rad === teamId ? 0 : dire === teamId ? 1 : null;
    if (teamSide === null || draftSide === teamSide) return;
    const heroId = toNumber(row.HeroId, null);
    if (!heroId) return;
    if (!map.has(heroId)) {
      map.set(heroId, {
        HeroId: heroId,
        HeroName: row.HeroName || `Hero ${heroId}`,
        TimesBannedAgainst: 0,
        DecidedGames: 0,
        TeamWinsWhenBanned: 0,
      });
    }
    const entry = map.get(heroId);
    entry.TimesBannedAgainst += 1;
    const winner = toNumber(row.WinnerId, null);
    if (winner) {
      entry.DecidedGames += 1;
      if (winner === teamId) entry.TeamWinsWhenBanned += 1;
    }
  });
  map.forEach((entry) => {
    entry.TeamWinRateWhenBanned =
      entry.DecidedGames > 0 ? (entry.TeamWinsWhenBanned / entry.DecidedGames) * 100 : 0;
  });
  return map;
}

function buildMatchupNotes(profile, h2h, heroMap) {
  if (!profile) return [];
  return (profile.Heroes || [])
    .slice(0, 5)
    .map((hero) => {
      const counters = (h2h.ByHeroA.get(hero.HeroId) || [])
        .filter((row) => row.Games >= 5)
        .sort((a, b) => a.HeroAWinRate - b.HeroAWinRate || b.Games - a.Games)
        .slice(0, 3)
        .map((row) => ({
          HeroId: row.HeroB,
          HeroName: heroName(heroMap, row.HeroB),
          Games: row.Games,
          WinRate: row.HeroAWinRate,
        }));
      return { HeroId: hero.HeroId, HeroName: hero.HeroName, Counters: counters };
    });
}

function buildModel(
  data,
  draftState,
  draftSequence,
  excludedComfortBySide = createEmptyExcludedComfortBySide(),
  excludedRecommendationHeroesBySide = createEmptyExcludedRecommendationHeroesBySide()
) {
  if (!data) {
    return {
      heroMap: new Map(),
      ourProfiles: { list: [], map: new Map() },
      opponentProfiles: { list: [], map: new Map() },
      ourPublicTrend: emptyPublicTrendData(),
      opponentPublicTrend: emptyPublicTrendData(),
      ourTeamStats: emptyTeamStats(),
      opponentTeamStats: emptyTeamStats(),
      h2h: { PairMap: new Map(), ByHeroA: new Map() },
      board: buildBoard(createEmptyDraftState(draftSequence.length), new Map(), draftSequence),
      currentActionIndex: -1,
      currentAction: null,
      availableHeroes: [],
      scoreModel: { Score: 50, ScoreRange: '50', Confidence: 'Low', Band: scoreBand(50), SignalTotals: {}, Contributions: [] },
      recommendations: { title: 'Draft', rows: [] },
      threatAlerts: [],
      selfScout: [],
      contestedSet: new Set(),
      ourStrength: { ScoreMap: new Map(), BestPlayerMap: new Map() },
      opponentStrength: { ScoreMap: new Map(), BestPlayerMap: new Map() },
      bannedAgainstOur: new Map(),
      bannedAgainstOpponent: new Map(),
    };
  }

  const heroMap = buildHeroMap(data.heroPool || []);
  const leagueWeights = buildLeagueWeights(data.recentLeagueIds || [], data.leagueId);
  const ourProfiles = buildPlayerProfiles(data.ourPlayerHeroRows || [], data.ourRoster || [], leagueWeights);
  const opponentProfiles = buildPlayerProfiles(data.opponentPlayerHeroRows || [], data.opponentRoster || [], leagueWeights);
  const ourPublicTrend = buildPublicTrendData(
    data.ourPublicHeroRows || [],
    data.ourRoster || [],
    excludedComfortBySide?.our || new Set()
  );
  const opponentPublicTrend = buildPublicTrendData(
    data.opponentPublicHeroRows || [],
    data.opponentRoster || [],
    excludedComfortBySide?.opponent || new Set()
  );
  const teammateRecent2WinMap = {
    our: buildTeammateHeroWinRateMap(data.ourPlayerHeroRows || [], data.recentLeagueIds || [], 2),
    opponent: buildTeammateHeroWinRateMap(data.opponentPlayerHeroRows || [], data.recentLeagueIds || [], 2),
  };
  const ourTeamId = toNumber(data.ourTeam?.TeamId, null);
  const opponentTeamId = toNumber(data.selectedOpponentTeamId, null);
  const ourTeamStats = buildTeamStats(
    data.ourTeamDraftRows || [],
    ourTeamId,
    leagueWeights,
    data.leagueId,
    data.recentLeagueDraftRows || data.currentLeagueDraftRows || []
  );
  const opponentTeamStats = buildTeamStats(
    data.opponentTeamDraftRows || [],
    opponentTeamId,
    leagueWeights,
    data.leagueId,
    data.recentLeagueDraftRows || data.currentLeagueDraftRows || []
  );
  const h2h = buildH2HData(
    (data.recent5LeagueDraftRows && data.recent5LeagueDraftRows.length > 0)
      ? data.recent5LeagueDraftRows
      : data.currentLeagueDraftRows || []
  );
  const contestedSet = buildContestedSet(data.currentLeagueDraftRows || [], data.leagueId);
  const board = buildBoard(draftState, heroMap, draftSequence);
  const currentActionIndex = nextActionIndex(draftState);
  const currentAction = currentActionIndex >= 0 ? draftSequence[currentActionIndex] : null;
  const availableHeroes = (data.heroPool || [])
    .map((row) => ({ HeroId: toNumber(row.HeroId), HeroName: row.HeroName }))
    .filter((hero) => !board.usedHeroes.has(hero.HeroId));
  const ourStrength = buildSideStrength(ourProfiles.list);
  const opponentStrength = buildSideStrength(opponentProfiles.list);
  const selfScout = ourTeamId ? buildSelfScoutBanRows(data.currentLeagueDraftRows || [], ourTeamId, ourTeamStats.CurrentPickRateMap) : [];
  const selfScoutMap = new Map(selfScout.map((row) => [row.HeroId, row.WeightedBanRate / 100]));

  const context = {
    heroMap,
    ourProfiles,
    opponentProfiles,
    ourPublicTrend,
    opponentPublicTrend,
    ourTeamStats,
    opponentTeamStats,
    h2h,
    contestedSet,
    ourStrength,
    opponentStrength,
    teammateRecent2WinMap,
    postEarlyPickIndex: (() => {
      const idx = draftSequence.findIndex((step) => step.type === 'pick' && step.pickOrder === 3);
      return idx >= 0 ? idx : draftSequence.length + 1;
    })(),
    lastPickActionIndex:
      [...draftSequence]
        .reverse()
        .find((step) => step.type === 'pick')?.actionIndex ?? -1,
    lastPickSide:
      [...draftSequence]
        .reverse()
        .find((step) => step.type === 'pick')?.side ?? 'opponent',
  };
  const scoreModel = computeScore(board, context, currentActionIndex);
  const recommendations = buildRecommendations(
    currentAction,
    board,
    context,
    availableHeroes,
    selfScoutMap,
    excludedComfortBySide,
    excludedRecommendationHeroesBySide
  );
  const threatAlerts = buildThreatAlerts(board, context, scoreModel, currentAction);
  const bannedAgainstOur = buildBannedAgainstMap(data.currentLeagueDraftRows || [], ourTeamId);
  const bannedAgainstOpponent = buildBannedAgainstMap(data.currentLeagueDraftRows || [], opponentTeamId);

  return {
    heroMap,
    ourProfiles,
    opponentProfiles,
    ourPublicTrend,
    opponentPublicTrend,
    ourTeamStats,
    opponentTeamStats,
    h2h,
    board,
    currentActionIndex,
    currentAction,
    availableHeroes,
    scoreModel,
    recommendations,
    threatAlerts,
    selfScout,
    contestedSet,
    ourStrength,
    opponentStrength,
    bannedAgainstOur,
    bannedAgainstOpponent,
  };
}

function ScoreBar({ scoreModel, opponentName }) {
  const border = scoreModel.Confidence === 'Medium' ? '2px dashed #d69e2e' : '2px solid #1f2937';
  const opacity = scoreModel.Confidence === 'Low' ? 0.65 : 1;
  const markerLeft = `${clamp(scoreModel.Score, SCORE_MIN, SCORE_MAX)}%`;
  const fillStart = Math.min(50, scoreModel.Score);
  const fillWidth = Math.abs(scoreModel.Score - 50);
  return (
    <div style={scoreCardStyle}>
      <div style={scoreHeaderStyle}>
        <h2 style={{ margin: 0 }}>Draft Score</h2>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>
            {scoreModel.Confidence === 'High' ? scoreModel.Score : scoreModel.ScoreRange}
          </div>
          <div style={tinyMutedTextStyle}>
            {scoreModel.Band.label} | Confidence: {scoreModel.Confidence}
          </div>
        </div>
      </div>
      <div style={scoreSidesStyle}>
        <span>{opponentName || 'Opponent'}</span>
        <span>Us</span>
      </div>
      <div style={{ ...scoreTrackStyle, border, opacity }}>
        <div style={scoreMidLineStyle} />
        <div
          style={{
            ...scoreFillStyle,
            left: `${fillStart}%`,
            width: `${fillWidth}%`,
            background: scoreModel.Band.color,
          }}
        />
        <div style={{ ...scorePointerStyle, left: markerLeft, borderColor: scoreModel.Band.color }} />
      </div>
    </div>
  );
}

function SlotCell({ slot, rosterMap }) {
  const playerName =
    slot?.playerId && rosterMap.has(toNumber(slot.playerId))
      ? rosterMap.get(toNumber(slot.playerId)).PlayerName
      : '';
  return (
    <td style={tableCellStyle}>
      {slot?.heroId ? (
        <>
          <Link to={`/hero/${slot.heroId}`}>{slot.heroName}</Link>
          {playerName && <div style={tinyMutedTextStyle}>{playerName}</div>}
        </>
      ) : (
        <span style={{ opacity: 0.65 }}>Empty</span>
      )}
    </td>
  );
}

function heroConfidenceFromGames(games) {
  const total = toNumber(games, 0);
  if (total >= 5) return 'High';
  if (total >= 2) return 'Medium';
  return 'Low';
}

function pickBriefingHeroSets(profile, currentLeagueId) {
  const seasons = [...(profile.Seasons || [])].sort((a, b) => toNumber(b.LeagueId) - toNumber(a.LeagueId));
  const resolvedCurrentLeagueId = toNumber(currentLeagueId, null) || toNumber(seasons[0]?.LeagueId, null);
  const currentSeason = seasons.find((season) => toNumber(season.LeagueId) === resolvedCurrentLeagueId);
  const previousSeason = seasons.find((season) => toNumber(season.LeagueId) < resolvedCurrentLeagueId);

  const currentCandidates = (currentSeason?.TopHeroes || []).map((hero) => ({
    ...hero,
    Confidence: heroConfidenceFromGames(hero.Games),
  }));
  let current = currentCandidates
    .filter((hero) => hero.Games >= 2 && hero.WinRate >= 50)
    .sort((a, b) => b.Games - a.Games || b.WinRate - a.WinRate);
  if (current.length === 0) {
    current = currentCandidates.filter((hero) => hero.Games >= 2).sort((a, b) => b.Games - a.Games || b.WinRate - a.WinRate);
  }
  if (current.length === 0) {
    current = [...currentCandidates].sort((a, b) => b.Games - a.Games || b.WinRate - a.WinRate);
  }
  current = current.slice(0, 3);

  const previous = (previousSeason?.TopHeroes || [])
    .map((hero) => ({
      ...hero,
      Confidence: heroConfidenceFromGames(hero.Games),
    }))
    .filter((hero) => hero.Confidence === 'Medium' || hero.Confidence === 'High')
    .sort((a, b) => b.Games - a.Games || b.WinRate - a.WinRate)
    .slice(0, 2);

  return { current, previous };
}

function TeamPlayerCards({
  title,
  profiles,
  heroMap,
  opponentPool,
  h2h,
  currentLeagueId,
  publicTrend,
}) {
  function isThreat(heroId) {
    if (!opponentPool || opponentPool.size === 0) return false;
    for (const oppHero of opponentPool) {
      const row = h2h.PairMap.get(`${heroId}|${oppHero}`);
      if (row && row.Games >= 6 && row.HeroAWinRate > 60) return true;
    }
    return false;
  }

  return (
    <section style={{ marginBottom: '1rem' }}>
      <h3 style={sectionHeadingStyle}>{title}</h3>
      {profiles.length === 0 && <p style={mutedTextStyle}>No roster data.</p>}
      {profiles.map((profile) => (
        <div key={profile.PlayerId} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <strong>{profile.PlayerName}</strong>
            <span style={tinyMutedTextStyle}>
              {profile.TotalGames} games | {formatPercent(profile.OverallWinRate)}
            </span>
          </div>
          {(() => {
            const sets = pickBriefingHeroSets(profile, currentLeagueId);
            const publicTop = publicTrend?.ByPlayerTopMap.get(toNumber(profile.PlayerId)) || [];
            return (
              <>
                <div style={{ ...tinyMutedTextStyle, marginTop: '0.4rem' }}>Current season (high pick/WR)</div>
                <div style={chipWrapStyle}>
                  {sets.current.map((hero) => (
                    <span key={`${profile.PlayerId}-c-${hero.HeroId}`} style={chipStyle}>
                      {heroName(heroMap, hero.HeroId)} ({hero.Games}, {formatPercent(hero.WinRate)})
                      {isThreat(hero.HeroId) && <span style={threatBadgeStyle}>Threat</span>}
                    </span>
                  ))}
                  {sets.current.length === 0 && <span style={tinyMutedTextStyle}>No current-season hero data</span>}
                </div>
                <div style={{ ...tinyMutedTextStyle, marginTop: '0.35rem' }}>Previous season (Medium/High confidence)</div>
                <div style={chipWrapStyle}>
                  {sets.previous.map((hero) => (
                    <span key={`${profile.PlayerId}-p-${hero.HeroId}`} style={chipStyle}>
                      {heroName(heroMap, hero.HeroId)} ({hero.Games}, {formatPercent(hero.WinRate)}, {hero.Confidence})
                      {isThreat(hero.HeroId) && <span style={threatBadgeStyle}>Threat</span>}
                    </span>
                  ))}
                  {sets.previous.length === 0 && <span style={tinyMutedTextStyle}>No medium/high-confidence previous-season heroes</span>}
                </div>
                <div style={{ ...tinyMutedTextStyle, marginTop: '0.35rem' }}>Public last 30d (high WR trend)</div>
                <div style={chipWrapStyle}>
                  {publicTop.map((hero) => (
                    <span key={`${profile.PlayerId}-pub-${hero.HeroId}`} style={chipStyle}>
                      {heroName(heroMap, hero.HeroId)} ({hero.Games}, {formatPercent(hero.WinRate)})
                      {isThreat(hero.HeroId) && <span style={threatBadgeStyle}>Threat</span>}
                    </span>
                  ))}
                  {publicTop.length === 0 && <span style={tinyMutedTextStyle}>No strong 30-day public trend</span>}
                </div>
              </>
            );
          })()}
        </div>
      ))}
    </section>
  );
}

export default function DraftGodPage() {
  const { user, loading: authLoading } = useAuth();
  const [draftData, setDraftData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedOpponentTeamId, setSelectedOpponentTeamId] = useState('');
  const [ourPickOrder, setOurPickOrder] = useState('first');

  const [activeTab, setActiveTab] = useState('draft');
  const [draftState, setDraftState] = useState(createEmptyDraftState);
  const [heroSearch, setHeroSearch] = useState('');
  const [selectedHeroId, setSelectedHeroId] = useState('');
  const [selectedPickPlayerId, setSelectedPickPlayerId] = useState('');
  const [excludedComfortBySide, setExcludedComfortBySide] = useState(createEmptyExcludedComfortBySide);
  const [excludedRecommendationHeroesBySide, setExcludedRecommendationHeroesBySide] = useState(
    createEmptyExcludedRecommendationHeroesBySide
  );

  const [playersTeamView, setPlayersTeamView] = useState('opponent');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [teamsView, setTeamsView] = useState('opponent');
  const [isCompactDraftLayout, setIsCompactDraftLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1200 : false
  );

  const isAdmin = user?.accountId === ADMIN_ACCOUNT_ID;
  const ourDraftSide = ourPickOrder === 'first' ? 'R' : 'D';
  const draftSequence = useMemo(() => buildDraftSequence('R', ourDraftSide), [ourDraftSide]);

  const fetchDraftData = useCallback(async (opponentTeamId = '') => {
    setLoading(true);
    setError('');
    try {
      const url = new URL('/api/draftgod', window.location.origin);
      if (opponentTeamId) url.searchParams.set('opponentTeamId', opponentTeamId);
      const response = await fetch(url.toString(), { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load DraftGod data');
      const data = await response.json();
      setDraftData(data);
      if (data?.selectedOpponentTeamId) setSelectedOpponentTeamId(String(data.selectedOpponentTeamId));
      setDraftState(createEmptyDraftState(draftSequence.length));
      setHeroSearch('');
      setSelectedHeroId('');
      setSelectedPickPlayerId('');
      setExcludedComfortBySide(createEmptyExcludedComfortBySide());
      setExcludedRecommendationHeroesBySide(createEmptyExcludedRecommendationHeroesBySide());
    } catch (err) {
      setError(err.message || 'Failed to load DraftGod');
    } finally {
      setLoading(false);
    }
  }, [draftSequence.length]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    fetchDraftData();
  }, [authLoading, isAdmin, fetchDraftData]);

  async function onOpponentChange(nextTeamId) {
    setSelectedOpponentTeamId(nextTeamId);
    await fetchDraftData(nextTeamId);
  }

  useEffect(() => {
    setDraftState(createEmptyDraftState(draftSequence.length));
    setHeroSearch('');
    setSelectedHeroId('');
    setSelectedPickPlayerId('');
    setExcludedComfortBySide(createEmptyExcludedComfortBySide());
    setExcludedRecommendationHeroesBySide(createEmptyExcludedRecommendationHeroesBySide());
  }, [draftSequence]);

  useEffect(() => {
    if (typeof window === 'undefined') return () => {};
    const onResize = () => setIsCompactDraftLayout(window.innerWidth < 1200);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const model = useMemo(
    () =>
      buildModel(
        draftData,
        draftState,
        draftSequence,
        excludedComfortBySide,
        excludedRecommendationHeroesBySide
      ),
    [draftData, draftState, draftSequence, excludedComfortBySide, excludedRecommendationHeroesBySide]
  );

  const filteredHeroes = useMemo(() => {
    const query = heroSearch.trim().toLowerCase();
    if (!query) return model.availableHeroes;
    return model.availableHeroes.filter((hero) => hero.HeroName.toLowerCase().includes(query));
  }, [heroSearch, model.availableHeroes]);

  useEffect(() => {
    if (!filteredHeroes.length) {
      setSelectedHeroId('');
      return;
    }
    const exists = filteredHeroes.some((hero) => String(hero.HeroId) === String(selectedHeroId));
    if (!exists) setSelectedHeroId(String(filteredHeroes[0].HeroId));
  }, [filteredHeroes, selectedHeroId]);

  const currentAction = model.currentAction;
  const currentPickRoster = useMemo(() => {
    if (!currentAction || currentAction.type !== 'pick') return [];
    return currentAction.side === 'our' ? draftData?.ourRoster || [] : draftData?.opponentRoster || [];
  }, [currentAction, draftData]);

  useEffect(() => {
    if (!currentAction || currentAction.type !== 'pick' || !currentPickRoster.length) {
      setSelectedPickPlayerId('');
      return;
    }
    if (!selectedPickPlayerId) return;
    const exists = currentPickRoster.some((row) => String(row.PlayerId) === String(selectedPickPlayerId));
    if (!exists) setSelectedPickPlayerId('');
  }, [currentAction, currentPickRoster, selectedPickPlayerId]);

  function applyCurrentAction() {
    if (!currentAction || !selectedHeroId) return;
    const index = model.currentActionIndex;
    if (index < 0) return;
    setDraftState((prev) =>
      prev.map((entry, idx) =>
        idx === index
          ? {
              heroId: toNumber(selectedHeroId, null),
              playerId: currentAction.type === 'pick' ? selectedPickPlayerId : '',
            }
          : entry
      )
    );
    setHeroSearch('');
  }

  function undoAction() {
    setDraftState((prev) => {
      const next = [...prev];
      let lastFilled = -1;
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (toNumber(next[i]?.heroId, 0) > 0) {
          lastFilled = i;
          break;
        }
      }
      if (lastFilled < 0) return prev;
      next[lastFilled] = { heroId: null, playerId: '' };
      return next;
    });
  }

  function resetDraft() {
    setDraftState(createEmptyDraftState(draftSequence.length));
    setHeroSearch('');
    setSelectedHeroId('');
    setSelectedPickPlayerId('');
    setExcludedComfortBySide(createEmptyExcludedComfortBySide());
    setExcludedRecommendationHeroesBySide(createEmptyExcludedRecommendationHeroesBySide());
  }

  function removeComfortPlayerFromAnalysis(side, playerId) {
    const parsedPlayerId = toNumber(playerId, null);
    if (!parsedPlayerId || (side !== 'our' && side !== 'opponent')) return;
    setExcludedComfortBySide((prev) => {
      const next = {
        our: new Set(prev.our),
        opponent: new Set(prev.opponent),
      };
      next[side].add(parsedPlayerId);
      return next;
    });
  }

  function clearRemovedComfortPlayers(side) {
    if (side !== 'our' && side !== 'opponent') return;
    setExcludedComfortBySide((prev) => {
      const next = {
        our: new Set(prev.our),
        opponent: new Set(prev.opponent),
      };
      next[side].clear();
      return next;
    });
  }

  function removeBanRecommendationCard(side, heroId) {
    const parsedHeroId = toNumber(heroId, null);
    if (!parsedHeroId || (side !== 'our' && side !== 'opponent')) return;
    setExcludedRecommendationHeroesBySide((prev) => {
      const next = {
        our: new Set(prev.our),
        opponent: new Set(prev.opponent),
      };
      next[side].add(parsedHeroId);
      return next;
    });
  }

  function clearRemovedBanRecommendationCards(side) {
    if (side !== 'our' && side !== 'opponent') return;
    setExcludedRecommendationHeroesBySide((prev) => {
      const next = {
        our: new Set(prev.our),
        opponent: new Set(prev.opponent),
      };
      next[side].clear();
      return next;
    });
  }

  const ourRosterMap = useMemo(
    () => new Map((draftData?.ourRoster || []).map((row) => [toNumber(row.PlayerId), row])),
    [draftData]
  );
  const opponentRosterMap = useMemo(
    () => new Map((draftData?.opponentRoster || []).map((row) => [toNumber(row.PlayerId), row])),
    [draftData]
  );

  const activeProfiles = playersTeamView === 'our' ? model.ourProfiles.list : model.opponentProfiles.list;
  const selectedProfile = useMemo(
    () => activeProfiles.find((profile) => String(profile.PlayerId) === String(selectedPlayerId)) || null,
    [activeProfiles, selectedPlayerId]
  );
  useEffect(() => {
    if (!activeProfiles.length) {
      setSelectedPlayerId('');
      return;
    }
    const exists = activeProfiles.some((profile) => String(profile.PlayerId) === String(selectedPlayerId));
    if (!exists) setSelectedPlayerId(String(activeProfiles[0].PlayerId));
  }, [activeProfiles, selectedPlayerId]);

  const matchupNotes = useMemo(
    () => buildMatchupNotes(selectedProfile, model.h2h, model.heroMap),
    [selectedProfile, model.h2h, model.heroMap]
  );

  const teamStats = teamsView === 'our' ? model.ourTeamStats : model.opponentTeamStats;
  const bannedAgainst = teamsView === 'our' ? model.bannedAgainstOur : model.bannedAgainstOpponent;
  const currentFingerprintSeasonId = useMemo(() => {
    const currentLeagueId = toNumber(draftData?.leagueId, null);
    if (currentLeagueId) return currentLeagueId;
    const seasonIds = [...teamStats.SeasonTopHeroes.keys()].sort((a, b) => b - a);
    return seasonIds[0] || null;
  }, [draftData, teamStats]);
  const currentFingerprintRows = useMemo(() => {
    if (!currentFingerprintSeasonId) return [];
    return teamStats.SeasonTopHeroes.get(currentFingerprintSeasonId) || [];
  }, [teamStats, currentFingerprintSeasonId]);
  const leagueNameMap = useMemo(() => {
    const map = new Map();
    if (draftData?.leagueId) {
      map.set(toNumber(draftData.leagueId), draftData.leagueName || `League ${draftData.leagueId}`);
    }
    (draftData?.recentLeagues || []).forEach((row) => {
      const leagueId = toNumber(row.LeagueId, null);
      if (!leagueId) return;
      map.set(leagueId, row.LeagueName || `League ${leagueId}`);
    });
    return map;
  }, [draftData]);
  const leagueDisplayName = (leagueId) =>
    leagueNameMap.get(toNumber(leagueId)) || `League ${toNumber(leagueId)}`;

  if (authLoading) return <div>Loading...</div>;
  if (!user) return <div>You are not logged in.</div>;
  if (!isAdmin) return <Navigate to="/" />;

  const opponentTeamName =
    draftData?.teams?.find((team) => String(team.TeamId) === String(selectedOpponentTeamId))?.TeamName ||
    'Opponent';
  const banCardSide = currentAction?.type === 'ban' ? currentAction.side : null;
  const comfortFocusSide =
    currentAction?.type === 'ban'
      ? currentAction.side === 'our'
      ? 'opponent'
      : 'our'
      : currentAction?.type === 'pick'
      ? currentAction.side
      : null;
  const removedComfortCount = currentAction?.type === 'pick' && comfortFocusSide
    ? (excludedComfortBySide[comfortFocusSide]?.size || 0)
    : 0;
  const removedBanCardCount = banCardSide
    ? (excludedRecommendationHeroesBySide[banCardSide]?.size || 0)
    : 0;
  const recommendationPercentDescription =
    currentAction?.type === 'ban'
      ? 'Recommendation % is a weighted ban priority score (24% season pick trend, 22% player comfort, 30% last-30d public trend, 19% matchup denial, 5% self-scout).'
      : 'Recommendation % is a weighted fit score, not win probability (22% season pick trend, 28% player comfort, 32% last-30d public trend, 13% matchup fit, 5% contested priority).';
  const radiantSide = ourDraftSide === 'R' ? 'our' : 'opponent';
  const direSide = radiantSide === 'our' ? 'opponent' : 'our';
  const radiantLabel = radiantSide === 'our' ? 'R (Us)' : `R (${opponentTeamName})`;
  const direLabel = direSide === 'our' ? 'D (Us)' : `D (${opponentTeamName})`;
  const sideRosterMap = {
    our: ourRosterMap,
    opponent: opponentRosterMap,
  };

  return (
    <div style={pageStyle}>
      <h1 style={{ marginTop: 0 }}>Draft Assistant</h1>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading && !draftData && <p>Loading draft model...</p>}

      {draftData && (
        <>
          <div style={topRowStyle}>
            <div>
              <p style={infoTextStyle}>
                Current league: <strong>{draftData.leagueName || 'N/A'}</strong>
              </p>
              <p style={infoTextStyle}>
                Your team: <strong>{draftData.ourTeam?.TeamName || 'Not found'}</strong>
              </p>
            </div>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <label htmlFor="draftgod-opponent-select" style={{ marginRight: '0.45rem' }}>
                Scout team:
              </label>
              <select
                id="draftgod-opponent-select"
                value={selectedOpponentTeamId}
                onChange={(e) => onOpponentChange(e.target.value)}
                style={selectStyle}
              >
                {(draftData.teams || []).map((team) => (
                  <option key={team.TeamId} value={team.TeamId}>
                    {team.TeamName}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <label htmlFor="draftgod-pickorder-select">We are:</label>
                <select
                  id="draftgod-pickorder-select"
                  value={ourPickOrder}
                  onChange={(e) => setOurPickOrder(e.target.value)}
                  style={selectStyle}
                >
                  <option value="first">First Pick</option>
                  <option value="second">Second Pick</option>
                </select>
              </div>
            </div>
          </div>

          <div style={tabsStyle}>
            <button type="button" style={activeTab === 'draft' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setActiveTab('draft')}>Draft</button>
            <button type="button" style={activeTab === 'players' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setActiveTab('players')}>Players</button>
            <button type="button" style={activeTab === 'teams' ? activeTabButtonStyle : tabButtonStyle} onClick={() => setActiveTab('teams')}>Teams</button>
          </div>

          {activeTab === 'draft' && (
            <div style={draftTabStackStyle}>
              <section style={panelStyle}>
                <h2 style={panelTitleStyle}>Team Intelligence Briefing</h2>
                <div style={isCompactDraftLayout ? intelStackStyle : intelLandscapeStyle}>
                  <TeamPlayerCards
                    title="Your Team Players"
                    profiles={model.ourProfiles.list}
                    heroMap={model.heroMap}
                    opponentPool={null}
                    h2h={model.h2h}
                    currentLeagueId={draftData?.leagueId}
                    publicTrend={model.ourPublicTrend}
                  />
                  <TeamPlayerCards
                    title="Opponent Players"
                    profiles={model.opponentProfiles.list}
                    heroMap={model.heroMap}
                    opponentPool={
                      new Set(model.ourTeamStats.TopWeightedHeroes.slice(0, 8).map((row) => row.HeroId))
                    }
                    h2h={model.h2h}
                    currentLeagueId={draftData?.leagueId}
                    publicTrend={model.opponentPublicTrend}
                  />
                  <div>
                    <section style={{ marginBottom: '1rem' }}>
                      <h3 style={sectionHeadingStyle}>Opponent Signature Picks (Current Season)</h3>
                      <table style={smallTableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeadStyle}>Hero</th>
                            <th style={tableHeadStyle}>Picks</th>
                            <th style={tableHeadStyle}>Win %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {model.opponentTeamStats.SignatureCurrent.slice(0, 3).map((row) => (
                            <tr key={`sig-${row.HeroId}`}>
                              <td style={tableCellStyle}>
                                <Link to={`/hero/${row.HeroId}`}>{row.HeroName}</Link>
                              </td>
                              <td style={tableCellStyle}>{row.CurrentSeasonPicks}</td>
                              <td style={tableCellStyle}>{formatPercent(row.WinRate)}</td>
                            </tr>
                          ))}
                          {model.opponentTeamStats.SignatureCurrent.length === 0 && (
                            <tr>
                              <td style={tableCellStyle} colSpan={3}>
                                No data.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </section>

                    <section>
                      <h3 style={sectionHeadingStyle}>Opponent First-Pick Tendencies</h3>
                      <table style={smallTableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeadStyle}>Hero</th>
                            <th style={tableHeadStyle}>Times</th>
                            <th style={tableHeadStyle}>Win %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {model.opponentTeamStats.FirstPickRows.slice(0, 3).map((row) => (
                            <tr key={`fp-${row.HeroId}`}>
                              <td style={tableCellStyle}>
                                <Link to={`/hero/${row.HeroId}`}>{row.HeroName}</Link>
                              </td>
                              <td style={tableCellStyle}>{row.TimesPicked}</td>
                              <td style={tableCellStyle}>{formatPercent(row.WinRateWhenPicked)}</td>
                            </tr>
                          ))}
                          {model.opponentTeamStats.FirstPickRows.length === 0 && (
                            <tr>
                              <td style={tableCellStyle} colSpan={3}>
                                No data.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </section>
                  </div>
                </div>
              </section>

              <div style={isCompactDraftLayout ? draftMainStackStyle : draftMainSplitStyle}>
                <section style={panelStyle}>
                <h2 style={panelTitleStyle}>Live Draft Board</h2>
                <ScoreBar scoreModel={model.scoreModel} opponentName={opponentTeamName} />
                <div style={phaseBadgeStyle}>
                  {currentAction
                    ? `Phase ${currentAction.phase} - ${currentAction.label}`
                    : 'Draft completed'}
                </div>
                <div style={draftOrderWrapStyle}>
                  {draftSequence.map((step, index) => (
                    <span
                      key={`order-${index}`}
                      style={
                        index === model.currentActionIndex
                          ? draftOrderChipActiveStyle
                          : draftOrderChipStyle
                      }
                    >
                      {step.actor} {step.type === 'ban' ? 'Ban' : 'Pick'}
                    </span>
                  ))}
                </div>

                <div style={controlsStyle}>
                  <input
                    type="text"
                    placeholder="Search hero..."
                    value={heroSearch}
                    onChange={(e) => setHeroSearch(e.target.value)}
                    style={inputStyle}
                    disabled={!currentAction}
                  />
                  <select
                    value={selectedHeroId}
                    onChange={(e) => setSelectedHeroId(e.target.value)}
                    style={selectStyle}
                    disabled={!currentAction || filteredHeroes.length === 0}
                  >
                    {filteredHeroes.map((hero) => (
                      <option key={hero.HeroId} value={hero.HeroId}>
                        {hero.HeroName}
                      </option>
                    ))}
                  </select>
                  {currentAction?.type === 'pick' && (
                    <select
                      value={selectedPickPlayerId}
                      onChange={(e) => setSelectedPickPlayerId(e.target.value)}
                      style={selectStyle}
                    >
                      <option value="">Flex / Unassigned</option>
                      {currentPickRoster.map((player) => (
                        <option key={player.PlayerId} value={player.PlayerId}>
                          {player.PlayerName}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" style={primaryButtonStyle} onClick={applyCurrentAction} disabled={!currentAction || !selectedHeroId}>
                    Apply Slot
                  </button>
                  <button type="button" style={secondaryButtonStyle} onClick={undoAction}>
                    Undo
                  </button>
                  <button type="button" style={secondaryButtonStyle} onClick={resetDraft}>
                    Reset
                  </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <h3 style={sectionHeadingStyle}>Bans</h3>
                  <table style={boardTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>Team</th>
                        {model.board[radiantSide].bans.map((slot, idx) => (
                          <th key={`ban-head-${idx}`} style={tableHeadStyle}>
                            Ban {idx + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={tableCellStyle}>{radiantLabel}</td>
                        {model.board[radiantSide].bans.map((slot, idx) => (
                          <SlotCell
                            key={`rad-ban-${idx}`}
                            slot={slot}
                            rosterMap={sideRosterMap[radiantSide]}
                          />
                        ))}
                      </tr>
                      <tr>
                        <td style={tableCellStyle}>{direLabel}</td>
                        {model.board[direSide].bans.map((slot, idx) => (
                          <SlotCell
                            key={`dire-ban-${idx}`}
                            slot={slot}
                            rosterMap={sideRosterMap[direSide]}
                          />
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ overflowX: 'auto', marginTop: '0.9rem' }}>
                  <h3 style={sectionHeadingStyle}>Picks</h3>
                  <table style={boardTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>Team</th>
                        {model.board[radiantSide].picks.map((slot, idx) => (
                          <th key={`pick-head-${idx}`} style={tableHeadStyle}>
                            Pick {idx + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={tableCellStyle}>{radiantLabel}</td>
                        {model.board[radiantSide].picks.map((slot, idx) => (
                          <SlotCell
                            key={`rad-pick-${idx}`}
                            slot={slot}
                            rosterMap={sideRosterMap[radiantSide]}
                          />
                        ))}
                      </tr>
                      <tr>
                        <td style={tableCellStyle}>{direLabel}</td>
                        {model.board[direSide].picks.map((slot, idx) => (
                          <SlotCell
                            key={`dire-pick-${idx}`}
                            slot={slot}
                            rosterMap={sideRosterMap[direSide]}
                          />
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <aside style={panelStyle}>
                <h2 style={panelTitleStyle}>Live Analysis</h2>

                <section style={{ marginBottom: '1rem' }}>
                  <h3 style={sectionHeadingStyle}>{model.recommendations.title}</h3>
                  <p style={tinyMutedTextStyle}>{recommendationPercentDescription}</p>
                  {currentAction?.type === 'pick' && comfortFocusSide && removedComfortCount > 0 && (
                    <div style={{ marginBottom: '0.45rem' }}>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => clearRemovedComfortPlayers(comfortFocusSide)}
                      >
                        Reset removed comfort players ({removedComfortCount})
                      </button>
                    </div>
                  )}
                  {currentAction?.type === 'ban' && banCardSide && removedBanCardCount > 0 && (
                    <div style={{ marginBottom: '0.45rem' }}>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => clearRemovedBanRecommendationCards(banCardSide)}
                      >
                        Reset removed ban cards ({removedBanCardCount})
                      </button>
                    </div>
                  )}
                  {model.recommendations.rows.length === 0 && (
                    <p style={mutedTextStyle}>No recommendation for this draft state.</p>
                  )}
                  {model.recommendations.rows.map((row) => (
                    <div key={`rec-${row.HeroId}`} style={cardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
                        <strong>
                          <Link to={`/hero/${row.HeroId}`}>{row.HeroName}</Link>
                        </strong>
                        <span style={tinyMutedTextStyle}>{formatPercent(row.Score * 100)}</span>
                      </div>
                      <div style={tinyMutedTextStyle}>{row.Reason}</div>
                      {row.ComfortPlayerName ? (
                        <div style={tinyMutedTextStyle}>
                          Comfort: {row.ComfortPlayerName} ({formatPercent(row.ComfortPercent)} fit, {row.ComfortPlayerGames} games,{' '}
                          {formatPercent(row.ComfortPlayerWinRate)} WR)
                        </div>
                      ) : (
                        <div style={tinyMutedTextStyle}>Comfort: no strong player fit identified</div>
                      )}
                      {row.PublicTrendPlayerName ? (
                        <div style={tinyMutedTextStyle}>
                          30d trend: {row.PublicTrendPlayerName} ({formatPercent(row.PublicTrendPercent)} fit, {row.PublicTrendGames} games,{' '}
                          {formatPercent(row.PublicTrendWinRate)} WR)
                        </div>
                      ) : (
                        <div style={tinyMutedTextStyle}>30d trend: no strong public signal</div>
                      )}
                      {currentAction?.type === 'pick' && comfortFocusSide && row.ComfortPlayerId && (
                        <div style={{ marginTop: '0.45rem' }}>
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => removeComfortPlayerFromAnalysis(comfortFocusSide, row.ComfortPlayerId)}
                          >
                            Remove {row.ComfortPlayerName} from comfort analysis
                          </button>
                        </div>
                      )}
                      {currentAction?.type === 'ban' && banCardSide && (
                        <div style={{ marginTop: '0.45rem' }}>
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => removeBanRecommendationCard(banCardSide, row.HeroId)}
                          >
                            Remove this ban card
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </section>

                <section style={{ marginBottom: '1rem' }}>
                  <h3 style={sectionHeadingStyle}>Threat Alerts</h3>
                  {model.threatAlerts.length === 0 && <p style={mutedTextStyle}>No immediate threat detected.</p>}
                  {model.threatAlerts.map((alert, idx) => (
                    <div key={`threat-${idx}`} style={alertCardStyle}>
                      <strong>{alert.title}</strong>
                      <div style={tinyMutedTextStyle}>{alert.detail}</div>
                    </div>
                  ))}
                </section>

                <section>
                  <details open>
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Score Breakdown</summary>
                    <div style={{ marginTop: '0.6rem' }}>
                      <table style={smallTableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeadStyle}>Signal</th>
                            <th style={tableHeadStyle}>Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {['PlayerPool', 'H2H', 'TeamTrend', 'PhasePriority'].map((signal) => (
                            <tr key={`sig-total-${signal}`}>
                              <td style={tableCellStyle}>{signal}</td>
                              <td style={tableCellStyle}>
                                {formatNumber(model.scoreModel.SignalTotals[signal] || 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div style={{ marginTop: '0.5rem', maxHeight: '240px', overflowY: 'auto' }}>
                        {model.scoreModel.Contributions.map((row, idx) => (
                          <div key={`contrib-${idx}`} style={deltaStyle}>
                            <strong>{row.signal}:</strong> {row.delta >= 0 ? '+' : ''}
                            {formatNumber(row.delta)} - {row.reason}
                            {row.sampleOk === false && <span style={warningTextStyle}> (low sample)</span>}
                          </div>
                        ))}
                        {model.scoreModel.Contributions.length === 0 && (
                          <p style={mutedTextStyle}>No active signals.</p>
                        )}
                      </div>
                    </div>
                  </details>
                </section>
              </aside>
              </div>
            </div>
          )}

          {activeTab === 'players' && (
            <div>
              <div style={{ marginBottom: '0.9rem' }}>
                <label htmlFor="players-team-view" style={{ marginRight: '0.45rem' }}>
                  Team:
                </label>
                <select
                  id="players-team-view"
                  value={playersTeamView}
                  onChange={(e) => setPlayersTeamView(e.target.value)}
                  style={selectStyle}
                >
                  <option value="our">{draftData.ourTeam?.TeamName || 'Our Team'}</option>
                  <option value="opponent">{opponentTeamName}</option>
                </select>
              </div>

              <div style={playersLayoutStyle}>
                <aside style={panelStyle}>
                  <h2 style={panelTitleStyle}>Players</h2>
                  <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
                    {activeProfiles.map((profile) => (
                      <button
                        key={`profile-${profile.PlayerId}`}
                        type="button"
                        onClick={() => setSelectedPlayerId(String(profile.PlayerId))}
                        style={
                          String(profile.PlayerId) === String(selectedPlayerId)
                            ? playerButtonActiveStyle
                            : playerButtonStyle
                        }
                      >
                        <div style={{ fontWeight: 700 }}>{profile.PlayerName}</div>
                        <div style={tinyMutedTextStyle}>
                          {profile.TotalGames} games | {formatPercent(profile.OverallWinRate)}
                        </div>
                      </button>
                    ))}
                    {activeProfiles.length === 0 && <p style={mutedTextStyle}>No player data.</p>}
                  </div>
                </aside>

                <section style={panelStyle}>
                  <h2 style={panelTitleStyle}>Player Profile</h2>
                  {!selectedProfile && <p style={mutedTextStyle}>Select a player.</p>}
                  {selectedProfile && (
                    <>
                      <div style={cardStyle}>
                        <h3 style={{ margin: 0 }}>{selectedProfile.PlayerName}</h3>
                        <div style={tinyMutedTextStyle}>
                          {selectedProfile.TotalGames} games over last 3 seasons |{' '}
                          {formatPercent(selectedProfile.OverallWinRate)} win rate
                        </div>
                      </div>

                      <section style={{ marginTop: '0.8rem' }}>
                        <h3 style={sectionHeadingStyle}>Season Breakdown</h3>
                        {selectedProfile.Seasons.map((season) => (
                          <details
                            key={`season-${season.LeagueId}`}
                            open={season.LeagueId === toNumber(draftData.leagueId)}
                          >
                            <summary style={{ cursor: 'pointer' }}>
                              {leagueDisplayName(season.LeagueId)}
                            </summary>
                            {!season.Played ? (
                              <p style={tinyMutedTextStyle}>Did not play</p>
                            ) : (
                              <div style={{ marginTop: '0.4rem' }}>
                                <div style={tinyMutedTextStyle}>
                                  {season.Games} games | {formatPercent(season.WinRate)} | Avg GPM {formatNumber(season.AvgGpm)} | Avg KDA {formatNumber(season.AvgKda)}
                                </div>
                                <div style={chipWrapStyle}>
                                  {season.TopHeroes.map((hero) => (
                                    <span key={`sh-${season.LeagueId}-${hero.HeroId}`} style={chipStyle}>
                                      {hero.HeroName} ({hero.Games}, {formatPercent(hero.WinRate)})
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </details>
                        ))}
                      </section>

                      <section style={{ marginTop: '0.9rem' }}>
                        <h3 style={sectionHeadingStyle}>Hero Performance</h3>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={smallTableStyle}>
                            <thead>
                              <tr>
                                <th style={tableHeadStyle}>Hero</th>
                                <th style={tableHeadStyle}>Games</th>
                                <th style={tableHeadStyle}>Win %</th>
                                <th style={tableHeadStyle}>Avg GPM</th>
                                <th style={tableHeadStyle}>Avg KDA</th>
                                <th style={tableHeadStyle}>Avg Damage</th>
                                <th style={tableHeadStyle}>Perf Score</th>
                                <th style={tableHeadStyle}>Confidence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedProfile.Heroes.map((hero) => (
                                <tr key={`ph-${hero.HeroId}`}>
                                  <td style={tableCellStyle}>
                                    <Link to={`/hero/${hero.HeroId}`}>{hero.HeroName}</Link>
                                  </td>
                                  <td style={tableCellStyle}>{hero.Games}</td>
                                  <td style={tableCellStyle}>{formatPercent(hero.WinRate)}</td>
                                  <td style={tableCellStyle}>{formatNumber(hero.AvgGpm)}</td>
                                  <td style={tableCellStyle}>{formatNumber(hero.AvgKda)}</td>
                                  <td style={tableCellStyle}>{formatNumber(hero.AvgDamage, 0)}</td>
                                  <td style={tableCellStyle}>{formatNumber(hero.WeightedPerformance)}</td>
                                  <td style={tableCellStyle}>{hero.Confidence}</td>
                                </tr>
                              ))}
                              {selectedProfile.Heroes.length === 0 && (
                                <tr>
                                  <td style={tableCellStyle} colSpan={8}>
                                    No hero performance data.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>

                      <section style={{ marginTop: '0.9rem' }}>
                        <h3 style={sectionHeadingStyle}>Matchup Notes</h3>
                        {matchupNotes.map((note) => (
                          <div key={`note-${note.HeroId}`} style={cardStyle}>
                            <strong>
                              <Link to={`/hero/${note.HeroId}`}>{note.HeroName}</Link>
                            </strong>
                            {note.Counters.length === 0 ? (
                              <div style={tinyMutedTextStyle}>No high-sample counters available.</div>
                            ) : (
                              <div style={tinyMutedTextStyle}>
                                {note.Counters.map((counter) => (
                                  <span key={`ctr-${note.HeroId}-${counter.HeroId}`} style={{ marginRight: '0.5rem' }}>
                                    {counter.HeroName}: {formatPercent(counter.WinRate)} ({counter.Games})
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {matchupNotes.length === 0 && <p style={mutedTextStyle}>No matchup notes.</p>}
                      </section>
                    </>
                  )}
                </section>
              </div>
            </div>
          )}

          {activeTab === 'teams' && (
            <div>
              <div style={{ marginBottom: '0.9rem' }}>
                <label htmlFor="teams-view" style={{ marginRight: '0.45rem' }}>
                  Team:
                </label>
                <select id="teams-view" value={teamsView} onChange={(e) => setTeamsView(e.target.value)} style={selectStyle}>
                  <option value="our">{draftData.ourTeam?.TeamName || 'Our Team'}</option>
                  <option value="opponent">{opponentTeamName}</option>
                </select>
              </div>

              <div style={teamsGridStyle}>
                <section style={panelStyle}>
                  <h2 style={panelTitleStyle}>Draft Fingerprint</h2>
                  <table style={smallTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>
                          {currentFingerprintSeasonId
                            ? leagueDisplayName(currentFingerprintSeasonId)
                            : 'Current Season'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[0, 1, 2, 3, 4].map((rank) => (
                        <tr key={`finger-rank-${rank}`}>
                          <td style={tableCellStyle}>
                            {currentFingerprintRows[rank] ? (
                              <>
                                <Link to={`/hero/${currentFingerprintRows[rank].HeroId}`}>
                                  {currentFingerprintRows[rank].HeroName}
                                </Link>{' '}
                                ({currentFingerprintRows[rank].Picks})
                              </>
                            ) : (
                              <span style={{ opacity: 0.65 }}>-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section style={panelStyle}>
                  <h2 style={panelTitleStyle}>First-Pick Tendencies</h2>
                  <table style={smallTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>Hero</th>
                        <th style={tableHeadStyle}>Times</th>
                        <th style={tableHeadStyle}>Win % (picked)</th>
                        <th style={tableHeadStyle}>Banned Against</th>
                        <th style={tableHeadStyle}>Win % (when banned)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamStats.FirstPickRows.slice(0, 10).map((row) => {
                        const banned = bannedAgainst.get(row.HeroId);
                        return (
                          <tr key={`tfp-${row.HeroId}`}>
                            <td style={tableCellStyle}>
                              <Link to={`/hero/${row.HeroId}`}>{row.HeroName}</Link>
                            </td>
                            <td style={tableCellStyle}>{row.TimesPicked}</td>
                            <td style={tableCellStyle}>{formatPercent(row.WinRateWhenPicked)}</td>
                            <td style={tableCellStyle}>{banned?.TimesBannedAgainst || 0}</td>
                            <td style={tableCellStyle}>{formatPercent(banned?.TeamWinRateWhenBanned || 0)}</td>
                          </tr>
                        );
                      })}
                      {teamStats.FirstPickRows.length === 0 && (
                        <tr>
                          <td style={tableCellStyle} colSpan={5}>
                            No first-pick data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>

                <section style={panelStyle}>
                  <h2 style={panelTitleStyle}>Win Condition Clusters</h2>
                  <table style={smallTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>Pair</th>
                        <th style={tableHeadStyle}>Games</th>
                        <th style={tableHeadStyle}>Win %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamStats.PairRows.slice(0, 10).map((pair) => (
                        <tr key={`pair-${pair.Key}`}>
                          <td style={tableCellStyle}>
                            <Link to={`/hero/${pair.HeroA}`}>{heroName(model.heroMap, pair.HeroA)}</Link> +{' '}
                            <Link to={`/hero/${pair.HeroB}`}>{heroName(model.heroMap, pair.HeroB)}</Link>
                          </td>
                          <td style={tableCellStyle}>{pair.DecidedGames}</td>
                          <td style={tableCellStyle}>{formatPercent(pair.WinRate)}</td>
                        </tr>
                      ))}
                      {teamStats.PairRows.length === 0 && (
                        <tr>
                          <td style={tableCellStyle} colSpan={3}>
                            No pair data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>

                <section style={panelStyle}>
                  <h2 style={panelTitleStyle}>Ban Priorities</h2>
                  <table style={smallTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>Hero</th>
                        <th style={tableHeadStyle}>Times Banned</th>
                        <th style={tableHeadStyle}>Current Season</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamStats.BanRows.slice(0, 10).map((row) => (
                        <tr key={`ban-${row.HeroId}`}>
                          <td style={tableCellStyle}>
                            <Link to={`/hero/${row.HeroId}`}>{row.HeroName}</Link>
                          </td>
                          <td style={tableCellStyle}>{row.TimesBanned}</td>
                          <td style={tableCellStyle}>{row.CurrentSeasonBans}</td>
                        </tr>
                      ))}
                      {teamStats.BanRows.length === 0 && (
                        <tr>
                          <td style={tableCellStyle} colSpan={3}>
                            No ban data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>

                <section style={panelStyle}>
                  <h2 style={panelTitleStyle}>Self-Scout Weighted Ban Rates</h2>
                  <table style={smallTableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadStyle}>Hero</th>
                        <th style={tableHeadStyle}>Weighted Ban %</th>
                        <th style={tableHeadStyle}>Raw Ban %</th>
                        <th style={tableHeadStyle}>Our Pick %</th>
                        <th style={tableHeadStyle}>Opp Win % (after ban)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.selfScout.map((row) => (
                        <tr key={`ss-${row.HeroId}`}>
                          <td style={tableCellStyle}>
                            <Link to={`/hero/${row.HeroId}`}>{row.HeroName}</Link>
                          </td>
                          <td style={tableCellStyle}>{formatPercent(row.WeightedBanRate)}</td>
                          <td style={tableCellStyle}>{formatPercent(row.BanRate)}</td>
                          <td style={tableCellStyle}>{formatPercent(row.OurPickRate)}</td>
                          <td style={tableCellStyle}>{formatPercent(row.OpponentWinRateWhenBanned)}</td>
                        </tr>
                      ))}
                      {model.selfScout.length === 0 && (
                        <tr>
                          <td style={tableCellStyle} colSpan={5}>
                            No self-scout data.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const pageStyle = { padding: '1rem' };
const topRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  gap: '1rem',
  flexWrap: 'wrap',
  marginBottom: '0.8rem',
};
const infoTextStyle = { margin: '0.2rem 0' };
const tabsStyle = { display: 'flex', gap: '0.5rem', marginBottom: '1rem' };
const tabButtonStyle = {
  background: '#111827',
  color: '#f3f4f6',
  border: '1px solid #1f2937',
  borderRadius: 8,
  padding: '0.4rem 0.75rem',
  cursor: 'pointer',
};
const activeTabButtonStyle = { ...tabButtonStyle, background: '#0f766e', border: '1px solid #0f766e' };
const panelStyle = {
  background: '#0f1720',
  border: '1px solid #1f2937',
  borderRadius: 12,
  padding: '0.9rem',
};
const panelTitleStyle = { margin: '0 0 0.7rem 0' };
const draftTabStackStyle = {
  display: 'grid',
  gap: '1rem',
};
const intelLandscapeStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '1rem',
  alignItems: 'start',
};
const intelStackStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: '1rem',
};
const draftMainSplitStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)',
  gap: '1rem',
  alignItems: 'start',
};
const draftMainStackStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: '1rem',
};
const playersLayoutStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 320px) 1fr',
  gap: '1rem',
};
const teamsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: '1rem',
};
const sectionHeadingStyle = { margin: '0 0 0.45rem 0', fontSize: '1rem' };
const scoreCardStyle = {
  border: '1px solid #233043',
  borderRadius: 8,
  padding: '0.65rem',
  marginBottom: '0.75rem',
};
const scoreHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.5rem',
  marginBottom: '0.4rem',
};
const scoreTrackStyle = {
  width: '100%',
  height: '18px',
  borderRadius: 999,
  background: '#111827',
  overflow: 'hidden',
  position: 'relative',
};
const scoreSidesStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '0.28rem',
  fontSize: '0.75rem',
  color: '#9ca3af',
};
const scoreMidLineStyle = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: '50%',
  width: '1px',
  background: '#445063',
  transform: 'translateX(-50%)',
};
const scoreFillStyle = {
  position: 'absolute',
  top: 0,
  height: '100%',
  transition: 'left 220ms ease, width 220ms ease',
  opacity: 0.6,
};
const scorePointerStyle = {
  position: 'absolute',
  top: '-2px',
  bottom: '-2px',
  width: '3px',
  border: '1px solid',
  borderRadius: 999,
  background: '#f9fafb',
  transform: 'translateX(-50%)',
};
const phaseBadgeStyle = {
  border: '1px solid #314255',
  borderRadius: 8,
  background: '#111827',
  padding: '0.45rem 0.55rem',
  marginBottom: '0.8rem',
  fontWeight: 700,
};
const draftOrderWrapStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.3rem',
  marginBottom: '0.8rem',
};
const draftOrderChipStyle = {
  border: '1px solid #2b3b50',
  borderRadius: 999,
  padding: '0.16rem 0.45rem',
  fontSize: '0.75rem',
  color: '#9ca3af',
  background: '#101826',
};
const draftOrderChipActiveStyle = {
  ...draftOrderChipStyle,
  color: '#f9fafb',
  border: '1px solid #0f766e',
  background: '#11322f',
};
const controlsStyle = { display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.9rem' };
const inputStyle = {
  background: '#0b0f14',
  color: '#f3f4f6',
  border: '1px solid #2a3440',
  borderRadius: 6,
  padding: '0.35rem 0.5rem',
  minWidth: 180,
};
const selectStyle = {
  background: '#0b0f14',
  color: '#f3f4f6',
  border: '1px solid #2a3440',
  borderRadius: 6,
  padding: '0.35rem 0.5rem',
};
const primaryButtonStyle = {
  background: '#0f766e',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '0.35rem 0.6rem',
  cursor: 'pointer',
};
const secondaryButtonStyle = {
  background: '#1f2937',
  color: '#f3f4f6',
  border: '1px solid #374151',
  borderRadius: 6,
  padding: '0.35rem 0.6rem',
  cursor: 'pointer',
};
const boardTableStyle = { width: '100%', minWidth: 760, borderCollapse: 'collapse' };
const smallTableStyle = { width: '100%', borderCollapse: 'collapse' };
const tableHeadStyle = {
  border: '1px solid #2b3b50',
  padding: '0.45rem',
  textAlign: 'center',
  background: '#111827',
};
const tableCellStyle = { border: '1px solid #2b3b50', padding: '0.45rem', textAlign: 'center' };
const cardStyle = {
  border: '1px solid #233043',
  borderRadius: 8,
  padding: '0.55rem',
  marginBottom: '0.45rem',
};
const alertCardStyle = { ...cardStyle, background: '#1b1110', border: '1px solid #55322f' };
const chipWrapStyle = { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.4rem' };
const chipStyle = {
  border: '1px solid #2f3b4b',
  borderRadius: 999,
  padding: '0.2rem 0.45rem',
  fontSize: '0.78rem',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
};
const threatBadgeStyle = {
  background: '#7f1d1d',
  color: '#fff',
  borderRadius: 999,
  padding: '0.1rem 0.35rem',
  fontSize: '0.68rem',
};
const mutedTextStyle = { margin: 0, color: '#9ca3af' };
const tinyMutedTextStyle = { color: '#9ca3af', fontSize: '0.82rem' };
const warningTextStyle = { color: '#f59e0b', fontSize: '0.82rem' };
const deltaStyle = {
  borderBottom: '1px solid #1f2937',
  padding: '0.35rem 0',
  fontSize: '0.88rem',
};
const playerButtonStyle = {
  width: '100%',
  textAlign: 'left',
  border: '1px solid #233043',
  borderRadius: 8,
  background: '#0b1220',
  color: '#f3f4f6',
  padding: '0.55rem',
  marginBottom: '0.45rem',
  cursor: 'pointer',
};
const playerButtonActiveStyle = {
  ...playerButtonStyle,
  border: '1px solid #0f766e',
  background: '#0f1d2b',
};
