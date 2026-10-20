import Database from 'better-sqlite3';
import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {digest} from './scheduleStore.js';
import {anchorPrice,configuredPricePolicy,ODDS_SCALE} from './pricing.js';
import {MODEL_VERSION,LEADER_FIELD_VERSION,METRICS,metricLabel,seededRandom,seriesForecast,statForecast,leaderForecast,simulateSeason} from './models.js';

const day=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(value)?value.slice(0,10):null;
const table=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const id=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export const PREVIEW_VERSION=1;
export function historicalPreviewPath(bettingPath,leagueId) {
  if(!id(leagueId))throw new Error('Invalid preview league');
  return resolve(dirname(bettingPath),`Betting-preview-${Number(leagueId)}.db`);
}

// This exception is deliberately separate from the live Analytics consumer.
// Only this offline reader can include pre-signup league history.
export function readHistoricalInputs(source,{leagueId,trainingLeagueId=null}) {
  leagueId=id(leagueId);if(!leagueId)throw new Error('A target league is required');
  const league=source.prepare('SELECT LeagueId,LeagueName FROM LeagueInfo WHERE LeagueId=?').get(leagueId);
  const target=source.prepare('SELECT MIN(DatePlayed) AS FirstDay,MIN(MatchId) AS FirstMatchId FROM MatchLeague WHERE LeagueId=?').get(leagueId);
  const cutoffDay=day(target.FirstDay);if(!league||!cutoffDay||!target.FirstMatchId)throw new Error('Target league needs a recorded first day and match ID');
  const candidates=source.prepare(`SELECT ml.LeagueId,li.LeagueName,MIN(ml.DatePlayed) AS FirstDay,MAX(ml.DatePlayed) AS LastDay,
    MIN(ml.MatchId) AS FirstMatchId,MAX(ml.MatchId) AS LastMatchId,COUNT(*) AS Games,COUNT(ml.DatePlayed) AS DatedGames
    FROM MatchLeague ml JOIN LeagueInfo li ON li.LeagueId=ml.LeagueId WHERE ml.LeagueId!=?
    GROUP BY ml.LeagueId ORDER BY LastMatchId DESC`).all(leagueId)
    .filter(l=>l.Games===l.DatedGames&&day(l.LastDay)&&day(l.LastDay)<cutoffDay&&l.LastMatchId<target.FirstMatchId);
  const training=trainingLeagueId?candidates.find(l=>l.LeagueId===id(trainingLeagueId)):candidates[0];
  if(!training)throw new Error('No wholly earlier dated training league is available');
  const rows=source.prepare(`SELECT ml.LeagueId,ml.MatchId,ml.DatePlayed,mt.TeamRad,mt.TeamDire,mt.WinnerId,mt.Duration,mt.Rehost,
    mp.PlayerId,mp.Kills,mp.Deaths,mp.Assists,mp.Lasthits AS LastHits,mp.HeroDamage,mp.TowerDamage,mp.Healing,mp.GPM,mp.XPM,
    a.TeamId FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId=ml.MatchId
    JOIN MatchPlayer mp ON mp.MatchId=ml.MatchId JOIN (SELECT DISTINCT MatchId,PlayerId,TeamId FROM MatchTeamPlayer) a
    ON a.MatchId=mp.MatchId AND a.PlayerId=mp.PlayerId WHERE ml.LeagueId=? AND ml.LeagueId!=? AND ml.MatchId<?
    ORDER BY ml.MatchId DESC,mp.PlayerId`).all(training.LeagueId,leagueId,target.FirstMatchId);
  const games=new Map();for(const row of rows) {
    if(!day(row.DatePlayed)||day(row.DatePlayed)>=cutoffDay||row.Rehost||!(row.Duration>0)||![row.TeamRad,row.TeamDire].includes(row.WinnerId))continue;
    if(!games.has(row.MatchId))games.set(row.MatchId,[]);games.get(row.MatchId).push(row);
  }
  const metricHistory=[];let excludedGames=0;
  for(const players of games.values()) {
    const first=players[0];
    if(players.length!==10||new Set(players.map(p=>p.PlayerId)).size!==10||players.some(p=>!id(p.PlayerId))
      ||[first.TeamRad,first.TeamDire].some(team=>players.filter(p=>p.TeamId===team).length!==5)){excludedGames++;continue;}
    for(const p of players)metricHistory.push({MatchId:p.MatchId,LeagueId:p.LeagueId,PlayerId:p.PlayerId,TeamId:p.TeamId,
      DatePlayed:day(p.DatePlayed),Membership:'unknown',...Object.fromEntries(Object.values(METRICS).map(column=>[column,
        typeof p[column]==='number'&&Number.isFinite(p[column])&&p[column]>=0?p[column]:null]))});
  }
  if(!metricHistory.length)throw new Error('Training league has no complete valid games');
  const teams=source.prepare(`SELECT g.TeamId AS TeamSubmissionId,g.TeamId,g.GroupId,COALESCE(t.TeamName,'Team '||g.TeamId) AS TeamName
    FROM LeagueGroups g LEFT JOIN TeamInfo t ON t.TeamId=g.TeamId WHERE g.LeagueId=? ORDER BY g.TeamId`).all(leagueId);
  if(!teams.length||new Set(teams.map(t=>t.TeamId)).size!==teams.length)throw new Error('Target team/group alignment needs correction');
  return {league,cutoffDay,firstTargetMatchId:target.FirstMatchId,training:{...training,validGames:new Set(metricHistory.map(p=>p.MatchId)).size,excludedGames},
    inputs:{season:{LeagueId:leagueId,SeasonId:leagueId,RulesJson:'null'},teams,roster:[],teamStats:[],metricHistory,modelMode:'league'}};
}

