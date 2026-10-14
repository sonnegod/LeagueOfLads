import 'dotenv/config';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {analyticsPaths} from '../../analytics/config.js';
import {buildHistoricalPreview,historicalOutcomes,historicalPreviewPath,saveHistoricalPreview} from '../../betting/historicalPreview.js';

const paths=analyticsPaths();const options={leagueId:19817};let rosters=null;let source;
try {
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    const flag=args[i];if(flag==='--match-rosters'){options.matchRosters=true;continue;}if(flag==='--help') {
      console.log('Usage: npm run betting:preview -- [--league-id 19817] [--training-league 19264] [--rosters historical-setup.json|--match-rosters] [--examples 3] [--simulations 2000]');process.exit(0);
    }
    if(!['--league-id','--training-league','--rosters','--examples','--simulations'].includes(flag)||!args[i+1])throw new Error('Invalid preview argument');
    const value=args[++i];if(flag==='--rosters')rosters=resolve(value);
    else options[{'--league-id':'leagueId','--training-league':'trainingLeagueId','--examples':'examples','--simulations':'simulations'}[flag]]=Number(value);
  }
  if(rosters)options.rosterConfig=JSON.parse(readFileSync(rosters,'utf8'));
  source=new Database(paths.league,{readonly:true,fileMustExist:true});source.pragma('query_only=ON');
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
}catch(error){console.error('Historical preview failed:',error.message);process.exitCode=1;}
finally{source?.close();}
