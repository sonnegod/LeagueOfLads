import 'dotenv/config';
import Database from 'better-sqlite3';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {analyticsPaths} from '../../analytics/config.js';
import {buildHistoricalPreview,historicalOutcomes,historicalPreviewPath,saveHistoricalPreview} from '../../betting/historicalPreview.js';
import {openAnalytics} from '../../analytics/store.js';
import {buildAnalytics} from '../../analytics/build.js';
import {readSeasonBettingInputs} from '../../analytics/bettingInputs.js';
import {readPreseasonPreviewHistory} from '../../analytics/preseasonHistory.js';
import {buildSignupPreseasonPreview,signupPreviewPath} from '../../betting/signupPreseasonPreview.js';

const paths=analyticsPaths();const options={leagueId:19817};let rosters=null;let source,analytics,publicDb;
try {
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    const flag=args[i];if(flag==='--match-rosters'){options.matchRosters=true;continue;}if(flag==='--help') {
      console.log('Usage: npm run betting:preview -- [--season-id 3 [--history-seasons 3] | --league-id 19817 [--training-league 19264] [--rosters historical-setup.json|--match-rosters]] [--examples 3] [--simulations 2000]');process.exit(0);
    }
    if(!['--season-id','--history-seasons','--league-id','--training-league','--rosters','--examples','--simulations'].includes(flag)||!args[i+1])throw new Error('Invalid preview argument');
    const value=args[++i];if(flag==='--rosters')rosters=resolve(value);
    else options[{'--season-id':'seasonId','--history-seasons':'historySeasons','--league-id':'leagueId','--training-league':'trainingLeagueId','--examples':'examples','--simulations':'simulations'}[flag]]=Number(value);
  }
  if(rosters)options.rosterConfig=JSON.parse(readFileSync(rosters,'utf8'));
  source=new Database(paths.league,{readonly:true,fileMustExist:true});source.pragma('query_only=ON');
  if(options.seasonId!==undefined) {
    if(!Number.isSafeInteger(options.seasonId)||options.seasonId<=0)throw new Error('Invalid signup season');
    if(args.includes('--league-id')||options.trainingLeagueId||options.matchRosters||rosters)throw new Error('Choose signup rosters or historical reconstruction');
    const now=new Date();analytics=openAnalytics(paths.analytics);
    if(existsSync(paths.public))publicDb=new Database(paths.public,{readonly:true,fileMustExist:true});
    buildAnalytics({league:source,analytics,publicDb,now});
    const inputs=readSeasonBettingInputs(analytics,options.seasonId,now);
    const training=readPreseasonPreviewHistory(source,{excludeLeagueId:inputs?.season.LeagueId,now,seasons:options.historySeasons??3});
    const preview=buildSignupPreseasonPreview({inputs,history:training.history,historyReports:training.reports,simulations:options.simulations??2000,now});
    const bettingPath=resolve(process.env.BETTING_DB||resolve(dirname(paths.league),'Betting.db'));
    const path=signupPreviewPath(bettingPath,options.seasonId);const runId=saveHistoricalPreview(path,preview,[]);
    console.log(JSON.stringify({runId,database:path,view:`/betting?previewSeason=${options.seasonId}`,target:preview.leagueName,
      training:training.reports,teams:preview.rosterTeams.length,players:inputs.roster.length,preseasonMarkets:preview.preseasonMarkets,
      held:preview.held.reduce((counts,h)=>({...counts,[h.reason]:(counts[h.reason]||0)+1}),{}),pricingStatus:preview.pricingStatus},null,2));
  } else {
  const preview=buildHistoricalPreview(source,options);
  const outcomes=historicalOutcomes(source,preview);
  const bettingPath=resolve(process.env.BETTING_DB||resolve(dirname(paths.league),'Betting.db'));
  const path=historicalPreviewPath(bettingPath,preview.leagueId);
  const runId=saveHistoricalPreview(path,preview,outcomes);
  console.log(JSON.stringify({runId,database:path,view:`/betting?previewLeague=${preview.leagueId}`,target:preview.leagueName,
    training:preview.trainingLeagueName,trainingGames:preview.trainingGames,trainingLastDay:preview.trainingLastDay,
    cutoffDay:preview.cutoffDay,preseasonStatus:preview.preseasonStatus,preseasonMarkets:preview.preseasonMarkets,
    seriesMarkets:preview.seriesMarkets,examples:preview.fixtures.map(f=>({seriesId:f.eventId,teams:[f.team1,f.team2],day:f.day,
      actualScore:outcomes.find(o=>o.eventId===f.eventId)?.score})),warnings:preview.warnings},null,2));
  }
}catch(error){console.error('Betting preview failed:',error.message);process.exitCode=1;}
finally{publicDb?.close();analytics?.close();source?.close();}
