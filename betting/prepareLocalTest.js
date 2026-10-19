import {localBettingTestMode} from './localTestPolicy.js';

export function prepareLocalTestSeason(schedules,seasonId,now=new Date(),env=process.env) {
  if(!localBettingTestMode(env))throw new Error('Enable development-only betting test mode first');
  const season=schedules.db.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
  if(season?.Status!=='signup_closed')throw new Error('Local test preparation requires closed signups; it does not start the league');
  schedules.finalizeSetup(seasonId,'group_round_robin',null,now);
  const existing=schedules.list(seasonId,{includeLocalTests:true}).find(e=>e.Stage==='regular'&&e.Status==='scheduled'&&!e.StartedAtUtc&&Date.parse(e.ScheduledStartUtc)>now.getTime());
  if(existing)return {prepared:true,fixtureId:existing.EventId,createdFixture:false,kickoff:existing.ScheduledStartUtc};
  const teams=schedules.teams(seasonId),pair=teams.find(t=>teams.filter(o=>o.GroupId===t.GroupId).length>=2);
  if(!pair)throw new Error('Assign at least two teams to one group');
  const other=teams.find(t=>t.GroupId===pair.GroupId&&t.TeamSubmissionId!==pair.TeamSubmissionId);
  const event=schedules.save(seasonId,{team1Key:pair.TeamSubmissionId,team2Key:other.TeamSubmissionId,stage:'regular',bestOf:2,
    scheduledStartUtc:new Date(now.getTime()+3*86400000).toISOString(),status:'scheduled',
    sourceMessageId:`local-test:${seasonId}:${now.getTime()}`},null,now);
  return {prepared:true,fixtureId:event.EventId,createdFixture:true,kickoff:event.ScheduledStartUtc};
}
