import {fail} from './scheduleStore.js';

export function marketBettors(db,marketId) {
  const rows=db.prepare(`SELECT l.OutcomeKey,COUNT(DISTINCT t.UserId) n FROM BettingTicketLegs l JOIN BettingTickets t ON t.TicketId=l.TicketId
    WHERE l.MarketId=? AND l.Result!='void' AND t.Status!='cancelled' GROUP BY l.OutcomeKey
    UNION ALL SELECT NULL,COUNT(DISTINCT t.UserId) FROM BettingTicketLegs l JOIN BettingTickets t ON t.TicketId=l.TicketId
    WHERE l.MarketId=? AND l.Result!='void' AND t.Status!='cancelled'`).all(marketId,marketId);
  return {total:rows.find(r=>r.OutcomeKey===null)?.n||0,byOutcome:Object.fromEntries(rows.filter(r=>r.OutcomeKey!==null).map(r=>[r.OutcomeKey,r.n]))};
}

function playerBettors(db,eventId,playerId) {
  return db.prepare(`SELECT COUNT(DISTINCT t.UserId) n FROM BettingMarkets m JOIN BettingTicketLegs l ON l.MarketId=m.MarketId
    JOIN BettingTickets t ON t.TicketId=l.TicketId WHERE m.EventId=? AND m.PlayerId=? AND m.MarketType='player_prop' AND l.Result!='void' AND t.Status!='cancelled'`).get(eventId,playerId).n;
}

// Page full player/fixture entries, loading their odds only when expanded.
export function readScheduledPlayers({db,league,seasonId,limit,before,eventId,search,localTesting,playerName}) {
  const events=league.prepare(`SELECT e.EventId,e.BestOf,e.ScheduledStartUtc,e.Team1Key,e.Team2Key,a.TeamName Team1Name,b.TeamName Team2Name
    FROM ScheduledEvents e JOIN SeasonTeams a ON a.TeamSubmissionId=e.Team1Key JOIN SeasonTeams b ON b.TeamSubmissionId=e.Team2Key
    WHERE e.SeasonId=? AND (? IS NULL OR e.EventId=?) AND (?=1 OR e.SourceMessageId IS NULL OR e.SourceMessageId NOT LIKE 'local-test:%') LIMIT 201`)
    .all(seasonId,eventId,eventId,Number(localTesting));
  if(events.length>200)fail('Narrow the fixture filter for this season',409);
  if(!events.length)return {players:[],nextBefore:null};
  const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
  const rows=db.prepare(`SELECT EventId,PlayerId,MAX(TeamKey) TeamKey,MAX(MarketId) Cursor,MAX(Title LIKE ? ESCAPE '\\') TitleMatch
    FROM BettingMarkets WHERE SeasonId=? AND MarketType='player_prop' AND Status IN ('open','held','locked')
    AND EventId IN (${events.map(()=>'?').join(',')}) GROUP BY EventId,PlayerId
    HAVING (? IS NULL OR MAX(MarketId)<?) ORDER BY Cursor DESC LIMIT 2001`).all(pattern,seasonId,...events.map(e=>e.EventId),before,before);
  if(rows.length>2000)fail('Narrow the fixture filter for player props',409);
  const names=new Map(),needle=search.toLocaleLowerCase();
  const matches=rows.map(row=>{
    if(!names.has(row.PlayerId))names.set(row.PlayerId,playerName(row.PlayerId));
    const e=events.find(e=>e.EventId===row.EventId);
    return {...row,name:names.get(row.PlayerId),event:e};
  }).filter(p=>!needle||p.TitleMatch||`${p.name} ${p.PlayerId} ${p.event.Team1Name} ${p.event.Team2Name}`.toLocaleLowerCase().includes(needle));
  return {players:matches.slice(0,limit).map(p=>({playerId:p.PlayerId,name:p.name,teamName:p.TeamKey===p.event.Team1Key?p.event.Team1Name:p.event.Team2Name,
    bettorCount:playerBettors(db,p.EventId,p.PlayerId),fixture:{eventId:p.EventId,bestOf:p.event.BestOf,startAt:p.event.ScheduledStartUtc,
      team1:p.event.Team1Name,team2:p.event.Team2Name}})),nextBefore:matches.length>limit?matches[limit-1].Cursor:null};
}

