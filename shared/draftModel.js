import { META_MODES } from './metaPolicy.js';
export const MODEL_VERSION = 'draft-assessment-v3-meta';
export const CORE_TRAITS = ['initiation', 'lockdown', 'waveclear', 'tower', 'save', 'sustain', 'frontline', 'damage'];
export const TRAITS = [...CORE_TRAITS, 'physical', 'magical', 'pure', 'early', 'mid', 'late', 'pickoff', 'teamfight',
  'splitpush', 'siege', 'dispel', 'break', 'bkb_pierce', 'illusion_clear', 'mobility', 'high_farm'];
export const DEFAULT_FORMAT = {
  id: 'league-cm-24-v1', name: 'League CM · 24 actions',
  // A/B denote first/second pick, independently of Radiant/Dire.
  actions: ['AB', 'BB', 'BB', 'AB', 'BB', 'BB', 'AB', 'AP', 'BP', 'AB', 'AB', 'BB',
    'BP', 'AP', 'AP', 'BP', 'BP', 'AP', 'AB', 'BB', 'BB', 'AB', 'AP', 'BP'],
};
export const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
export const rate = (wins, games, baseline = .5, k = 10) => (wins + baseline * k) / (games + k);
const confidence = games => clamp(games / 15);
const evidenceCache = new WeakMap();

export function validateFormat(format) {
  if (!format || !Array.isArray(format.actions) || format.actions.length > 40 || format.actions.length < 10
    || format.actions.some(action => !/^[AB][PB]$/.test(action))) throw new Error('Use AP/BP for picks and AB/BB for bans.');
  for (const side of ['A', 'B']) {
    if (format.actions.filter(action => action === `${side}P`).length !== 5) throw new Error('Each side needs exactly five picks.');
    if (format.actions.filter(action => action === `${side}B`).length > 10) throw new Error('A side can have at most ten bans.');
  }
  return format;
}

export function sequenceFor(config) {
  return validateFormat(config.format || DEFAULT_FORMAT).actions.map((action, index) => ({
    index, side: (action[0] === 'A') === config.firstPick ? 'our' : 'opponent',
    type: action[1] === 'P' ? 'pick' : 'ban',
  }));
}

export function validateBoard(board, config) {
  const sequence = sequenceFor(config), used = new Set(), players = { our: new Set(), opponent: new Set() };
  if (!Array.isArray(board) || board.length > sequence.length) throw new Error('Invalid draft length.');
  for (let i = 0; i < board.length; i++) {
    const entry = board[i], step = sequence[i];
    if (!entry || !Number.isSafeInteger(entry.heroId) || entry.heroId <= 0 || used.has(entry.heroId)) throw new Error('Each hero may only appear once.');
    used.add(entry.heroId);
    if (step.type === 'pick' && entry.playerId) {
      if (!(config.lineups[step.side] || []).some(player => player.id === entry.playerId)) throw new Error('Pick a player from the confirmed lineup.');
      if (players[step.side].has(entry.playerId)) throw new Error('A player cannot have two heroes.');
      players[step.side].add(entry.playerId);
    }
  }
  return sequence;
}

function heroEvidence(data, playerId, heroId) {
  if (!evidenceCache.has(data)) evidenceCache.set(data, new Map());
  const cache = evidenceCache.get(data), key = `${playerId}:${heroId}`;
  if (cache.has(key)) return cache.get(key);
  const hero = data.players[playerId]?.heroes.find(row => row.id === heroId);
  const pub = data.players[playerId]?.publicHeroes.find(row => row.id === heroId);
  const games = hero?.games || 0, publicGames = pub?.games || 0;
  const effectiveGames = hero?.effectiveGames ?? games, practiceGames = hero?.practiceGames ?? games;
  const league = rate(hero?.effectiveWins ?? hero?.wins ?? 0, effectiveGames);
  const publicValue = pub ? rate(pub.weightedWins, pub.weightedGames, pub.baseline, 12) - pub.baseline : 0;
  const publicWeight = data.players[playerId]?.publicFresh ? .25 * confidence(publicGames) : 0;
  // Familiarity is evidence of practice, independent of core/support farm output.
  const fit = clamp(.5 + (league - .5) * .8 + .16 * confidence(practiceGames) + publicWeight * publicValue);
  const result = { fit, games, effectiveGames, practiceGames, wins: hero?.wins || 0, publicGames, publicWeight, known: practiceGames >= 1 || publicWeight > 0 };
  cache.set(key, result); return result;
}

