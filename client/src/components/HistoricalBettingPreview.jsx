import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {PlayerOddsRow,TeamOddsGroups} from './PreseasonOdds';
import BettingMatchupSimulations from './BettingMatchupSimulations';
import '../css/BettingV2.css';

const reasons={original_opening_rosters_and_planned_game_counts_missing:'Opening rosters and planned game counts are missing.',
  fewer_than_five_preseason_history_games:'Fewer than five earlier player appearances.',conflicting_reconstructed_roster:'The reconstructed lineups put this player on multiple teams.',
  leader_field_has_missing_history_or_conflicting_players:'Leader markets need a complete player field with enough earlier history and one team per player.',
  group_or_bracket_format_not_supported:'The saved group/bracket format is unsupported.'};
reasons.fewer_than_five_preseason_metric_games='Fewer than five earlier appearances with this recorded statistic.';
function MarketPrices({market}) {
  return market?<div className="historical-betting-prices">{market.selections.map((s,i)=><span key={i}>{s.label} <strong>{s.odds.toFixed(2)}×</strong></span>)}</div>:<span aria-label="Not offered">—</span>;
}
export default function HistoricalBettingPreview({leagueId,seasonId}) {
  const [scope,setScope]=useState('preseason');const [eventId,setEventId]=useState('');const [search,setSearch]=useState('');
  const [preseasonGroup,setPreseasonGroup]=useState('player');
  const [before,setBefore]=useState(null);const [pages,setPages]=useState([]);const [data,setData]=useState(null);const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [rebuilding,setRebuilding]=useState(false);const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');const params=new URLSearchParams(seasonId?{seasonId,scope}:{leagueId,scope});
    if(scope==='preseason'){params.set('preseasonGroup',preseasonGroup==='simulations'?'team':preseasonGroup);if(preseasonGroup==='player')params.set('groupPlayers','1');else params.set('groupTeams','1');}
    if(eventId&&scope==='series')params.set('eventId',eventId);if(before)params.set('before',before);if(search)params.set('search',search);
    fetch(`/api/admin/betting/preview?${params}`,{signal:controller.signal}).then(async response=>{
      const value=await response.json();if(!response.ok)throw new Error(value.error||'Unable to load the historical preview');return value;
    }).then(setData).catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[leagueId,seasonId,scope,preseasonGroup,eventId,search,before,refresh]);
  async function rebuild() {
    setRebuilding(true);setError('');
    try {
      const response=await fetch(`/api/admin/betting/seasons/${seasonId}/preview`,{method:'POST'});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not rebuild the preview');
      setBefore(null);setPages([]);setRefresh(value=>value+1);
    }catch(error){setError(error.message);}finally{setRebuilding(false);}
  }
  function changeScope(value){setScope(value);setBefore(null);setPages([]);setSearch('');}
  const heldCounts=(data?.held||[]).reduce((counts,item)=>({...counts,[item.reason]:(counts[item.reason]||0)+1}),{});
  const playerView=scope==='preseason'&&preseasonGroup==='player';
  const teamView=scope==='preseason'&&preseasonGroup==='team';
  const simulationView=scope==='preseason'&&preseasonGroup==='simulations';
  return <div className="ui-page sportsbook-page historical-betting-preview"><header className="sportsbook-heading"><div>
    <h1>{data?.leagueName||'Historical betting preview'}</h1><p>Admin preview · Read only · No points or live tickets</p></div>
    <div className="season-actions">{seasonId&&<button type="button" disabled={rebuilding} onClick={rebuild}>
      {rebuilding?'Rebuilding preview...':'Rebuild preseason preview'}</button>}<Link to="/betting">Exit preview</Link></div></header>
    {rebuilding&&<p role="status">Rebuilding odds from the saved rosters, groups and rules...</p>}
    {error&&<p role="alert">{error}</p>}
    {data&&<>
      <section className="sportsbook-market historical-betting-summary"><h2>Pricing history: {data.trainingLeagueName}</h2>
        {data.previewKind==='signup'?<>
          <p>{data.trainingGames} earlier league games, using the saved signup rosters and groups. Target-season results are excluded.</p>
          <p>Player lines weight personal history, recent games, recorded patches and compatible lane roles. Team prices combine signup MMR with a modest adjustment for historical player win records, softened toward 50% for small samples.</p>
          <p>Candidate prices for review. Earlier roster membership is not fully known; these prices have not passed the validation required for live betting.</p>
        </>:<>
        <p>{data.trainingGames} complete games through {data.trainingLastDay}. All prices exclude {data.leagueName} performance and results, with a cutoff of {data.cutoffDay}.</p>
        <p>Preseason rosters use {data.rosterSource==='first_complete_recorded_lineup'?'each team’s first complete recorded lineup':'the supplied historical setup'}. Planned games come from the saved groups’ BO2 round robin. These are reconstructed scenarios.</p>
        <p>{data.neutralTeamPriors?'Team odds use neutral strength priors because historical signup MMRs are unavailable.':'Team odds use the supplied historical signup priors.'} Player props use earlier league history. Exact kickoff and historical source-availability times are unavailable.</p>
        </>}
        <p><strong>{data.preseasonMarkets}</strong> preseason markets · <strong>{data.seriesMarkets}</strong> played-series examples</p>
      </section>
      {!!data.rosterTeams?.length&&<details><summary>{seasonId?'Signup rosters and planned games':'Reconstructed rosters and planned games'}</summary><div className="historical-betting-fixtures"><table className="sportsbook-table">
        <thead><tr><th>Team</th><th>Roster source</th><th>Planned games</th><th>Players</th></tr></thead><tbody>{data.rosterTeams.map(t=><tr key={t.teamId}>
          <td>{t.teamName}</td><td>{seasonId?'Website signup':t.rosterMatchId?<Link to={`/match/${t.rosterMatchId}`}>Match {t.rosterMatchId}</Link>:'Supplied setup'}</td><td>{t.regularGames}</td>
          <td>{t.players.map((p,i)=><span key={p.playerId}>{i?', ':''}<Link to={`/player/${p.playerId}`}>{p.name}</Link></span>)}</td>
        </tr>)}</tbody></table></div></details>}
      <div className="ui-tabs"><button className="ui-tab" type="button" aria-pressed={scope==='preseason'} onClick={()=>changeScope('preseason')}>Preseason</button>
        {!seasonId&&<button className="ui-tab" type="button" aria-pressed={scope==='series'} onClick={()=>changeScope('series')}>Played series</button>}</div>
      {scope==='preseason'&&<div className="ui-tabs" aria-label="Preseason odds"><button className="ui-tab" type="button" aria-pressed={preseasonGroup==='player'} onClick={()=>{setPreseasonGroup('player');setBefore(null);setPages([]);setSearch('');}}>Player odds</button>
        <button className="ui-tab" type="button" aria-pressed={preseasonGroup==='team'} onClick={()=>{setPreseasonGroup('team');setBefore(null);setPages([]);setSearch('');}}>Team odds</button>
        {seasonId&&<button className="ui-tab" type="button" aria-pressed={simulationView} onClick={()=>{setPreseasonGroup('simulations');setBefore(null);setPages([]);setSearch('');}}>Matchup simulations</button>}</div>}
      {scope==='series'&&<><div className="historical-betting-fixtures"><table className="sportsbook-table"><thead><tr><th>Series</th><th>Recorded day</th><th>Actual score</th><th /></tr></thead><tbody>
        {data.fixtures.map(f=><tr key={f.eventId}><td>{f.team1} vs {f.team2}</td><td>{f.day}</td><td>{f.score?f.score.join('–'):'Unverified'}</td><td><button type="button" onClick={()=>{setEventId(String(f.eventId));setBefore(null);setPages([]);}}>View odds</button></td></tr>)}
      </tbody></table></div><p>Actual scores were read after prices were frozen. Example lineups come from the played games; they were not verified before kickoff.</p>
      <div className="sportsbook-markets">{data.seriesOffers.filter(m=>!eventId||m.eventId===Number(eventId)).map(m=><article className="sportsbook-market" key={m.marketId}>
        <h2>{m.title}</h2><div className="historical-betting-prices">{m.selections.map((s,i)=><span key={i}>{s.label} <strong>{s.odds.toFixed(2)}×</strong></span>)}</div></article>)}</div></>}
      <div className="sportsbook-toolbar">{scope==='series'&&<label>Fixture <select value={eventId} onChange={e=>{setEventId(e.target.value);setBefore(null);setPages([]);}}><option value="">All examples</option>
        {data.fixtures.map(f=><option key={f.eventId} value={f.eventId}>{f.team1} vs {f.team2}</option>)}</select></label>}
        <label>Search player, team or market <input type="search" maxLength="100" value={search} onChange={e=>{setSearch(e.target.value);setBefore(null);setPages([]);}} /></label></div>
      {loading&&<p role="status">Loading preview…</p>}
      {!loading&&!simulationView&&!(playerView?(data.players?.length||data.leaderMarkets?.length):teamView?data.teamGroups?.length:data.markets.length)&&<p>No priced markets match this view. Check the held markets below.</p>}
      {simulationView?(!loading&&<BettingMatchupSimulations report={data.matchupSimulation} groups={data.teamGroups||[]} search={search}/>):playerView?<>{!loading&&<>
        {!!data.leaderMarkets?.length&&<details><summary>League-wide player leaders</summary><div className="historical-betting-fixtures"><table className="sportsbook-table"><thead><tr><th>Market</th><th>Reference odds</th></tr></thead><tbody>
          {data.leaderMarkets.map(m=><tr key={m.marketId}><td>{m.title}</td><td><MarketPrices market={m} /></td></tr>)}
        </tbody></table></div></details>}
        <div className="historical-player-list">{data.players?.map(player=><PlayerOddsRow key={player.playerId} player={player} />)}</div>
      </>}</>:teamView?(!loading&&<TeamOddsGroups groups={data.teamGroups||[]} />):<div className="historical-betting-fixtures"><table className="sportsbook-table"><thead><tr><th>Market</th><th>Reference odds</th></tr></thead><tbody>
        {!loading&&data.markets.map(m=><tr key={m.marketId}><td>{m.title}</td><td><div className="historical-betting-prices">{m.selections.map((s,i)=><span key={i}>{s.label} <strong>{s.odds.toFixed(2)}×</strong></span>)}</div></td></tr>)}
      </tbody></table></div>}
      {!teamView&&!simulationView&&<div className="sportsbook-paging"><button type="button" disabled={!pages.length||loading} onClick={()=>{setBefore(pages.at(-1));setPages(p=>p.slice(0,-1));}}>Previous</button>
        <span>Page {pages.length+1}</span><button type="button" disabled={!data.nextBefore||loading} onClick={()=>{setPages(p=>[...p,before]);setBefore(data.nextBefore);}}>Next</button></div>}
      {!!data.held.length&&<details><summary>Held markets and data gaps ({data.held.length})</summary>
        <ul>{Object.entries(heldCounts).map(([reason,count])=><li key={reason}>{reasons[reason]||reason.replaceAll('_',' ')} ({count})</li>)}</ul>
        {!!data.conflictingPlayers?.length&&<p>Conflicting account IDs: {data.conflictingPlayers.join(', ')}. Their preseason selections are withheld.</p>}
      </details>}
    </>}
    {!data&&loading&&<p role="status">Loading historical preview…</p>}
  </div>;
}
