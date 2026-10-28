import {useEffect,useRef,useState} from 'react';

export default function useLiveSnapshots(match,enabled) {
  const [snapshots,setSnapshots]=useState([]),[error,setError]=useState(false),[loading,setLoading]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const cursor=useRef(0);
  const trigger=useRef(null);
  const matchId=match.MatchId;
  const revision=match.LatestSnapshotId??match.SnapshotId??match.SnapshotHash;
  const latestRevision=useRef(revision);
  useEffect(()=>{
    latestRevision.current=revision;
    trigger.current?.();
  },[revision]);
  useEffect(()=>{
    if(!enabled)return;
    let disposed=false,pending=false,pendingRevision,queued=false,controller;
    async function load() {
      if(disposed)return;
      if(pending){
        if(pendingRevision!==latestRevision.current)queued=true;
        return;
      }
      pending=true;pendingRevision=latestRevision.current;
      controller=new AbortController();
      const request=controller;
      const timeout=setTimeout(()=>request.abort(),8000);
      setLoading(true);setError(false);
      try {
        const response=await fetch(`/api/liveMatches/${matchId}/snapshots?afterSnapshotId=${cursor.current}`,{signal:request.signal,cache:'no-store'});
        if(!response.ok)throw Error('Unable to load timeline');
        const payload=await response.json();
        if(!Array.isArray(payload.snapshots))throw Error('Invalid timeline');
        if(disposed||request.signal.aborted)return;
        const rows=payload.snapshots;
        cursor.current=rows.reduce((latest,row)=>Math.max(latest,Number(row.SnapshotId)||0),cursor.current);
        setSnapshots(previous=>{
          const known=new Map(previous.map(row=>[row.SnapshotId,row]));
          for(const row of rows)known.set(row.SnapshotId,row);
          return [...known.values()].sort((a,b)=>a.SnapshotId-b.SnapshotId);
        });
      }catch {
        if(!disposed)setError(true);
      }finally {
        clearTimeout(timeout);pending=false;
        if(!disposed){
          setLoading(false);
          if(queued){queued=false;load();}
        }
      }
    }
    trigger.current=load;
    load();
    return()=>{disposed=true;trigger.current=null;controller?.abort();};
  },[matchId,enabled,attempt]);
  return {snapshots,error,loading,retry:()=>setAttempt(value=>value+1)};
}
