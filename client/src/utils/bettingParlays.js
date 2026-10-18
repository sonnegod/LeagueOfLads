const matchupTypes=new Set(['series_winner','exact_score']);

// Shared by the slip and ticket acceptance. Overlapping versions of the same
// player/stat are excluded rather than counting the same performance twice.
export function parlayConflict(legs) {
  if(legs.length>1&&legs.some(leg=>!leg.eventId))return {code:'PRESEASON_SINGLE',message:'Preseason bets are standalone. They cannot be combined with other selections.'};
  for(let i=0;i<legs.length;i++)for(let j=0;j<i;j++) {
    const a=legs[i],b=legs[j];
    if(a.marketId===b.marketId||a.selectionId===b.selectionId&&a.selectionId!=null)
      return {code:'PARLAY_CONFLICT',message:'Choose only one outcome for each prop or market. Over and Under cannot be combined.'};
    if(a.eventId!==b.eventId)continue;
    if(matchupTypes.has(a.type)&&matchupTypes.has(b.type))
      return {code:'PARLAY_CONFLICT',message:'Related selections: choose only one matchup result per fixture.'};
    if(a.type==='player_prop'&&b.type==='player_prop'&&a.playerId===b.playerId&&a.stat===b.stat) {
      if(a.scope==='game'&&b.scope==='game'&&a.gameNumber!==b.gameNumber)continue;
      return {code:'PARLAY_CONFLICT',message:'These props overlap. Choose one series total or average for a player/stat, or separate individual-game props for that stat.'};
    }
  }
  return null;
}
