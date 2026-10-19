import {Link} from 'react-router-dom';
import {ArrowUpRight,Swords} from 'lucide-react';
import HeroDisplay from './HeroDisplay';

const number=(value,digits=0)=>value==null?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const record=summary=>summary?.games?`${summary.wins}W · ${summary.losses}L${summary.unknown?` · ${summary.unknown} awaiting result`:''}`:'No games yet';
const matchDate=value=>{
  if(!value)return 'Date unavailable';
  const date=new Date(value.length===10?`${value}T12:00:00`:value);
  return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
};
const teamLink=team=>team.TeamId?`/team/${team.TeamId}`:`/team/roster/${team.TeamSubmissionId}`;
const resultLabel=winner=>winner===1?'Win':winner===0?'Loss':'Result pending';
const resultClass=winner=>winner===1?'is-win':winner===0?'is-loss':'is-unknown';

export function PersonalStats({data,loading,error,accountId,onRetry}) {
  if(!data)return error?<div className="ui-panel" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></div>
    :<div className="ui-panel" role="status">Loading your dashboard…</div>;
  const {currentLeague,seasonSummary,recentMatches,teams,heroForm}=data;
  const recent={games:recentMatches.length,wins:recentMatches.filter(m=>m.Winner===1).length,
    losses:recentMatches.filter(m=>m.Winner===0).length,unknown:recentMatches.filter(m=>![0,1].includes(m.Winner)).length};
  const heroCounts=new Map();
  for(const match of recentMatches)if(match.HeroId){
    const hero=heroCounts.get(match.HeroId)||{...match,games:0};hero.games++;heroCounts.set(match.HeroId,hero);
  }
  const recentHero=[...heroCounts.values()].sort((a,b)=>b.games-a.games)[0];
  return <div aria-busy={loading}>
    {error&&<p role="alert" className="player-dashboard-error">{error} Your last loaded record is shown.</p>}
    {recentMatches.length>0&&<section className="ui-panel player-dashboard-form" aria-label="Your recent form">
      <div><p className="player-dashboard-eyebrow">Your recent form</p><strong>{record(recent)}</strong>
        <small>Your latest {recent.games} league {recent.games===1?'appearance':'appearances'} · oldest to newest</small></div>
      <div className="player-dashboard-form-results">{[...recentMatches].reverse().map(match=><Link key={match.MatchId}
        to={`/match/${match.MatchId}`} className={`player-dashboard-result ${resultClass(match.Winner)}`}
        aria-label={`${resultLabel(match.Winner)} on ${match.HeroName||'unknown hero'}, ${matchDate(match.DatePlayed)}`}
        title={`${resultLabel(match.Winner)} · ${match.HeroName||'Unknown hero'} · ${matchDate(match.DatePlayed)}`}>
        {match.Winner===1?'W':match.Winner===0?'L':'?'}</Link>)}</div>
      {recentHero?.games>1&&<div className="player-dashboard-recent-hero"><p className="player-dashboard-eyebrow">Your go-to lately</p>
        <HeroDisplay heroId={recentHero.HeroId} heroName={recentHero.HeroName} iconSize={30} />
        <small>{recentHero.games} of these {recent.games} games</small></div>}
    </section>}
    <div className="player-dashboard-grid">
      <section className="ui-panel player-dashboard-recent">
        <div className="player-dashboard-panel-heading"><div><h2>Recent matches</h2><p>Your latest league appearances across seasons</p></div>
          <Link to={`/player/${accountId}`}>Full history <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        {recentMatches.length?<div className="player-dashboard-table-scroll"><table className="player-dashboard-matches">
          <thead><tr><th>Hero / Match</th><th>Result</th><th>K / D / A</th><th>GPM</th><th>XPM</th></tr></thead>
          <tbody>{recentMatches.map(match=><tr key={match.MatchId}>
            <td><Link to={`/match/${match.MatchId}`}><HeroDisplay heroId={match.HeroId} heroName={match.HeroName} iconSize={34} link={false} /></Link>
              <small title={match.LeagueName}>{matchDate(match.DatePlayed)} · {match.LeagueName||`Match ${match.MatchId}`}</small></td>
            <td><span className={`player-dashboard-result ${resultClass(match.Winner)}`}>
              {match.Winner===1?'Win':match.Winner===0?'Loss':'—'}</span></td>
            <td className="player-dashboard-kda">{number(match.Kills)} / {number(match.Deaths)} / {number(match.Assists)}</td>
            <td>{number(match.GPM)}</td><td>{number(match.XPM)}</td>
          </tr>)}</tbody>
        </table></div>:<div className="player-dashboard-empty"><Swords size={28} aria-hidden="true" /><h3>Your first game starts the story</h3>
          <p>League matches will appear here once they are played and imported.</p><Link to="/">Explore the league →</Link></div>}
      </section>
      <aside className="player-dashboard-side">
        <section className="ui-panel player-dashboard-season"><div className="player-dashboard-panel-heading"><h2>Your team</h2></div>
          {teams.length>0?teams.map(team=><div className="player-dashboard-team" key={team.TeamSubmissionId}>
            <Link className="player-dashboard-team-name" to={teamLink(team)}>{team.TeamName} <ArrowUpRight size={16} aria-hidden="true" /></Link>
            <ul className="player-dashboard-roster">{team.players.map(player=><li key={player.PlayerId}>
              <Link to={`/player/${player.PlayerId}`}>{player.PlayerName||`Player ${player.PlayerId}`}</Link>
              {String(player.PlayerId)===String(accountId)&&<span>You</span>}</li>)}</ul>
          </div>):<p className="player-dashboard-muted">{currentLeague?'You are not on a finalized roster for the current season.':'Your team will appear here when a new season starts and rosters are finalized.'}</p>}
          {currentLeague&&<div className="player-dashboard-season-footer"><Link className="player-dashboard-season-name" to={`/league/${currentLeague.LeagueId}`}>{currentLeague.LeagueName} <ArrowUpRight size={14} aria-hidden="true" /></Link>
            <p className="player-dashboard-muted">{seasonSummary.games?`Your season: ${record(seasonSummary)}`:'Your season is still ahead. No games played yet.'}</p></div>}
        </section>
        <section className="ui-panel player-dashboard-hero-form"><div className="player-dashboard-panel-heading"><div>
          <h2>Heroes you’re winning with</h2><p>Last two seasons with games · 5+ recorded results per hero</p>
        </div></div>
          {heroForm?.seasons.length>0&&<p className="player-dashboard-form-seasons">{heroForm.seasons.map((season,i)=><span key={season.LeagueId}>
            {i>0&&' · '}<Link to={`/league/${season.LeagueId}`}>{season.LeagueName}</Link></span>)}</p>}
          {heroForm?.heroes.length>0?<div className="player-dashboard-form-heroes">{heroForm.heroes.map(hero=><article key={hero.HeroId}>
            <div><HeroDisplay heroId={hero.HeroId} heroName={hero.HeroName} iconSize={38} />
              <strong>{number(hero.winRate,1)}%<small>win rate</small></strong></div>
            <p><span>{hero.wins}W · {hero.losses}L</span><span>{number(hero.kda,2)} KDA</span></p>
          </article>)}</div>:<p className="player-dashboard-muted">{heroForm?.seasons.length?
            'No heroes with at least five recorded results and a winning record in these seasons yet. Your strong picks will appear here as you play.':
            'Your hero form will appear once league games are recorded.'}</p>}
        </section>
      </aside>
    </div>
  </div>;
}
