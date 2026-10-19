import {useState} from 'react';

const percent=value=>`${(value*100).toFixed(1)}%`;

export default function BettingMatchupSimulations({report,groups=[],search=''}) {
  const [group,setGroup]=useState('');
  if(!report)return <p>No saved matchup simulations. Rebuild the preseason preview to generate them. A supported BO2 group schedule is required.</p>;
  const groupNames=new Map([...groups.map(g=>[g.groupId,g.name]),...report.matchups.map(m=>[m.groupId,m.groupName||`Group ${m.groupId}`])]);
  const groupIds=[...new Set(report.matchups.map(m=>m.groupId))];
  const query=search.trim().toLocaleLowerCase();
  const rows=report.matchups.filter(m=>(!group||String(m.groupId)===group)
    &&`${m.team1} ${m.team2} ${groupNames.get(m.groupId)||''}`.toLocaleLowerCase().includes(query));
  return <section className="betting-matchup-simulations">
    <h2>Matchup simulations</h2>
    <p>{report.samples.toLocaleString()} simulated seasons. Every group matchup plays one BO2 in each run. Scores are from Team A's perspective.</p>
    <p className="admin-help">Each game is a weighted coin flip using the model's estimated win chance. Repeating it shows possible season outcomes; it does not validate whether that win chance is correct.</p>
    <details className="admin-help"><summary>How the simulations work</summary>
      <ol>
        <li>Estimate each team's strength from signup MMR and a modest adjustment for its players' previous league win records. Use up to 100 earlier games per player, soften small samples toward 50%, and average the five players' signals. Players without history receive a neutral history adjustment. These estimates stay fixed throughout each run.</li>
        <li>For each group game, draw a random number between 0 and 1. Team A wins if the draw is below its estimated win chance; otherwise Team B wins. A 60% chance means roughly 60 wins per 100 games, not a guaranteed result.</li>
        <li>Play both games independently. At 60%, Team A's BO2 score probabilities are 36% for 2-0, 48% for 1-1 and 16% for 0-2.</li>
        <li>Rank groups by wins, then Neustadtl, then a random draw for remaining ties. Apply the saved qualification rules and play the supported playoff bracket as BO3, with a BO5 final.</li>
        <li>Repeat the season and count placements and champions to estimate futures probabilities. Player props use separate samples of historical player statistics.</li>
      </ol>
      <p>Each score cell shows its calculated probability, then the observed frequency and count in these runs. Small differences are sampling noise. More runs reduce that noise; they do not prove the strength estimates are accurate.</p>
      <p>These are probability simulations, not Dota gameplay. Drafts, side advantage, changes in form and correlations between games are not modeled. No target-season results are used. Probabilities here are before the 10% odds reduction; the preview has no wager-driven movement.</p>
    </details>
    <div className="sportsbook-toolbar"><label>Group<select value={group} onChange={e=>setGroup(e.target.value)}>
      <option value="">All groups</option>{groupIds.map(id=><option key={id} value={id}>{groupNames.get(id)||`Group ${id}`}</option>)}
    </select></label></div>
    <div className="historical-betting-fixtures"><table className="sportsbook-table historical-matchup-table">
      <colgroup><col style={{width:'25%'}}/><col style={{width:'25%'}}/>{Array.from({length:5},(_,i)=><col key={i} style={{width:'10%'}}/>)}</colgroup>
      <thead><tr><th>Team A</th><th>Team B</th><th>A game win</th><th>B game win</th><th>A 2-0</th><th>1-1</th><th>A 0-2</th></tr></thead>
      <tbody>{rows.map(m=><tr key={`${m.team1Key}:${m.team2Key}`}>
        <th scope="row">{m.team1}</th><td>{m.team2}</td><td>{percent(m.gameWinProbability)}</td><td>{percent(1-m.gameWinProbability)}</td>
        {m.scores.map(s=><td key={s.score}><strong>{percent(s.probability)}</strong><small>{percent(s.count/report.samples)} observed<br/>{s.count.toLocaleString()} / {report.samples.toLocaleString()}</small></td>)}
      </tr>)}</tbody>
    </table></div>
    {!rows.length&&<p>No matchups match these filters.</p>}
  </section>;
}