function fixtures(source,leagueId,count) {
  const series=source.prepare(`SELECT SeriesId,Team1,Team2,DateCreated,Stage FROM SeriesInfo WHERE LeagueId=? AND Stage='g' ORDER BY SeriesId`).all(leagueId);
  const result=[];
  for(const s of series) {
    // Read fixture identity and observed lineups only. Target scores/stat values
    // are not selected anywhere in this pricing function.
    const matches=source.prepare(`SELECT DISTINCT sm.MatchId,ml.DatePlayed FROM SeriesMatch sm JOIN MatchLeague ml ON ml.MatchId=sm.MatchId
      WHERE sm.SeriesId=? AND ml.LeagueId=? ORDER BY sm.MatchId`).all(s.SeriesId,leagueId);
    if(matches.length!==2||matches.some(m=>!day(m.DatePlayed)))continue;
    const players=source.prepare(`SELECT DISTINCT a.PlayerId,a.TeamId,COALESCE(p.PlayerName,'Player '||a.PlayerId) AS PlayerName
      FROM MatchTeamPlayer a LEFT JOIN PlayerInfo p ON p.PlayerId=a.PlayerId WHERE a.MatchId IN (?,?) AND a.TeamId IN (?,?) AND a.PlayerId>0 ORDER BY a.TeamId,a.PlayerId`)
      .all(matches[0].MatchId,matches[1].MatchId,s.Team1,s.Team2);
    if(!players.length)continue;
    result.push({eventId:s.SeriesId,team1Key:s.Team1,team2Key:s.Team2,day:day(matches[0].DatePlayed),bestOf:2,
      matchIds:matches.map(m=>m.MatchId),players});if(result.length>=count)break;
  }
  return result;
}

function reconstructedRoster(source,leagueId,teams) {
  const rosters=teams.map(team=>{
    const matches=source.prepare(`SELECT DISTINCT a.MatchId FROM MatchTeamPlayer a JOIN MatchLeague l ON l.MatchId=a.MatchId
      WHERE l.LeagueId=? AND a.TeamId=? ORDER BY a.MatchId`).all(leagueId,team.TeamId);
    for(const match of matches) {
      const players=source.prepare('SELECT DISTINCT PlayerId AS accountId FROM MatchTeamPlayer WHERE MatchId=? AND TeamId=? AND PlayerId>0 ORDER BY PlayerId').all(match.MatchId,team.TeamId);
      if(players.length===5)return {teamId:team.TeamId,players,rosterMatchId:match.MatchId,regularGames:2*(teams.filter(t=>t.GroupId===team.GroupId).length-1)};
    }
    throw new Error(`Team ${team.TeamId} has no complete recorded five-player lineup`);
  });
  const rules=table(source,'LeagueRules')?source.prepare('SELECT UpperBracketTeams,LowerBracketTeams,EliminatedTeams,HasTiebreaker,TiebreakerPosition FROM LeagueRules WHERE LeagueId=?').get(leagueId):null;
  return {reconstruction:'first_complete_match',teams:rosters,rules};
}