export function assignLineup(picks, lineup, data) {
  if (picks.length > lineup.length) return { valid: false, assignments: [], value: .5, known: 0, samples: 0 };
  let best = null;
  function visit(index, used, assignments, total) {
    if (index === picks.length) {
      if (!best || total > best.total) best = { total, assignments: [...assignments] };
      return;
    }
    const pick = picks[index], roles = data.heroProfiles[pick.heroId]?.roles || [];
    for (const player of lineup) {
      if (used.has(player.id) || (pick.playerId && pick.playerId !== player.id)) continue;
      if (player.role && roles.length && !roles.includes(player.role)) continue;
      const evidence = heroEvidence(data, player.id, pick.heroId);
      used.add(player.id); assignments.push({ heroId: pick.heroId, playerId: player.id, role: player.role, ...evidence });
      visit(index + 1, used, assignments, total + evidence.fit);
      assignments.pop(); used.delete(player.id);
    }
  }
  visit(0, new Set(), [], 0);
  return best ? { valid: true, assignments: best.assignments, value: picks.length ? best.total / picks.length : .5,
    known: best.assignments.filter(a => a.known).length, samples: best.assignments.reduce((s, a) => s + a.effectiveGames, 0) }
    : { valid: false, assignments: [], value: .5, known: 0, samples: 0 };
}

function picksFor(board, sequence, side) {
  return board.flatMap((entry, i) => sequence[i].side === side && sequence[i].type === 'pick' ? [entry] : []);
}

function composition(picks, data) {
  const counts = Object.fromEntries(TRAITS.map(tag => [tag, 0]));
  let classified = 0;
  for (const pick of picks) {
    const tags = data.heroProfiles[pick.heroId]?.tags || [];
    if (tags.length) classified++;
    for (const tag of tags) counts[tag]++;
  }
  return { counts, classified, total: picks.length, unknown: picks.length - classified };
}

const outcomeGames = row => row?.effectiveGames ?? row?.games ?? 0;
const outcomeWins = row => row?.effectiveWins ?? row?.wins ?? 0;
function matchup(heroId, enemies, data) {
  const rows = enemies.map(enemy => data.matchups[`${heroId}:${enemy.heroId}`]).filter(row => outcomeGames(row) >= 5);
  if (!rows.length) return { value: .5, games: 0 };
  return { value: rows.reduce((sum, row) => sum + rate(outcomeWins(row), outcomeGames(row), .5, 20), 0) / rows.length,
    games: rows.reduce((sum, row) => sum + outcomeGames(row), 0) };
}

function synergy(picks, team, data) {
  let total = 0, count = 0;
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
    const key = [picks[i].heroId, picks[j].heroId].sort((a, b) => a - b).join(':');
    const side=Object.keys(data.intelligence || {}).find(s=>data.intelligence[s].teamKey===team);
    const rosterRow=side ? data.intelligence[side].heroPairs[key] : null;
    const row = outcomeGames(rosterRow)>=5 ? rosterRow : data.teams[team]?.pairs?.[key];
    if (outcomeGames(row) >= 5) { total += rate(outcomeWins(row), outcomeGames(row), .5, 20) - .5; count++; }
  }
  return count ? total / count : 0;
}

// Maximum bipartite matching checks that shared comfort heroes can cover distinct players.
export function supportedAssignments(graph) {
  const matched = new Map();
  function visit(id, seen) {
    for (const hero of graph[id] || []) {
      if (seen.has(hero)) continue; seen.add(hero);
      if (!matched.has(hero) || visit(matched.get(hero), seen)) { matched.set(hero,id); return true; }
    }
    return false;
  }
  let count=0; for (const id of Object.keys(graph)) if(visit(id,new Set()))count++;
  return count;
}

export function poolPressure(data, config, board, side, removedHero = null) {
  const sequence=sequenceFor(config), picks=picksFor(board,sequence,side), used=new Set(board.map(r=>r.heroId));
  const ownHeroes=new Set(picks.map(r=>r.heroId)), graph={}, players=[];
  for (const player of config.lineups[side]) {
    const fixed=picks.find(p=>p.playerId===player.id);
    const rolesOk = heroId => !player.role || !data.heroProfiles[heroId]?.roles?.length || data.heroProfiles[heroId].roles.includes(player.role);
    const options=data.heroes.filter(h=>h.id!==removedHero && (!used.has(h.id)||ownHeroes.has(h.id)) && rolesOk(h.id)
      && (!fixed || h.id===fixed.heroId) && !picks.some(p=>p.heroId===h.id && p.playerId && p.playerId!==player.id)
      && (ownHeroes.has(h.id) || heroEvidence(data,player.id,h.id).practiceGames>=2
        || (data.players[player.id]?.publicFresh && heroEvidence(data,player.id,h.id).publicGames>=3))).map(h=>h.id);
    graph[player.id]=options;
    players.push({id:player.id,role:player.role,options:options.length,currentOptions:options.filter(id=>data.players[player.id]?.heroes.find(h=>h.id===id)?.currentGames>0).length,
      heroes:options.slice(0,20),fixed:Boolean(fixed)});
  }
  return { players, graph, supported:supportedAssignments(graph), required:config.lineups[side].length,
    shared:data.heroes.map(h=>({heroId:h.id,players:players.filter(p=>graph[p.id].includes(h.id)).map(p=>p.id)})).filter(h=>h.players.length>=2) };
}

