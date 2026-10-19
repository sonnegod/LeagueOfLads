import {useEffect,useRef,useState} from 'react';
import {Outlet} from 'react-router-dom';
import {useAuth} from './AuthContext';
import {quotedReturn} from '../utils/bettingPoints';
import {bettingRequest} from '../utils/bettingRequest';
import {SeasonBetSlipContext} from './seasonBetSlip';
import {parlayConflict} from '../utils/bettingParlays';

// Shared across betting pages so visiting another matchup keeps the slip.
export function SeasonBettingLayout() {
  const {user}=useAuth();
  const [season,setSeason]=useState(''),[slip,setSlip]=useState([]),[stake,setStake]=useState('100');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [revision,setRevision]=useState(0),[reviewQuotes,setReviewQuotes]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  useEffect(()=>{setSlip([]);setReviewQuotes(false);setError('');setMessage('');},[season,user?.accountId]);
  useEffect(()=>{requestKey.current=crypto.randomUUID();},[slip,stake]);
  function choose(market,selection) {
    if(!user){setError('Sign in with Steam to add selections to your bet slip.');return;}
    setMessage('');setError('');setReviewQuotes(false);
    if(slip.some(s=>s.selectionId===selection.selectionId)){setSlip(slip.filter(s=>s.selectionId!==selection.selectionId));return;}
    const retained=slip.filter(s=>s.marketId!==market.marketId);
    if(retained.length>=8){setError('A ticket can contain at most eight selections.');return;}
    const next=[...retained,{marketId:market.marketId,eventId:market.eventId,type:market.type,playerId:market.playerId,stat:market.stat,
      scope:market.scope,gameNumber:market.gameNumber,selectionId:selection.selectionId,quoteVersion:market.quoteVersion,odds:selection.odds,title:market.title,label:selection.label}];
    const conflict=parlayConflict(next);if(conflict){setError(conflict.message);return;}
    setSlip(next);
  }
  async function updateQuotes() {
    setBusy(true);setError('');
    try {
      const response=await bettingRequest(`/api/betting/quotes?ids=${slip.map(s=>s.selectionId).join(',')}`);
      if(response.quotes.some(q=>q.status!=='open'))throw new Error('One of your selections is no longer open. Remove it before betting.');
      setSlip(old=>old.map(s=>({...s,...response.quotes.find(q=>q.selectionId===s.selectionId)})));
      setReviewQuotes(false);setMessage('Quotes updated. Review the slip before placing your bet.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function place(event) {
    event.preventDefault();if(!user){setError('Sign in with Steam to place a bet.');return;}
    setBusy(true);setError('');setMessage('');
    try {
      const result=await bettingRequest('/api/betting/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        seasonId:Number(season),stake,requestKey:requestKey.current,legs:slip.map(s=>({selectionId:s.selectionId,quoteVersion:s.quoteVersion}))})});
      setMessage(`Ticket #${result.ticketId} placed.`);setSlip([]);setRevision(r=>r+1);
    }catch(err){setError(err.message);if(err.code==='QUOTE_CHANGED')setReviewQuotes(true);setRevision(r=>r+1);}finally{setBusy(false);}
  }
  return <SeasonBetSlipContext.Provider value={{season,setSeason,slip,setSlip,stake,setStake,busy,error,message,revision,reviewQuotes,choose,updateQuotes,place,
    odds:slip.reduce((product,s)=>product*s.odds,1),potential:quotedReturn(stake,slip.map(s=>s.odds))}}><Outlet/></SeasonBetSlipContext.Provider>;
}
