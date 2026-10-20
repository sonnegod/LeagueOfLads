import {normalizeLeagueRules,normalizeQualificationPlan} from './leagueRules.js';
import {createHash} from 'node:crypto';
import {ensureTiebreakerStageSchema} from './tiebreakerStage.js';

export const qualificationRevision=rules=>createHash('sha256').update(JSON.stringify(rules?normalizeLeagueRules(rules):null)).digest('hex');

// Additive startup migration; no historical data scan or rule conversion.
export function ensureQualificationSchema(db) {
  ensureTiebreakerStageSchema(db);
  for(const table of ['LeagueRules']) {
    const columns=db.pragma(`table_info(${table})`);
    if(columns.length&&!columns.some(c=>c.name==='QualificationJson'))db.exec(`ALTER TABLE ${table} ADD COLUMN QualificationJson TEXT`);
  }
}

export function saveQualificationRules(db,key,values,groupSizes=null) {
  if(db.prepare('SELECT 1 FROM LeagueQualificationStages WHERE LeagueId=?').get(key))
    throw Object.assign(Error('Qualification rules are locked after tiebreakers start.'),{status:409});
  const rules=normalizeLeagueRules(values);
  if(rules.QualificationPlan)normalizeQualificationPlan(rules.QualificationPlan,groupSizes);
  else {
    for(const field of ['UpperBracketTeams','LowerBracketTeams','EliminatedTeams'])if(values[field]==null||values[field]===''
      ||!Number.isSafeInteger(Number(values[field]))||Number(values[field])<0)throw Object.assign(Error('Team counts must be non-negative integers'),{status:400});
    if(rules.HasTiebreaker&&(!Number.isSafeInteger(Number(values.TiebreakerPosition))||Number(values.TiebreakerPosition)<1))
      throw Object.assign(Error('Tiebreaker position must be a positive integer'),{status:400});
  }
  db.prepare(`INSERT INTO LeagueRules(LeagueId,UpperBracketTeams,LowerBracketTeams,EliminatedTeams,HasTiebreaker,TiebreakerPosition,QualificationJson)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(LeagueId) DO UPDATE SET UpperBracketTeams=excluded.UpperBracketTeams,
    LowerBracketTeams=excluded.LowerBracketTeams,EliminatedTeams=excluded.EliminatedTeams,HasTiebreaker=excluded.HasTiebreaker,
    TiebreakerPosition=excluded.TiebreakerPosition,QualificationJson=excluded.QualificationJson`)
    .run(key,rules.UpperBracketTeams,rules.LowerBracketTeams,rules.EliminatedTeams,Number(rules.HasTiebreaker),rules.TiebreakerPosition,
      rules.QualificationPlan?JSON.stringify(rules.QualificationPlan):null);
  return db.prepare('SELECT * FROM LeagueRules WHERE LeagueId=?').get(key);
}

export function refreshQualificationSetup(db,schedules,leagueId,now=new Date()) {
  const season=db.prepare("SELECT SeasonId FROM LeagueSeasons WHERE ExternalLeagueId=? AND Status='active'").get(leagueId);
  const setup=season&&schedules.setup(season.SeasonId);
  if(!setup||setup.Completion!=='normal')return false;
  const hasTable=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if(hasTable('MatchLeague')&&db.prepare('SELECT 1 FROM MatchLeague WHERE LeagueId=? LIMIT 1').get(leagueId)
    ||hasTable('LiveMatchCurrentState')&&db.prepare('SELECT 1 FROM LiveMatchCurrentState WHERE LeagueId=? LIMIT 1').get(leagueId))return false;
  if(schedules.list(season.SeasonId).some(event=>event.Stage==='regular'&&
    (event.StartedAtUtc||['started','completed'].includes(event.Status)||event.Status==='scheduled'&&Date.parse(event.ScheduledStartUtc)<=now.getTime())))return false;
  schedules.finalizeSetup(season.SeasonId,JSON.parse(setup.SetupJson).gamesByTeam?'group_round_robin':setup.RegularGamesPerTeam,'rules',now);
  return true;
}