export function banImpact(pressure, heroId) {
  const graph=Object.fromEntries(Object.entries(pressure.graph).map(([id,heroes])=>[id,heroes.filter(h=>h!==heroId)]));
  return {before:pressure.supported,after:supportedAssignments(graph),players:pressure.players.filter(p=>pressure.graph[p.id].includes(heroId)).map(p=>({id:p.id,before:p.options,after:p.options-1}))};
}

export function analyzeDraft(data, config, board = []) {
  const sequence = validateBoard(board, config);
  const picks = Object.fromEntries(['our', 'opponent'].map(side => [side, picksFor(board, sequence, side)]));
  const assigned = Object.fromEntries(['our', 'opponent'].map(side => [side, assignLineup(picks[side], config.lineups[side], data)]));
  const compositions = Object.fromEntries(['our', 'opponent'].map(side => [side, composition(picks[side], data)]));
  const contributions = [];
  // Only compare the same amount of evidence; a lone first pick is not a lead.
  if (picks.our.length && picks.opponent.length) {
    contributions.push({ label: 'Player comfort and practice', delta: 50 * (assigned.our.value - assigned.opponent.value) });
    const pairings = [];
    for (const our of picks.our) for (const enemy of picks.opponent) {
      const row = data.matchups[`${our.heroId}:${enemy.heroId}`];
      if (outcomeGames(row) >= 5) pairings.push(rate(outcomeWins(row), outcomeGames(row), .5, 20) - .5);
    }
    if (pairings.length) contributions.push({ label: 'Historical hero matchups', delta: 20 * pairings.reduce((a, b) => a + b, 0) / pairings.length });
    contributions.push({ label: 'Observed lineup/team hero pairs', delta: 12 * (synergy(picks.our, config.ourTeam, data) - synergy(picks.opponent, config.opponentTeam, data)) });
    if (compositions.our.unknown === 0 && compositions.opponent.unknown === 0) {
      const coverage = side => CORE_TRAITS.filter(tag => compositions[side].counts[tag] > 0).length / CORE_TRAITS.length;
      contributions.push({ label: 'Composition coverage', delta: 6 * (coverage('our') - coverage('opponent')) });
    }
  }
  const totalPicks = picks.our.length + picks.opponent.length;
  const known = assigned.our.known + assigned.opponent.known;
  const coverage = totalPicks ? known / totalPicks : 0;
  const samples = assigned.our.samples + assigned.opponent.samples;
  const confidenceLabel = !totalPicks || !known ? 'Unknown' : coverage < .7 || samples < totalPicks * 5 ? 'Low'
    : totalPicks >= 6 && samples >= totalPicks * 10 ? 'High' : 'Medium';
  const valid = assigned.our.valid && assigned.opponent.valid;
  const score = valid ? Math.round(clamp(50 + contributions.reduce((sum, row) => sum + row.delta, 0), 0, 100)) : null;
  const used = new Set(board.map(row => row.heroId));
  const action = sequence[board.length] || null;
  const target = action?.type === 'ban' ? action.side === 'our' ? 'opponent' : 'our' : action?.side;
  const other = target === 'our' ? 'opponent' : 'our';
  const teamKey = target === 'our' ? config.ourTeam : config.opponentTeam;
  const teamStats = data.teams[teamKey];
  const pressure=Object.fromEntries(['our','opponent'].map(side=>[side,poolPressure(data,config,board,side)]));
  const recommendations = !action ? [] : data.heroes.filter(hero => !used.has(hero.id)).flatMap(hero => {
    const assignment = assignLineup([...picks[target], { heroId: hero.id }], config.lineups[target], data);
    if (!assignment.valid) return [];
    const player = assignment.assignments.at(-1), history = teamStats?.heroes[hero.id];
    const counters = matchup(hero.id, picks[other], data);
    const pickRate = history && teamStats.games ? history.picks / teamStats.games : 0;
    const retainedPickRate = history && outcomeGames(teamStats)>0 ? outcomeGames(history)/outcomeGames(teamStats) : 0;
    const roster = data.players[player.playerId];
    const personalRate = roster?.practiceGames ? player.practiceGames / roster.practiceGames : roster?.games ? player.games / roster.games : 0;
    const publicRate = roster?.publicFresh && roster.publicGames ? player.publicGames / roster.publicGames : 0;
    const likelihood = clamp(.65 * (outcomeGames(teamStats)>0 ? retainedPickRate : personalRate) + .35 * (publicRate || personalRate));
    if (action.type === 'ban' && likelihood === 0) return [];
    const tags = data.heroProfiles[hero.id]?.tags || [];
    const fills = tags.filter(tag => compositions[target].counts[tag] === 0);
    const fit = .65 * player.fit + .25 * counters.value + .1 * (history ? rate(outcomeWins(history), outcomeGames(history)) : .5);
    const impact=action.type==='ban' ? banImpact(pressure[target],hero.id) : null;
    const priority = action.type === 'ban' ? fit * likelihood + .02*(impact.before-impact.after) : clamp(fit + Math.min(.04, fills.length * .01));
    const reasons = [];
    if (player.games) reasons.push(`${roster?.name || player.playerId}: ${player.wins}W/${player.games - player.wins}L on this hero`);
    else reasons.push('No league hero sample for the likely player');
    if (player.games) reasons.push(`${player.effectiveGames.toFixed(1)} retained outcome games after patch and recency adjustments`);
    if (player.publicWeight) reasons.push(`${player.publicGames} public games in the 30-day window`);
    if (history) reasons.push(`Picked in ${history.picks}/${teamStats.games} team games`);
    if (counters.games) reasons.push(`${counters.games.toFixed(1)} retained matchup games; association, not a guaranteed counter`);
    if (fills.length) reasons.push(`Adds ${fills.join(', ')} from your hero profiles`);
    if(impact?.players.length) reasons.push(`Removes a supported option for ${impact.players.length} players; distinct-player coverage ${impact.before} → ${impact.after}/5`);
    return [{ heroId: hero.id, playerId: player.playerId, role: player.role, priority: Math.round(priority * 100),
      confidence: player.effectiveGames >= 10 ? 'High' : player.effectiveGames >= 5 ? 'Medium' : 'Low', reasons,
      pickRate: teamStats?.games ? pickRate : null, assignments: assignment.assignments, banImpact:impact }];
  }).sort((a, b) => b.priority - a.priority || ({ High: 3, Medium: 2, Low: 1 }[b.confidence] - { High: 3, Medium: 2, Low: 1 }[a.confidence]) || a.heroId - b.heroId).slice(0, 8);
  return { sequence, action, picks, assigned, compositions, pressure, score, confidence: confidenceLabel, coverage, contributions, recommendations, valid };
}

