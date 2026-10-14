import 'dotenv/config';
import Database from 'better-sqlite3';
import {resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {analyticsPaths,positiveId} from '../../analytics/config.js';
import {readSeasonBettingInputs} from '../../analytics/bettingInputs.js';
import {validateBaseline,validateLineupModel,validateStatDistributions} from '../../betting/models.js';

const paths=analyticsPaths();let bettingPath=resolve(process.env.BETTING_DB||resolve(dirname(paths.league),'Betting.db'));
let seasonId=null;const connections=[];
try {
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    const flag=args[i];if(flag==='--help'){console.log('Usage: npm run betting:validate -- [--season-id id] [--league-db path] [--analytics-db path] [--betting-db path]');process.exit(0);}
    const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${flag}`);
    if(flag==='--season-id')seasonId=positiveId(value,'season');
    else if(flag==='--betting-db')bettingPath=resolve(value);
    else if(flag==='--league-db')paths.league=resolve(value);
    else if(flag==='--analytics-db')paths.analytics=resolve(value);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  const open=path=>{const db=new Database(path,{readonly:true,fileMustExist:true});db.pragma('busy_timeout=5000');connections.push(db);return db;};
  const league=open(paths.league),analytics=open(paths.analytics);
  if(!seasonId)seasonId=league.prepare("SELECT SeasonId FROM LeagueSeasons ORDER BY CASE WHEN Status!='ended' THEN 0 ELSE 1 END,SeasonId DESC LIMIT 1").get()?.SeasonId;
  if(!seasonId)throw new Error('No signup-era season is available');
  const inputs=readSeasonBettingInputs(analytics,seasonId);
  if(!inputs)throw new Error('No canonical Analytics publication exists for this season. Build Analytics first; legacy previews cannot validate live betting.');
  if(existsSync(bettingPath)) {
    const betting=open(bettingPath);
    if(betting.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='BettingPreviewMetadata'").get())throw new Error('Use the live Betting database, not a historical preview');
    if(betting.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='BettingPrivateFeatureHistory'").get())
      inputs.publicFeatureHistory=betting.prepare('SELECT * FROM BettingPrivateFeatureHistory ORDER BY ObservedAtUtc DESC LIMIT 100001').all();
    if(inputs.publicFeatureHistory?.length>100000)throw new Error('Private observation history exceeds the supported validation batch');
  }
  const required=inputs.sources.filter(s=>['match_history','match_details'].includes(s.SourceName));
  console.log(JSON.stringify({seasonId,name:inputs.season.LeagueName,analyticsAsOf:inputs.asOf,
    sourceReady:required.length===2&&required.every(s=>!s.IsStale&&s.LatestStatus==='complete')
      &&Number.isFinite(Date.parse(inputs.asOf))&&Date.parse(inputs.asOf)<=Date.now()&&Date.now()-Date.parse(inputs.asOf)<48*3600000,
    coverage:{teams:inputs.teams.length,rosteredPlayers:inputs.roster.length,verifiedGames:inputs.history.length,
      teamsWithSignupMMR:inputs.teams.filter(t=>Number.isFinite(t.AverageSignupMMR)).length},
    models:{league:validateBaseline(inputs.history),signup:validateBaseline(inputs.history,inputs.historyTeams,'roster'),
      lineup:validateLineupModel(inputs),lineupWithPrivatePublic:validateLineupModel(inputs,{includePublic:true}),
      playerStats:validateStatDistributions(inputs.metricHistory)}},null,2));
}catch(error){console.error(`Betting validation failed: ${error.message}`);process.exitCode=1;}
finally{for(const db of connections.reverse())db.close();}
