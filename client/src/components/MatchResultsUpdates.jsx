import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

export default function MatchResultsUpdates() {
  const {pathname}=useLocation();
  useEffect(()=>{
    if(!/^\/(live|league|team|match|series|betting|dashboard|admin)(\/|$)/.test(pathname))return;
    let source,revision=null,disposed=false,timer;
    function notify(){if(!document.hidden)window.dispatchEvent(new Event('league-results:changed'));}
    function connect() {
      if(disposed||document.hidden)return;
      if(typeof EventSource==='undefined'){timer=setInterval(notify,30000);return;}
      source=new EventSource('/api/match-results/stream');
      source.onerror=()=>{if(!timer)timer=setInterval(notify,30000);};
      source.addEventListener('results',event=>{
        clearInterval(timer);timer=null;
        try{const next=JSON.parse(event.data).revision;if(revision!==null&&revision!==next)notify();revision=next;}catch{/* Reconnect hydrates current state. */}
      });
    }
    function visibility(){source?.close();clearInterval(timer);if(!document.hidden){notify();connect();}}
    connect();document.addEventListener('visibilitychange',visibility);
    return()=>{disposed=true;source?.close();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[pathname]);
  return null;
}
