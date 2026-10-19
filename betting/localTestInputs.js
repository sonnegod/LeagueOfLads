import {readPreseasonPreviewHistory} from '../analytics/preseasonHistory.js';
import {signupTeamPricingInputs,PRESEASON_MODEL_VERSION} from './signupPreseasonPreview.js';
import {localBettingTestMode} from './localTestPolicy.js';

// Only the background worker builds this private bundle. Source facts retained
// by the engine still drive result verification and settlement without overrides.
export function buildLocalTestInputs(league,inputs,now,{env=process.env,readHistory=readPreseasonPreviewHistory}={}) {
  if(!localBettingTestMode(env))throw new Error('Local betting tests are disabled');
  const history=readHistory(league,{excludeLeagueId:inputs.season.LeagueId,now,seasons:3});
  const eligible=history.history.filter(g=>g.LeagueId!==inputs.season.LeagueId&&['regular','playoff'].includes(g.Stage)
    &&Number.isFinite(Date.parse(g.SourceObservedAtUtc))&&Date.parse(g.SourceObservedAtUtc)<=now.getTime()
    &&g.DurationSeconds>0&&Date.parse(g.StartedAtUtc)+g.DurationSeconds*1000<now.getTime())
    .sort((a,b)=>a.StartedAtUtc.localeCompare(b.StartedAtUtc)||a.MatchId-b.MatchId||a.PlayerId-b.PlayerId);
  const teams=inputs.teams.map(t=>({...t,ActualTeamId:t.TeamId,TeamId:t.TeamSubmissionId}));
  return {modelVersion:PRESEASON_MODEL_VERSION,historyReports:history.reports,
    ...signupTeamPricingInputs({...inputs,teams},eligible,now.toISOString())};
}
