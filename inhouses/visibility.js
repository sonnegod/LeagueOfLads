export function visibleSnapshot(snapshot, {playerId=null,administrator=false,management=false}={}) {
  if(management||administrator&&snapshot.settings.availability!=='closed'||snapshot.settings.availability==='open')return snapshot;
  return {...snapshot,queue:[],bots:[],
    games:snapshot.games.filter(g=>g.players.some(p=>p.playerId===playerId)),
    leaderboard:snapshot.leaderboard.filter(p=>p.playerId===playerId)};
}

export function visibleActivity(queue, player, administrator=false) {
  if(administrator&&queue.availability!=='closed'||queue.availability==='open')return queue;
  const games=queue.games.filter(g=>g.id===player.activeGameId),activePlayers=games.reduce((n,g)=>n+g.playerCount,0);
  return {...queue,count:0,players:[],games,activePlayers,totalPlayers:activePlayers};
}

export function canKeepInhouseStream(snapshot,viewer) {
  return viewer.management||snapshot.settings.availability!=='closed'||snapshot.games.some(game=>
    !['completed','cancelled'].includes(game.status)&&game.players.some(player=>player.playerId===viewer.playerId));
}
