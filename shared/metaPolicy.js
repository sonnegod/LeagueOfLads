export const META_POLICY_VERSION = 'meta-transfer-v1';
export const META_MODES = ['adaptive', 'current', 'recent'];
const day = 86400000;
const timestamp = value => Date.parse(value);
const calendars = new WeakMap();
const calendar = patches => {
  if(!calendars.has(patches)) calendars.set(patches,patches.map(p=>({...p,time:timestamp(p.startsAt)})));
  return calendars.get(patches);
};

export function patchAt(patches, date, precise = true) {
  const time = timestamp(date);
  if (!Number.isFinite(time)) return null;
  const dated=calendar(patches);
  let patch=null;
  for(let i=dated.length-1;i>=0;i--) if(dated[i].time<=time){patch=patches[i];break;}
  if (!patch) return null;
  // A date without kickoff time cannot establish which side of a patch boundary it belongs to.
  if (!precise && patches.some(p => p.startsAt.slice(0, 10) === date.slice(0, 10))) return null;
  return patch;
}

export function metaWeight(meta, { date, precise = true, heroes = [], mode = 'adaptive' }) {
  const current = meta.current, historical = patchAt(meta.patches, date, precise);
  const age = Math.max(0, (timestamp(meta.asOf) - timestamp(date)) / day);
  if (!Number.isFinite(age)) return { outcome: 0, practice: 0, patch: null, unknown: true, resets: 0 };
  let outcome = 2 ** (-age / 60), practice = 2 ** (-age / 365), resets = 0;
  if (!historical || !current) {
    // Unknown patch identity is not evidence that old results transfer to today's game.
    return { outcome: mode === 'adaptive' ? outcome * .1 : 0, practice: practice * .5, patch: historical?.key || null, unknown: true, resets };
  }
  if (mode === 'current' && historical.key !== current.key) outcome = 0;
  if (mode === 'recent' && age > 30) outcome = 0;
  const historicalTime=timestamp(historical.startsAt), currentTime=timestamp(current.startsAt);
  for (const boundary of calendar(meta.patches)) {
    if (boundary.time <= historicalTime || boundary.time > currentTime) continue;
    const global = meta.overrides?.[`${boundary.key}:0`];
    let transfer = global?.transfer ?? (boundary.major ? .35 : .9);
    let heroTransfer = 1;
    for (const hero of heroes) {
      const override = meta.overrides?.[`${boundary.key}:${hero}`];
      const change = boundary.heroes?.[hero];
      const value = override?.transfer ?? (change === 'reset' ? 0 : change === 'changed' ? .45 : boundary.notesKnown ? .97 : .65);
      heroTransfer = Math.min(heroTransfer, value);
      if (value === 0) resets++;
    }
    transfer *= heroTransfer;
    outcome *= transfer;
    // Mechanical resets reduce retained practice, without claiming the player forgot Dota.
    practice *= heroTransfer === 0 || transfer === 0 ? .2 : .98;
  }
  return { outcome, practice, patch: historical.key, unknown: false, resets };
}

export function summarizeSignal(records) {
  let games = 0, wins = 0, effectiveGames = 0, effectiveWins = 0, practiceGames = 0, currentGames = 0, unknownGames = 0;
  for (const row of records) {
    games++; wins += Number(row.won); effectiveGames += row.weight.outcome;
    effectiveWins += row.weight.outcome * Number(row.won); practiceGames += row.weight.practice;
    if (row.current) currentGames++; if (row.weight.unknown) unknownGames++;
  }
  return { games, wins, effectiveGames, effectiveWins, practiceGames, currentGames, unknownGames };
}
