const positive=value=>Number.isSafeInteger(value)&&value>0;
const exists=(db,table)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const heroes=rows=>rows.map(row=>row.hero_id).sort((a,b)=>a-b);
const side=slot=>Number.isInteger(slot)&&slot>=0&&slot<=4?0:Number.isInteger(slot)&&slot>=128&&slot<=132?1:null;
const WINDOW_SECONDS=2*3600;
class DraftLinkError extends Error {status=400;}

export function ensureRemakeDraftSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS RemakeDraftSources (
    SourceMatchId INTEGER PRIMARY KEY,LeagueId INTEGER NOT NULL,StartTime INTEGER NOT NULL,
    TeamRad INTEGER NOT NULL,TeamDire INTEGER NOT NULL,DraftJson TEXT NOT NULL,CollectedAtUtc TEXT NOT NULL,DiscardedAtUtc TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_RemakeDraftSources_LeagueTime ON RemakeDraftSources(LeagueId,StartTime);
  CREATE TABLE IF NOT EXISTS MatchDraftSources (
    MatchId INTEGER PRIMARY KEY,SourceMatchId INTEGER NOT NULL UNIQUE,
    SideSwapped INTEGER NOT NULL CHECK(SideSwapped IN (0,1)),LinkedAtUtc TEXT NOT NULL
  );`);
  if(!db.pragma('table_info(RemakeDraftSources)').some(column=>column.name==='DiscardedAtUtc'))db.exec('ALTER TABLE RemakeDraftSources ADD COLUMN DiscardedAtUtc TEXT');
}

export function normalizeRemakeDraft(data){
  if(!positive(data?.match_id)||!positive(data.leagueid)||!positive(data.start_time)
    ||!positive(data.radiant_team_id)||!positive(data.dire_team_id)||data.radiant_team_id===data.dire_team_id
    ||data.game_mode!==2||data.radiant_score!==0||data.dire_score!==0)
    throw new DraftLinkError('Draft source must be a 0–0 Captains Mode match with known league and teams');
  if(!Array.isArray(data.picks_bans)||!data.picks_bans.length)throw new DraftLinkError('Draft source has no picks and bans');
  const draft=data.picks_bans.map(row=>({is_pick:row.is_pick,hero_id:row.hero_id,team:row.team,order:row.order}))
    .sort((a,b)=>a.order-b.order);
  if(draft.some((row,index)=>typeof row.is_pick!=='boolean'||!positive(row.hero_id)||![0,1].includes(row.team)||row.order!==index)
    ||new Set(draft.map(row=>row.hero_id)).size!==draft.length
    ||[0,1].some(team=>draft.filter(row=>row.is_pick&&row.team===team).length>5))
    throw new DraftLinkError('Draft source contains conflicting picks, bans or draft order');
  return {sourceMatchId:data.match_id,leagueId:data.leagueid,startTime:data.start_time,
    teamRad:data.radiant_team_id,teamDire:data.dire_team_id,draft};
}

function readSource(row){
  return {sourceMatchId:row.SourceMatchId,leagueId:row.LeagueId,startTime:row.StartTime,
    teamRad:row.TeamRad,teamDire:row.TeamDire,draft:JSON.parse(row.DraftJson)};
}

function saveSource(db,source,now){
  const old=db.prepare('SELECT * FROM RemakeDraftSources WHERE SourceMatchId=?').get(source.sourceMatchId);
  if(old?.DiscardedAtUtc)throw new DraftLinkError('This held draft was deleted');
  if(old&&!same(readSource(old),source))throw new DraftLinkError('Archived draft differs from this response; review the source before replacing it');
  db.prepare(`INSERT OR IGNORE INTO RemakeDraftSources
    (SourceMatchId,LeagueId,StartTime,TeamRad,TeamDire,DraftJson,CollectedAtUtc) VALUES (?,?,?,?,?,?,?)`).run(source.sourceMatchId,source.leagueId,
    source.startTime,source.teamRad,source.teamDire,JSON.stringify(source.draft),now.toISOString());
}

export function archiveRemakeDraft(db,data,now=new Date()){
  const source=normalizeRemakeDraft(data);
  return db.transaction(()=>{
    if(db.prepare('SELECT DiscardedAtUtc FROM RemakeDraftSources WHERE SourceMatchId=?').get(source.sourceMatchId)?.DiscardedAtUtc)return null;
    saveSource(db,source,now);return source;
  })();
}

export function planRemakeDraftLink(db,source,matchId,data){
  if([0,1].some(team=>source.draft.filter(row=>row.is_pick&&row.team===team).length!==5)||!source.draft.some(row=>!row.is_pick))
    throw new DraftLinkError('This draft is incomplete and must stay held or be deleted');
  if(!positive(matchId)||matchId===source.sourceMatchId||data?.match_id!==matchId)throw new DraftLinkError('Choose a different, verified played match');
  if(data.leagueid!==source.leagueId||!positive(data.start_time)||data.start_time<=source.startTime
    ||data.start_time-source.startTime>WINDOW_SECONDS)throw new DraftLinkError('Played match must follow the draft in the same league within two hours');
  if(typeof data.radiant_win!=='boolean'||(data.radiant_score===0&&data.dire_score===0))throw new DraftLinkError('Target must be a played game with a result');
  const swapped=data.radiant_team_id===source.teamDire&&data.dire_team_id===source.teamRad;
  if(!swapped&&!(data.radiant_team_id===source.teamRad&&data.dire_team_id===source.teamDire))throw new DraftLinkError('Draft and played match teams differ');
  const players=data.players;
  if(!Array.isArray(players)||players.length!==10||new Set(players.map(p=>p.account_id)).size!==10
    ||new Set(players.map(p=>p.hero_id)).size!==10||players.some(p=>!positive(p.account_id)||!positive(p.hero_id)||side(p.player_slot)===null)
    ||[0,1].some(team=>players.filter(p=>side(p.player_slot)===team).length!==5))throw new DraftLinkError('Played match needs ten identified players and heroes');
  for(const team of [0,1]){
    const drafted=heroes(source.draft.filter(row=>row.is_pick&&row.team===(swapped?1-team:team)));
    if(!same(drafted,heroes(players.filter(p=>side(p.player_slot)===team))))throw new DraftLinkError('Played heroes do not match the original draft by team');
  }
  const recorded=db.prepare('SELECT * FROM MatchTeam WHERE MatchId=?').get(matchId);
  if(!recorded||recorded.TeamRad!==data.radiant_team_id||recorded.TeamDire!==data.dire_team_id
    ||![recorded.TeamRad,recorded.TeamDire].includes(recorded.WinnerId)||recorded.Rehost)
    throw new DraftLinkError('Import the verified played match before attaching its draft');
  if(!db.prepare('SELECT 1 FROM MatchLeague WHERE MatchId=? AND LeagueId=?').get(matchId,source.leagueId))throw new DraftLinkError('Recorded match belongs to a different league');
  const stored=db.prepare(`SELECT DISTINCT p.PlayerId,p.HeroId,t.TeamId FROM MatchPlayer p
    JOIN MatchTeamPlayer t ON t.MatchId=p.MatchId AND t.PlayerId=p.PlayerId WHERE p.MatchId=?`).all(matchId);
  if(stored.length!==10||players.some(p=>!stored.some(row=>row.PlayerId===p.account_id&&row.HeroId===p.hero_id
    &&row.TeamId===(side(p.player_slot)===0?recorded.TeamRad:recorded.TeamDire))))throw new DraftLinkError('Recorded players and heroes differ from the verified played match');
  const rows=source.draft.map(row=>({IsPick:Number(row.is_pick),Hero_Id:row.hero_id,OrderNum:row.order,Team:swapped?1-row.team:row.team}));
  const existing=db.prepare('SELECT DISTINCT IsPick,Hero_Id,OrderNum,Team FROM PickInfo WHERE MatchId=? ORDER BY OrderNum').all(matchId);
  if(existing.length&&!same(existing,rows))throw new DraftLinkError('Played match already has a different draft; it will not be overwritten');
  const link=exists(db,'MatchDraftSources')?db.prepare('SELECT * FROM MatchDraftSources WHERE MatchId=? OR SourceMatchId=?').all(matchId,source.sourceMatchId):[];
  if(link.some(row=>row.MatchId!==matchId||row.SourceMatchId!==source.sourceMatchId))throw new DraftLinkError('Draft source or played match is already linked elsewhere');
  return {sourceMatchId:source.sourceMatchId,matchId,sideSwapped:swapped,rows,
    picks:rows.filter(row=>row.IsPick).length,bans:rows.filter(row=>!row.IsPick).length,alreadyLinked:link.length>0};
}

export function linkRemakeDraft(db,source,matchId,data,now=new Date()){
  return db.transaction(()=>{
    const plan=planRemakeDraftLink(db,source,matchId,data);
    saveSource(db,source,now);
    const insert=db.prepare(`INSERT INTO PickInfo (MatchId,IsPick,Hero_Id,OrderNum,Team)
      SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM PickInfo WHERE MatchId=? AND OrderNum=?)`);
    for(const row of plan.rows)insert.run(matchId,row.IsPick,row.Hero_Id,row.OrderNum,row.Team,matchId,row.OrderNum);
    db.prepare('INSERT OR IGNORE INTO MatchDraftSources VALUES (?,?,?,?)').run(matchId,source.sourceMatchId,Number(plan.sideSwapped),now.toISOString());
    return plan;
  }).immediate();
}

export function linkMatchingRemakeDraft(db,matchId,data){
  if(db.prepare('SELECT 1 FROM PickInfo WHERE MatchId=? LIMIT 1').get(matchId))return {status:'draft_present'};
  const sources=db.prepare(`SELECT s.* FROM RemakeDraftSources s WHERE s.LeagueId=? AND s.StartTime<? AND s.StartTime>=?
    AND s.DiscardedAtUtc IS NULL AND NOT EXISTS(SELECT 1 FROM MatchDraftSources link WHERE link.SourceMatchId=s.SourceMatchId)`).all(data.leagueid,data.start_time,data.start_time-WINDOW_SECONDS);
  const matches=[];
  for(const row of sources){
    const source=readSource(row);
    try{planRemakeDraftLink(db,source,matchId,data);matches.push(source);}catch{/* Incompatible candidates are left for explicit review. */}
  }
  if(matches.length!==1)return {status:matches.length?'ambiguous':'no_match',candidates:matches.length};
  return {status:'linked',...linkRemakeDraft(db,matches[0],matchId,data)};
}

export function heldRemakeDraft(db,sourceId){
  if(!exists(db,'RemakeDraftSources'))return null;
  const row=db.prepare(`SELECT s.* FROM RemakeDraftSources s WHERE s.SourceMatchId=? AND s.DiscardedAtUtc IS NULL
    AND NOT EXISTS(SELECT 1 FROM MatchDraftSources l WHERE l.SourceMatchId=s.SourceMatchId)`).get(sourceId);
  return row?readSource(row):null;
}

export function canonicalDraftTarget(db,matchId,leagueId){
  const match=db.prepare('SELECT * FROM MatchTeam WHERE MatchId=?').get(matchId);
  const league=db.prepare('SELECT * FROM MatchLeague WHERE MatchId=? AND LeagueId=?').get(matchId,leagueId);
  if(!match||!league)throw new DraftLinkError('Played match is not in this league');
  const source=exists(db,'MatchSourceDetails')?db.prepare('SELECT StartedAtUtc FROM MatchSourceDetails WHERE MatchId=?').get(matchId):null;
  const precise=source?.StartedAtUtc||(typeof league.DatePlayed==='string'&&league.DatePlayed.length>10?league.DatePlayed:null);
  const start=match.StartTimeUtc||(precise?Date.parse(precise)/1000:null);
  const rows=db.prepare(`SELECT DISTINCT p.PlayerId,p.HeroId,t.TeamId FROM MatchPlayer p
    JOIN MatchTeamPlayer t ON t.MatchId=p.MatchId AND t.PlayerId=p.PlayerId WHERE p.MatchId=? ORDER BY t.TeamId,p.PlayerId`).all(matchId);
  const counters=[0,0];
  return {match_id:matchId,leagueid:leagueId,start_time:start,radiant_team_id:match.TeamRad,dire_team_id:match.TeamDire,
    radiant_win:match.WinnerId===match.TeamRad,radiant_score:match.RadiantScore,dire_score:match.DireScore,
    players:rows.map(row=>{const team=row.TeamId===match.TeamRad?0:row.TeamId===match.TeamDire?1:null;
      return {account_id:row.PlayerId,hero_id:row.HeroId,player_slot:team===null?-1:(team?128:0)+counters[team]++};})};
}

export function heldRemakeDrafts(db,leagueId){
  if(!exists(db,'RemakeDraftSources'))return [];
  const ids=db.prepare(`SELECT s.SourceMatchId FROM RemakeDraftSources s WHERE s.LeagueId=? AND s.DiscardedAtUtc IS NULL
    AND NOT EXISTS(SELECT 1 FROM MatchDraftSources l WHERE l.SourceMatchId=s.SourceMatchId)
    ORDER BY s.StartTime DESC LIMIT 50`).all(leagueId);
  const name=id=>exists(db,'TeamInfo')?db.prepare('SELECT TeamName FROM TeamInfo WHERE TeamId=?').get(id)?.TeamName||`Team ${id}`:`Team ${id}`;
  return ids.map(({SourceMatchId})=>{
    const source=heldRemakeDraft(db,SourceMatchId);
    const candidates=db.prepare(`SELECT DISTINCT m.MatchId FROM MatchTeam m JOIN MatchLeague ml ON ml.MatchId=m.MatchId
      WHERE ml.LeagueId=? AND ((m.TeamRad=? AND m.TeamDire=?) OR (m.TeamRad=? AND m.TeamDire=?))
      AND NOT EXISTS(SELECT 1 FROM PickInfo p WHERE p.MatchId=m.MatchId) ORDER BY m.MatchId DESC LIMIT 100`)
      .all(leagueId,source.teamRad,source.teamDire,source.teamDire,source.teamRad).flatMap(({MatchId})=>{
        try{const data=canonicalDraftTarget(db,MatchId,leagueId);planRemakeDraftLink(db,source,MatchId,data);
          return [{matchId:MatchId,startedAt:new Date(data.start_time*1000).toISOString()}];
        }catch(error){if(error instanceof DraftLinkError)return [];throw error;}
      });
    return {...source,startedAt:new Date(source.startTime*1000).toISOString(),teamRadName:name(source.teamRad),teamDireName:name(source.teamDire),candidates};
  });
}

export function discardHeldRemakeDraft(db,sourceId,now=new Date()){
  return db.prepare(`UPDATE RemakeDraftSources SET DraftJson='[]',DiscardedAtUtc=?
    WHERE SourceMatchId=? AND DiscardedAtUtc IS NULL
    AND NOT EXISTS(SELECT 1 FROM MatchDraftSources l WHERE l.SourceMatchId=RemakeDraftSources.SourceMatchId)`)
    .run(now.toISOString(),sourceId).changes;
}
