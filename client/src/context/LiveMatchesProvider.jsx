import {useCallback,useEffect,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {LiveMatchesContext} from './liveMatches';
import useLiveResource from '../hooks/useLiveResource';

// One stream per viewing tab, shared by the live page and navigation badge.
export default function LiveMatchesProvider({children}) {
  const {pathname}=useLocation();
  const active=pathname.replace(/\/+$/,'')==='/live';
  const [snapshot,setSnapshot]=useState(null),[connection,setConnection]=useState('connecting');
  const [fallback,setFallback]=useState(false),[attempt,setAttempt]=useState(0);
  const poll=useLiveResource('/api/liveMatches',2000,active&&fallback);
  const refreshPoll=poll.refresh;
  const refresh=useCallback(()=>{setAttempt(value=>value+1);refreshPoll();},[refreshPoll]);

  useEffect(()=>{
    if(!active)return;
    let source=null,disposed=false,watchdog,reconnect;
    function enableFallback() {
      if(disposed||document.hidden)return;
      setConnection('polling');setFallback(true);
    }
    function close() {
      clearTimeout(watchdog);clearTimeout(reconnect);
      source?.close();source=null;
    }
    function armWatchdog(delay=25000) {
      if(disposed)return;
      clearTimeout(watchdog);
      watchdog=setTimeout(()=>{
        enableFallback();close();
        if(!disposed&&!document.hidden)reconnect=setTimeout(connect,2000);
      },delay);
    }
    function received() {
      armWatchdog();setConnection('live');setFallback(false);
    }
    function connect() {
      if(disposed||document.hidden)return;
      close();setConnection('connecting');
      if(typeof EventSource==='undefined'){enableFallback();return;}
      try {
        source=new EventSource('/api/liveMatches/stream');
      }catch {
        enableFallback();reconnect=setTimeout(connect,2000);return;
      }
      source.onopen=()=>armWatchdog(8000);
      source.onerror=()=>{
        enableFallback();
        // EventSource retries dropped connections itself, but an HTTP error can
        // close it permanently. Retry those without waiting for the watchdog.
        if(source?.readyState===2){close();reconnect=setTimeout(connect,2000);}
      };
      let receivedState=false;
      source.addEventListener('state',event=>{
        try {
          const data=JSON.parse(event.data);
          if(!Array.isArray(data.matches))throw Error('Invalid live state');
          if(disposed)return;
          receivedState=true;setSnapshot({data,updatedAt:Date.now()});received();
        }catch{enableFallback();}
      });
      source.addEventListener('checked',event=>{
        try {
          const data=JSON.parse(event.data);
          if(!Array.isArray(data.matches))throw Error('Invalid observation');
          if(disposed)return;
          if(!receivedState){enableFallback();return;}
          const checked=new Map(data.matches.map(row=>[Number(row.matchId),row.lastUpdated]));
          setSnapshot(previous=>previous?{updatedAt:Date.now(),data:{...previous.data,
            matches:previous.data.matches.map(row=>checked.has(Number(row.MatchId))?{...row,LastUpdated:checked.get(Number(row.MatchId))}:row),
          }}:previous);
          received();
        }catch{enableFallback();}
      });
      source.addEventListener('heartbeat',()=>armWatchdog());
      source.addEventListener('unavailable',enableFallback);
      armWatchdog(8000);
    }
    function visibilityChanged() {
      if(document.hidden){close();setFallback(false);setConnection('paused');}
      else connect();
    }
    connect();
    document.addEventListener('visibilitychange',visibilityChanged);
    return()=>{disposed=true;close();document.removeEventListener('visibilitychange',visibilityChanged);};
  },[active,attempt]);

  // A previous fallback response must not replace a newer pushed game state.
  const data=connection==='live'||!poll.data||poll.updatedAt<=(snapshot?.updatedAt||0)?snapshot?.data:poll.data;
  const error=active&&fallback?poll.error:null;
  return <LiveMatchesContext.Provider value={{active,data,error,loading:active&&!data&&!error,refresh,
    connection:active?connection:'inactive'}}>{children}</LiveMatchesContext.Provider>;
}
