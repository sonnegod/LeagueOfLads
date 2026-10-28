import {useCallback,useEffect,useState} from 'react';

// Poll lightweight current state separately from recent games and replay history.
// Keep the last successful result during failures, and never overlap requests.
export default function useLiveResource(url, intervalMs, enabled = true) {
  const [result,setResult]=useState(null);
  const [attempt,setAttempt]=useState(0);
  const refresh=useCallback(()=>setAttempt(value=>value+1),[]);

  useEffect(()=>{
    if(!enabled)return;
    let disposed=false,timer,controller,pending=false,queued=false;
    async function load() {
      clearTimeout(timer);
      if(disposed||document.hidden)return;
      if(pending){queued=true;return;}
      pending=true;
      const startedAt=Date.now();
      controller=new AbortController();
      const request=controller;
      const timeout=setTimeout(()=>request.abort(),8000);
      try {
        const response=await fetch(url,{signal:request.signal,cache:'no-store'});
        if(!response.ok)throw Error('Live data is temporarily unavailable.');
        const data=await response.json();
        if(data.error)throw Error('Live data is temporarily unavailable.');
        if(!disposed&&!request.signal.aborted)setResult({url,data,error:null,updatedAt:Date.now()});
      }catch {
        if(!disposed&&!document.hidden)setResult(previous=>({url,
          data:previous?.url===url?previous.data:null,
          updatedAt:previous?.url===url?previous.updatedAt:0,
          error:'Updates interrupted. Retrying automatically; showing the last available data.',
        }));
      }finally {
        clearTimeout(timeout);
        pending=false;
        if(!disposed&&!document.hidden){
          const delay=queued?0:Math.max(100,intervalMs-(Date.now()-startedAt));
          queued=false;
          timer=setTimeout(load,delay);
        }
      }
    }
    function visibilityChanged() {
      if(document.hidden){clearTimeout(timer);controller?.abort();}
      else load();
    }
    load();
    document.addEventListener('visibilitychange',visibilityChanged);
    window.addEventListener('focus',load);
    return()=>{
      disposed=true;clearTimeout(timer);controller?.abort();
      document.removeEventListener('visibilitychange',visibilityChanged);
      window.removeEventListener('focus',load);
    };
  },[url,intervalMs,attempt,enabled]);

  const current=result?.url===url?result:null;
  return {data:current?.data,error:current?.error,updatedAt:current?.updatedAt||0,loading:!current,refresh};
}
