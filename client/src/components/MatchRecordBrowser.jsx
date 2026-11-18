import {useEffect,useMemo,useState} from 'react';
import {matchRecordDay} from '../../../shared/matchRecordDay.js';

const pageSize=5;
const day=record=>matchRecordDay(record.playedAt);
const teamText=team=>`${team.name} ${team.sourceName||''} ${team.id}`;
const needsReview=record=>record.team1.needsReview||record.team2.needsReview;
function dateLabel(value) {
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}

export default function MatchRecordBrowser({leagueId,refreshKey,selectedId,disabled,onSelect}) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[query,setQuery]=useState(''),[date,setDate]=useState(''),[reviewOnly,setReviewOnly]=useState(true),[page,setPage]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch(`/api/admin/match-records${leagueId?`?leagueId=${leagueId}`:''}`,{signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not load matches');return result;})
      .then(result=>{if(!controller.signal.aborted)setData(result);})
      .catch(cause=>{if(cause.name!=='AbortError')setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[leagueId,refreshKey,revision]);
  const groups=useMemo(()=>{
    const map=new Map();
    for(const record of data?.matches||[]) {
      const key=record.seriesId?`series:${record.seriesId}`:`match:${record.matchId}`;
      if(!map.has(key))map.set(key,{key,seriesId:record.seriesId,matches:[]});
      map.get(key).matches.push(record);
    }
    const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...map.values()].map(group=>({...group,matches:group.matches.sort((a,b)=>a.matchId-b.matchId)}))
      .filter(group=>group.matches.some(record=>{
        const text=`${record.matchId} ${record.seriesId||''} ${teamText(record.team1)} ${teamText(record.team2)}`.toLowerCase();
        return (!date||day(record)===date)&&(!reviewOnly||needsReview(record))&&words.every(word=>text.includes(word));
      }));
  },[data,query,date,reviewOnly]);
  const pages=Math.max(1,Math.ceil(groups.length/pageSize)),currentPage=Math.min(page,pages-1);
  const recordsById=new Map((data?.matches||[]).map(record=>[record.matchId,record]));
  const changeFilter=setter=>event=>{setter(event.target.type==='checkbox'?event.target.checked:event.target.value);setPage(0);};
  return <section className="match-record-browser" aria-label="Find a match" aria-busy={loading}>
    <div className="match-browser-heading"><div><h4>Find a match</h4><span>{data?.league?.LeagueName||'Current season'}</span></div>
      <button type="button" disabled={disabled||loading} onClick={()=>setRevision(value=>value+1)}>{loading?'Loading…':'Refresh matches'}</button>
    </div>
    <div className="match-browser-filters">
      <label>Search<input type="search" value={query} onChange={changeFilter(setQuery)} placeholder="Team name or match ID" /></label>
      <label>Played on (NY)<input type="date" value={date} onChange={changeFilter(setDate)} /></label>
    </div>
    <div className="match-browser-filter-summary">
      <label><input type="checkbox" checked={reviewOnly} onChange={changeFilter(setReviewOnly)} /> Ungrouped teams only</label>
      {(query||date||reviewOnly)&&<button type="button" onClick={()=>{setQuery('');setDate('');setReviewOnly(false);setPage(0);}}>Clear filters</button>}
    </div>
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRevision(value=>value+1)}>Retry</button></p>}
    {!loading&&!error&&groups.length===0&&<p>{data?.matches?.length?'No matches fit these filters.':'No saved matches in this season yet. You can still load a match by ID.'}</p>}
    <div className="match-browser-results">
      {groups.slice(currentPage*pageSize,(currentPage+1)*pageSize).map(group=>{
        const first=group.matches[0],ids=[first.team1.id,first.team2.id];
        const consistent=group.matches.every(record=>ids.includes(record.team1.id)&&ids.includes(record.team2.id));
        const wins=ids.map(id=>group.matches.filter(record=>record.winnerId===id).length);
        return <article key={group.key} className="match-browser-series">
          <header><strong>{first.team1.name} <span>vs</span> {first.team2.name}</strong>
            <span className="match-browser-series-meta">{dateLabel(day(first))} · {group.seriesId?`Series #${group.seriesId}`:'Standalone game'}
              {group.seriesId&&` · ${consistent?`${wins[0]}–${wins[1]}`:'Mixed team IDs'}`}</span>
          </header>
          <div className="match-browser-games">{group.matches.map((record,index)=>{
            const winner=[record.team1,record.team2].find(team=>team.id===record.winnerId);
            const related=(record.relatedMatches||[]).map(suggestion=>({...suggestion,record:recordsById.get(suggestion.matchId)})).filter(suggestion=>suggestion.record);
            return <div key={record.matchId}><button type="button" className="match-browser-game" aria-pressed={String(selectedId)===String(record.matchId)}
              disabled={disabled} onClick={()=>onSelect(record)}>
              <span className="match-browser-game-number">{group.seriesId?`Game ${index+1}`:'Match'} <span>#{record.matchId}</span></span>
              <span className="match-browser-game-teams">{record.team1.name} <span>vs</span> {record.team2.name}</span>
              <span className="match-browser-game-result">{record.radiantScore!=null&&record.direScore!=null&&<span>{record.radiantScore}–{record.direScore}</span>}
                <span>{winner?`${winner.name} won`:'Winner not recorded'}</span>
                {needsReview(record)&&<span className="match-browser-review">Ungrouped team</span>}</span>
            </button>
            {needsReview(record)&&<div className="match-browser-related" aria-label={`Related games for match ${record.matchId}`}>
              {related.length>0?<><strong>Possible same-day series</strong>
                {related.map(suggestion=>{
                  const other=suggestion.record,teams=[other.team1,other.team2];
                  const evidence=[...suggestion.sharedTeamIds.map(id=>`Same opponent: ${teams.find(team=>team.id===id)?.name||`Team ${id}`}`),...suggestion.rosterMatches.map(match=>{
                    const from=[record.team1,record.team2].find(team=>team.id===match.fromTeamId);
                    const to=teams.find(team=>team.id===match.toTeamId);
                    return `${match.playerCount} players from ${from?.name||'ungrouped team'} match ${to?.name||'this team'}`;
                  })];
                  return <button type="button" key={other.matchId} className="match-browser-related-game" disabled={disabled}
                    aria-pressed={String(selectedId)===String(other.matchId)}
                    onClick={()=>onSelect(other)} aria-label={`Open related match ${other.matchId}`}>
                    <span>#{other.matchId}{other.seriesId?` · Series #${other.seriesId}`:' · Standalone game'}</span>
                    <strong>{other.team1.name} vs {other.team2.name}</strong>
                    <span>{evidence.join(' · ')}</span>
                  </button>;
                })}<span>Suggestions only. Compare the games before correcting a team.</span></>:<span>No related game found by team ID that day.</span>}
            </div>}
            </div>;
          })}</div>
        </article>;
      })}
    </div>
    {groups.length>0&&<div className="match-browser-pagination">
      <span>{groups.length} {groups.length===1?'matchup':'matchups'} · Page {currentPage+1} of {pages}</span>
      {pages>1&&<div><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</button>
        <button type="button" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>Next</button></div>}
    </div>}
  </section>;
}
