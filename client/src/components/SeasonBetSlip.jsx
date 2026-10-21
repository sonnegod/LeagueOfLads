import {useAuth} from '../context/AuthContext';
import {useSeasonBetSlip} from '../context/seasonBetSlip';

const points=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});

export default function SeasonBetSlip({disabled=false}) {
  const {user}=useAuth();
  const {slip,setSlip,stake,setStake,busy,error,message,reviewQuotes,odds,potential,place,updateQuotes}=useSeasonBetSlip();
  return <aside className="sportsbook-slip"><h2>Bet slip</h2>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!user?<p>Odds are public. <a href="/api/auth/steam">Sign in with Steam</a> to add selections to your bet slip.</p>:!slip.length&&<p>Choose an outcome to add it here.</p>}
    {slip.map(s=><div className="sportsbook-slip-selection" key={s.selectionId}>
      <button type="button" disabled={busy} aria-label={`Remove ${s.label}`} onClick={()=>setSlip(old=>old.filter(l=>l.selectionId!==s.selectionId))}>×</button>
      <strong>{s.title}</strong><span>{s.label} · {s.odds.toFixed(2)}×</span>
    </div>)}
    {slip.length>0&&<form onSubmit={place}>
      <label>Stake (points)<input required type="number" min="0.01" step="0.01" disabled={busy} value={stake} onChange={e=>setStake(e.target.value)}/></label>
      <p>Combined odds <strong>{odds.toFixed(2)}×</strong></p>
      <p>Potential return <strong>{potential===null?'Choose a valid stake or fewer selections':`${points(potential)} points`}</strong></p>
      <small>Up to 8 parlay legs. One matchup result per fixture; overlapping props cannot combine. Preseason bets are singles. Stake up to your available points.</small>
      {reviewQuotes&&<button type="button" disabled={busy||disabled} onClick={updateQuotes}>Update quotes for review</button>}
      {user?<button type="submit" disabled={busy||disabled||reviewQuotes||potential===null}>{busy?'Submitting…':'Place bet'}</button>:<a href="/api/auth/steam">Sign in with Steam to bet</a>}
    </form>}
  </aside>;
}
