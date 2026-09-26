function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function withLiveMatchJson(row) {
  const normalizedPlayers = (row.Players || []).map((player) => ({
    account_id: player.AccountId,
    name: player.PlayerName,
    team: player.Team,
    player_slot: player.PlayerSlot,
    hero_id: player.HeroId,
    kills: player.Kills,
    death: player.Deaths,
    assists: player.Assists,
    last_hits: player.LastHits,
    denies: player.Denies,
    gold: player.Gold,
    level: player.Level,
    gold_per_min: player.GPM,
    xp_per_min: player.XPM,
    net_worth: player.NetWorth,
    respawn_timer: player.RespawnTimer,
    position_x: player.PositionX,
    position_y: player.PositionY,
  }));
  const normalizedDraft = row.Draft || {};
  const radiantPicks = parseJson(normalizedDraft.RadiantPicksJson, []);
  const direPicks = parseJson(normalizedDraft.DirePicksJson, []);
  const radiantBans = parseJson(normalizedDraft.RadiantBansJson, []);
  const direBans = parseJson(normalizedDraft.DireBansJson, []);

  return {
    ...row,
    Players: normalizedPlayers,
    RadiantPicks: radiantPicks,
    DirePicks: direPicks,
    RadiantBans: radiantBans,
    DireBans: direBans,
  };
}

export function toAppLiveMatch(row) {
  const match = withLiveMatchJson(row);
  const players = (match.Players || []).map((player) => ({
    accountId: toNullableNumber(player.account_id),
    name: player.name || null,
    team: toNullableNumber(player.team),
    playerSlot: toNullableNumber(player.player_slot),
    heroId: toNullableNumber(player.hero_id),
    stats: {
      kills: toNullableNumber(player.kills),
      deaths: toNullableNumber(player.death),
      assists: toNullableNumber(player.assists),
      lastHits: toNullableNumber(player.last_hits),
      denies: toNullableNumber(player.denies),
      gold: toNullableNumber(player.gold),
      level: toNullableNumber(player.level),
      gpm: toNullableNumber(player.gold_per_min),
      xpm: toNullableNumber(player.xp_per_min),
      netWorth: toNullableNumber(player.net_worth),
      respawnTimer: toNullableNumber(player.respawn_timer),
    },
    position: {
      x: toNullableNumber(player.position_x),
      y: toNullableNumber(player.position_y),
    },
  }));

  const payload = {
    matchId: toNullableNumber(match.MatchId),
    leagueId: toNullableNumber(match.LeagueId),
    lobbyId: toNullableNumber(match.LobbyId),
    snapshotId: toNullableNumber(match.SnapshotId),
    snapshotHash: match.SnapshotHash || null,
    status: match.SnapshotId ? 'recent' : 'live',
    timestamps: {
      lastUpdated: match.LastUpdated || null,
      createdAt: match.CreatedAt || null,
    },
    teams: {
      radiant: {
        teamId: toNullableNumber(match.RadiantTeamId),
        name: match.RadiantTeamName || null,
        score: toNullableNumber(match.RadiantScore),
        towerState: toNullableNumber(match.RadiantTowerState),
        barracksState: toNullableNumber(match.RadiantBarracksState),
        netWorth: getTeamNetWorth(match.Players || [], 0),
      },
      dire: {
        teamId: toNullableNumber(match.DireTeamId),
        name: match.DireTeamName || null,
        score: toNullableNumber(match.DireScore),
        towerState: toNullableNumber(match.DireTowerState),
        barracksState: toNullableNumber(match.DireBarracksState),
        netWorth: getTeamNetWorth(match.Players || [], 1),
      },
    },
    game: {
      duration: toNullableNumber(match.GameDuration),
      streamDelaySeconds: toNullableNumber(match.StreamDelaySeconds),
    },
    players,
    draft: {
      radiant: {
        picks: normalizeDraftItems(match.RadiantPicks),
        bans: normalizeDraftItems(match.RadiantBans),
      },
      dire: {
        picks: normalizeDraftItems(match.DirePicks),
        bans: normalizeDraftItems(match.DireBans),
      },
    },
  };

  return payload;
}

export function getAppLiveMatchesPayload(db, { includeRecent = true } = {}) {
  const liveMatches = db.getLiveMatchCurrentStates().map((match) => toAppLiveMatch(match));
  const recentMatches = includeRecent
    ? db.getAllRecentLiveMatchSnapshots().map((match) => toAppLiveMatch(match))
    : [];

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      live: liveMatches.length,
      recent: recentMatches.length,
    },
    liveMatches,
    recentMatches,
  };
}

function getTeamNetWorth(players, team) {
  return players.reduce((total, player) => {
    if (Number(player.team) !== team) return total;
    return total + toNumber(player.net_worth, 0);
  }, 0);
}

function normalizeDraftItems(items = []) {
  return items.map((item, index) => ({
    order: index + 1,
    heroId: toNullableNumber(item.hero_id ?? item.HeroId),
  }));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