function confirmedRoster(config,teams,cutoffDay) {
  if(!config)return null;
  if(config.reconstruction!=='first_complete_match'&&(!day(config.recordedBefore)||day(config.recordedBefore)>=cutoffDay))throw new Error('Roster setup must be identified as recorded before the target season');
  if(!Array.isArray(config.teams)||config.teams.length!==teams.length)throw new Error('Provide every target team’s opening roster');
  const seen=new Set();const conflicts=new Set();const teamIds=new Set();const roster=[];const gameCounts={};
  for(const team of config.teams) {
    const key=id(team.teamId);if(!teams.some(t=>t.TeamId===key)||teamIds.has(key)||!Array.isArray(team.players)||team.players.length!==5)throw new Error('Each target team needs one five-player opening roster');
    teamIds.add(key);const games=id(team.regularGames??config.regularGamesPerTeam);if(!games||games<5||games>100)throw new Error('Provide planned regular-season game counts (5–100)');
    gameCounts[key]=games;
    team.players.forEach((player,slot)=>{
      const playerId=id(player.accountId);if(!playerId)throw new Error('Invalid opening player');
      if(seen.has(playerId)){if(config.reconstruction!=='first_complete_match')throw new Error('Opening players must belong to exactly one team');conflicts.add(playerId);}seen.add(playerId);
      const mmr=player.mmr===undefined?null:Number(player.mmr);if(mmr!==null&&(!Number.isFinite(mmr)||mmr<=0))throw new Error('Invalid historical signup MMR');
      roster.push({PlayerId:playerId,TeamSubmissionId:key,Slot:slot,SignupMMR:mmr,PlayerName:`Player ${playerId}`});
    });
  }
  return {roster,gameCounts,rules:config.rules||null,conflicts:[...conflicts],reconstructed:config.reconstruction==='first_complete_match'};
}