// Page whole fixtures; player markets are loaded only on the fixture page.
// project() is the same guarded quote projection used by ordinary market reads.
export function readFixtureMarketPage({db,league,seasonId,limit,before,eventId,search,includeProps,localTesting,playerName,project,allowEmpty=false,playerId=null}) {
  if(includeProps&&!eventId)fail('Select a fixture before loading player props');
  const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
  const candidates=search?db.prepare("SELECT DISTINCT PlayerId FROM BettingMarkets WHERE SeasonId=? AND EventId IS NOT NULL AND PlayerId IS NOT NULL LIMIT 1001").all(seasonId):[];
  if(candidates.length>1000)fail('This season exceeds the supported player count',409);
  const ids=candidates.filter(p=>`${playerName(p.PlayerId)} ${p.PlayerId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p=>p.PlayerId);
  const playerMatch=ids.length?` OR m.PlayerId IN (${ids.map(()=>'?').join(',')})`:'';
  const events=league.prepare(`SELECT e.EventId,e.Team1Key,e.Team2Key,e.Stage,e.BestOf,e.ScheduledStartUtc,e.Status,e.SourceMessageId,
    a.TeamName AS Team1Name,a.ExternalTeamId AS Team1Id,b.TeamName AS Team2Name,b.ExternalTeamId AS Team2Id
    FROM ScheduledEvents e JOIN SeasonTeams a ON a.TeamSubmissionId=e.Team1Key JOIN SeasonTeams b ON b.TeamSubmissionId=e.Team2Key
    WHERE e.SeasonId=? AND (? IS NULL OR e.EventId=?) AND (? IS NULL OR e.EventId<?)
    AND (?=1 OR e.SourceMessageId IS NULL OR e.SourceMessageId NOT LIKE 'local-test:%') ORDER BY e.EventId DESC LIMIT 201`)
    .all(seasonId,eventId,eventId,before,before,Number(localTesting));
  if(events.length>200)fail('Narrow the fixture filter for this season',409);
  const matches=events.filter(e=>allowEmpty&&eventId||db.prepare(`SELECT 1 FROM BettingMarkets m WHERE m.SeasonId=? AND m.EventId=? AND m.Status IN ('open','held','locked')
    AND (?='' OR ? LIKE ? ESCAPE '\\' OR ? LIKE ? ESCAPE '\\' OR m.Title LIKE ? ESCAPE '\\'${playerMatch}) LIMIT 1`)
    .get(seasonId,e.EventId,search,e.Team1Name,pattern,e.Team2Name,pattern,pattern,...ids));
  const page=matches.slice(0,limit);
  const fixtures=page.map(e=>{
    const rows=db.prepare(`SELECT * FROM BettingMarkets WHERE SeasonId=? AND EventId=? AND Status IN ('open','held','locked')
      AND MarketType IN ('exact_score','series_winner'${includeProps?",'player_prop'":''})
      AND (MarketType!='player_prop' OR ? IS NULL OR PlayerId=?)
      AND MarketId IN (SELECT MAX(MarketId) FROM BettingMarkets WHERE SeasonId=? AND EventId=? AND Status IN ('open','held','locked')
        GROUP BY MarketType,PlayerId,TeamKey,StatKey,Scope,GameNumber)
      ORDER BY MarketId DESC LIMIT 801`).all(seasonId,e.EventId,playerId,playerId,seasonId,e.EventId);
    if(rows.length>800)fail('Fixture exceeds the supported market count',409);
    const markets=rows.map(project),players=new Map(),names=new Map();
    for(const m of markets.filter(m=>m.type==='player_prop')) {
      if(!names.has(m.playerId))names.set(m.playerId,playerName(m.playerId));
      const name=names.get(m.playerId);
      if(search&&!`${name} ${m.playerId} ${m.title} ${e.Team1Name} ${e.Team2Name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))continue;
      if(!players.has(m.playerId))players.set(m.playerId,{playerId:m.playerId,name,teamKey:m.teamKey,bettorCount:playerBettors(db,e.EventId,m.playerId),
        teamName:m.teamKey===e.Team1Key?e.Team1Name:e.Team2Name,markets:[]});
      players.get(m.playerId).markets.push(m);
    }
    const propCount=db.prepare("SELECT COUNT(*) n FROM BettingMarkets WHERE SeasonId=? AND EventId=? AND MarketType='player_prop' AND Status IN ('open','held','locked')").get(seasonId,e.EventId).n;
    return {eventId:e.EventId,team1:{teamKey:e.Team1Key,teamId:e.Team1Id,name:e.Team1Name},team2:{teamKey:e.Team2Key,teamId:e.Team2Id,name:e.Team2Name},
      stage:e.Stage,bestOf:e.BestOf,startAt:e.ScheduledStartUtc,status:e.Status,localTestFixture:e.SourceMessageId?.startsWith('local-test:')||false,
      exactScore:markets.find(m=>m.type==='exact_score')||null,winner:markets.find(m=>m.type==='series_winner')||null,
      propsAvailable:propCount>0,propsLoaded:includeProps,
      players:[...players.values()].sort((a,b)=>Number(b.teamKey===e.Team1Key)-Number(a.teamKey===e.Team1Key)||a.name.localeCompare(b.name))};
  });
  return {markets:[],fixtures,nextBefore:matches.length>limit?page.at(-1).EventId:null};
}
