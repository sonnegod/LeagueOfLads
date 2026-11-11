import {useEffect,useState} from 'react';
import useMatchResultsRevision from '../hooks/useMatchResultsRevision';
import PlayoffBracketBoard from './PlayoffBracketBoard';

export default function CurrentPlayoffBracketView({leagueId}) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  const revision=useMatchResultsRevision();
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/getCurrentBracket${leagueId?`?leagueId=${leagueId}`:''}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error||'Unable to load playoffs.');return value;})
      .then(value=>{setData(value);setError('');}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
    return()=>controller.abort();
  },[leagueId,revision]);
  return <div className="current-playoff-bracket">
    {error&&<p role="alert" className="playoff-error">{error}</p>}
    {!data&&!error&&<p role="status">Loading playoffs…</p>}
    {data?.playoffBracket?<PlayoffBracketBoard bracket={data.playoffBracket} matchDetails={data.matchDetails}/>
      :data&&<p className="playoff-empty">The playoff bracket will appear once the starting matchups are published.</p>}
  </div>;
}
