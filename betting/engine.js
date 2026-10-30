import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readSeasonBettingInputs } from '../analytics/bettingInputs.js';
import { digest } from './scheduleStore.js';
import { normalizeLeagueRules } from '../config/leagueRules.js';
import {plannedGames,plannedGameCounts,gameCountsChanged} from './seasonFormat.js';
import {localBettingTestMode} from './localTestPolicy.js';
import { currentSeasonRoster, conflictingRosterPlayers } from './rosterMembership.js';
import { currentPendingSlots } from '../config/pendingRosterSlots.js';
import { HISTORICAL_PRICING_VERSION, historicalSourceFingerprint } from './historicalPricing.js';
import { marketHasClosed } from './marketTiming.js';
import {mergePlayerMetricHistory,PLAYER_FORM_VERSION} from './playerForm.js';
import {readRosterOrder} from '../config/rosterDisplayOrder.js';
import { MODEL_VERSION,LEADER_FIELD_VERSION,METRICS,metricLabel,seededRandom,validateBaseline,validateLineupModel,validateStatDistributions,seriesForecast,statForecast,leaderForecast,eligibleLeaderRoster,simulateSeason,seasonWinsForecast } from './models.js';

const allVoid = (book,market,reason) => book.void(market.MarketId,reason);
const overUnder = (value,line) => value===line ? {over:{result:'void'},under:{result:'void'}}
  : {over:{result:value>line?'won':'lost'},under:{result:value<line?'won':'lost'}};
const hasTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
function holdResult(book,market,selections,reason) {
  if(['settled','void'].includes(market.Status))book.settle(market.MarketId,Object.fromEntries(selections.map(s=>[s.OutcomeKey,{result:'pending'}])),{reason});
}
function setupMatchesSource(league,setup) {
  if(!setup)return false;const expected=JSON.parse(setup.SetupJson);
  const season=league.prepare('SELECT Status,ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(setup.SeasonId);
  const teams=league.prepare('SELECT TeamSubmissionId,ExternalTeamId,GroupId FROM SeasonTeams WHERE SeasonId=? ORDER BY TeamSubmissionId').all(setup.SeasonId)
    .map(t=>({TeamSubmissionId:t.TeamSubmissionId,GroupId:['active','ended'].includes(season.Status)&&hasTable(league,'LeagueRosterEntries')
      ?league.prepare('SELECT GroupId FROM LeagueRosterEntries WHERE LeagueId=? AND (TeamSubmissionId=? OR TeamId=?) ORDER BY EntryId LIMIT 1')
        .get(season.ExternalLeagueId,t.TeamSubmissionId,t.ExternalTeamId)?.GroupId||null:t.GroupId}));
  const live=season.ExternalLeagueId&&hasTable(league,'LeagueRules')?league.prepare('SELECT * FROM LeagueRules WHERE LeagueId=?').get(season.ExternalLeagueId):null;
  const rules=live||league.prepare('SELECT * FROM SeasonLeagueRules WHERE SeasonId=?').get(setup.SeasonId);
  const roster=currentSeasonRoster(league,setup.SeasonId,season.Status);
  return JSON.stringify(teams)===JSON.stringify(expected.teams)&&JSON.stringify(normalizeLeagueRules(rules))===JSON.stringify(normalizeLeagueRules(expected.rules))
    &&JSON.stringify(roster)===JSON.stringify(expected.roster)
    &&JSON.stringify(currentPendingSlots(league,setup.SeasonId))===JSON.stringify(expected.pendingSlots||[]);
}
function regularDataReady(league,inputs,setup,events,{checkMembership=true}={}) {
  if(setup?.RegularSeasonComplete&&Date.parse(setup.UpdatedAtUtc)>Date.parse(inputs.asOf))return false;
  if(checkMembership&&inputs.appearances.some(g=>g.Stage==='regular'&&g.Membership==='unknown'))return false;
  if(hasTable(league,'MatchLeague')) {
    const ids=league.prepare('SELECT DISTINCT MatchId FROM MatchLeague WHERE LeagueId=? AND (? IS NULL OR MatchId<=?)')
      .all(inputs.season.LeagueId,inputs.season.GroupEndMatchId,inputs.season.GroupEndMatchId);
    const official=hasTable(league,'OfficialMatchStatus')?league.prepare('SELECT * FROM OfficialMatchStatus WHERE SeasonId=?').all(inputs.season.SeasonId):[];
    if(ids.some(row=>{
      const classification=official.find(o=>o.MatchId===row.MatchId);
      if(classification?.Status==='abandoned')return false;
      if(classification?.Status==='superseded'&&inputs.games.some(g=>g.MatchId===classification.ReplacementMatchId))return false;
      return !inputs.games.some(g=>g.MatchId===row.MatchId&&(inputs.season.GroupEndMatchId?g.Stage==='regular':true));
    }))return false;
  }
  if(setup?.Completion==='normal')for(const team of inputs.teams) {
    const actual=inputs.teamStats.filter(s=>s.TeamSubmissionId===team.TeamSubmissionId&&s.Stage==='regular').reduce((n,s)=>n+s.GamesPlayed,0);
    const forfeited=events.filter(e=>e.Stage==='regular'&&e.Status==='forfeit'&&[e.Team1Key,e.Team2Key].includes(team.TeamSubmissionId)).length*2;
    if(actual+forfeited<plannedGames(setup,team.TeamSubmissionId))return false;
  }
  return true;
}

export function fixtureGuard(league,eventId,market,now=new Date(),env=process.env) {
  if(!eventId)return null;
  const event=league.prepare('SELECT * FROM ScheduledEvents WHERE EventId=?').get(eventId);
  if(event?.SourceMessageId?.startsWith('local-test:')&&!localBettingTestMode(env))return 'Local test fixtures are disabled';
  if(!event||event.Status!=='scheduled'||event.StartedAtUtc||Date.parse(event.ScheduledStartUtc)<=now.getTime()) return 'This fixture is closed or awaiting review';
  if(event.Revision!==market.EventRevision)return 'Schedule changed; updated markets are pending';
  const season=league.prepare('SELECT ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(event.SeasonId);
  const ids=[event.Team1Key,event.Team2Key].map(key=>league.prepare('SELECT ExternalTeamId FROM SeasonTeams WHERE TeamSubmissionId=?').get(key)?.ExternalTeamId);
  if(ids.every(Boolean)&&hasTable(league,'LiveMatchCurrentState')) {
    const live=league.prepare(`SELECT 1 FROM LiveMatchCurrentState WHERE LeagueId=? AND
      ((RadiantTeamId=? AND DireTeamId=?) OR (RadiantTeamId=? AND DireTeamId=?)) LIMIT 1`)
      .get(season.ExternalLeagueId,ids[0],ids[1],ids[1],ids[0]);
    if(live)return 'The fixture has already started';
  }
  if(event.SeriesId&&hasTable(league,'SeriesMatch')&&league.prepare('SELECT 1 FROM SeriesMatch WHERE SeriesId=? LIMIT 1').get(event.SeriesId))return 'The fixture has already started';
  return null;
}

function preseasonWindow(league,seasonId,now,env,events=null) {
  const includeLocalTests=localBettingTestMode(env);
  const regular=(events||league.prepare('SELECT * FROM ScheduledEvents WHERE SeasonId=?').all(seasonId))
    .filter(e=>e.Stage==='regular'&&(includeLocalTests||!e.SourceMessageId?.startsWith('local-test:'))
      &&!['cancelled','forfeit','replaced'].includes(e.Status));
  const closed={closed:true,closeAt:null};
  if(regular.some(e=>e.StartedAtUtc||['started','completed'].includes(e.Status)))return closed;
  const leagueId=league.prepare('SELECT ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(seasonId)?.ExternalLeagueId;
  if(leagueId) {
    // Actual play can precede the saved schedule or arrive without a fixture.
    if(hasTable(league,'MatchLeague')&&league.prepare('SELECT 1 FROM MatchLeague WHERE LeagueId=? LIMIT 1').get(leagueId))return closed;
    if(hasTable(league,'LiveMatchCurrentState')&&league.prepare('SELECT 1 FROM LiveMatchCurrentState WHERE LeagueId=? LIMIT 1').get(leagueId))return closed;
    if(hasTable(league,'SeriesInfo')&&hasTable(league,'SeriesMatch')&&league.prepare(`SELECT 1 FROM SeriesInfo s JOIN SeriesMatch m ON m.SeriesId=s.SeriesId
      WHERE s.LeagueId=? AND s.Stage='g' LIMIT 1`).get(leagueId))return closed;
  }
  const first=regular.sort((a,b)=>a.ScheduledStartUtc.localeCompare(b.ScheduledStartUtc))[0];
  if(first&&fixtureGuard(league,first.EventId,{EventRevision:first.Revision},now,env))return closed;
  return {closed:false,closeAt:first?.ScheduledStartUtc||null};
}

// Refunds do not need fresh analytical inputs. They do need authoritative start
// checks; a pending refresh or a newer fixture revision alone must not block them.
export function cancellationGuard(league,market,now=new Date(),env=process.env) {
  const season=league.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(market.SeasonId);
  if(!season||!['active','signup_closed'].includes(season.Status))return 'This season is closed';
  if(market.EventId){
    const event=league.prepare('SELECT Revision FROM ScheduledEvents WHERE EventId=?').get(market.EventId);
    return fixtureGuard(league,market.EventId,{...market,EventRevision:event?.Revision},now,env);
  }
  return preseasonWindow(league,market.SeasonId,now,env).closed?'The season has started; preseason tickets cannot be cancelled':null;
}

export function seasonGuard(league,analyticsPath,seasonId,market,now=new Date(),sourceState=null,env=process.env) {
  const marketRules=JSON.parse(market.RulesJson||'{}');
  const localMarket=marketRules.localTesting===true;
  const historicalMarket=marketRules.historicalPricing?.version===HISTORICAL_PRICING_VERSION;
  const frozenPreseason=marketRules.frozenPreseason?.version===1&&marketRules.frozenPreseason.localTesting===localMarket;
  if(localMarket&&!localBettingTestMode(env))return 'Local test markets are disabled';
  const read=(key,fn)=>{
    if(!sourceState)return fn();sourceState.reads??=new Map();
    if(!sourceState.reads.has(key))sourceState.reads.set(key,fn());return sourceState.reads.get(key);
  };
  const table=name=>read(`table:${name}`,()=>hasTable(league,name));
  const seasonState=read(`season:${seasonId}`,()=>league.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId));
  if(!seasonState||!['active','signup_closed'].includes(seasonState.Status))return 'Betting is closed for this season';
  if(read(`rosterConflicts:${seasonId}`,()=>conflictingRosterPlayers(currentSeasonRoster(league,seasonId,seasonState.Status)).length)) {
    return 'Resolve conflicting roster memberships before betting';
  }
  const currentRoster=read(`roster:${seasonId}`,()=>currentSeasonRoster(league,seasonId,seasonState.Status));
  if(market.MarketType==='player_leader'&&read(`pendingSlots:${seasonId}`,()=>currentPendingSlots(league,seasonId)).length)
    return 'Player-leader markets open after every roster is confirmed';
  if(market.MarketType==='season_player'&&!currentRoster.some(p=>p.PlayerId===market.PlayerId&&p.TeamSubmissionId===market.TeamKey))
    return 'This player is not confirmed on that roster';
  if(market.EventId&&table('BettingRefreshState')) {
    const refresh=read('refresh',()=>league.prepare('SELECT RequestedRevision,CompletedRevision FROM BettingRefreshState WHERE Id=1').get());
    if(refresh.RequestedRevision>refresh.CompletedRevision)return 'Updated markets are being prepared';
  }
  const setup=read(`setup:${seasonId}`,()=>league.prepare('SELECT * FROM SeasonBettingSetup WHERE SeasonId=?').get(seasonId));
  if(setup?.Completion==='canceled')return 'This season was canceled';
  if(market.EventId&&market.MarketType==='player_prop'&&table('TeamRosterMembershipHistory')) {
    const event=league.prepare('SELECT ScheduledStartUtc FROM ScheduledEvents WHERE EventId=?').get(market.EventId);
    const signupVerified=(localMarket||historicalMarket)&&seasonState.Status==='signup_closed'&&setup&&event
      &&Date.parse(setup.FinalizedAtUtc)<=Date.parse(event.ScheduledStartUtc)&&setupMatchesSource(league,setup)
      &&JSON.parse(setup.SetupJson).roster.some(p=>p.TeamSubmissionId===market.TeamKey&&p.PlayerId===market.PlayerId);
    if(event&&!signupVerified&&!league.prepare(`SELECT 1 FROM TeamRosterMembershipHistory WHERE TeamSubmissionId=? AND PlayerId=? AND FromEstimated=0
      AND EffectiveFromUtc<=? AND (EffectiveToUtc IS NULL OR EffectiveToUtc>?) LIMIT 1`).get(market.TeamKey,market.PlayerId,event.ScheduledStartUtc,event.ScheduledStartUtc))return 'Roster membership needs verification';
  }
  if(!market.EventId) {
    if(!setup)return 'Season setup is not finalized';
    if(!read(`setupMatches:${seasonId}`,()=>setupMatchesSource(league,setup)))return 'League setup changed; finalize it before reopening preseason markets';
    const rules=JSON.parse(market.RulesJson);
    if(rules.setupJson&&rules.setupJson!==setup.SetupJson)return 'Season setup changed; preseason markets need rebuilding';
    if(gameCountsChanged(setup,rules.regularGames,['season_player','season_team'].includes(market.MarketType)?market.TeamKey:null))return 'Season setup changed; markets are awaiting review';
    const player=market.PlayerId||(market.OutcomeKey?.startsWith('player:')?Number(market.OutcomeKey.slice(7)):null);
    if(player&&table('SeasonRosterChanges')&&read(`changed:${seasonId}`,()=>new Set(league.prepare("SELECT PlayerId FROM SeasonRosterChanges WHERE SeasonId=? AND Kind='permanent'").all(seasonId).map(r=>r.PlayerId))).has(player))return 'Roster change affects this selection';
    if(read(`preseason:${seasonId}:${Number(localMarket)}`,()=>preseasonWindow(league,seasonId,now,
      localMarket?env:{...env,BETTING_LOCAL_TEST_MODE:'false'})).closed)return 'Preseason betting is closed';
    // Published preseason prices keep their validated generation. Later Analytics
    // timestamps and fixture refreshes do not invalidate that fixed book.
    if(historicalMarket||localMarket||frozenPreseason)return null;
  }
  // A grouped read contains hundreds of quotes. Share only the source watermark
  // within that request; schedule, setup and player guards still run per market.
  const state=localMarket?(sourceState?(sourceState.localTestState??={}):{}):historicalMarket
    ?(sourceState?(sourceState.historicalState??={}):{}):sourceState||{};
  if(!state.loaded)Object.assign(state,readBettingSourceState(league,analyticsPath,now,{localTesting:localMarket,historicalPricing:historicalMarket}),{loaded:true});
  if(state.reason)return state.reason;
  if(historicalMarket&&state.sourceFingerprint!==marketRules.historicalPricing.sourceFingerprint)return 'Updated historical inputs are awaiting new quotes';
  if(JSON.parse(market.RulesJson||'{}').usesPrivatePublic&&state.publicReason)return 'Updated inputs are awaiting new quotes';
  return Date.parse(state.asOf)>Date.parse(market.UpdatedAtUtc)?'Updated analytical inputs are awaiting new quotes':null;
}

function readBettingSourceState(league,analyticsPath,now,{localTesting=false,historicalPricing=false}={}) {
  const held=reason=>({reason});
  if(!existsSync(analyticsPath))return held('Analytical inputs are unavailable');
  const db=new Database(analyticsPath,{readonly:true,fileMustExist:true});
  try {
    const run=db.prepare(`SELECT r.AsOfUtc,r.Scope,s.PublishedRunId FROM AnalyticsState s JOIN AnalyticsRuns r ON r.RunId=s.PublishedRunId WHERE s.Id=1 AND r.Status='complete'`).get();
    if(!run||run.Scope==='legacy_preview'||!Number.isFinite(Date.parse(run.AsOfUtc))||Date.parse(run.AsOfUtc)>now.getTime()||now.getTime()-Date.parse(run.AsOfUtc)>=48*3600000)return held('Analytical inputs need refreshing');
    if(localTesting)return {asOf:run.AsOfUtc,reason:null,publicReason:true};
    // A validated retrospective model consumes completed historical records,
    // not fresh current-season match imports. Canonical roster freshness and
    // historical source revisions still invalidate its quotes.
    if(historicalPricing)return {asOf:run.AsOfUtc,reason:null,publicReason:true,sourceFingerprint:historicalSourceFingerprint(league)};
    const sources=db.prepare('SELECT SourceName,LastSuccessAtUtc,LatestStatus FROM SourceSnapshots WHERE RunId=?').all(run.PublishedRunId);
    const required=sources.filter(s=>['match_history','match_details'].includes(s.SourceName));
    if(required.length!==2||required.some(s=>!Number.isFinite(Date.parse(s.LastSuccessAtUtc))||Date.parse(s.LastSuccessAtUtc)>now.getTime()||now.getTime()-Date.parse(s.LastSuccessAtUtc)>=48*3600000||s.LatestStatus!=='complete'))return held('League source data needs refreshing');
    if(hasTable(league,'SourceLoadRuns'))for(const source of required) {
      const latest=league.prepare('SELECT Status,FinishedAtUtc FROM SourceLoadRuns WHERE SourceName=? ORDER BY SourceRunId DESC LIMIT 1').get(source.SourceName);
      if(latest&&(latest.Status!=='complete'||latest.FinishedAtUtc>source.LastSuccessAtUtc))return held('Updated league data is awaiting new quotes');
    }
    const publicSource=sources.find(s=>s.SourceName==='public_matches');
    let publicReason=!publicSource||publicSource.LatestStatus!=='complete'||!Number.isFinite(Date.parse(publicSource.LastSuccessAtUtc))
      ||Date.parse(publicSource.LastSuccessAtUtc)>now.getTime()||now.getTime()-Date.parse(publicSource.LastSuccessAtUtc)>=48*3600000;
    if(!publicReason&&hasTable(league,'SourceLoadRuns')) {
      const latest=league.prepare("SELECT Status,FinishedAtUtc FROM SourceLoadRuns WHERE SourceName='public_matches' ORDER BY SourceRunId DESC LIMIT 1").get();
      publicReason=!!latest&&(latest.Status!=='complete'||latest.FinishedAtUtc>publicSource.LastSuccessAtUtc);
    }
    return {asOf:run.AsOfUtc,reason:null,publicReason};
  } finally {db.close();}
}

export function verifiedFixtureGames(league,inputs,event) {
  if(!event.SeriesId)return null;
  const source=league.prepare('SELECT * FROM SeriesInfo WHERE SeriesId=?').get(event.SeriesId);
  const teams=[event.Team1Key,event.Team2Key].map(key=>inputs.teams.find(t=>t.TeamSubmissionId===key));
  if(!source||source.LeagueId!==inputs.season.LeagueId||teams.some(t=>!t?.TeamId)
    ||!teams.some(t=>t.TeamId===source.Team1)||!teams.some(t=>t.TeamId===source.Team2))return null;
  const classified=hasTable(league,'OfficialMatchStatus')?league.prepare('SELECT * FROM OfficialMatchStatus WHERE SeasonId=?').all(event.SeasonId):[];
  const rawLinked=league.prepare('SELECT DISTINCT MatchId FROM SeriesMatch WHERE SeriesId=? ORDER BY MatchId').all(event.SeriesId);
  if(rawLinked.some(row=>{const c=classified.find(c=>c.MatchId===row.MatchId);return c?.Status==='superseded'&&!rawLinked.some(r=>r.MatchId===c.ReplacementMatchId);}))return null;
  const linked=rawLinked
    .filter(row=>{const c=classified.find(c=>c.MatchId===row.MatchId);return c?.Status!=='abandoned'&&!(c?.Status==='superseded'&&inputs.games.some(g=>g.MatchId===c.ReplacementMatchId));});
  const games=inputs.games.filter(g=>g.SeriesId===event.SeriesId).sort((a,b)=>(a.StartedAtUtc||'').localeCompare(b.StartedAtUtc||'')||a.MatchId-b.MatchId);
  if(!games.length||games.length!==linked.length||games.length>event.BestOf||games.some(g=>!g.StartedAtUtc||g.Stage!==event.Stage
    ||!teams.some(t=>t.TeamId===g.WinnerTeamId)))return null;
  let a=0,b=0;const target=event.BestOf===2?Infinity:(event.BestOf+1)/2;
  for(let i=0;i<games.length;i++) {
    if(i&&Date.parse(games[i-1].StartedAtUtc)+games[i-1].DurationSeconds*1000>Date.parse(games[i].StartedAtUtc))return null;
    if(games[i].WinnerTeamId===teams[0].TeamId)a++;else b++;
    if(event.BestOf!==2&&(a===target||b===target)&&i!==games.length-1)return null;
  }
  if(event.BestOf===2?games.length!==2:Math.max(a,b)!==target)return null;
  return {games,a,b};
}

export function settleOperationalChanges(book,league,seasonId=null) {
  let count=0;
  const markets=book.db.prepare("SELECT * FROM BettingMarkets WHERE SeasonId>0 AND Status!='void' AND (? IS NULL OR SeasonId=?)").all(seasonId,seasonId);
  for(const market of markets) {
    const event=market.EventId?league.prepare('SELECT Status FROM ScheduledEvents WHERE EventId=?').get(market.EventId):null;
    if(market.EventId&&(!event||['cancelled','forfeit','replaced'].includes(event.Status))) {
      if(book.void(market.MarketId,'fixture_cancelled_forfeited_or_replaced'))count++;continue;
    }
    const setup=league.prepare('SELECT * FROM SeasonBettingSetup WHERE SeasonId=?').get(market.SeasonId);
    if(setup?.Completion==='canceled'&&market.Status!=='settled') {
      if(book.void(market.MarketId,'season_canceled'))count++;continue;
    }
    if(market.EventId||market.Status==='settled')continue;
    const rules=JSON.parse(market.RulesJson);
    if(setup&&(setup.Completion==='shortened'||gameCountsChanged(setup,rules.regularGames,market.TeamKey,{reducedOnly:true}))&&market.Scope==='total') {
      if(book.void(market.MarketId,'season_shortened'))count++;continue;
    }
    if(market.MarketType==='season_team'&&league.prepare("SELECT 1 FROM ScheduledEvents WHERE SeasonId=? AND Stage='regular' AND Status='forfeit' AND (Team1Key=? OR Team2Key=?) AND (?=1 OR SourceMessageId IS NULL OR SourceMessageId NOT LIKE 'local-test:%') LIMIT 1")
      .get(market.SeasonId,market.TeamKey,market.TeamKey,Number(book.localTesting))) {
      if(book.void(market.MarketId,'season_team_forfeit'))count++;continue;
    }
    const changed=league.prepare("SELECT DISTINCT PlayerId FROM SeasonRosterChanges WHERE SeasonId=? AND Kind='permanent'").all(market.SeasonId).map(r=>r.PlayerId);
    if(market.MarketType==='season_player'&&changed.includes(market.PlayerId)) {
      if(book.void(market.MarketId,'permanent_roster_change'))count++;
    }else if(market.MarketType==='player_leader'&&changed.length) {
      const selections=book.db.prepare('SELECT OutcomeKey FROM BettingSelections WHERE MarketId=?').all(market.MarketId);
      const results=Object.fromEntries(selections.map(s=>[s.OutcomeKey,{result:changed.includes(Number(s.OutcomeKey.slice(7)))?'void':'pending'}]));
      if(book.settle(market.MarketId,results,{reason:'permanent_roster_change',players:changed}))count++;
    }
  }
  return count;
}

export function settleSeason(book,league,inputs,setup,events) {
  const markets=book.db.prepare('SELECT * FROM BettingMarkets WHERE SeasonId=? ORDER BY MarketId').all(inputs.season.SeasonId);
  let count=0;
  for(const market of markets) {
    if(market.Status==='void') {
      const latest=book.db.prepare('SELECT EvidenceJson FROM BettingMarketSettlements WHERE MarketId=? ORDER BY Revision DESC LIMIT 1').get(market.MarketId);
      const reason=latest?JSON.parse(latest.EvidenceJson).reason:null;
      if(['fixture_cancelled_forfeited_or_replaced','season_canceled','season_shortened','season_team_forfeit','permanent_roster_change'].includes(reason))continue;
    }
    const selections=book.db.prepare('SELECT OutcomeKey FROM BettingSelections WHERE MarketId=?').all(market.MarketId);
    const rules=JSON.parse(market.RulesJson);
    const outcome=winner=>Object.fromEntries(selections.map(s=>[s.OutcomeKey,{result:s.OutcomeKey===winner?'won':'lost'}]));
    let results=null,evidence=null;
    if(market.EventId) {
      const event=events.find(e=>e.EventId===market.EventId);
      if(!event||['cancelled','forfeit','replaced'].includes(event.Status)) {if(allVoid(book,market,'fixture_cancelled_forfeited_or_replaced'))count++;continue;}
      const verified=verifiedFixtureGames(league,inputs,event);if(!verified) {
        holdResult(book,market,selections,'fixture_result_needs_review');
        continue;
      }
      evidence={eventId:event.EventId,seriesId:event.SeriesId,matchIds:verified.games.map(g=>g.MatchId),score:[verified.a,verified.b]};
      if(market.MarketType==='series_winner')results=outcome(verified.a===verified.b?'draw':verified.a>verified.b?'team1':'team2');
      else if(market.MarketType==='exact_score')results=outcome(`${verified.a}-${verified.b}`);
      else if(market.MarketType==='player_prop') {
        const required=market.Scope==='game'?verified.games.filter((_,i)=>i+1===market.GameNumber):verified.games;
        if(!required.length) {if(allVoid(book,market,'game_not_played'))count++;continue;}
        const appearances=required.map(game=>inputs.appearances.find(g=>g.MatchId===game.MatchId&&g.PlayerId===market.PlayerId&&g.TeamSubmissionId===market.TeamKey));
        if(appearances.some(g=>!g)) {if(allVoid(book,market,'player_missed_required_game'))count++;continue;}
        const column=METRICS[market.StatKey];if(!column||appearances.some(g=>!Number.isFinite(g[column]))) {holdResult(book,market,selections,'metric_needs_review');continue;}
        let value=appearances.reduce((s,g)=>s+g[column],0);if(market.Scope==='average')value/=appearances.length;
        results=overUnder(value,market.Line);evidence.value=value;
      }
    } else {
      if(setup?.Completion==='canceled') {if(market.Status!=='settled'&&allVoid(book,market,'season_canceled'))count++;continue;}
      if(!setup)continue;
      if(gameCountsChanged(setup,rules.regularGames,market.TeamKey,{reducedOnly:true})||setup.Completion==='shortened') {
        if(['season_player','player_leader','season_team'].includes(market.MarketType)&&market.Scope==='total') {if(market.Status!=='settled'&&allVoid(book,market,'season_shortened'))count++;continue;}
      }
      const permanentlyChanged=market.Status!=='settled'&&hasTable(league,'SeasonRosterChanges')?league.prepare("SELECT DISTINCT PlayerId FROM SeasonRosterChanges WHERE SeasonId=? AND Kind='permanent'")
        .all(market.SeasonId).map(r=>r.PlayerId):[];
      if(market.MarketType==='season_player'&&permanentlyChanged.includes(market.PlayerId)) {if(allVoid(book,market,'permanent_roster_change'))count++;continue;}
      if(['season_player','player_leader'].includes(market.MarketType)) {
        if(market.MarketType==='player_leader'&&permanentlyChanged.length&&(!setup.RegularSeasonComplete&&!inputs.season.GroupEndMatchId)) {
          const partial=Object.fromEntries(selections.map(s=>[s.OutcomeKey,{result:permanentlyChanged.includes(Number(s.OutcomeKey.slice(7)))?'void':'pending'}]));
          book.settle(market.MarketId,partial,{reason:'permanent_roster_change',players:permanentlyChanged});
        }
        if(!setup.RegularSeasonComplete&&!inputs.season.GroupEndMatchId)continue;
        if(!regularDataReady(league,inputs,setup,events)) {
          holdResult(book,market,selections,'season_result_needs_review');
          continue;
        }
        const stat=inputs.playerStats.filter(s=>s.Stage==='regular'&&s.Membership==='rostered'&&s.Metric===METRICS[market.StatKey]);
        const value=row=>market.Scope==='total'?row.Total:row.Average;
        if(market.MarketType==='season_player') {
          const row=stat.find(s=>s.PlayerId===market.PlayerId&&s.TeamSubmissionId===market.TeamKey);
          if(!row?.MarketEligible) {if(allVoid(book,market,'player_failed_participation_threshold'))count++;continue;}
          if(!row.MetricComplete||!Number.isFinite(value(row))){holdResult(book,market,selections,'metric_needs_review');continue;}
          results=overUnder(value(row),market.Line);evidence={seasonId:market.SeasonId,value:value(row),games:row.GamesPlayed,teamGames:row.TeamGames};
        } else {
          const roster=rules.roster;const rows=roster.map(p=>({p,row:stat.find(s=>s.PlayerId===p.PlayerId&&s.TeamSubmissionId===p.TeamSubmissionId)}));
          const listed=rules.leaderField===LEADER_FIELD_VERSION;
          const eligible=stat.filter(row=>row.MarketEligible&&(!listed||roster.some(p=>p.PlayerId===row.PlayerId&&p.TeamSubmissionId===row.TeamSubmissionId)
            &&!permanentlyChanged.includes(row.PlayerId)));
          if(eligible.some(row=>!row.MetricComplete||!Number.isFinite(value(row)))||new Set(eligible.map(row=>row.PlayerId)).size!==eligible.length) {holdResult(book,market,selections,'metric_needs_review');continue;}
          const compare=(a,b)=>market.Scope==='total'?a.Total-b.Total:a.Total*b.Samples-b.Total*a.Samples;
          const top=eligible.reduce((best,row)=>!best||compare(row,best)>0?row:best,null);
          const high=top?value(top):null;
          const leaders=top?eligible.filter(row=>compare(row,top)===0).map(row=>row.PlayerId):[];
          results=Object.fromEntries(selections.map(s=>{const playerId=Number(s.OutcomeKey.slice(7));const declared=roster.find(p=>p.PlayerId===playerId);
            const row=declared?stat.find(r=>r.PlayerId===playerId&&r.TeamSubmissionId===declared.TeamSubmissionId):null;
            return [s.OutcomeKey,{result:!row?.MarketEligible||permanentlyChanged.includes(playerId)?'void':leaders.includes(playerId)?'won':'lost',divisor:leaders.includes(playerId)?leaders.length:1}];}));
          evidence={seasonId:market.SeasonId,leaders,metricValue:high,...(listed?{leaderField:rules.leaderField}: {})};
        }
      } else if(market.MarketType==='season_team') {
        if(events.some(e=>e.Stage==='regular'&&e.Status==='forfeit'&&[e.Team1Key,e.Team2Key].includes(market.TeamKey))) {
          if(market.Status!=='settled'&&allVoid(book,market,'season_team_forfeit'))count++;continue;
        }
        if(!setup.RegularSeasonComplete&&!inputs.season.GroupEndMatchId)continue;
        if(!regularDataReady(league,inputs,setup,events,{checkMembership:false})) {
          holdResult(book,market,selections,'season_result_needs_review');continue;
        }
        const row=inputs.teamStats.find(s=>s.TeamSubmissionId===market.TeamKey&&s.Stage==='regular');
        if(market.StatKey!=='wins'||!row||!Number.isInteger(row.Wins)||!Number.isInteger(row.Losses)
          ||row.Wins<0||row.Losses<0||row.Wins+row.Losses!==row.GamesPlayed||row.GamesPlayed!==rules.regularGames) {
          holdResult(book,market,selections,'season_team_result_needs_review');continue;
        }
        results=overUnder(row.Wins,market.Line);evidence={seasonId:market.SeasonId,teamKey:market.TeamKey,value:row.Wins,games:row.GamesPlayed};
      } else if(market.MarketType==='champion') {
        const champion=league.prepare('SELECT ChampionTeamId,Status FROM LeagueSeasons WHERE SeasonId=?').get(market.SeasonId);
        const official=champion?.Status==='ended'&&inputs.teams.find(t=>t.TeamId===champion.ChampionTeamId);
        if(official) {results=outcome(`team:${official.TeamSubmissionId}`);evidence={champion:official.TeamSubmissionId};}
        else if(inputs.season.Status==='ended') {if(allVoid(book,market,'official_outcome_unresolved'))count++;continue;}
      } else if(market.MarketType==='placement') {
        const official=league.prepare("SELECT OutcomeValue FROM BettingOfficialOutcomes WHERE SeasonId=? AND OutcomeType='placement' AND TeamSubmissionId=?").get(market.SeasonId,market.TeamKey);
        if(official){results=outcome(official.OutcomeValue);evidence={placement:official.OutcomeValue,teamKey:market.TeamKey};}
        else if(inputs.season.Status==='ended'){if(allVoid(book,market,'official_outcome_unresolved'))count++;continue;}
      }
    }
    if(results&&book.settle(market.MarketId,results,evidence))count++;
  }
  return count;
}

export function runBetting({book,league,analytics,schedules,seasonId=null,now=new Date(),simulations=2000,
  lookaheadDays=Number(process.env.BETTING_FIXTURE_LOOKAHEAD_DAYS||7),localTestInputBuilder=null,historicalInputBuilder=null,lockOwner=null,
  preservePreseason=false,refreshSavedInputs=false}) {
  const localTesting=localBettingTestMode(book.env);
  if(localTesting!==book.localTesting)throw new Error('Betting test mode changed; reopen the correct database');
  if(localTesting&&typeof localTestInputBuilder!=='function')throw new Error('Local test pricing inputs are required');
  if(!Number.isInteger(lookaheadDays)||lookaheadDays<1||lookaheadDays>60)throw new Error('BETTING_FIXTURE_LOOKAHEAD_DAYS must be between 1 and 60');
  const owner=lockOwner||book.acquireLock();
  if(!owner)throw Object.assign(new Error('Another betting worker is running'),{code:'BETTING_WORKER_BUSY'});
  if(lockOwner&&!book.db.prepare('SELECT 1 FROM BettingWorkerLock WHERE Id=1 AND Owner=?').get(lockOwner))throw new Error('Betting worker lock was lost');
  const job=Number(book.db.prepare("INSERT INTO BettingJobs (StartedAtUtc,Status) VALUES (?,'running')").run(now.toISOString()).lastInsertRowid);
  let opened=0,settled=0;const issues=[];
  try {
    schedules.syncRosterHistory();
    settled+=settleOperationalChanges(book,league,seasonId);
    const seasons=league.prepare('SELECT * FROM LeagueSeasons WHERE (? IS NULL OR SeasonId=?) ORDER BY SeasonId').all(seasonId,seasonId);
    for(const season of seasons) {
      book.registerSeason(season);
      const links=schedules.linkPlayedSeries(season.SeasonId,now);
      if(links.needsReview)issues.push('fixture_series_link_needs_review');
      const setup=schedules.setup(season.SeasonId);const events=schedules.list(season.SeasonId,{includeLocalTests:localTesting});
      const savedPreseason=book.db.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=? AND EventId IS NULL AND Status IN ('open','held','locked')").all(season.SeasonId);
      const keepPreseason=preservePreseason&&savedPreseason.length>0;
      if(savedPreseason.length) {
        const window=preseasonWindow(league,season.SeasonId,now,book.env,events),sourceState={};
        book.db.transaction(()=>{
          for(const market of savedPreseason) {
            const originalRules=market.RulesJson;
            const rules=JSON.parse(market.RulesJson);
            if(!rules.frozenPreseason) {
              const forecast=book.db.prepare('SELECT ValidationJson FROM BettingForecasts WHERE ForecastId=?').get(market.ForecastId);
              const approved=forecast&&JSON.parse(forecast.ValidationJson);
              if(approved?.validated&&Boolean(approved.localTesting)===localTesting&&Boolean(rules.localTesting)===localTesting) {
                rules.frozenPreseason={version:1,localTesting};market.RulesJson=JSON.stringify(rules);
              }
            }
            const reason=seasonGuard(league,null,season.SeasonId,market,now,sourceState,book.env);
            const status=window.closed?'locked':reason?'held':'open';
            const closeAt=window.closed?market.CloseAtUtc:window.closeAt??'';
            const changed=market.Status!==status||market.CloseAtUtc!==closeAt;
            if(!changed&&market.HoldReason===reason&&market.RulesJson===originalRules)continue;
            book.db.prepare('UPDATE BettingMarkets SET Status=?,HoldReason=?,CloseAtUtc=?,RulesJson=?,QuoteVersion=QuoteVersion+? WHERE MarketId=?')
              .run(status,reason,closeAt,market.RulesJson,Number(changed),market.MarketId);
            if(changed)book.quoteHistory(market.MarketId);
          }
        })();
      }
      const inputs=readSeasonBettingInputs(analytics,season.SeasonId,now);if(!inputs){if(['active','signup_closed'].includes(season.Status))issues.push('analytics_not_available');continue;}
      const canonicalMetrics=mergePlayerMetricHistory(inputs.metricHistory,[],inputs.season,inputs.asOf);
      inputs.metricHistory=canonicalMetrics;
      if(['active','signup_closed'].includes(season.Status)
        &&conflictingRosterPlayers(currentSeasonRoster(league,season.SeasonId,season.Status)).length) {
        book.db.prepare("UPDATE BettingMarkets SET Status='held',HoldReason='conflicting_roster_memberships' WHERE SeasonId=? AND Status IN ('open','held')").run(season.SeasonId);
        issues.push('conflicting_roster_memberships');continue;
      }
      for(const event of events)if(event.SeriesId&&['scheduled','started'].includes(event.Status)) {
        const verified=verifiedFixtureGames(league,inputs,event);
        if(verified)Object.assign(event,schedules.recordVerifiedCompletion(event.EventId,verified.games[0].StartedAtUtc,now));
      }
      settled+=settleSeason(book,league,inputs,setup,events);
      if(!['active','signup_closed'].includes(season.Status)) {
        book.db.prepare("UPDATE BettingMarkets SET Status='held',HoldReason='season_not_open' WHERE SeasonId=? AND Status='open'").run(season.SeasonId);continue;
      }
      // Scheduled data jobs also prepare inputs for fixtures that arrive later.
      // Routine scheduling jobs can stay idle when no upcoming fixture needs odds.
      if(keepPreseason&&!refreshSavedInputs&&!events.some(event=>event.Status==='scheduled'&&!event.StartedAtUtc
        &&Date.parse(event.ScheduledStartUtc)>now.getTime()&&Date.parse(event.ScheduledStartUtc)<=now.getTime()+lookaheadDays*86400000))continue;
      const publicSource=inputs.sources.find(s=>s.SourceName==='public_matches');
      if(publicSource&&!publicSource.IsStale&&publicSource.LatestStatus==='complete')for(const feature of inputs.privatePlayerFeatures) {
        if(feature.QualityStatus!=='ready'||Date.parse(feature.AsOfUtc)>now.getTime()||now.getTime()-Date.parse(feature.AsOfUtc)>=48*3600000)continue;
        book.db.prepare(`INSERT OR IGNORE INTO BettingPrivateFeatureHistory VALUES (?,?,?,?,?,?,?,?,?)`).run(feature.PlayerId,
          now.toISOString().slice(0,10),now.toISOString(),feature.AsOfUtc,feature.WindowStartUtc,feature.SampleCount,feature.Wins,feature.QualityStatus,feature.FeatureVersion);
      }
      const publicRows=book.db.prepare('SELECT * FROM BettingPrivateFeatureHistory WHERE ObservedAtUtc<=? ORDER BY ObservedAtUtc DESC LIMIT 100001').all(now.toISOString());
      inputs.publicFeatureHistory=publicRows.length<=100000?publicRows:[];
      const leagueValidation=validateBaseline(inputs.history),rosterValidation=validateBaseline(inputs.history,inputs.historyTeams,'roster');
      const lineupValidation=validateLineupModel(inputs),publicValidation=validateLineupModel(inputs,{includePublic:true});
      const lineupReady=rosterValidation.validated&&lineupValidation.validated;
      const usePublic=lineupReady&&publicValidation.validated&&publicSource&&!publicSource.IsStale&&publicSource.LatestStatus==='complete';
      inputs.modelMode=lineupReady?(usePublic?'lineup_public':'lineup'):rosterValidation.validated?'roster':'league';
      let validation={...(lineupReady?(usePublic?publicValidation:lineupValidation):rosterValidation.validated?rosterValidation:leagueValidation),
        candidates:{league:leagueValidation,roster:rosterValidation,lineup:lineupValidation,lineup_public:publicValidation}};
      validation.statDistributions=validateStatDistributions(inputs.metricHistory);
      const requiredSources=inputs.sources.filter(s=>['match_history','match_details'].includes(s.SourceName));
      let sourceReady=requiredSources.length===2&&requiredSources.every(s=>!s.IsStale&&s.LatestStatus==='complete')
        &&Number.isFinite(Date.parse(inputs.asOf))&&Date.parse(inputs.asOf)<=now.getTime()&&now.getTime()-Date.parse(inputs.asOf)<48*3600000;
      const needsHistoricalTeam=!validation.validated||inputs.modelMode==='league'
        &&inputs.teams.some(t=>!inputs.teamStats.some(s=>s.TeamSubmissionId===t.TeamSubmissionId&&s.GamesPlayed>=5));
      const historicalPlayerQuotes=book.db.prepare(`SELECT 1 FROM BettingMarkets WHERE SeasonId=?
        AND MarketType='player_prop' AND json_extract(RulesJson,'$.historicalPricing.version')=? LIMIT 1`)
        .get(season.SeasonId,HISTORICAL_PRICING_VERSION);
      const needsHistoricalStats=!!historicalPlayerQuotes||Object.values(validation.statDistributions).some(stat=>!stat.validated);
      if(!localTesting&&historicalInputBuilder&&(needsHistoricalTeam||needsHistoricalStats)) {
        const historical=historicalInputBuilder(inputs,now);
        if(historical) {
          const candidates={...validation.candidates,historical:historical.validation};
          if(historical.validation.validated) {
            inputs.metricHistory=mergePlayerMetricHistory(canonicalMetrics,historical.metricHistory,inputs.season,inputs.asOf);
            const pricing={version:historical.modelVersion,sourceFingerprint:historical.sourceFingerprint};
            if(needsHistoricalTeam) {
              inputs.modelMode=historical.modelMode;
              inputs.preseasonTeamPriors=historical.preseasonTeamPriors;
              inputs.historicalPricing=pricing;
              validation={...historical.validation,candidates};
              sourceReady=Number.isFinite(Date.parse(inputs.asOf))&&Date.parse(inputs.asOf)<=now.getTime()
                &&now.getTime()-Date.parse(inputs.asOf)<48*3600000;
            } else {
              // A validated team model does not establish player-stat readiness.
              // Keep its team odds while retaining the approved historical props.
              inputs.historicalStatPricing=pricing;
              inputs.historicalStatValidation=historical.validation;
              inputs.preseasonTeamPriors=historical.preseasonTeamPriors;
              validation={...validation,candidates,statDistributions:historical.validation.statDistributions};
            }
          } else if(!validation.validated)validation={...historical.validation,candidates};
          else if(needsHistoricalStats&&historical.validation.reason)issues.push(historical.validation.reason);
        }
        if(historicalPlayerQuotes&&!historical?.validation?.validated) {
          // Do not replace approved historical props with pooled-only guesses
          // when their required history cannot currently be validated.
          validation={...validation,statDistributions:Object.fromEntries(Object.entries(validation.statDistributions)
            .map(([stat,report])=>[stat,{...report,validated:false}]))};
        }
      }
      if(localTesting) {
        const testInputs=localTestInputBuilder(inputs,now);
        inputs.modelMode='preseason_candidate';inputs.metricHistory=testInputs.metricHistory;
        inputs.preseasonTeamPriors=testInputs.preseasonTeamPriors;inputs.preseasonDistributions=testInputs.preseasonDistributions;
        inputs.localTestModelVersion=testInputs.modelVersion;inputs.localTesting=true;
        validation={validated:true,localTesting:true,productionApproved:false,reason:'local_test_only',
          modelVersion:testInputs.modelVersion,statDistributions:Object.fromEntries(Object.keys(METRICS).map(stat=>[stat,
            {validated:Object.values(testInputs.preseasonDistributions.players).some(p=>!!p[stat]),localTesting:true}]))};
        sourceReady=Number.isFinite(Date.parse(inputs.asOf))&&Date.parse(inputs.asOf)<=now.getTime()
          &&now.getTime()-Date.parse(inputs.asOf)<48*3600000;
        issues.push('local_test_only');
      }
      const seasonRoster=currentSeasonRoster(league,season.SeasonId,season.Status);
      // These are today's declared positions only; never label older matches
      // from a roster order that may have changed since they were played.
      inputs.currentPositions=season.Status==='active'?seasonRoster.map(player=>{
        const order=readRosterOrder(league,player.TeamSubmissionId),position=order.indexOf(player.Slot)+1;
        return {playerId:player.PlayerId,teamKey:player.TeamSubmissionId,position:position||null,
          role:position?position<=3?'core':'support':null,source:'current_roster_order'};
      }):[];
      const preseason=preseasonWindow(league,season.SeasonId,now,book.env,events);
      const existing=book.db.prepare("SELECT * FROM BettingMarkets WHERE SeasonId=? AND Status IN ('open','held','locked')").all(season.SeasonId);
      for(const m of existing) {
        if(keepPreseason&&!m.EventId)continue;
        const event=m.EventId&&events.find(e=>e.EventId===m.EventId);
        const started=event&&fixtureGuard(league,event.EventId,m,now,book.env)==='The fixture has already started';
        const closed=m.Status==='locked'||marketHasClosed(m,now)||started
          ||!m.EventId&&(preseason.closed||inputs.games.some(g=>g.Stage==='regular'))||event&&(event.StartedAtUtc||event.Status==='started'||event.Status==='completed');
        const pendingLeader=m.MarketType==='player_leader'&&inputs.pendingSlots.length>0;
        const absentPlayer=m.MarketType==='season_player'&&!seasonRoster.some(p=>p.PlayerId===m.PlayerId&&p.TeamSubmissionId===m.TeamKey);
        const statNotReady=m.MarketType==='player_prop'&&!validation.statDistributions[m.StatKey]?.validated;
        const held=pendingLeader||absentPlayer||statNotReady||!sourceReady||!validation.validated||event?.Status==='needs_review'||event?.Stage==='tiebreaker';
        book.db.prepare('UPDATE BettingMarkets SET Status=?,HoldReason=? WHERE MarketId=?').run(closed?'locked':held?'held':m.Status,
          pendingLeader?'pending_roster_slots':absentPlayer?'player_not_rostered':held?'source_or_model_not_ready':null,m.MarketId);
        // Removing the kickoff can restore an earlier cached forecast. Closing
        // metadata must still follow today's schedule without changing tickets.
        if(!m.EventId&&!closed&&m.CloseAtUtc!==(preseason.closeAt??'')) {
          book.db.prepare('UPDATE BettingMarkets SET CloseAtUtc=?,QuoteVersion=QuoteVersion+1,UpdatedAtUtc=? WHERE MarketId=?')
            .run(preseason.closeAt??'',now.toISOString(),m.MarketId);
          book.quoteHistory(m.MarketId);
        }
      }
      if(!sourceReady||!validation.validated){if(!sourceReady)issues.push('league_source_not_ready');if(!validation.validated)issues.push(validation.reason);continue;}
      const consumed={inputs,events,setup,preseason};
      const inputHash=digest(consumed);const snapshot=book.db.prepare(`INSERT OR IGNORE INTO BettingInputSnapshots (SeasonId,AnalyticsRunId,AsOfUtc,Digest,InputJson,CreatedAtUtc)
        VALUES (?,?,?,?,?,?)`).run(season.SeasonId,inputs.analyticsRunId,inputs.asOf,inputHash,JSON.stringify(consumed),now.toISOString());
      void snapshot;
      const snapshotId=book.db.prepare('SELECT SnapshotId FROM BettingInputSnapshots WHERE Digest=?').get(inputHash).SnapshotId;
      const upcoming=events.filter(e=>Date.parse(e.ScheduledStartUtc)>now.getTime()&&Date.parse(e.ScheduledStartUtc)<=now.getTime()+lookaheadDays*86400000);
      const modelVersion=inputs.historicalPricing?.version||`${MODEL_VERSION}-${inputs.modelMode}${inputs.historicalStatPricing?'-historical-stats-v1':''}`;
      const forecastKey=digest({inputHash,events,setup,model:modelVersion,playerForm:PLAYER_FORM_VERSION,leaderField:LEADER_FIELD_VERSION,simulations,policy:book.policy,lookaheadDays,upcoming:upcoming.map(e=>e.EventId)});
      if(book.db.prepare('SELECT 1 FROM BettingForecasts WHERE ForecastKey=?').get(forecastKey))continue;
      const semantic=JSON.parse(JSON.stringify({teams:inputs.teams,roster:inputs.roster,stats:inputs.teamStats,metrics:inputs.metricHistory,
        games:inputs.games,mode:inputs.modelMode},(key,value)=>['RunId','SourceObservedAtUtc'].includes(key)?undefined:value));
      const seed=parseInt(digest(semantic).slice(0,8),16);const random=seededRandom(seed);
      const forecastId=Number(book.db.prepare('INSERT INTO BettingForecasts (SnapshotId,ModelVersion,Seed,ValidationJson,ForecastJson,CreatedAtUtc) VALUES (?,?,?,?,?,?)')
        .run(snapshotId,modelVersion,seed,JSON.stringify(validation),'{}',now.toISOString()).lastInsertRowid);
      const fixedLine=(eventId,playerId,stat,scope,gameNumber,regularGames=null)=>book.db.prepare(`SELECT Line,RulesJson FROM BettingMarkets WHERE SeasonId=?
        AND EventId IS ? AND PlayerId=? AND StatKey=? AND Scope=? AND GameNumber IS ?
        AND Status!='void' ORDER BY MarketId DESC`).all(season.SeasonId,eventId,playerId,stat,scope,gameNumber)
        .find(m=>scope!=='total'||eventId||regularGames===JSON.parse(m.RulesJson).regularGames)?.Line??null;
      const forecasts=[],playerForms=new Map();
      const proposals=[];
      const publish=(definition,probabilities,close)=>{
        const historicalPricing=inputs.historicalPricing||(['player_prop','season_player','player_leader'].includes(definition.type)?inputs.historicalStatPricing:null);
        const rules={...definition.rules,...(localTesting?{localTesting:true}:{}),
          ...(!definition.eventId?{frozenPreseason:{version:1,localTesting}}:{}),
          ...(historicalPricing?{historicalPricing}:{})};
        proposals.push({definition:{...definition,rules},probabilities,close});
      };
      for(const event of upcoming) {
        if(event.Stage==='tiebreaker')continue;
        if(event.Status!=='scheduled'||event.StartedAtUtc||Date.parse(event.ScheduledStartUtc)<=now.getTime())continue;
        if(fixtureGuard(league,event.EventId,{EventRevision:event.Revision},now,book.env))continue;
        const teams=[event.Team1Key,event.Team2Key].map(key=>inputs.teams.find(t=>t.TeamSubmissionId===key));if(teams.some(t=>!t))continue;
        const sparse=teams.some(t=>!inputs.teamStats.some(s=>s.TeamSubmissionId===t.TeamSubmissionId&&s.GamesPlayed>=5));
        if(sparse&&inputs.modelMode==='league'){issues.push('new_team_roster_prior_not_validated');continue;}
        if(!['league','historical_roster'].includes(inputs.modelMode)&&teams.some(t=>!Number.isFinite(t.AverageSignupMMR))){issues.push('roster_prior_missing');continue;}
        const prediction=seriesForecast(inputs,event);forecasts.push({eventId:event.EventId,...prediction});
        const def={seasonId:season.SeasonId,eventId:event.EventId,eventRevision:event.Revision,stage:event.Stage,bestOf:event.BestOf,
          rules:{usesPrivatePublic:inputs.modelMode==='lineup_public'}};
        publish({...def,type:'series_winner',title:`${teams[0].TeamName} vs ${teams[1].TeamName} — Series result`},prediction.winner.map(p=>({...p,
          label:p.key==='draw'?'Draw':teams[p.key==='team1'?0:1].TeamName})),event.ScheduledStartUtc);
        publish({...def,type:'exact_score',title:`${teams[0].TeamName} vs ${teams[1].TeamName} — Exact score`},prediction.scores.map(p=>({key:p.key,
          label:`${teams[0].TeamName} ${p.a}–${p.b} ${teams[1].TeamName}`,probability:p.probability})),event.ScheduledStartUtc);
        const signupVerified=(localTesting||inputs.modelMode==='historical_roster')&&season.Status==='signup_closed'&&setup&&setupMatchesSource(league,setup)
          &&Date.parse(setup.FinalizedAtUtc)<=Date.parse(event.ScheduledStartUtc);
        const roster=signupVerified?JSON.parse(setup.SetupJson).roster.filter(p=>[event.Team1Key,event.Team2Key].includes(p.TeamSubmissionId))
          .map(p=>({...p,PlayerName:inputs.roster.find(r=>r.PlayerId===p.PlayerId)?.PlayerName||`Player ${p.PlayerId}`}))
          :inputs.roster.filter(p=>[event.Team1Key,event.Team2Key].includes(p.TeamSubmissionId)&&!p.FromEstimated&&p.EffectiveFromUtc
          &&p.EffectiveFromUtc<=event.ScheduledStartUtc&&(!p.EffectiveToUtc||p.EffectiveToUtc>event.ScheduledStartUtc)
          &&(!(inputs.rosterIntervals||[]).some(r=>r.TeamSubmissionId===p.TeamSubmissionId&&r.PlayerId===p.PlayerId)
            ||inputs.rosterIntervals.some(r=>r.TeamSubmissionId===p.TeamSubmissionId&&r.PlayerId===p.PlayerId&&!r.FromEstimated
              &&r.EffectiveFromUtc<=event.ScheduledStartUtc&&(!r.EffectiveToUtc||r.EffectiveToUtc>event.ScheduledStartUtc))));
        for(const player of roster)for(const stat of Object.keys(METRICS))for(const scope of ['total','average','game']) {
          if(!validation.statDistributions[stat]?.validated)continue;
          if(scope==='total'&&['gpm','xpm'].includes(stat))continue;
          const variants=scope==='game'?Array.from({length:event.BestOf},(_,i)=>i+1):[null];
          for(const gameNumber of variants) {
            const forecast=statForecast(inputs,{playerId:player.PlayerId,teamKey:player.TeamSubmissionId,stat,
              scope:scope==='game'?'average':scope,event:scope==='game'?null:event,games:1,
              line:fixedLine(event.EventId,player.PlayerId,stat,scope,gameNumber)},random,simulations);
            if(!forecast)continue;
            if(forecast.form)playerForms.set(`${player.PlayerId}:${stat}`,{playerId:player.PlayerId,stat,
              position:inputs.currentPositions.find(row=>row.playerId===player.PlayerId&&row.teamKey===player.TeamSubmissionId)?.position||null,...forecast.form});
            publish({...def,type:'player_prop',playerId:player.PlayerId,teamKey:player.TeamSubmissionId,stat,scope,gameNumber,line:forecast.line,
              title:`${player.PlayerName} — ${metricLabel(stat)} ${scope==='game'?`game ${gameNumber}`:scope}`},
              [{key:'over',label:`Over ${forecast.line}`,probability:forecast.over},{key:'under',label:`Under ${forecast.line}`,probability:forecast.under}],event.ScheduledStartUtc);
          }
        }
      }
      const preseasonPriorReady=inputs.modelMode==='historical_roster'||inputs.modelMode!=='league'&&!inputs.teams.some(t=>!Number.isFinite(t.AverageSignupMMR));
      if(!keepPreseason&&setup&&!preseason.closed&&!preseasonPriorReady)issues.push('preseason_roster_prior_not_validated');
      if(!keepPreseason&&preseasonPriorReady&&setup&&!preseason.closed
        &&!inputs.games.some(g=>g.Stage==='regular')&&setup.Completion==='normal'&&setupMatchesSource(league,setup)) {
        const changedPlayers=hasTable(league,'SeasonRosterChanges')?league.prepare("SELECT DISTINCT PlayerId FROM SeasonRosterChanges WHERE SeasonId=? AND Kind='permanent'").all(season.SeasonId).map(r=>r.PlayerId):[];
        const roster=JSON.parse(setup.SetupJson).roster.filter(p=>!changedPlayers.includes(p.PlayerId)).map(p=>({...p,PlayerName:inputs.roster.find(r=>r.PlayerId===p.PlayerId)?.PlayerName||`Player ${p.PlayerId}`}));
        const def={seasonId:season.SeasonId,stage:'regular',setupRevision:setup.Revision,regularGames:plannedGameCounts(setup),roster,
          rules:{setupJson:setup.SetupJson,usesPrivatePublic:inputs.modelMode==='lineup_public'}};
        for(const player of roster)for(const stat of Object.keys(METRICS))for(const scope of ['total','average']) {
          if(!validation.statDistributions[stat]?.validated)continue;
          if(scope==='total'&&['gpm','xpm'].includes(stat))continue;
          const forecast=statForecast(inputs,{playerId:player.PlayerId,teamKey:player.TeamSubmissionId,stat,scope,games:plannedGames(setup,player.TeamSubmissionId),
            line:fixedLine(null,player.PlayerId,stat,scope,null,plannedGames(setup,player.TeamSubmissionId))},random,simulations);
          if(!forecast)continue;
          publish({...def,type:'season_player',playerId:player.PlayerId,teamKey:player.TeamSubmissionId,regularGames:plannedGames(setup,player.TeamSubmissionId),stat,scope,line:forecast.line,
            title:`${player.PlayerName} — Regular-season ${metricLabel(stat)} ${scope}`},[{key:'over',label:`Over ${forecast.line}`,probability:forecast.over},
              {key:'under',label:`Under ${forecast.line}`,probability:forecast.under}],preseason.closeAt);
        }
        for(const [stat,scope] of [['kills','total'],['kills','average'],['gpm','average'],['xpm','average']]) {
          if(!validation.statDistributions[stat]?.validated)continue;
          if(inputs.pendingSlots.length||roster.length!==inputs.teams.length*5)continue;
          const previous=book.db.prepare(`SELECT MarketId,RulesJson FROM BettingMarkets WHERE SeasonId=? AND MarketType='player_leader'
            AND StatKey=? AND Scope=? AND json_extract(RulesJson,'$.leaderField')=? ORDER BY MarketId DESC LIMIT 1`)
            .get(season.SeasonId,stat,scope,LEADER_FIELD_VERSION);
          const field=previous?JSON.parse(previous.RulesJson).roster:eligibleLeaderRoster(inputs,roster,stat);
          const ready=eligibleLeaderRoster(inputs,field,stat).length===field.length&&!field.some(p=>changedPlayers.includes(p.PlayerId));
          const prediction=ready?leaderForecast(inputs,field,stat,scope,plannedGameCounts(setup),random,simulations):null;
          if(prediction)publish({...def,type:'player_leader',stat,scope,roster:field,
            rules:{...def.rules,leaderField:LEADER_FIELD_VERSION},
            title:`Regular-season leader — ${metricLabel(stat)} ${scope} · Among listed players`},prediction,preseason.closeAt);
          else if(previous)book.db.prepare("UPDATE BettingMarkets SET Status='held',HoldReason='leader_field_needs_review' WHERE MarketId=? AND Status IN ('open','held')").run(previous.MarketId);
        }
        const simulated=simulateSeason(inputs,setup,random,simulations);forecasts.push({seasonSimulation:simulated});
        if(simulated)for(const team of inputs.teams) {
          const games=plannedGames(setup,team.TeamSubmissionId);
          const previous=book.db.prepare("SELECT Line,RulesJson FROM BettingMarkets WHERE SeasonId=? AND MarketType='season_team' AND TeamKey=? AND StatKey='wins' AND Status!='void' ORDER BY MarketId DESC")
            .all(season.SeasonId,team.TeamSubmissionId).find(m=>JSON.parse(m.RulesJson).regularGames===games);
          const forecast=seasonWinsForecast(simulated,team.TeamSubmissionId,previous?.Line??null);
          if(forecast)publish({...def,type:'season_team',teamKey:team.TeamSubmissionId,scope:'total',stat:'wins',line:forecast.line,regularGames:games,
            title:`${team.TeamName} — Regular-season wins`,rules:{...def.rules,winsPolicy:'official_played_regular_games_forfeit_refund'}},
            [{key:'over',label:`Over ${forecast.line}`,probability:forecast.over},{key:'under',label:`Under ${forecast.line}`,probability:forecast.under}],preseason.closeAt);
        }
        if(simulated?.champion)publish({...def,type:'champion',title:'League champion',stage:'playoff'},inputs.teams.map(t=>({key:`team:${t.TeamSubmissionId}`,
          label:t.TeamName,probability:simulated.champion[t.TeamSubmissionId]})),preseason.closeAt);
        else issues.push('champion_format_not_supported');
        if(simulated?.placement)for(const team of inputs.teams) {
          const buckets=Object.entries(simulated.placement[team.TeamSubmissionId]).filter(([,p])=>p>0&&p<1);
          if(buckets.length>=2&&Math.abs(buckets.reduce((s,[,p])=>s+p,0)-1)<.000001)publish({...def,type:'placement',teamKey:team.TeamSubmissionId,
            title:`${team.TeamName} — Postseason placement`},buckets.map(([key,probability])=>({key,label:key==='upper'?'Upper bracket':key==='lower'?'Lower bracket':'Eliminated',probability})),preseason.closeAt);
        }
      }
      book.db.transaction(()=>{
        const oldCount=book.db.prepare('SELECT COUNT(*) AS n FROM BettingMarkets').get().n;
        const stored=proposals.map(p=>({marketId:book.publish(p.definition,p.probabilities,forecastId,p.close),definition:p.definition,probabilities:p.probabilities}));
        opened+=book.db.prepare('SELECT COUNT(*) AS n FROM BettingMarkets').get().n-oldCount;
        book.db.prepare('UPDATE BettingForecasts SET ForecastJson=?,ForecastKey=? WHERE ForecastId=?').run(JSON.stringify({events:forecasts,markets:stored,playerForm:[...playerForms.values()]}),forecastKey,forecastId);
      })();
    }
    book.db.prepare("UPDATE BettingJobs SET Status='complete',CompletedAtUtc=?,MarketsOpened=?,MarketsSettled=?,IssueCode=? WHERE JobId=?")
      .run(now.toISOString(),opened,settled,[...new Set(issues)].join(',')||null,job);
    return {marketsOpened:opened,marketsSettled:settled,issues:[...new Set(issues)]};
  } catch(error) {book.db.prepare("UPDATE BettingJobs SET Status='failed',CompletedAtUtc=?,IssueCode='worker_failed' WHERE JobId=?").run(new Date().toISOString(),job);throw error;}
  finally {
    if(!lockOwner)book.db.prepare('DELETE FROM BettingWorkerLock WHERE Owner=?').run(owner);
    book.db.prepare('DELETE FROM BettingJobs WHERE JobId NOT IN (SELECT JobId FROM BettingJobs ORDER BY JobId DESC LIMIT 100)').run();
  }
}
