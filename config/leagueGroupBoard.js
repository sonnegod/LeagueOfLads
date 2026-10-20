import {createHash,randomUUID} from 'node:crypto';
import {saveRegisteredLeagueTeam} from './leagueParticipants.js';

export const groupTeamKey = team => team.EntryId != null ? `entry:${team.EntryId}` : `team:${team.TeamId}`;
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const validName = value => typeof value==='string' && value.trim().length>0 && value.trim().length<=60;

// Standings can change overnight without invalidating an admin's group draft.
export function leagueGroupBoardRevision(board) {
  const groups=board.groups.map(g=>({id:g.GroupId,name:g.GroupName,teams:g.teams.map(t=>({
    key:groupTeamKey(t),name:t.TeamName,teamId:t.TeamId,submission:t.TeamSubmissionId??null,
  })).sort((a,b)=>a.key.localeCompare(b.key))})).sort((a,b)=>a.id-b.id);
  const available=board.availableTeams.map(t=>({id:t.TeamId,name:t.TeamName})).sort((a,b)=>a.id-b.id);
  const unregistered=(board.unregisteredTeams||[]).map(t=>({id:t.TeamSubmissionId,name:t.TeamName,teamId:t.TeamId}))
    .sort((a,b)=>a.id-b.id);
  return createHash('sha256').update(JSON.stringify({leagueId:board.league?.LeagueId??null,groups,available,unregistered})).digest('hex');
}