export function buildHistoricalPreview(source,{leagueId=19817,trainingLeagueId=null,rosterConfig=null,matchRosters=false,examples=3,simulations=2000,margin=configuredPricePolicy().margin}={}) {
  if(!Number.isInteger(examples)||examples<1||examples>10||!Number.isInteger(simulations)||simulations<100||simulations>10000)throw new Error('Use 1–10 examples and 100–10000 simulations');
  return source.transaction(()=>{
    const base=readHistoricalInputs(source,{leagueId,trainingLeagueId});const {inputs,cutoffDay}=base;
    if(matchRosters){if(rosterConfig)throw new Error('Choose match rosters or a supplied historical setup');rosterConfig=reconstructedRoster(source,Number(leagueId),inputs.teams);}
    const planned=confirmedRoster(rosterConfig,inputs.teams,cutoffDay);const sampleFixtures=fixtures(source,Number(leagueId),examples);
    const warnings=['historical_observation_times_unavailable','legacy_training_membership_unknown','reference_prices_not_validated_for_live_betting'];
    const held=[];const markets=[];const priceInputs={...inputs,roster:planned?.roster||[]};
    const neutralTeamPriors=!planned||planned.conflicts.length>0||planned.roster.some(p=>p.SignupMMR===null);
    if(!neutralTeamPriors){
      priceInputs.modelMode='roster';priceInputs.teams=inputs.teams.map(t=>({...t,AverageSignupMMR:planned.roster.filter(p=>p.TeamSubmissionId===t.TeamId).reduce((n,p)=>n+p.SignupMMR,0)/5}));
    }
    if(planned?.reconstructed)warnings.push('preseason_rosters_reconstructed_from_first_complete_match','game_counts_and_rules_assumed_from_saved_groups');
    if(planned?.conflicts.length)warnings.push('conflicting_reconstructed_players_withheld');
    const setupDigest=digest({model:MODEL_VERSION,leaderField:LEADER_FIELD_VERSION,version:PREVIEW_VERSION,inputs:priceInputs,rosterConfig,fixtures:sampleFixtures,simulations,margin});
    const seed=parseInt(setupDigest.slice(0,8),16);const random=seededRandom(seed);
    const add=(scope,definition,outcomes)=>markets.push({marketId:markets.length+1,scope,...definition,
      selections:outcomes.map(o=>({key:o.key,label:o.label,odds:anchorPrice(o.probability,margin)/ODDS_SCALE}))});
    const samples=playerId=>inputs.metricHistory.filter(p=>p.PlayerId===playerId).length;
    const name=playerId=>source.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=?').get(playerId)?.PlayerName||`Player ${playerId}`;
    function playerMarkets(player,scope,event=null) {
      if(scope==='preseason'&&planned.conflicts.includes(player.PlayerId)){held.push({scope,playerId:player.PlayerId,reason:'conflicting_reconstructed_roster'});return;}
      if(samples(player.PlayerId)<5){held.push({scope,eventId:event?.EventId||null,playerId:player.PlayerId,reason:'fewer_than_five_preseason_history_games'});return;}
      for(const stat of Object.keys(METRICS))for(const aggregation of ['total','average']) {
        if(aggregation==='total'&&['gpm','xpm'].includes(stat))continue;
        const prediction=statForecast(priceInputs,{playerId:player.PlayerId,teamKey:player.TeamSubmissionId,stat,scope:aggregation,
          games:event?1:planned.gameCounts[player.TeamSubmissionId],event},random,simulations);
        if(!prediction)continue;
        add(scope,{eventId:event?.EventId||null,type:scope==='preseason'?'season_player':'player_prop',playerId:player.PlayerId,
          teamKey:player.TeamSubmissionId,stat,aggregation,line:prediction.line,title:`${name(player.PlayerId)} — ${metricLabel(stat)} ${aggregation}`},
          [{key:'over',label:`Over ${prediction.line}`,probability:prediction.over},{key:'under',label:`Under ${prediction.line}`,probability:prediction.under}]);
      }
    }
    if(!planned)held.push({scope:'preseason',reason:'original_opening_rosters_and_planned_game_counts_missing'});
    else {
      priceInputs.roster=planned.roster.map(p=>({...p,PlayerName:name(p.PlayerId)}));
      for(const player of priceInputs.roster)playerMarkets(player,'preseason');
      if(!planned.conflicts.length)for(const [stat,aggregation] of [['kills','total'],['kills','average'],['gpm','average'],['xpm','average']]) {
        const outcomes=leaderForecast(priceInputs,priceInputs.roster,stat,aggregation,planned.gameCounts,random,simulations);
        if(outcomes)add('preseason',{type:'player_leader',stat,aggregation,leaderField:LEADER_FIELD_VERSION,title:`Regular-season leader — ${metricLabel(stat)} ${aggregation} · Among listed players`},outcomes);
      }
      else held.push({scope:'preseason',reason:'leader_field_has_missing_history_or_conflicting_players'});
      if(planned.rules) {
        const knownMmr=priceInputs.roster.every(p=>p.SignupMMR!==null)&&!planned.conflicts.length;
        const teamInputs={...priceInputs,modelMode:knownMmr?'roster':'league',season:{...inputs.season,RulesJson:JSON.stringify(planned.rules)},
          teams:inputs.teams.map(t=>({...t,AverageSignupMMR:knownMmr?priceInputs.roster.filter(p=>p.TeamSubmissionId===t.TeamId).reduce((n,p)=>n+p.SignupMMR,0)/5:null}))};
        const season=simulateSeason(teamInputs,{RegularGamesPerTeam:planned.gameCounts},random,simulations);
        if(season?.champion)add('preseason',{type:'champion',title:'League champion',neutralPrior:!knownMmr},teamInputs.teams.map(t=>({key:`team:${t.TeamId}`,label:t.TeamName,probability:season.champion[t.TeamId]})));
        else held.push({scope:'preseason',reason:'group_or_bracket_format_not_supported'});
        if(season?.placement)for(const t of teamInputs.teams) {
          const outcomes=Object.entries(season.placement[t.TeamId]).filter(([,p])=>p>0&&p<1);
          if(outcomes.length>=2&&Math.abs(outcomes.reduce((sum,[,p])=>sum+p,0)-1)<1e-6)add('preseason',{type:'placement',teamKey:t.TeamId,title:`${t.TeamName} — Bracket placement`,neutralPrior:!knownMmr},outcomes.map(([key,probability])=>({key,label:key==='upper'?'Upper bracket':key==='lower'?'Lower bracket':'Eliminated',probability})));
        }
        if(!knownMmr)warnings.push('team_markets_use_neutral_strength_priors');
      }else held.push({scope:'preseason',reason:'historical_qualification_rules_missing_for_team_futures'});
    }
    for(const f of sampleFixtures) {
      const event={EventId:f.eventId,Team1Key:f.team1Key,Team2Key:f.team2Key,BestOf:f.bestOf};
      const teamName=key=>inputs.teams.find(t=>t.TeamId===key)?.TeamName||`Team ${key}`;
      // No trustworthy historical roster strength exists by default: neutral
      // team priors are shown explicitly, rather than borrowing eventual wins.
      const prediction=seriesForecast(priceInputs,event);
      add('series',{eventId:f.eventId,type:'series_winner',title:`${teamName(f.team1Key)} vs ${teamName(f.team2Key)} — Series result`,neutralPrior:neutralTeamPriors},
        prediction.winner.map(p=>({...p,label:p.key==='draw'?'Draw':teamName(p.key==='team1'?f.team1Key:f.team2Key)})));
      add('series',{eventId:f.eventId,type:'exact_score',title:'Exact score',neutralPrior:neutralTeamPriors},prediction.scores.map(p=>({...p,label:`${p.a}–${p.b}`})));
      for(const p of f.players)playerMarkets({PlayerId:p.PlayerId,TeamSubmissionId:p.TeamId},'series',event);
    }
    const targetIds=new Set(source.prepare('SELECT MatchId FROM MatchLeague WHERE LeagueId=?').all(leagueId).map(r=>r.MatchId));
    if(inputs.metricHistory.some(p=>p.LeagueId===Number(leagueId)||targetIds.has(p.MatchId)||p.DatePlayed>=cutoffDay||p.MatchId>=base.firstTargetMatchId))throw new Error('Target-season leakage detected');
    return {version:PREVIEW_VERSION,leagueId:Number(leagueId),leagueName:base.league.LeagueName,cutoffDay,trainingLeagueId:base.training.LeagueId,
      trainingLeagueName:base.training.LeagueName,trainingGames:base.training.validGames,trainingAppearances:inputs.metricHistory.length,
      trainingLastDay:day(base.training.LastDay),excludedTrainingGames:base.training.excludedGames,inputDigest:setupDigest,seed,simulations,modelVersion:MODEL_VERSION,
      pricingStatus:'illustration_only',neutralTeamPriors,preseasonStatus:planned?planned.reconstructed?'conditional_on_reconstructed_rosters':'conditional_on_supplied_rosters':'held_missing_original_setup',
      preseasonMarkets:markets.filter(m=>m.scope==='preseason').length,seriesMarkets:markets.filter(m=>m.scope==='series').length,
      rosterSource:planned?.reconstructed?'first_complete_recorded_lineup':planned?'supplied_historical_setup':'missing',
      rosterTeams:rosterConfig?.teams.map(t=>({teamId:t.teamId,teamName:inputs.teams.find(team=>team.TeamId===t.teamId)?.TeamName||`Team ${t.teamId}`,
        rosterMatchId:t.rosterMatchId||null,regularGames:t.regularGames||rosterConfig.regularGamesPerTeam,
        players:t.players.map(p=>({playerId:Number(p.accountId),name:name(Number(p.accountId))}))}))||[],
      conflictingPlayers:planned?.conflicts||[],
      warnings,held,fixtures:sampleFixtures.map(f=>({...f,team1:inputs.teams.find(t=>t.TeamId===f.team1Key)?.TeamName||`Team ${f.team1Key}`,
        team2:inputs.teams.find(t=>t.TeamId===f.team2Key)?.TeamName||`Team ${f.team2Key}`,lineupSource:'observed_after_the_fact',kickoffVerified:false})),
      markets,privateInputs:{inputs:priceInputs,rosterConfig,fixtures:sampleFixtures},generatedAt:new Date().toISOString()};
  })();
}

