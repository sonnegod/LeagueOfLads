import { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import { MatchDraftBoard } from './LeagueMatchDetails';
import { useReport, ReportState, Panel, ReportTable, fmt } from './PerformanceUI';

function WinRate({ stats, showGames = true }) {
  return <span title={`${stats.wins} wins in ${stats.resolvedGames} games with a known result`}>
    {stats.winRate == null ? '—' : `${fmt(stats.winRate)}%`}
    {showGames && <small className="performance-sample"> {stats.resolvedGames} GP</small>}
  </span>;
}

function Frequency({ value, count, games, sample = 'drafts' }) {
  return <span title={`${count} of ${games} ${sample === 'games' ? 'played games with known lineups' : 'complete recorded drafts'} in the selected history`}>
    {value == null ? '—' : `${fmt(value)}%`}<small className="performance-sample"> {count}/{games} {sample === 'games' ? 'GP' : 'drafts'}</small>
  </span>;
}

function OpponentPickRate({ stats }) {
  if (!stats) return null;
  return <small className="draft-opponent-picks" title={stats.games
    ? `${stats.teamName}: played this hero in ${stats.picks} of ${stats.games} games with known lineups in the selected history`
    : `${stats.teamName}: no played games with known lineups in the selected history`}>
    Opponent picks <b>{stats.pickRate == null ? '—' : `${fmt(stats.pickRate)}%`}</b>
  </small>;
}

const centerStats = columns => columns.map(column => ['OrderNum', 'pickRate', 'banRate', 'contestRate', 'phaseRate',
  'games', 'playerWr', 'heroWr', 'picks', 'bans', 'winRate'].includes(column.key)
  ? { ...column, className: 'performance-cell-center' } : column);

const frequencyColumns = ['teamFrequency', 'frequency'].flatMap(source => [
  ['pickRate', 'Pick %', stats => stats.picks, stats => stats.pickGames],
  ['banRate', 'Ban %', stats => stats.bans, stats => stats.games],
  ['phaseRate', 'Same phase %', stats => stats.phaseCount, stats => stats.phaseGames],
].map(([key, label, count, games], index) => ({ key: `${source}.${key}`, label,
  className: `performance-cell-center${index === 0 ? ' draft-frequency-group-start' : ''}`,
  value: entry => entry[source][key], render: entry => <>
    <Frequency value={entry[source][key]} count={count(entry[source])} games={games(entry[source])} sample={key === 'pickRate' ? 'games' : 'drafts'} />
    {source === 'teamFrequency' && key === 'banRate' && entry.IsPick === 0 && <OpponentPickRate stats={entry.opponentPickFrequency} />}
  </> })));

export default function MatchDraftAnalysis({ matchId }) {
  const [scope, setScope] = useState('season'), [view, setView] = useState('frequency'), [phase, setPhase] = useState('all');
  const [beforeMatch, setBeforeMatch] = useState(false);
  const report = useReport(`/api/matches/${matchId}/analysis/draft/views`);
  return <Panel title="Picks & bans"><ReportState report={report}>{views => {
    const data = views[scope][beforeMatch ? 'before' : 'full'];
    const starts = data.history.playedLineupOnly ? null : data.entries[0]?.Team;
    const teamName = side => data.teams.find(t => t.side === side)?.name || 'Side unavailable';
    return <>
      <div className="draft-context-toolbar">
        <p className="performance-coverage">{data.history.playedLineupOnly ? `${data.entries.length} played heroes · draft order and bans unavailable`
          : `${data.entries.filter(e => e.IsPick === 1).length} picks · ${data.bans.length} bans`}
          {starts === 0 || starts === 1 ? <> · First pick: <strong className={`performance-side-${starts}`}>{teamName(starts)}</strong></> : null}</p>
        <div className="draft-context-filters">
          <div className="draft-period-control" role="group" aria-label="Draft history period">
            <span className="draft-period-label" data-active={!beforeMatch}>Full season</span>
            <button type="button" className="draft-period-switch" role="switch" aria-checked={beforeMatch}
              aria-label="Before this match" title={beforeMatch ? 'Switch to full season' : 'Switch to before this match'}
              onClick={() => setBeforeMatch(value => !value)}><span aria-hidden="true" /></button>
            <span className="draft-period-label" data-active={beforeMatch}>Before this match</span>
          </div>
        <label>History<select value={scope} onChange={event => setScope(event.target.value)}>
          <option value="season">This season</option>
          <option value="patch" disabled={!data.history.patchAvailable}>This season · same patch{data.history.patchKey ? ` (${data.history.patchKey})` : ''}</option>
        </select></label></div>
      </div>
      <p className="performance-note draft-context-coverage">{data.history.games} {data.history.beforeMatch ? 'earlier games' : 'season games'} in {data.history.leagueName}{scope === 'patch' ? ` on ${data.history.patchKey}` : ''}. {data.history.beforeMatch ? 'This match and later games are excluded.' : 'Includes this match and games played later in the season.'}</p>
      <div className="draft-analysis-layout">
        <aside className="match-overview-draft">
          <MatchDraftBoard draft={data.entries} radiantTeamName={teamName(0)} direTeamName={teamName(1)} iconSize={40} showPhases />
        </aside>
        <section className="draft-context" aria-label="Draft context">
          <div className="ui-tabs" aria-label="Draft context views">{[['frequency', 'Draft frequency'], ['lineups', 'Hero familiarity'], ['bans', 'Ban context']].map(([key, label]) =>
            <button type="button" className="ui-tab" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
          {view === 'frequency' ? <>
            <div className="draft-frequency-heading">
              <p className="performance-note">{data.history.playedGames} games with known lineups · {data.history.completeDrafts} complete drafts in this selection. Picks use played heroes, including games without a draft; bans and phases use recorded drafts. Team Specific follows the acting team; “Opponent picks” shows the opposing team’s played hero rate.</p>
              <label>Phase<select value={phase} onChange={event => setPhase(event.target.value)}>
                <option value="all">All phases</option>{[...new Map(data.entries.filter(e => e.phaseKey).map(e => [e.phaseKey, e.phase])).entries()].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></label>
            </div>
            {!data.history.phasesAvailable && <p className="performance-note">{data.history.playedLineupOnly ? 'Played lineups are shown. Draft order, bans and phases were not recorded for this match.' : 'Phase labels are unavailable because this draft’s action sequence is incomplete or conflicting.'}</p>}
            <div className="draft-frequency-table"><ReportTable rows={data.entries.filter(e => phase === 'all' || e.phaseKey === phase)} rowKey="OrderNum" initialSort="OrderNum" initialDirection="asc"
              columnGroups={[{ label: '', span: 3 }, { label: 'Team Specific', span: 3 }, { label: 'League Specific', span: 3 }]} columns={centerStats([
              { key: 'OrderNum', label: 'Order', render: e => e.OrderNum == null ? '—' : e.OrderNum + 1 },
              { key: 'HeroName', label: 'Hero', className: 'performance-cell-left', render: e => <HeroDisplay heroId={e.HeroId} heroName={e.HeroName} iconSize={26} /> },
              { key: 'phase', label: 'Action / phase', className: 'performance-cell-center', render: e => <span>{e.phase || (e.IsPick ? 'Pick' : 'Ban')}<small className={`draft-action-team performance-side-${e.Team}`}>{teamName(e.Team)}</small></span> },
              ...frequencyColumns,
            ])} empty="No draft actions were recorded for this selection." /></div>
            <p className="performance-note">Pick samples are games with known lineups; ban and phase samples are complete recorded drafts. Missing drafts never count as zero bans. Team rates follow the team across Radiant and Dire. Phases follow recorded pick/ban blocks; same-phase samples require that phase, and an action by the team for team rates.</p>
          </> : view === 'lineups' ? <>
            <p className="performance-note">Each player’s games on their chosen hero, compared with that hero’s league win rate in this history selection.</p>
            <div className="draft-lineup-columns">{data.teams.map(team => <section key={team.side}>
              <h3 className={`performance-side-${team.side}`}>{team.name}</h3>
              <ReportTable rows={team.players} rowKey="playerId" initialSort="pickOrder" initialDirection="asc" columns={centerStats([
                { key: 'playerName', label: 'Hero / player', render: p => <div className="draft-player-hero">
                  <HeroDisplay heroId={p.heroId} heroName={p.heroName} iconSize={28} showName={false} />
                  <span><Link to={`/hero/${p.heroId}`} title={p.heroName}>{p.heroName}</Link><Link to={`/player/${p.playerId}`} title={p.playerName}>{p.playerName}</Link></span>
                </div> },
                { key: 'games', label: data.history.beforeMatch ? 'Prior games' : 'Games', value: p => p.familiarity.games },
                { key: 'playerWr', label: 'Player WR', value: p => p.familiarity.winRate, render: p => <WinRate stats={p.familiarity} showGames={false} /> },
                { key: 'heroWr', label: 'League WR', value: p => p.leagueHero.winRate, render: p => <WinRate stats={p.leagueHero} /> },
              ])} empty="Player assignments are unavailable for this side." />
            </section>)}</div>
          </> : <>
            <p className="performance-note">Picks count actual played heroes, including games without a draft. Bans use recorded drafts. Pick/Ban uses only complete known drafts, with its own sample shown; its numerator can differ from Picks + Bans. League WR uses recorded results. Opponent experience is context, not proof of a ban’s intent.</p>
            <ReportTable rows={data.bans} rowKey="OrderNum" initialSort="OrderNum" initialDirection="asc" columns={centerStats([
              { key: 'OrderNum', label: 'Order', render: row => row.OrderNum == null ? '—' : row.OrderNum + 1 },
              { key: 'HeroName', label: 'Banned hero', className: 'performance-cell-left', render: row => <HeroDisplay heroId={row.HeroId} heroName={row.HeroName} iconSize={26} /> },
              { key: 'Team', label: 'Banned by', className: 'performance-cell-left', value: row => teamName(row.Team), render: row => <span className={`performance-side-${row.Team}`}>{teamName(row.Team)}</span> },
              { key: 'picks', label: data.history.beforeMatch ? 'Prior picks' : 'Picks', value: row => row.frequency.picks },
              { key: 'bans', label: data.history.beforeMatch ? 'Prior bans' : 'Bans', value: row => row.frequency.bans },
              { key: 'contestRate', label: 'Pick/Ban %', description: 'Games where this hero was picked or banned / complete recorded drafts in the selected history',
                value: row => row.frequency.contestRate, render: row => <Frequency value={row.frequency.contestRate} count={row.frequency.contestCount} games={row.frequency.games} /> },
              { key: 'winRate', label: 'League WR', value: row => row.leagueHero.winRate, render: row => <WinRate stats={row.leagueHero} /> },
              { key: 'opponents', label: 'Opponent experience', value: row => row.opponents[0]?.games ?? 0,
                render: row => row.opponents.length ? <div className="draft-ban-opponents">{row.opponents.map(p => <span key={p.playerId}>
                  <Link to={`/player/${p.playerId}`}>{p.playerName}</Link> <small>{p.games} GP · <WinRate stats={p} showGames={false} /></small>
                </span>)}</div> : <span className="performance-sample">{[0, 1].includes(row.Team) ? 'No games in this selection' : 'Opposing side unavailable'}</span> },
            ])} empty="No bans were recorded for this match." />
          </>}
          <p className="performance-note">WR uses games with a known team and result; sample sizes are shown as GP (games played). A blank WR means no resolved sample. Stand-in appearances count as hero experience.
            {data.history.usesMatchOrder ? ' Match ID order is used where historical kickoff times are unavailable.' : ''}</p>
        </section>
      </div>
    </>;
  }}</ReportState></Panel>;
}