export function saveLeagueGroupBoard(db,input,{readBoard,rebuild,audit}) {
  return db.transaction(()=>{
    const before=readBoard(),leagueId=before.league?.LeagueId;
    if(!leagueId || input?.leagueId!==leagueId)fail('The active league changed. Cancel editing and reload the groups.',409);
    if(typeof input.revision!=='string'||input.revision!==before.revision)
      fail('Another admin or league update changed these groups. Cancel editing to load the latest version.',409);
    if(!Array.isArray(input.groups)||!Array.isArray(input.teams)||input.groups.length>50||input.teams.length>500)
      fail('Invalid group setup');
    const existingGroups=new Map(before.groups.map(g=>[g.GroupId,g]));
    const groups=new Map(),groupNames=new Set();
    for(const group of input.groups) {
      const newGroup=typeof group?.id==='string'&&/^new-group:[a-z0-9-]{1,80}$/i.test(group.id);
      if((!existingGroups.has(group?.id)&&!newGroup)||groups.has(group.id)||!validName(group.name))fail('Enter unique groups with names of 1–60 characters');
      const name=group.name.trim(),normalized=name.toLocaleLowerCase('en-US');
      if(groupNames.has(normalized))fail('Group names must be unique');
      groups.set(group.id,{...group,name});groupNames.add(normalized);
    }
    if([...existingGroups.keys()].some(id=>!groups.has(id)))fail('Existing groups must remain in the setup');
    const originalTeams=new Map(before.groups.flatMap(g=>g.teams.map(t=>[groupTeamKey(t),{...t,GroupId:g.GroupId}])));
    for(const team of before.availableTeams)originalTeams.set(groupTeamKey(team),{...team,GroupId:null});
    for(const team of before.unregisteredTeams||[])originalTeams.set(`submission:${team.TeamSubmissionId}`,{...team,GroupId:null,Unregistered:true});
    const availableIds=new Set(before.availableTeams.map(t=>t.TeamId));
    const selected=new Map(),teamIds=new Set(),namesByGroup=new Set();
    for(const team of input.teams) {
      const original=originalTeams.get(team?.key);
      const newTeam=typeof team?.key==='string'&&/^new-team:[a-z0-9-]{1,80}$/i.test(team.key);
      if((!original&&!newTeam)||selected.has(team.key)||!validName(team.name))fail('Invalid or repeated team');
      if(team.groupId!==null&&!groups.has(team.groupId))fail('Choose a valid group for every team');
      const name=team.name.trim(),teamId=team.teamId;
      if(teamId!==null&&(!Number.isSafeInteger(teamId)||teamId<=0))fail('Choose a valid team ID');
      if(original?.TeamId!=null&&(teamId!==original.TeamId||name!==original.TeamName))fail('Use Team Changes to rename or replace an already linked team ID');
      if(teamId!==null&&teamId!==original?.TeamId&&!availableIds.has(teamId))fail('A selected team ID is no longer available',409);
      const registered=original?.EntryId!=null||newTeam;
      if(registered&&team.groupId===null)fail('Assign every signup or named team to a group before saving');
      if(original?.Unregistered&&team.groupId===null&&teamId!==null)fail('Assign an unregistered team to a group before linking a team ID');
      if(team.groupId!==null) {
        const key=`${team.groupId}:${name.toLocaleLowerCase('en-US')}`;
        if(namesByGroup.has(key))fail('A group cannot contain the same team name twice');
        namesByGroup.add(key);
        if(teamId!==null) {
          if(teamIds.has(teamId))fail('A team ID cannot belong to two teams or groups');
          teamIds.add(teamId);
        }
      }
      selected.set(team.key,{...team,name,original,newTeam});
    }
    for(const [key,team] of originalTeams)if(!selected.has(key)&&(team.EntryId==null||team.TeamId!=null))
      fail('Existing played teams must remain in the setup');

    const season=db.prepare("SELECT SeasonId FROM LeagueSeasons WHERE ExternalLeagueId=? AND Status='active'").get(leagueId);
    const seasonGroups=season?db.prepare('SELECT GroupId,SortOrder FROM SeasonGroups WHERE SeasonId=? ORDER BY SortOrder,GroupId').all(season.SeasonId):[];
    if(season&&[...existingGroups.keys()].some(id=>!seasonGroups[id-1]))
      fail('The public groups do not match the season setup. Correct that alignment before adding or moving teams.',409);
    const token=`group-edit-${randomUUID()}`;
    // Stage names so swaps are valid even with case-insensitive uniqueness indexes.
    if(season)for(const group of existingGroups.values())db.prepare('UPDATE SeasonGroups SET GroupName=? WHERE GroupId=?')
      .run(`${token}:${group.GroupId}`,seasonGroups[group.GroupId-1].GroupId);
    let nextGroup=Math.max(0,seasonGroups.length,...existingGroups.keys());
    let nextOrder=Math.max(0,...seasonGroups.map(g=>g.SortOrder));
    for(const group of groups.values()) {
      group.publicId=existingGroups.has(group.id)?group.id:++nextGroup;
      if(existingGroups.has(group.id)) {
        db.prepare('UPDATE GroupNames SET GroupName=? WHERE LeagueId=? AND GroupId=?').run(group.name,leagueId,group.publicId);
        if(season)db.prepare('UPDATE SeasonGroups SET GroupName=? WHERE GroupId=?').run(group.name,seasonGroups[group.id-1].GroupId);
      }else {
        db.prepare('INSERT INTO GroupNames(LeagueId,GroupId,GroupName) VALUES(?,?,?)').run(leagueId,group.publicId,group.name);
        if(season)db.prepare('INSERT INTO SeasonGroups(SeasonId,GroupName,SortOrder) VALUES(?,?,?)').run(season.SeasonId,group.name,++nextOrder);
      }
    }
    const entries=[...originalTeams.values()].filter(t=>t.EntryId!=null);
    for(const team of entries) {
      if(!selected.has(groupTeamKey(team))) {
        // Suggested opponents reference this entry; remove them before deleting the team.
        db.prepare(`DELETE FROM SeasonMatchups WHERE SeasonId IN(
          SELECT SeasonId FROM LeagueSeasons WHERE ExternalLeagueId=?)
          AND (TeamAEntryId=? OR TeamBEntryId=?)`).run(leagueId,team.EntryId,team.EntryId);
        db.prepare('DELETE FROM LeagueRosterEntries WHERE LeagueId=? AND EntryId=?').run(leagueId,team.EntryId);
      }else db.prepare('UPDATE LeagueRosterEntries SET DisplayName=? WHERE LeagueId=? AND EntryId=?').run(`${token}:${team.EntryId}`,leagueId,team.EntryId);
    }
    const orders=new Map();
    const nextSort=groupId=>{const order=(orders.get(groupId)||0)+1;orders.set(groupId,order);return order;};
    for(const team of selected.values()) {
      const groupId=team.groupId===null?null:groups.get(team.groupId).publicId;
      if(team.original?.Unregistered) {
        if(!season)fail('The signup season is no longer active',409);
        if(groupId===null) {
          db.prepare('UPDATE SeasonTeams SET TeamName=?,UpdatedAt=? WHERE SeasonId=? AND TeamSubmissionId=?')
            .run(team.name,new Date().toISOString(),season.SeasonId,team.original.TeamSubmissionId);
        }else {
          const seasonGroup=db.prepare('SELECT GroupId FROM SeasonGroups WHERE SeasonId=? ORDER BY SortOrder,GroupId')
            .all(season.SeasonId)[groupId-1];
          if(!seasonGroup)fail('This group has no matching season group',409);
          db.prepare('UPDATE SeasonTeams SET GroupId=? WHERE SeasonId=? AND TeamSubmissionId=?')
            .run(seasonGroup.GroupId,season.SeasonId,team.original.TeamSubmissionId);
          const added=db.prepare(`INSERT INTO LeagueRosterEntries(LeagueId,GroupId,DisplayName,SortOrder,TeamSubmissionId)
            VALUES(?,?,?,?,?)`).run(leagueId,groupId,team.name,nextSort(groupId),team.original.TeamSubmissionId);
          saveRegisteredLeagueTeam(db,leagueId,{entryId:Number(added.lastInsertRowid),teamId:team.teamId,teamName:team.name,groupId},{rebuild:()=>{},audit:()=>{}});
        }
      }else if(team.original?.EntryId!=null) {
        saveRegisteredLeagueTeam(db,leagueId,{entryId:team.original.EntryId,teamId:team.teamId,teamName:team.name,groupId},{rebuild:()=>{},audit:()=>{}});
        db.prepare('UPDATE LeagueRosterEntries SET SortOrder=? WHERE EntryId=?').run(nextSort(groupId),team.original.EntryId);
      }else if(team.newTeam) {
        const added=db.prepare('INSERT INTO LeagueRosterEntries(LeagueId,GroupId,DisplayName,SortOrder) VALUES(?,?,?,?)')
          .run(leagueId,groupId,team.name,nextSort(groupId));
        if(team.teamId!==null)saveRegisteredLeagueTeam(db,leagueId,{entryId:Number(added.lastInsertRowid),teamId:team.teamId,teamName:team.name,groupId},{rebuild:()=>{},audit:()=>{}});
      }else if(groupId!==team.original.GroupId) {
        if(team.original.GroupId!=null)db.prepare('DELETE FROM GroupResultOverrides WHERE LeagueId=? AND GroupId=? AND (TeamA=? OR TeamB=?)')
          .run(leagueId,team.original.GroupId,team.teamId,team.teamId);
        if(groupId===null)db.prepare('DELETE FROM LeagueGroups WHERE LeagueId=? AND TeamId=?').run(leagueId,team.teamId);
        else db.prepare('INSERT INTO LeagueGroups(LeagueId,TeamId,GroupId) VALUES(?,?,?) ON CONFLICT(LeagueId,TeamId) DO UPDATE SET GroupId=excluded.GroupId')
          .run(leagueId,team.teamId,groupId);
      }
    }
    rebuild(leagueId);
    audit('Group Setup Save',`League ${leagueId}: saved ${groups.size} groups and ${[...selected.values()].filter(t=>t.groupId!==null).length} assigned teams`);
  }).immediate();
}