// Outcomes are fetched only after all prices have been frozen. They are never
// passed into forecasting, the seed, validation or input digests.
export function historicalOutcomes(source,preview) {
  return preview.fixtures.map(f=>{
    const games=source.prepare(`SELECT mt.MatchId,mt.WinnerId FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId=mt.MatchId
      WHERE mt.MatchId IN (${f.matchIds.map(()=>'?').join(',')}) AND ml.LeagueId=? ORDER BY mt.MatchId`).all(...f.matchIds,preview.leagueId);
    const valid=games.length===f.matchIds.length&&games.every(g=>[f.team1Key,f.team2Key].includes(g.WinnerId));
    return {eventId:f.eventId,score:valid?[games.filter(g=>g.WinnerId===f.team1Key).length,games.filter(g=>g.WinnerId===f.team2Key).length]:null};
  });
}

export function saveHistoricalPreview(path,preview,outcomes) {
  if(existsSync(path)) {
    const check=new Database(path,{readonly:true,fileMustExist:true});try{if(!table(check,'BettingPreviewMetadata'))throw new Error('Refusing to overwrite a non-preview database');}finally{check.close();}
  }
  const db=new Database(path);try {
    db.exec(`CREATE TABLE IF NOT EXISTS BettingPreviewMetadata (Id INTEGER PRIMARY KEY CHECK(Id=1),LeagueId INTEGER NOT NULL,Version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS PreviewRuns (RunId INTEGER PRIMARY KEY,InputDigest TEXT UNIQUE NOT NULL,ReportJson TEXT NOT NULL,PrivateInputsJson TEXT NOT NULL,OutcomesJson TEXT NOT NULL,GeneratedAtUtc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS PreviewMarkets (RunId INTEGER NOT NULL,MarketId INTEGER NOT NULL,Scope TEXT NOT NULL,EventId INTEGER,MarketType TEXT NOT NULL,Title TEXT NOT NULL,DefinitionJson TEXT NOT NULL,PRIMARY KEY(RunId,MarketId));
      CREATE TABLE IF NOT EXISTS PreviewSelections (RunId INTEGER NOT NULL,MarketId INTEGER NOT NULL,OutcomeKey TEXT NOT NULL,Label TEXT NOT NULL,Odds REAL NOT NULL,PRIMARY KEY(RunId,MarketId,OutcomeKey));`);
    return db.transaction(()=>{
      db.prepare('INSERT OR REPLACE INTO BettingPreviewMetadata VALUES(1,?,?)').run(preview.leagueId,PREVIEW_VERSION);
      const {privateInputs,markets,...report}=preview;
      const old=db.prepare('SELECT RunId FROM PreviewRuns WHERE InputDigest=?').get(preview.inputDigest);if(old){
        db.prepare('UPDATE PreviewRuns SET OutcomesJson=?,ReportJson=? WHERE RunId=?').run(JSON.stringify(outcomes),JSON.stringify(report),old.RunId);return old.RunId;
      }
      const run=Number(db.prepare('INSERT INTO PreviewRuns (InputDigest,ReportJson,PrivateInputsJson,OutcomesJson,GeneratedAtUtc) VALUES (?,?,?,?,?)')
        .run(preview.inputDigest,JSON.stringify(report),JSON.stringify(privateInputs),JSON.stringify(outcomes),preview.generatedAt).lastInsertRowid);
      for(const m of markets) {
        const {selections,...definition}=m;
        db.prepare('INSERT INTO PreviewMarkets VALUES(?,?,?,?,?,?,?)').run(run,m.marketId,m.scope,m.eventId||null,m.type,m.title,JSON.stringify(definition));
        for(const s of selections)db.prepare('INSERT INTO PreviewSelections VALUES(?,?,?,?,?)').run(run,m.marketId,s.key,s.label,s.odds);
      }
      return run;
    })();
  }finally{db.close();}
}

