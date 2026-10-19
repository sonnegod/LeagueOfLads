// Interpretable priors, not Elo. Average five shrunk player records so teammates'
// shared wins do not count as five independent team results. Same-season results
// enter the team's own record instead of being counted a second time here.
export const STRENGTH_POLICY=Object.freeze({playerPriorGames:20,leagueWeight:.75,publicWeight:.20,publicPriorGames:40,publicMinGames:20});
const clamp=p=>Math.max(.1,Math.min(.9,p));
const logit=p=>Math.log(p/(1-p));
export const probabilityFromLogit=value=>1/(1+Math.exp(-value));
export const resultAvailableAt=game=>Math.max(Date.parse(game.SourceObservedAtUtc),Date.parse(game.StartedAtUtc)+Number(game.DurationSeconds)*1000);

export function activeLineup(roster,teamKey,at,pendingSlots=[]) {
  const rows=roster.filter(r=>r.TeamSubmissionId===teamKey&&r.FromEstimated===0&&r.EffectiveFromUtc
    &&Date.parse(r.EffectiveFromUtc)<=Date.parse(at)&&(!r.EffectiveToUtc||Date.parse(r.EffectiveToUtc)>Date.parse(at)));
  const pending=pendingSlots.filter(p=>p.TeamSubmissionId===teamKey).map(p=>({TeamSubmissionId:teamKey,Slot:p.Slot,IsPending:true,PlayerId:null}));
  const lineup=[...rows,...pending];
  return lineup.length===5&&new Set(rows.map(r=>r.PlayerId)).size===rows.length&&new Set(lineup.map(r=>r.Slot)).size===5?lineup:null;
}

export function lineupPrior({mmrPrior=.5,lineup,history,seasonId,at,publicFeatures=[]}) {
  if(!lineup)return {probability:mmrPrior,leagueProbability:mmrPrior,mmrPrior,ready:false,publicReady:false};
  const cutoff=Date.parse(at);const byPlayer=new Map(lineup.filter(p=>!p.IsPending).map(p=>[p.PlayerId,[]]));
  for(const game of history)if(byPlayer.has(game.PlayerId)&&game.SeasonId!==seasonId&&resultAvailableAt(game)<cutoff)
    byPlayer.get(game.PlayerId).push(game);
  const records=lineup.map(p=>(p.IsPending?[]:byPlayer.get(p.PlayerId)).sort((a,b)=>resultAvailableAt(a)-resultAvailableAt(b)||a.MatchId-b.MatchId).slice(-100));
  const priors=records.map(games=>(games.reduce((sum,g)=>sum+g.Won,0)+STRENGTH_POLICY.playerPriorGames*.5)/(games.length+STRENGTH_POLICY.playerPriorGames));
  const publicRows=lineup.map(p=>p.IsPending?null:publicFeatures.filter(f=>f.PlayerId===p.PlayerId&&f.QualityStatus==='ready'&&f.FeatureVersion===1
    &&f.SampleCount>=STRENGTH_POLICY.publicMinGames&&Number.isFinite(f.Wins)&&f.Wins>=0&&f.Wins<=f.SampleCount
    &&Date.parse(f.ObservedAtUtc)<cutoff&&Date.parse(f.AsOfUtc)<=Date.parse(f.ObservedAtUtc)&&cutoff-Date.parse(f.AsOfUtc)<48*3600000)
    .sort((a,b)=>Date.parse(b.ObservedAtUtc)-Date.parse(a.ObservedAtUtc))[0]);
  const publicReady=publicRows.every(Boolean);
  const privateSignal=publicReady?publicRows.reduce((sum,f)=>sum+logit((f.Wins+STRENGTH_POLICY.publicPriorGames*.5)/(f.SampleCount+STRENGTH_POLICY.publicPriorGames)),0)/5:0;
  const leagueLogit=logit(clamp(mmrPrior))+STRENGTH_POLICY.leagueWeight*priors.reduce((sum,p)=>sum+logit(p),0)/5;
  return {probability:clamp(probabilityFromLogit(leagueLogit+STRENGTH_POLICY.publicWeight*privateSignal)),
    leagueProbability:clamp(probabilityFromLogit(leagueLogit)),mmrPrior,ready:records.every((games,i)=>lineup[i].IsPending||games.length>=5),publicReady};
}
