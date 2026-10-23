import {useLayoutEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import './UpcomingGamesTicker.css';

const kickoff=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',
  hour:'numeric',minute:'2-digit',timeZoneName:'short'});

export default function UpcomingGamesTicker({games}) {
  const viewport=useRef(null),sequence=useRef(null);
  const [layout,setLayout]=useState({copies:1,duration:30});
  const scheduleKey=JSON.stringify(games);
  useLayoutEffect(()=>{
    if(!viewport.current||!sequence.current)return;
    const measure=()=>{
      const width=sequence.current.getBoundingClientRect().width;
      if(!width)return;
      const copies=Math.max(1,Math.ceil(viewport.current.clientWidth/width));
      const duration=copies*width/45;
      setLayout(previous=>previous.copies===copies&&previous.duration===duration?previous:{copies,duration});
    };
    const observer=new ResizeObserver(measure);
    observer.observe(viewport.current);observer.observe(sequence.current);measure();
    return()=>observer.disconnect();
  },[scheduleKey]);

  if(!games.length)return null;
  return <div className="upcoming-ticker" role="region" aria-label="Upcoming games" aria-live="off">
    <div className="upcoming-ticker-viewport" ref={viewport}>
      <div className="upcoming-ticker-track" key={scheduleKey} style={{'--ticker-duration':`${layout.duration}s`}}>
        {[0,1].map(group=><div className="upcoming-ticker-group" key={group} aria-hidden={group===1?true:undefined}>
          {Array.from({length:layout.copies},(_,copy)=><div className="upcoming-ticker-sequence" key={copy}
            ref={group===0&&copy===0?sequence:undefined} aria-hidden={copy>0?true:undefined}>
            {games.map(game=>{
              const time=kickoff.format(new Date(game.startAt));
              const left=game.sweepOdds?.team1,right=game.sweepOdds?.team2;
              const oddsDescription=left&&right?` Sweep odds: ${game.team1} ${left.score} at ${left.odds.toFixed(2)} times; ${game.team2} ${right.score} at ${right.odds.toFixed(2)} times.`:'';
              return <Link key={game.eventId} className="upcoming-ticker-game" to={`/bet/matchup/${game.eventId}`} tabIndex={group||copy?-1:undefined}
                aria-label={`${game.localTestFixture?'Test fixture. ':''}${game.team1} versus ${game.team2}, ${time}.${oddsDescription} View matchup.`}>
                <span className="upcoming-ticker-teams"><span className="upcoming-ticker-name" title={game.team1}>{game.team1}</span><span className="upcoming-ticker-vs">vs</span><span className="upcoming-ticker-name" title={game.team2}>{game.team2}</span></span>
                <span className="upcoming-ticker-kickoff">
                  <span className="upcoming-ticker-odds" title={left?`${game.team1} ${left.score} sweep`:'Sweep odds unavailable'}>{left?`${left.odds.toFixed(2)}×`:'—'}</span>
                  <span className="upcoming-ticker-when">{game.localTestFixture&&<span className="upcoming-ticker-test">Test</span>}<time dateTime={game.startAt}>{time}</time></span>
                  <span className="upcoming-ticker-odds upcoming-ticker-odds-right" title={right?`${game.team2} ${right.score} sweep`:'Sweep odds unavailable'}>{right?`${right.odds.toFixed(2)}×`:'—'}</span>
                </span>
              </Link>;
            })}
          </div>)}
        </div>)}
      </div>
    </div>
  </div>;
}
