import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './TiebreakerInfo.css';

export default function TiebreakerInfo({pool}) {
  const id=useId(),button=useRef(null),tooltip=useRef(null),closeTimer=useRef(null);
  const [open,setOpen]=useState(false),[pinned,setPinned]=useState(false),[position,setPosition]=useState(null);
  const count=Number(pool.upper)+Number(pool.lower)+Number(pool.eliminated);
  const outcomes=[];
  if(pool.upper)outcomes.push(`Top ${pool.upper} ${pool.upper===1?'team advances':'teams advance'} to the upper bracket.`);
  if(pool.lower)outcomes.push(`${pool.upper?'Next':'Top'} ${pool.lower} ${pool.lower===1?'team advances':'teams advance'} to the lower bracket.`);
  if(pool.eliminated)outcomes.push(`The remaining ${pool.eliminated} ${pool.eliminated===1?'team is':'teams are'} eliminated.`);
  const description=outcomes.join(' ');
  const show=()=>{clearTimeout(closeTimer.current);setOpen(true);};
  const hide=()=>{setOpen(false);setPinned(false);clearTimeout(closeTimer.current);};
  const leave=()=>{
    clearTimeout(closeTimer.current);
    closeTimer.current=setTimeout(()=>{if(!pinned&&document.activeElement!==button.current)setOpen(false);},150);
  };
  useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
  useLayoutEffect(()=>{
    if(!open)return;
    const anchor=button.current.getBoundingClientRect(),height=tooltip.current?.getBoundingClientRect().height||180;
    const width=Math.min(320,window.innerWidth-24),maxHeight=Math.max(80,window.innerHeight-24);
    const below=window.innerHeight-anchor.bottom-8;
    setPosition({left:Math.max(12,Math.min(anchor.left,window.innerWidth-width-12)),
      top:Math.max(12,Math.min(below>=Math.min(height,maxHeight)?anchor.bottom+8:anchor.top-Math.min(height,maxHeight)-8,
        window.innerHeight-Math.min(height,maxHeight)-12))});
  },[open,description,count,pool.bestOf]);
  useEffect(()=>{
    if(!open)return;
    const dismiss=event=>{
      if(!(event.target instanceof window.Node)||!button.current?.contains(event.target)&&!tooltip.current?.contains(event.target)){
        setOpen(false);setPinned(false);clearTimeout(closeTimer.current);
      }
    };
    const escape=event=>{if(event.key==='Escape'){setOpen(false);setPinned(false);clearTimeout(closeTimer.current);}};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    window.addEventListener('scroll',dismiss,true);window.addEventListener('resize',dismiss);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);
      window.removeEventListener('scroll',dismiss,true);window.removeEventListener('resize',dismiss);};
  },[open]);
  return <span className="tiebreaker-info" onMouseEnter={show} onMouseLeave={leave}>
    <button ref={button} type="button" className="tiebreaker-info-button" aria-label={`How ${pool.name} works`}
      aria-describedby={open?id:undefined} aria-expanded={open} onFocus={show} onBlur={()=>{
        setPinned(false);clearTimeout(closeTimer.current);
        closeTimer.current=setTimeout(()=>{if(!tooltip.current?.matches(':hover'))setOpen(false);},150);
      }}
      onClick={()=>{if(pinned)hide();else{setPinned(true);show();}}}
      style={{minHeight:0,width:22,height:22,padding:0,border:0,background:'transparent'}}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="10" cy="6" r="1" fill="currentColor"/></svg>
    </button>
    {open&&createPortal(<div ref={tooltip} id={id} role="tooltip" className="tiebreaker-info-tooltip"
      style={{width:Math.min(320,window.innerWidth-24),maxHeight:Math.max(80,window.innerHeight-24),...position,visibility:position?'visible':'hidden'}}
      onMouseEnter={show} onMouseLeave={leave}>
      <strong>{pool.name}</strong>
      <p>The assigned positions from all groups combine into one {count}-team pool. Every team plays every other team in a BO{pool.bestOf} series.</p>
      <p>{description}</p>
      <p>Ranked by series wins, then Neustadtl. Any remaining tie is resolved via the rules.</p>
    </div>,document.body)}
  </span>;
}
