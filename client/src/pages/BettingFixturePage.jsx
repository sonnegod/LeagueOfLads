import {useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {bettingRequest} from '../utils/bettingRequest';
import {useSeasonBetSlip} from '../context/seasonBetSlip';
import ScheduledBettingFixture from '../components/ScheduledBettingFixture';
import SeasonBetSlip from '../components/SeasonBetSlip';
import '../css/BettingV2.css';

export default function BettingFixturePage() {
  const {eventId}=useParams(),{user}=useAuth();
  const {season,setSeason,choose,slip,busy,revision}=useSeasonBetSlip();
  const [data,setData]=useState(null),[wallet,setWallet]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setData(null);setWallet(null);
    bettingRequest(`/api/betting/fixtures/${encodeURIComponent(eventId)}`,{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return;
      setData(value);setSeason(String(value.season.seasonId));
    }).catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[eventId,revision,refresh,setSeason]);
  useEffect(()=>{
    if(!user||!data)return;
    const controller=new AbortController();
    bettingRequest(`/api/betting/wallet?seasonId=${data.season.seasonId}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setWallet(value);})
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return()=>controller.abort();
  },[user,data]);
  return <div className="ui-page sportsbook-page">
    <Link className="scheduled-back" to={data?`/betting?seasonId=${data.season.seasonId}`:'/betting'}>← Matchups</Link>
    <header className="sportsbook-heading"><div><h1>Matchup betting</h1>{data&&<p>{data.season.name}</p>}</div>
      {user&&wallet&&<div className="sportsbook-wallet"><strong>{Number(wallet.balance).toLocaleString('en-US',{maximumFractionDigits:2})}</strong><span>Season points</span></div>}
    </header>
    {data?.localTesting&&<p className="sportsbook-test-banner" role="status"><strong>Local test betting</strong> · Development only. Test wallets and tickets are separate. Prices have not been approved for production.</p>}
    <div className="sportsbook-toolbar"><button type="button" disabled={loading} onClick={()=>setRefresh(r=>r+1)}>Refresh odds</button></div>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}
    {loading&&<p role="status">Loading matchup…</p>}
    <div className="sportsbook-layout"><section>
      {data&&<ScheduledBettingFixture key={eventId} fixture={data.fixture} onChoose={choose} slip={slip} canBet={Boolean(user)} busy={busy||loading||season!==String(data.season.seasonId)}/>}
    </section><SeasonBetSlip disabled={loading||!data||season!==String(data?.season.seasonId)}/></div>
  </div>;
}
