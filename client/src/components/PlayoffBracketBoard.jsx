import {useState} from 'react';
import {Link} from 'react-router-dom';
import {playoffMatches,playoffLabels,playoffResult,playoffSlotLabel,playoffFormat} from '../../../shared/playoffBracket.js';
import './CurrentPlayoffBracketView.css';

const kickoff=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):null;
function MatchCard({match,bracket,detail={},labels,onSelect,selected,related,dimmed,onFocus}) {
  const game={...match,...detail,bestOf:detail.bestOf||playoffFormat(match)},result=playoffResult(game);
  const status=game.seriesStatus==='needs_review'||!result.valid?'Needs review':game.live?'Live':result.complete?'Complete'
    :game.seriesStatus==='needs_format'?'Set format':result.a||result.b?'In progress':!game.team1Id||!game.team2Id?'Awaiting teams':game.kickoff?'Scheduled':'Ready';
  const label=labels.get(match.id),time=kickoff(game.kickoff);
  const click=event=>{if(onSelect&&!event.target.closest('a,button'))onSelect(match.id);};
  return <article className={`playoff-match${selected?' is-selected':''}${related?' is-related':''}${dimmed?' is-dimmed':''}${result.complete?' is-complete':''}${game.live?' is-live':''}`}
    data-match-id={match.id} onClick={click} onMouseEnter={()=>onFocus(match.id)} onMouseLeave={()=>onFocus(null)} onFocus={()=>onFocus(match.id)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))onFocus(null);}}>
    <div className="playoff-match-heading">
      {onSelect?<button type="button" className="playoff-match-edit" onClick={()=>onSelect(match.id)} aria-label={`Edit ${label}`}>{label}<span>Edit</span></button>:<strong>{label}</strong>}
      {status!=='Complete'&&<span className={`playoff-status status-${status.toLowerCase().replaceAll(' ','-')}`}>{status}</span>}
    </div>
    {[1,2].map(slot=>{
      const id=game[`team${slot}Id`],name=String(game[`team${slot}Name`]||'TBD'),seed=game[`team${slot}Seed`];
      const source=playoffSlotLabel(bracket,match.id,slot);
      return <div key={slot} className={`playoff-team${result.winnerSlot===slot?' is-winner':''}${result.loserSlot===slot?' is-loser':''}`}>
        <div className="playoff-team-copy"><div className="playoff-team-name">{seed&&<span className="playoff-seed">{seed}</span>}
          {id?<Link to={`/team/${id}`} title={name}>{name}</Link>:<span className="playoff-placeholder">{source==='Select team'?'Unassigned':source}</span>}</div>
          {source!=='Select team'&&id&&<small>{source}</small>}</div>
        <strong className="playoff-score" aria-label={`${id?name:source} score`}>{id?game[`team${slot}Score`]||0:'–'}</strong>
      </div>;
    })}
    <div className="playoff-match-meta">{time?<span>{time} NY</span>:<span>{game.bracket==='grand'?'Championship series':game.resultSource==='manual'?'Manual score':'Time to be announced'}</span>}
      {game.seriesId&&<Link to={`/series/${game.seriesId}`}>View series</Link>}</div>
    <div className="playoff-match-path">{game.winnerTo?<span>Win → {labels.get(game.winnerTo)||game.winnerTo}</span>:<span>Win → Champion</span>}
      <span>{game.loserTo?`Loss → ${labels.get(game.loserTo)||game.loserTo}`:game.bracket==='grand'?'Loss → Runner-up':'Loss → Eliminated'}</span></div>
  </article>;
}

export default function PlayoffBracketBoard({bracket,matchDetails={},onSelect,selectedId}) {
  const [section,setSection]=useState('all'),[search,setSearch]=useState(''),[hovered,setHovered]=useState(null);
  const matches=playoffMatches(bracket),labels=playoffLabels(bracket),focus=selectedId||hovered;
  const focused=matches.find(match=>match.id===focus);
  const related=new Set(focus?[focus,focused?.winnerTo,focused?.loserTo,...matches.filter(match=>match.winnerTo===focus||match.loserTo===focus).map(match=>match.id)]:[]);
  const needle=search.trim().toLocaleLowerCase();
  const complete=matches.filter(match=>playoffResult({...match,...matchDetails[match.id]}).complete).length;
  const upperCount=(bracket.upperBracket[0]?.matches.length||0)*2,lowerCount=(bracket.lowerBracket[0]?.matches.length||0)*2;
  const card=match=><MatchCard key={match.id} match={match} bracket={bracket} detail={matchDetails[match.id]} labels={labels} onSelect={onSelect}
    selected={selectedId===match.id} related={related.has(match.id)} dimmed={Boolean(needle)&&![match.team1Name,match.team2Name].some(name=>String(name||'').toLocaleLowerCase().includes(needle))} onFocus={setHovered}/>;
  function rounds(items,kind,final=false) {
    const max=Math.max(1,...items.map(round=>round.matches.length));
    return <div className={`playoff-rounds-scroll playoff-${kind}`} tabIndex={0} aria-label={`${kind==='upper'?'Upper':'Lower'} bracket rounds`}>
      <div className="playoff-rounds">
        {items.map((round,index)=><section className="playoff-round" key={round.round}>
          <header><h4>{index===items.length-1?`${kind==='upper'?'Upper':'Lower'} final`:`Round ${round.round}`}</h4><span>{round.matches.length} series</span></header>
          <div className="playoff-round-matches" style={{gridTemplateRows:`repeat(${max}, minmax(208px, 1fr))`}}>
            {round.matches.map((match,i)=><div className="playoff-match-slot" key={match.id} style={{gridRow:`${Math.floor(i*max/round.matches.length)+1} / ${Math.floor((i+1)*max/round.matches.length)+1}`}}>{card(match)}</div>)}
          </div>
        </section>)}
        {final&&<section className="playoff-round playoff-final"><header><h4>Grand final</h4><span>Championship</span></header><div className="playoff-final-match">{bracket.grandFinals.map(card)}</div></section>}
      </div>
    </div>;
  }
  return <div className="playoff-board">
    <div className="playoff-board-toolbar"><div className="ui-tabs playoff-section-tabs" aria-label="Bracket section">{[['all','All'],['upper','Upper'],['lower','Lower'],['final','Final']].map(([value,label])=>
      <button type="button" key={value} className="ui-tab" aria-pressed={section===value} onClick={()=>setSection(value)}>{label}</button>)}</div>
      <label className="playoff-search"><span className="sr-only">Find a team in the bracket</span><input type="search" placeholder="Find a team" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
    <div className="playoff-board-summary"><span><strong>{upperCount}</strong> upper · <strong>{lowerCount}</strong> lower</span><span>{complete} / {matches.length} series complete</span></div>
    {(section==='all'||section==='upper')&&<section className="playoff-branch"><h3><span className="playoff-branch-dot upper"/>Upper bracket</h3>{rounds(bracket.upperBracket,'upper',section==='all')}</section>}
    {(section==='all'||section==='lower')&&<section className="playoff-branch"><h3><span className="playoff-branch-dot lower"/>Lower bracket</h3>{rounds(bracket.lowerBracket,'lower')}</section>}
    {section==='final'&&<section className="playoff-final-standalone"><h3>Grand final</h3>{bracket.grandFinals.map(card)}</section>}
  </div>;
}