export function readHistoricalPreview(path,{scope='preseason',preseasonGroup='all',groupPlayers=false,groupTeams=false,groupNames={},eventId=null,before=null,search=''}={}) {
  if(!existsSync(path))return null;
  if(!['preseason','series'].includes(scope)||!['all','player','team'].includes(preseasonGroup)||search.length>100||eventId!==null&&!id(eventId)||before!==null&&!id(before))throw new Error('Invalid preview filter');
  const group=scope==='preseason'?preseasonGroup:'all';
  const db=new Database(path,{readonly:true,fileMustExist:true});try {
    if(!table(db,'BettingPreviewMetadata'))throw new Error('Invalid preview database');
    return db.transaction(()=>{
      const run=db.prepare('SELECT RunId,ReportJson,OutcomesJson FROM PreviewRuns ORDER BY RunId DESC LIMIT 1').get();if(!run)return null;
      const report=JSON.parse(run.ReportJson);
      const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
      const playerView=scope==='preseason'&&group==='player'&&groupPlayers;
      const teamView=scope==='preseason'&&group==='team'&&groupTeams;
      const selections=marketId=>db.prepare('SELECT Label AS label,Odds AS odds FROM PreviewSelections WHERE RunId=? AND MarketId=? ORDER BY OutcomeKey').all(run.RunId,marketId);
      const marketDto=m=>({marketId:m.MarketId,title:m.Title,type:m.MarketType,eventId:m.EventId,
        leaderField:m.MarketType==='player_leader'?JSON.parse(m.DefinitionJson).leaderField:undefined,selections:selections(m.MarketId)});
      const teamGroups=[];
      if(teamView) {
        const teams=db.prepare(`SELECT json_extract(t.value,'$.TeamId') AS TeamId,json_extract(t.value,'$.GroupId') AS GroupId,
          json_extract(t.value,'$.TeamName') AS TeamName FROM PreviewRuns r,json_each(r.PrivateInputsJson,'$.inputs.teams') t
          WHERE r.RunId=? LIMIT 201`).all(run.RunId);
        if(teams.length>200)throw new Error('Team preview exceeds bounds');
        const markets=db.prepare("SELECT * FROM PreviewMarkets WHERE RunId=? AND Scope='preseason' AND MarketType IN ('champion','placement','season_team') ORDER BY MarketId DESC LIMIT 402").all(run.RunId);
        if(markets.length>401)throw new Error('Team preview exceeds market bounds');
        const champion=markets.find(m=>m.MarketType==='champion');
        const championPrices=champion?new Map(db.prepare('SELECT OutcomeKey,Odds FROM PreviewSelections WHERE RunId=? AND MarketId=?').all(run.RunId,champion.MarketId).map(s=>[s.OutcomeKey,s.Odds])):new Map();
        const placements=new Map();
        for(const market of markets.filter(m=>m.MarketType==='placement')) {
          const definition=JSON.parse(market.DefinitionJson);
          // Older preview definitions lack a team key. Match their frozen label
          // only for display; settlement never relies on this fallback.
          const legacy=teams.filter(t=>market.Title===`${t.TeamName} — Bracket placement`);
          const teamId=definition.teamKey||(legacy.length===1?legacy[0].TeamId:null);if(!teamId)continue;
          placements.set(teamId,db.prepare('SELECT OutcomeKey AS key,Label AS label,Odds AS odds FROM PreviewSelections WHERE RunId=? AND MarketId=? ORDER BY OutcomeKey').all(run.RunId,market.MarketId));
        }
        const query=search.toLocaleLowerCase('en-US');const grouped=new Map();
        for(const team of teams) {
          const placement=placements.get(team.TeamId)||[];
          const winsMarket=markets.find(m=>m.MarketType==='season_team'&&JSON.parse(m.DefinitionJson).teamKey===team.TeamId);
          const winsDefinition=winsMarket?JSON.parse(winsMarket.DefinitionJson):null;
          const wins=winsDefinition?{...marketDto(winsMarket),line:winsDefinition.line,stat:winsDefinition.stat}:null;
          if(query&&!`${team.TeamName} ${groupNames[team.GroupId]||''} league champion bracket placement ${wins?'regular season wins':''} ${placement.map(p=>p.label).join(' ')}`.toLocaleLowerCase('en-US').includes(query))continue;
          if(!grouped.has(team.GroupId))grouped.set(team.GroupId,{groupId:team.GroupId,name:groupNames[team.GroupId]||`Group ${team.GroupId??'unassigned'}`,teams:[]});
          const signupTeam=report.previewKind==='signup'?report.rosterTeams.find(t=>t.teamId===team.TeamId):null;
          grouped.get(team.GroupId).teams.push({teamKey:team.TeamId,teamId:report.previewKind==='signup'?signupTeam?.externalTeamId||null:team.TeamId,
            name:team.TeamName,pendingPlayers:signupTeam?.pendingPlayers||0,championOdds:championPrices.get(`team:${team.TeamId}`)??null,placement,wins});
        }
        teamGroups.push(...[...grouped.values()].sort((a,b)=>Number(a.groupId)-Number(b.groupId)).map(g=>({...g,
          teams:g.teams.sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'})||a.teamId-b.teamId)})));
      }
      const playerRows=playerView?db.prepare(`SELECT CAST(json_extract(DefinitionJson,'$.playerId') AS INTEGER) AS PlayerId,MAX(MarketId) AS Cursor
        FROM PreviewMarkets WHERE RunId=? AND Scope='preseason' AND MarketType='season_player' AND Title LIKE ? ESCAPE '\\'
        GROUP BY PlayerId HAVING PlayerId>0 AND (? IS NULL OR MAX(MarketId)<?) ORDER BY Cursor DESC LIMIT 21`).all(run.RunId,pattern,before,before):[];
      const players=playerRows.slice(0,20).map(row=>{
        const team=report.rosterTeams.find(t=>t.players.some(p=>p.playerId===row.PlayerId));
        const name=team?.players.find(p=>p.playerId===row.PlayerId)?.name||`Player ${row.PlayerId}`;
        const rows=db.prepare(`SELECT * FROM PreviewMarkets WHERE RunId=? AND Scope='preseason' AND MarketType='season_player'
          AND CAST(json_extract(DefinitionJson,'$.playerId') AS INTEGER)=? AND Title LIKE ? ESCAPE '\\' ORDER BY MarketId LIMIT 33`).all(run.RunId,row.PlayerId,pattern);
        if(rows.length>32)throw new Error('Player preview exceeds market bounds');
        return {playerId:row.PlayerId,name,teamName:team?.teamName||null,markets:rows.map(m=>{
          const definition=JSON.parse(m.DefinitionJson);return {...marketDto(m),stat:definition.stat,aggregation:definition.aggregation,line:definition.line};
        })};
      });
      const rows=playerView||teamView?[]:db.prepare(`SELECT * FROM PreviewMarkets WHERE RunId=? AND Scope=? AND (? IS NULL OR EventId=?) AND (? IS NULL OR MarketId<?)
        AND (?='all' OR (?='player' AND MarketType IN ('season_player','player_leader')) OR (?='team' AND MarketType IN ('champion','placement','season_team')))
        AND Title LIKE ? ESCAPE '\\' ORDER BY MarketId DESC LIMIT 21`).all(run.RunId,scope,eventId,eventId,before,before,group,group,group,pattern);
      // Admin-only projection: matchup probabilities are intentional diagnostics;
      // private inputs, MMRs and raw source records remain excluded.
      return {previewKind:report.previewKind||'historical',seasonId:report.seasonId||null,asOf:report.asOf||null,
        leagueId:report.leagueId,leagueName:report.leagueName,cutoffDay:report.cutoffDay,trainingLeagueId:report.trainingLeagueId,
        trainingLeagueName:report.trainingLeagueName,trainingGames:report.trainingGames,trainingLastDay:report.trainingLastDay,
        preseasonStatus:report.preseasonStatus,preseasonMarkets:report.preseasonMarkets,seriesMarkets:report.seriesMarkets,rosterSource:report.rosterSource,neutralTeamPriors:report.neutralTeamPriors,
        rosterTeams:report.rosterTeams.map(t=>({teamId:t.teamId,teamName:t.teamName,rosterMatchId:t.rosterMatchId,regularGames:t.regularGames,
          players:t.players.map(p=>({playerId:p.playerId,name:p.name}))})),conflictingPlayers:report.conflictingPlayers,
        warnings:report.warnings,held:report.held,generatedAt:report.generatedAt,pricingStatus:report.pricingStatus,
        fixtures:report.fixtures.map(f=>({eventId:f.eventId,team1:f.team1,team2:f.team2,day:f.day,matchIds:f.matchIds,
          lineupSource:f.lineupSource,kickoffVerified:f.kickoffVerified,score:JSON.parse(run.OutcomesJson).find(o=>o.eventId===f.eventId)?.score||null})),
        seriesOffers:db.prepare("SELECT MarketId,EventId,Title,DefinitionJson FROM PreviewMarkets WHERE RunId=? AND MarketType IN ('series_winner','exact_score') ORDER BY MarketId").all(run.RunId).map(m=>({
          marketId:m.MarketId,eventId:m.EventId,title:m.Title,type:JSON.parse(m.DefinitionJson).type,
          selections:db.prepare('SELECT Label AS label,Odds AS odds FROM PreviewSelections WHERE RunId=? AND MarketId=? ORDER BY OutcomeKey').all(run.RunId,m.MarketId)})),
        players,
        teamGroups,
        matchupSimulation:teamView&&report.matchupSimulation?{samples:report.matchupSimulation.samples,
          matchups:report.matchupSimulation.matchups.map(m=>({groupId:m.groupId,groupName:groupNames[m.groupId]||`Group ${m.groupId}`,team1Key:m.team1Key,team2Key:m.team2Key,
            team1:m.team1,team2:m.team2,gameWinProbability:m.gameWinProbability,
            scores:m.scores.map(s=>({score:s.score,probability:s.probability,count:s.count}))}))}:null,
        leaderMarkets:playerView?db.prepare("SELECT * FROM PreviewMarkets WHERE RunId=? AND Scope='preseason' AND MarketType='player_leader' AND Title LIKE ? ESCAPE '\\' ORDER BY MarketId DESC LIMIT 4").all(run.RunId,pattern).map(marketDto):[],
        markets:rows.slice(0,20).map(marketDto),
        nextBefore:playerView?(playerRows.length>20?playerRows[19].Cursor:null):(rows.length>20?rows[19].MarketId:null)};
    })();
  }finally{db.close();}
}