export function validateDraftState(state) {
  if (!state || state.version !== 1 || !state.config || !Array.isArray(state.board)) throw new Error('Unsupported saved draft.');
  const c = state.config;
  if (!Number.isSafeInteger(c.seasonId) || !c.ourTeam || !c.opponentTeam || c.ourTeam === c.opponentTeam
    || typeof c.firstPick !== 'boolean' || typeof c.radiant !== 'boolean'
    || !Number.isFinite(Date.parse(c.asOf))) throw new Error('Choose a season, different teams, and a valid data cutoff.');
  if(c.metaMode && !META_MODES.includes(c.metaMode)) throw new Error('Choose adaptive, current patch, or recent evidence.');
  const allIds = new Set();
  for (const side of ['our', 'opponent']) {
    const lineup = c.lineups?.[side];
    if (!Array.isArray(lineup) || lineup.length !== 5) throw new Error('Confirm five players on each side.');
    const roles = new Set();
    for (const player of lineup) {
      if (!Number.isSafeInteger(player.id) || player.id <= 0 || allIds.has(player.id)) throw new Error('Each player must appear once across the two lineups.');
      if (!Number.isInteger(player.role) || player.role < 0 || player.role > 5 || (player.role && roles.has(player.role))) throw new Error('Positions must be unique, or left unknown.');
      allIds.add(player.id); if (player.role) roles.add(player.role);
    }
  }
  validateBoard(state.board, c);
  if (state.undo && (!Array.isArray(state.undo) || state.undo.length > 40)) throw new Error('Invalid undo history.');
  for (const board of state.undo || []) validateBoard(board, c);
  if (state.redo && (!Array.isArray(state.redo) || state.redo.length > 40)) throw new Error('Invalid redo history.');
  for (const board of state.redo || []) validateBoard(board, c);
  return state;
}
