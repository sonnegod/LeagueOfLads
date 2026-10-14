export const ODDS_SCALE=1000000;
export function toPointCents(value) {
  const text=String(value);
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text))return null;
  const [whole,fraction='']=text.split('.');const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  return cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents):null;
}
export function exactPayoutCents(stakeCents,legs) {
  let numerator=BigInt(stakeCents),denominator=1n;
  for(const leg of legs) {
    if(leg.Result==='pending')return null;
    if(leg.Result==='lost')return 0;
    if(leg.Result==='void')continue;
    numerator*=BigInt(leg.AcceptedMicros);denominator*=BigInt(ODDS_SCALE)*BigInt(leg.Divisor||1);
  }
  const result=numerator/denominator;
  return result<=BigInt(Number.MAX_SAFE_INTEGER)?Number(result):null;
}
export function quotedReturn(stake,odds) {
  const cents=toPointCents(stake);if(cents===null)return null;
  const payout=exactPayoutCents(cents,odds.map(price=>({Result:'won',AcceptedMicros:Math.round(price*ODDS_SCALE),Divisor:1})));
  return payout===null?null:payout/100;
}
