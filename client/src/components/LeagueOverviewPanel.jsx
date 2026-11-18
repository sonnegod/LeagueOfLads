import {useEffect,useState} from 'react';
import './LeagueOverviewPanel.css';

const stages={groups:'Group stage',tiebreakers:'Tiebreakers',playoffs:'Playoffs'};
const groupColors=['#60a5fa','#c084fc','#f472b6','#34d399'];

export default function LeagueOverviewPanel({seasonId,refreshKey,onOpenSettings,onOpenMatches}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let inFlight=false;
    const load=async()=>{
      if(inFlight)return;inFlight=true;
      try {
        const response=await fetch(`/api/admin/league-overview/${seasonId}`,{signal:controller.signal,cache:'no-store'});
        const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Could not load the overview');
        if(!controller.signal.aborted){setData(payload);setError('');}
      }catch(cause){if(cause.name!=='AbortError')setError(cause.message);}
      finally{inFlight=false;}
    };
    load();
    const visible=()=>{if(document.visibilityState==='visible')load();};
    const timer=setInterval(visible,60_000);document.addEventListener('visibilitychange',visible);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[seasonId,refreshKey,revision]);
  const remaining=data?.remaining,snapshot=data?.snapshot;
  return <div className="league-overview">
    {error&&<p role="alert" className="league-overview-error">{error} <button type="button" onClick={()=>setRevision(value=>value+1)}>Retry</button></p>}
    {!data&&!error&&<p role="status">Loading league overview…</p>}
    {data&&<>
      <section className="league-overview-snapshot" aria-label="Season snapshot">
        <header className="league-overview-heading"><div><h2>{data.season.name}</h2>
          <span className="league-overview-stage">{stages[data.season.stage]}</span></div>
          <div className="league-overview-actions"><button type="button" onClick={()=>setRevision(value=>value+1)}>Refresh</button>
            <button type="button" onClick={onOpenSettings}>Settings</button></div>
        </header>
        <div className="league-overview-stats">
          <div><strong>{snapshot.teams}</strong><span>Teams</span><small>{snapshot.groups} groups</small></div>
          <div><strong>{snapshot.players}</strong><span>Rostered players</span><small>Current league rosters</small></div>
          <div><strong>{snapshot.completedSeries}</strong><span>Completed series</span><small>{snapshot.closedSeries} closed incomplete</small></div>
          <div><strong>{snapshot.scheduledSeries}</strong><span>Upcoming series</span><small>{snapshot.inProgressSeries} in progress</small></div>
        </div>
      </section>
      <section className="league-overview-remaining" aria-label="Remaining regular-season series">
        <header className="league-overview-heading"><div><h3>Remaining regular-season series</h3>
          <p>{remaining.totalSeries} series left across {remaining.groups.length} groups</p></div>
          <div className="league-overview-actions"><button type="button" onClick={onOpenMatches}>Manage matches</button></div>
        </header>
        {!remaining.groups.length?<p className="league-overview-note">No groups have been set up yet.</p>:<>
          <div className="league-overview-groups">{remaining.groups.map((group,index)=><section className="league-overview-group" key={group.groupId} style={{'--group-accent':groupColors[index%groupColors.length]}} aria-label={`${group.name} remaining series`}>
            <header><h4>{group.name}</h4><span>{group.teams.length} teams · {group.remainingSeries} series left</span></header>
            {group.teams.length?<table className="league-overview-remaining-table"><thead><tr><th>Team</th><th>Remaining</th></tr></thead>
              <tbody>{group.teams.map(team=><tr key={team.entryId}><td>{team.name}</td>
                <td><strong className="league-overview-remaining-count" data-complete={team.remainingSeries===0}>{team.remainingSeries}</strong></td></tr>)}</tbody>
            </table>:<p className="league-overview-note">No teams assigned.</p>}
          </section>)}</div>
          <p className="league-overview-note">Most remaining first. Includes H2H score overrides, completed series, closed series and forfeits.</p>
        </>}
      </section>
    </>}
  </div>;
}
