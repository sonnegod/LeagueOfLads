import {useEffect,useState} from 'react';

export default function useUpcomingGames() {
  const [games,setGames]=useState([]);
  useEffect(()=>{
    let pending=null,active=true;
    async function refresh() {
      if(pending||document.visibilityState==='hidden')return;
      const controller=new AbortController();pending=controller;
      try {
        const response=await fetch('/api/upcoming-games',{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw new Error('Upcoming games unavailable');
        const data=await response.json();
        if(active&&!controller.signal.aborted)setGames((data.games||[]).filter(game=>Number.isSafeInteger(game.eventId)&&game.eventId>0
          &&typeof game.team1==='string'&&typeof game.team2==='string'&&Date.parse(game.startAt)>Date.now())
          .sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)||a.eventId-b.eventId));
      }catch{/* Keep the last known schedule during a temporary connection failure. */}
      finally{if(pending===controller)pending=null;}
    }
    refresh();
    const interval=setInterval(refresh,60000);
    document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;pending?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  // Remove a game at kickoff even between schedule refreshes.
  useEffect(()=>{
    if(!games.length)return;
    const delay=Math.min(2147483647,Math.max(0,Date.parse(games[0].startAt)-Date.now())+25);
    const timeout=setTimeout(()=>setGames(current=>current.filter(game=>Date.parse(game.startAt)>Date.now())),delay);
    return()=>clearTimeout(timeout);
  },[games]);
  return games;
}
