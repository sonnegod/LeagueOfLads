import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import './SignupHistoryPanel.css';

const mmr=value=>value==null?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:0});
const status=value=>({draft:'Draft',signup_open:'Signups open',signup_closed:'Signups closed',active:'Active',ended:'Ended'})[value]||value;
async function load(url,signal) {
  const response=await fetch(url,{signal,cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.error||'Could not load signups');
  return data;
}

export default function SignupHistoryPanel() {
  const [seasons,setSeasons]=useState(null),[seasonId,setSeasonId]=useState('');
  const [result,setResult]=useState(null),[error,setError]=useState(null),[attempt,setAttempt]=useState(0);
  const [search,setSearch]=useState('');
  useEffect(()=>{
    if(seasons!==null)return;
    const controller=new AbortController();
    load('/api/admin/signups',controller.signal).then(data=>{
      if(controller.signal.aborted)return;
      setSeasons(data.seasons);setSeasonId(current=>current||String(data.defaultSeasonId||''));setError(null);
    }).catch(cause=>{if(!controller.signal.aborted)setError({seasonId:null,message:cause.message});});
    return()=>controller.abort();
  },[attempt,seasons]);
  useEffect(()=>{
    if(!seasonId)return;
    const controller=new AbortController();
    load(`/api/admin/signups/${seasonId}`,controller.signal).then(data=>{
      if(controller.signal.aborted)return;
      setResult({seasonId,data});setError(null);
    }).catch(cause=>{if(!controller.signal.aborted)setError({seasonId,message:cause.message});});
    return()=>controller.abort();
  },[seasonId,attempt]);
  const data=result?.seasonId===seasonId?result.data:null;
  const currentError=error&&(error.seasonId===null||error.seasonId===seasonId)?error.message:null;
  const query=search.trim().toLocaleLowerCase();
  const teams=(data?.teams||[]).filter(team=>!query||[team.TeamName,...team.players.flatMap(player=>[player.PlayerName,player.PlayerId])]
    .some(value=>String(value??'').toLocaleLowerCase().includes(query)));
  const playerCount=(data?.teams||[]).reduce((sum,team)=>sum+team.players.length,0);

  return <section className="signup-history" aria-labelledby="signup-history-title">
    <header className="signup-history-heading">
      <div><h2 id="signup-history-title">Signups</h2><p>Submitted teams, players and MMRs by season.</p></div>
      {data&&<span className="signup-history-summary">{data.teams.length} teams · {playerCount} players</span>}
    </header>
    <div className="signup-history-toolbar">
      <label htmlFor="signup-history-season">Season<select id="signup-history-season" value={seasonId} disabled={!seasons?.length}
        onChange={event=>{setSeasonId(event.target.value);setSearch('');}}>
        {!seasons?.length&&<option value="">{seasons?'No seasons available':'Loading seasons…'}</option>}
        {(seasons||[]).map(season=><option key={season.SeasonId} value={season.SeasonId}>
          {season.LeagueName} · {status(season.Status)}</option>)}
      </select></label>
      <label htmlFor="signup-history-search">Find a team or player<input id="signup-history-search" type="search"
        placeholder="Search teams or players" value={search} onChange={event=>setSearch(event.target.value)} disabled={!data}/></label>
    </div>
    {currentError?<div className="ui-panel" role="alert"><p>{currentError}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></div>
      :seasons===null||seasonId&&!data?<p role="status">Loading signups…</p>
      :!seasonId?<p className="signup-history-empty">No seasons are available yet.</p>
      :!data.teams.length?<p className="signup-history-empty">No saved team signups for this season.</p>
      :!teams.length?<p className="signup-history-empty">No teams or players match your search.</p>
      :<div className="signup-history-grid">{teams.map(team=><article className="signup-history-team" key={team.TeamSubmissionId}>
        <header><div><h3>{team.TeamName}</h3><span>{team.IsManual?'Manual team':`${team.players.length} players`}</span></div>
          <div className="signup-history-average"><small>Avg MMR</small><strong>{mmr(team.AverageMMR)}</strong></div></header>
        {team.players.length?<table aria-label={`${team.TeamName} signup players`}>
          <thead><tr><th scope="col" aria-label="Signup order">#</th><th scope="col">Player</th><th scope="col">MMR</th></tr></thead>
          <tbody>{team.players.map(player=><tr key={player.PlayerId}><td>{player.Slot+1}</td>
            <td className="signup-history-player"><Link to={`/player/${player.PlayerId}`}>{player.PlayerName||`Player ${player.PlayerId}`}</Link></td>
            <td>{mmr(player.MMR)}</td></tr>)}</tbody>
        </table>:<p className="signup-history-empty">No player-level signup details recorded.</p>}
      </article>)}</div>}
  </section>;
}
