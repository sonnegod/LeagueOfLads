// Public grouping uses source identities and offered quotes only. Never project
// the private forecast/input snapshot into a browser response.
export function groupPlayerMarkets(markets,players,teams) {
  return players.map(player=>({playerId:player.playerId,name:player.name,
    teamName:teams.find(t=>t.TeamSubmissionId===markets.find(m=>m.playerId===player.playerId)?.teamKey)?.TeamName||'',
    markets:markets.filter(m=>m.playerId===player.playerId)}));
}

export function groupTeamMarkets(markets,teams,groupNames={}) {
  const identity=({selections,...market})=>market;
  const groups=new Map();
  const champion=markets.find(m=>m.type==='champion');
  for(const team of teams) {
    const placement=markets.find(m=>m.type==='placement'&&m.teamKey===team.TeamSubmissionId);
    const wins=markets.find(m=>m.type==='season_team'&&m.stat==='wins'&&m.teamKey===team.TeamSubmissionId);
    const selection=champion?.selections.find(s=>s.key===`team:${team.TeamSubmissionId}`);
    if(!placement&&!selection&&!wins)continue;
    if(!groups.has(team.GroupId))groups.set(team.GroupId,{groupId:team.GroupId,
      name:groupNames[team.GroupId]||(team.GroupId==null?'Unassigned':`Group ${team.GroupId}`),teams:[]});
    groups.get(team.GroupId).teams.push({teamKey:team.TeamSubmissionId,teamId:team.ExternalTeamId,name:team.TeamName,pendingPlayers:team.PendingPlayers||0,
      champion:selection?{market:identity(champion),selection}:null,
      wins:wins||null,
      placement:placement?placement.selections.map(s=>({key:s.key,market:identity(placement),selection:s})):[]});
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))
    .map(group=>({...group,teams:group.teams.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.teamKey-b.teamKey)}));
}
