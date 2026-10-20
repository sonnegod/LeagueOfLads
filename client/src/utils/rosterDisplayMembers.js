export function rosterDisplayMembers(roster) {
  const order=roster.SlotOrder||[0,1,2,3,4];
  const members=[...roster.players,...(roster.pendingSlots||[]).map(slot=>({...slot,pending:true}))];
  return members.sort((a,b)=>order.indexOf(a.Slot)-order.indexOf(b.Slot));
}
