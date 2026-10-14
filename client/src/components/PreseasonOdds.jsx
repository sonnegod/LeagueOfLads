import {useState} from 'react';
import {Link} from 'react-router-dom';

const statNames={kills:'Kills',deaths:'Deaths',assists:'Assists',last_hits:'Last hits',hero_damage:'Hero damage',tower_damage:'Tower damage',healing:'Healing',gpm:'GPM',xpm:'XPM'};

export function OutcomeButton({market,selection,onChoose,slip=[],busy=false,compact=false}) {
  const preview=!onChoose;
  return <button type="button" disabled={preview||busy||market.status!=='open'||selection.available===false}
    title={preview?'Read-only historical preview':market.notice||undefined}
    aria-label={`${market.title}: ${selection.label}, odds ${selection.odds.toFixed(2)}`}
    aria-pressed={preview?undefined:slip.some(s=>s.selectionId===selection.selectionId)}
    onClick={()=>onChoose?.(market,selection)}>
    {!compact&&<span>{selection.key==='over'||selection.label.startsWith('Over')?'Over':'Under'}</span>}
    <strong>{selection.odds.toFixed(2)}</strong>
  </button>;
}

function PlayerMarketPrices({market,...actions}) {
  if(!market)return <span aria-label="Not offered">—</span>;
  return <div className="historical-line-odds"><span className="historical-market-line">{Number(market.line).toLocaleString('en-US',{maximumFractionDigits:2})}</span>
    {market.selections.map((selection,i)=><OutcomeButton key={selection.selectionId||i} market={market} selection={selection} {...actions} />)}
  </div>;
}

export function PlayerOddsRow({player,...actions}) {
  const [open,setOpen]=useState(false);const stats=new Map();
  for(const market of player.markets){if(!stats.has(market.stat))stats.set(market.stat,{});stats.get(market.stat)[market.aggregation||market.scope]=market;}
  const notices=[...new Set(player.markets.filter(m=>m.notice).map(m=>m.notice))];
  return <details className="historical-player-odds" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><strong>{player.name}</strong><span className="historical-player-team">{player.teamName}</span><span className="historical-player-count">{stats.size} stats</span></summary>
    {open&&<div className="historical-player-content">{notices.map(notice=><p className="sportsbook-notice" key={notice}>{notice}</p>)}
      <div className="historical-betting-fixtures"><table className="sportsbook-table historical-player-stats">
      <colgroup><col style={{width:'20%'}} /><col style={{width:'40%'}} /><col style={{width:'40%'}} /></colgroup>
      <thead><tr><th>Stat</th><th>Season total</th><th>Per-game average</th></tr></thead><tbody>
        {[...stats].map(([stat,markets])=><tr key={stat}><th scope="row">{statNames[stat]||stat}</th><td><PlayerMarketPrices market={markets.total} {...actions} /></td><td><PlayerMarketPrices market={markets.average} {...actions} /></td></tr>)}
      </tbody></table></div><Link to={`/player/${player.playerId}`}>Player profile</Link></div>}
  </details>;
}

export function TeamOddsGroups({groups,...actions}) {
  const columns=[{key:'champion',label:'Champion'},{key:'upper',label:'Upper bracket'},{key:'lower',label:'Lower bracket'},{key:'eliminated',label:'Eliminated'}];
  return <div className="historical-team-groups">{groups.map(group=><section className="historical-team-group" key={group.groupId??'unassigned'}>
    <h2>{group.name}</h2><div className="historical-betting-fixtures"><table className="sportsbook-table historical-team-table">
      <colgroup><col style={{width:'32%'}} />{columns.map(c=><col key={c.key} style={{width:'17%'}} />)}</colgroup>
      <thead><tr><th scope="col">Team</th>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>
        {group.teams.map(team=><tr key={team.teamKey||team.teamId}><th scope="row">{team.teamId?<Link to={`/team/${team.teamId}`} title={team.name}>{team.name}</Link>:team.name}</th>
          {columns.map(column=>{
            const offer=column.key==='champion'?team.champion:team.placement.find(p=>p.key===column.key);
            const odds=offer?.selection?.odds??(column.key==='champion'?team.championOdds:offer?.odds);
            return <td key={column.key}>{odds==null?<span aria-label="Not offered">—</span>:actions.onChoose&&offer?.market
              ?<OutcomeButton {...offer} {...actions} compact />:<strong className="historical-team-price">{odds.toFixed(2)}</strong>}</td>;
          })}
        </tr>)}
      </tbody></table></div>
  </section>)}</div>;
}
