export const PRICE_POLICY = Object.freeze({ margin: .10, movement: .10, liquidityPoints: 10000 });
export function configuredPricePolicy(env=process.env) {
  const margin=env.BETTING_ODDS_REDUCTION===undefined?PRICE_POLICY.margin:Number(env.BETTING_ODDS_REDUCTION);
  if(!Number.isFinite(margin)||margin<0||margin>.30)throw new Error('BETTING_ODDS_REDUCTION must be between 0 and 0.30');
  return Object.freeze({...PRICE_POLICY,margin});
}
export const ODDS_SCALE = 1000000;
export function anchorPrice(probability, margin = PRICE_POLICY.margin) {
  if (!(probability > 0 && probability < 1)) throw new Error('A market probability must be between zero and one');
  return Math.max(1010000, Math.round((1 - margin) / probability * ODDS_SCALE / 10000) * 10000);
}
export function movedPrices(selections, stakes, policy = PRICE_POLICY) {
  const total = stakes.reduce((sum, n) => sum + n, 0);
  if (!total) return selections.map(s => s.AnchorMicros);
  const weight = Math.min(.15, total / (total + policy.liquidityPoints));
  const quote = t => selections.map((s, i) => {
    const p = s.Probability + t * ((stakes[i] / total) - s.Probability);
    const low = Math.max(1010000, Math.ceil(s.AnchorMicros * (1 - policy.movement)));
    const high = Math.floor(s.AnchorMicros * (1 + policy.movement));
    const raw = (1 - policy.margin) / p * ODDS_SCALE;
    return { raw, low, high };
  });
  let lo = 0; let hi = weight;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (quote(t).every(q => q.raw >= q.low && q.raw <= q.high)) lo = t; else hi = t;
  }
  return quote(lo).map(q => Math.max(Math.ceil(q.low/10000)*10000,
    Math.min(Math.floor(q.high/10000)*10000,Math.round(q.raw/10000)*10000)));
}

export function seriesDistribution(p, bestOf) {
  if (!(p > 0 && p < 1) || ![1,2,3,5].includes(bestOf)) throw new Error('Invalid series model');
  const outcomes = [];
  const walk = (a, b, probability) => {
    const done = bestOf === 2 ? a + b === 2 : a === (bestOf + 1) / 2 || b === (bestOf + 1) / 2;
    if (done) { const key = `${a}-${b}`; const previous = outcomes.find(o => o.key === key);
      if (previous) previous.probability += probability; else outcomes.push({ key, a, b, probability }); return; }
    walk(a + 1, b, probability * p); walk(a, b + 1, probability * (1 - p));
  };
  walk(0, 0, 1); return outcomes;
}
