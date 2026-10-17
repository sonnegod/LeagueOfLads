import { useEffect, useState } from 'react';
import MatchEditorPanel from './MatchEditorPanel';
import MatchTeamIdReplacementCard from './MatchTeamIdReplacementCard';
import DeleteMatchCard from './DeleteMatchCard';

export default function RecordManagementPanel({ refreshKey, onChanged }) {
  const [leagues,setLeagues]=useState([]);
  const [leagueId,setLeagueId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/leagues',{signal:controller.signal}).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load seasons');
      const list=[...data].sort((a,b)=>b.LeagueId-a.LeagueId);
      setLeagues(list);setLeagueId(String((list.find(league=>league.LastMatchId)||list[0])?.LeagueId||''));
    }).catch(cause=>{if(cause.name!=='AbortError')setError(cause.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[]);
  return <section style={{display:'grid',gap:20,minWidth:0}}>
    <header>
      <h2>Record Management</h2>
      <p>Correct match records from any season. Select the season before loading a match or replacing a team ID.</p>
      <label htmlFor="record-management-season">Season</label>{' '}
      <select id="record-management-season" value={leagueId} disabled={loading}
        onChange={event=>setLeagueId(event.target.value)}>
        <option value="">{loading?'Loading seasons...':'Select a season'}</option>
        {leagues.map(league=><option key={league.LeagueId} value={league.LeagueId}>{league.LeagueName}</option>)}
      </select>
      {error&&<p role="alert">{error}</p>}
    </header>
    {leagueId&&<div key={leagueId} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',gap:20,alignItems:'start'}}>
      <MatchEditorPanel leagueId={Number(leagueId)} onMatchUpdated={onChanged}/>
      <MatchTeamIdReplacementCard leagueId={Number(leagueId)} refreshKey={refreshKey} onUpdated={onChanged}/>
      <DeleteMatchCard leagueId={Number(leagueId)} onMatchDeleted={onChanged}/>
    </div>}
  </section>;
}
