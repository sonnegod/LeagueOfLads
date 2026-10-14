export function plannedGameCounts(setup) {
  const snapshot=setup?.SetupJson?JSON.parse(setup.SetupJson):{};
  return snapshot.gamesByTeam||setup?.RegularGamesPerTeam;
}
export function plannedGames(setup,teamKey) {
  const counts=plannedGameCounts(setup);return typeof counts==='object'?counts[teamKey]:counts;
}
export function gameCountsChanged(setup,previous,teamKey=null,{reducedOnly=false}={}) {
  if(previous==null)return false;
  const current=plannedGameCounts(setup);
  const keys=teamKey?[teamKey]:[...new Set([...Object.keys(typeof previous==='object'?previous:{}),
    ...Object.keys(typeof current==='object'?current:{})])];
  if(!keys.length)return reducedOnly?current<previous:current!==previous;
  return keys.some(key=>{const a=typeof current==='object'?current[key]:current,b=typeof previous==='object'?previous[key]:previous;
    return reducedOnly?a<b:a!==b;});
}
