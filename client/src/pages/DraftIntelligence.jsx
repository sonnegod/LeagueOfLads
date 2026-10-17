import { useState } from 'react';
import HeroDisplay from '../components/HeroDisplay';

const num=(n,d=1)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(d):'—';
const pct=(n,d)=>d?`${num(100*n/d)}%`:'—';
const record=r=>r?.games?`${r.wins}–${r.games-r.wins} · ${pct(r.wins,r.games)}`:'No sample';
const minutes=n=>n===null||n===undefined?'—':`${Math.floor(Math.round(n)/60)}:${String(Math.round(n)%60).padStart(2,'0')}`;
const METRICS=[['gpm','GPM'],['xpm','XPM'],['kp','Kill participation',true],['netShare','Farm share',true],['damageShare','Damage share',true],
  ['damageMin','Hero damage/min'],['towerMin','Tower damage/min'],['healMin','Healing/min'],['gold10','Gold @10'],['xp10','XP @10'],['lh10','LH @10'],
  ['laneDelta','Gold @10 vs hero/lane baseline'],['wards','Observers placed'],['sentries','Sentries placed'],['stacks','Camps stacked'],['stuns','Stun seconds']];

export default function DraftIntelligence({data,config,model,request,onRefresh,report,busy}) {
  const [side,setSide]=useState('opponent'),[patch,setPatch]=useState(data.meta.current?.key || ''),[hero,setHero]=useState(0),[transfer,setTransfer]=useState('0'),[note,setNote]=useState(''),[saving,setSaving]=useState(false);
  const intel=data.intelligence[side], names=new Map(data.heroes.map(h=>[h.id,h.name]));
  const player=id=>data.players[id]?.name || id;
  const icon=id=><HeroDisplay heroId={Number(id)} heroName={names.get(Number(id))} iconSize={24}/>;
  async function saveOverride(remove=false) {
    setSaving(true);
    try {await request(`/meta/${encodeURIComponent(patch)}`,{method:'PUT',body:JSON.stringify({heroId:Number(hero),transfer:remove?null:Number(transfer),note})});await onRefresh(config);setNote('');}
    catch(e){report(e.message);}finally{setSaving(false);}
  }
  return <div className="dg-intelligence">
    <section className="dg-panel"><div className="dg-controls"><h2>Matchup overview</h2><label>Outcome evidence<select value={config.metaMode || 'adaptive'} disabled={busy||saving} onChange={e=>onRefresh({...config,metaMode:e.target.value}).catch(e=>report(e.message))}>
      <option value="adaptive">Adaptive across patches</option><option value="current">Current patch only</option><option value="recent">Last 30 days, patch adjusted</option></select></label></div>
      <p className="dg-muted">Patch {data.meta.current?.key || 'unknown'} at this cutoff. Older familiarity can carry forward; old win rates and hero pairs lose weight at patch boundaries. Rework flags reset affected outcome evidence. All values are observations, not predicted win probabilities.</p>
      {data.meta.stale && Date.now()-Date.parse(data.asOf)<2*86400000 && <p className="dg-warning">The patch calendar has not been checked in the last week. A new boundary may be missing; run the patch sync before relying on current-meta evidence.</p>}
      <div className="dg-two-columns">{['our','opponent'].map(s=>{const t=data.intelligence[s];return <section key={s}><h3>{data.teams[s==='our'?config.ourTeam:config.opponentTeam].name}</h3><div className="dg-stat-grid">
        <div><strong>{t.teamGames}</strong><small>Team-ID history · {t.current.games} current patch</small></div>
        <div><strong>{record(t.chemistry.exact)}</strong><small>Confirmed five together, across team IDs</small></div>
        <div><strong>{record(t.form.recent)}</strong><small>Last 10 team games</small></div>
        <div><strong>{model.pressure[s].supported}/5</strong><small>Distinct players covered by remaining observed pools</small></div>
      </div></section>;})}</div>
      <p className="dg-muted">A thin observed pool means limited evidence; it does not mean a player cannot play other heroes. Picked flex heroes are counted as available to their possible players.</p>
    </section>
    <div className="ui-tabs"><button className="ui-tab" aria-pressed={side==='our'} onClick={()=>setSide('our')}>Your team</button><button className="ui-tab" aria-pressed={side==='opponent'} onClick={()=>setSide('opponent')}>Opponent</button></div>
    <div className="dg-two-columns">
      <section className="dg-panel"><h2>Lineup chemistry</h2><p className="dg-muted">These confirmed players together on any team. Each match counts once per overlap group. Results can span patches.</p>
        <div className="dg-chips">{intel.chemistry.overlaps.map(r=><span key={r.players}>{r.players}+ together: {record(r)}</span>)}</div>
        <details><summary>Teammate pairs</summary><div className="dg-table-wrap"><table><thead><tr><th>Players</th><th>Games</th><th>Win rate</th><th>Current patch</th></tr></thead><tbody>{intel.chemistry.pairs.map(p=><tr key={p.players.join(':')}><td>{p.players.map(player).join(' + ')}</td><td>{p.games}</td><td>{pct(p.wins,p.games)}</td><td>{p.currentGames}</td></tr>)}</tbody></table></div></details>
        {!intel.chemistry.pairs.length&&<p>No shared appearances before the cutoff.</p>}
        <details><summary>Hero pairs played by this lineup across teams</summary><p className="dg-muted">At least three observed games with two confirmed lineup members. Scoring requires five retained outcome games. Either hero's rework can reset a pair's transferred results.</p>
          <div className="dg-table-wrap"><table><thead><tr><th>Pair</th><th>Games</th><th>Raw win rate</th><th>Retained outcomes</th><th>Patch splits</th></tr></thead><tbody>{Object.entries(intel.heroPairs).filter(([,r])=>r.games>=3).sort((a,b)=>b[1].effectiveGames-a[1].effectiveGames).slice(0,15).map(([key,r])=><tr key={key}><td>{key.split(':').map(Number).map((id,i)=><span key={id}>{i?' + ':''}{icon(id)}</span>)}</td><td>{r.games}</td><td>{pct(r.wins,r.games)}</td><td>{num(r.effectiveGames)}</td><td>{Object.entries(r.patches).map(([key,p])=>`${key}: ${p.wins}/${p.games}W`).join(' · ')}</td></tr>)}</tbody></table></div>
        </details>
        <h3>Results by patch</h3><div className="dg-table-wrap"><table><thead><tr><th>Patch</th><th>Games</th><th>W–L · Win rate</th></tr></thead><tbody>{intel.patches.slice(-8).reverse().map(r=><tr key={r.patch}><td>{r.patch}</td><td>{r.games}</td><td>{record(r)}</td></tr>)}</tbody></table></div>
        <p className="dg-muted">Changes in results can reflect opponents and rosters as well as balance updates. Small samples should not be read as a meta shift.</p>
      </section>
      <section className="dg-panel"><h2>Hero pool pressure</h2><div className="dg-table-wrap"><table><thead><tr><th>Player</th><th>Remaining options</th><th>Current patch</th><th>Observed heroes</th><th>Top-3 concentration</th></tr></thead><tbody>{model.pressure[side].players.map(p=>{
        const pool=intel.pools.find(r=>r.id===p.id);return <tr key={p.id}><td>{player(p.id)}{p.fixed?' · assigned':''}</td><td>{p.options}</td><td>{p.currentOptions}</td><td>{pool.heroes} · {pool.currentHeroes} current</td><td>{pct(pool.topThreeShare,1)}</td></tr>;
      })}</tbody></table></div><p className="dg-muted">Supported options require 2 retained league practice games or 3 recent public games; known positions restrict the fit. Concentration uses raw league history, before draft removals.</p>
        <details><summary>Shared comfort heroes</summary><div className="dg-chips">{model.pressure[side].shared.slice(0,15).map(r=><span key={r.heroId}>{icon(r.heroId)}{r.players.map(player).join(', ')}</span>)}</div></details>
        <h3>Recent form & duration</h3><p>Last 10: {record(intel.form.recent)}. Previous 10: {record(intel.form.previous)}.</p><div className="dg-chips">{intel.durations.map(r=><span key={r.label}>{r.label}: {record(r)} ({r.games} games)</span>)}</div>
      </section>
      <section className="dg-panel"><h2>Draft tendencies</h2><p className="dg-muted">Pick phase uses overall pick ordinal: early 1–4, middle 5–8, late 9–10. Team history may contain other rosters.</p>
        <div className="dg-table-wrap"><table><thead><tr><th>Hero</th><th>Picks</th><th>Current</th><th>Early</th><th>Middle</th><th>Late</th></tr></thead><tbody>{intel.draft.heroes.slice(0,12).map(r=><tr key={r.heroId}><td>{icon(r.heroId)}</td><td>{r.picks}</td><td>{r.currentPicks}</td><td>{r.early}</td><td>{r.middle}</td><td>{r.late}</td></tr>)}</tbody></table></div>
        <details><summary>Observed replies to opposing picks</summary><p className="dg-muted">The immediately preceding enemy pick, not proof of a deliberate counter.</p>{intel.draft.responses.map(r=><div className="dg-chips" key={`${r.enemy}:${r.reply}`}><span>{icon(r.enemy)} → {icon(r.reply)} {r.games} games · {r.currentGames} current patch</span></div>)}{!intel.draft.responses.length&&<p>No replies repeated at least twice.</p>}</details>
      </section>
      <section className="dg-panel"><h2>Game flow & objectives</h2><p className="dg-muted">Timelines available at 20 minutes: {intel.timeline.coverage.timeline}/{intel.timeline.coverage.eligible} team games. Parsed detail fetched: {intel.timeline.coverage.observed}. Missing replays are excluded from each denominator.</p>
        <div className="dg-stat-grid"><div><strong>{num(intel.timeline.gold10.value,0)}</strong><small>Average gold advantage @10 ({intel.timeline.gold10.samples} samples)</small></div>
          <div><strong>{record(intel.timeline.leadConversion)}</strong><small>Converted +3,000 gold leads @20</small></div>
          <div><strong>{record(intel.timeline.comebacks)}</strong><small>Won from −2,000 gold @20</small></div>
          <div><strong>{pct(intel.timeline.fights.converted,intel.timeline.fights.wins)}</strong><small>Won fights followed by a tower/Roshan within 120s ({intel.timeline.fights.wins} fights)</small></div></div>
        <div className="dg-table-wrap"><table><thead><tr><th>First objective</th><th>Secured / observed</th><th>Win rate after</th><th>Median time</th></tr></thead><tbody>{Object.entries(intel.timeline.objectives).map(([key,r])=><tr key={key}><td>{key==='firstBlood'?'First blood':key}</td><td>{r.first}/{r.eligible}</td><td>{pct(r.wins,r.first)}</td><td>{minutes(r.medianSeconds)}</td></tr>)}</tbody></table></div>
        <p className="dg-muted">Fight wins mean fewer deaths in parsed fights with at least two deaths. Objective follow-up is an association; tower denies are excluded.</p>
      </section>
    </div>
    <section className="dg-panel"><h2>Player style & lane snapshots</h2><p className="dg-muted">Last 10 eligible league appearances per player, including stand-ins. Values show their sample count. Hero/lane baseline requires 5 other-player observations in the same patch. Lane classification is not a numbered position.</p>
      <div className="dg-table-wrap"><table><thead><tr><th>Metric</th>{config.lineups[side].map(p=><th key={p.id}>{player(p.id)}<small className="dg-block">{intel.players[p.id].patches.join(', ') || 'No history'}</small></th>)}</tr></thead><tbody>{METRICS.map(([key,label,percent])=><tr key={key}><th>{label}</th>{config.lineups[side].map(p=>{const r=intel.players[p.id].stats[key];return <td key={p.id}>{percent?pct(r.value, r.value===null?0:1):num(r.value,key.includes('Share')?2:1)} <small className="dg-muted">({r.samples})</small></td>;})}</tr>)}</tbody></table></div>
      <details><summary>Item timing medians · first purchase, among buyers</summary><div className="dg-two-columns">{config.lineups[side].map(p=><section key={p.id}><h3>{player(p.id)}</h3><div className="dg-chips">{intel.players[p.id].items.map(r=><span key={r.item}>{r.item.replaceAll('_',' ')}: {minutes(r.seconds)} · {r.buyers} games</span>)}</div>{!intel.players[p.id].items.length&&<p>No observed purchase timeline.</p>}</section>)}</div></details>
      <details><summary>Player form & recent hero results</summary><div className="dg-two-columns">{config.lineups[side].map(p=><section key={p.id}><h3>{player(p.id)}</h3><p>Last 10: {record(intel.players[p.id].form.recent)}. Previous 10: {record(intel.players[p.id].form.previous)}.</p><div className="dg-chips">{intel.players[p.id].heroForm.map(r=><span key={r.heroId}>{icon(r.heroId)} {record(r)} ({r.games} games)</span>)}</div></section>)}</div></details>
    </section>
    <details className="dg-panel"><summary>Meta policy & private overrides</summary><p className="dg-muted">Defaults: 60-day outcome half-life, 365-day familiarity half-life; major patch transfer 35%, minor 90%, with an additional hero-change discount. Rework text flags reset outcomes. These are conservative policy choices, not learned causal effects. A missing change marker does not prove a hero or synergy stayed unchanged. Override a boundary when your league's evidence warrants it.</p>
      <div className="dg-table-wrap"><table><thead><tr><th>Patch</th><th>History games</th><th>Base retained games</th><th>Change markers</th></tr></thead><tbody>{Object.entries(data.meta.counts).reverse().map(([key,r])=><tr key={key}><td>{key}</td><td>{r.games}</td><td>{num(r.effectiveGames)}</td><td>{data.meta.patches.find(p=>p.key===key)?.notesKnown?'Available':'Unknown'}</td></tr>)}</tbody></table></div><p className="dg-muted">Base retention is before individual hero-change discounts. Pair evidence uses both heroes' boundaries.</p>
      <div className="dg-settings"><label>Boundary<select value={patch} onChange={e=>setPatch(e.target.value)}>{data.meta.patches.slice().reverse().map(p=><option key={p.key} value={p.key}>{p.key} · {p.startsAt.slice(0,10)}</option>)}</select></label>
        <label>Applies to<select value={hero} onChange={e=>setHero(Number(e.target.value))}><option value={0}>All heroes / global meta</option>{data.heroes.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label>Retained fraction<input type="number" min={0} max={1} step={.05} value={transfer} onChange={e=>setTransfer(e.target.value)}/></label>
        <label>Reason<input maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label></div>
      <p>{data.meta.overrides[`${patch}:${hero}`]?`Saved override: ${data.meta.overrides[`${patch}:${hero}`].transfer} · ${data.meta.overrides[`${patch}:${hero}`].note}`:'Using the default policy for this boundary.'}</p>
      <button disabled={busy||saving||!patch||!note.trim()||transfer===''} onClick={()=>saveOverride()}>Save override</button> <button disabled={busy||saving||!data.meta.overrides[`${patch}:${hero}`]} onClick={()=>saveOverride(true)}>Restore default</button>
      <p className="dg-muted">Calendar: <a href="https://www.dota2.com/patches" target="_blank" rel="noreferrer">Valve patch notes</a>. No public rank or MMR is displayed.</p>
    </details>
  </div>;
}
