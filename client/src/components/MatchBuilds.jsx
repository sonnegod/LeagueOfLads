import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HeroDisplay from './HeroDisplay';
import MatchResultBadge from './MatchResultBadge';
import MatchSkillSequence from './MatchSkillSequence';
import MatchInventorySlot from './MatchInventorySlot';
import { Panel, ReportState, clock, useReport } from './PerformanceUI';
import items from '@dota-items';

const itemByKey = new Map(Object.values(items).map(item => [item.key, item]));
const itemIdByKey = new Map(Object.entries(items).map(([id, item]) => [item.key, id]));

function ItemGroup({ label, starting = false, children }) {
  return <div className={`match-build-item-group${starting ? ' match-build-item-group--starting' : ''}`}>
    <span>{label}</span><div role="group" aria-label={label}>{children}</div>
  </div>;
}

function Equipment({ inventory, startingItems, loading, error }) {
  const unavailable = label => <span className="match-build-equipment-note">{loading ? 'Loading items…' : error ? 'Items could not be loaded.' : `${label} unavailable.`}</span>;
  return <div className="match-build-loadouts">
    <section className="match-build-loadout" aria-label="Starting items" style={{ '--item-slots': 'var(--starting-item-slots)' }}>
      <h3>Starting items</h3>
      {startingItems == null ? unavailable('Starting purchases') : startingItems.length ?
        <div className="match-build-equipment"><ItemGroup label="Starting purchases" starting>{startingItems.map((key, index) =>
          <MatchInventorySlot key={index} id={itemIdByKey.get(key) || key} label={`Starting purchase ${index + 1}`} />)}</ItemGroup></div> :
        <span className="match-build-equipment-note">No starting purchases recorded.</span>}
    </section>
    <section className="match-build-loadout" aria-label="Final items"><h3>Final items</h3>
      {!inventory ? unavailable('Final inventory') : <div className="match-build-equipment">
    {[['Items', inventory.items, false], ['Backpack', inventory.backpack, false], ['Neutral', [inventory.neutral], true]].map(([label, slots, round]) =>
      <ItemGroup label={label} key={label}>
        {slots.map((id, index) => <MatchInventorySlot key={index} id={id} label={`${label} ${index + 1}`} round={round} />)}
      </ItemGroup>)}
      </div>}
    </section>
  </div>;
}

function Purchases({ matchId, player }) {
  const report = useReport(`/api/matches/${matchId}/analysis/players/${player.PlayerId}`);
  const [limit, setLimit] = useState(30);
  return <div className="match-build-purchase-detail" id={`match-purchases-${player.PlayerId}`}>
    <h3>{player.PlayerName} · Purchase timeline</h3>
    <ReportState report={report}>{data => data.purchases.length ? <>
      <ol className="match-build-purchases">{data.purchases.slice(0, limit).map(purchase => {
        const item = itemByKey.get(purchase.ItemKey);
        return <li key={purchase.EventIndex}><time>{clock(purchase.TimeSeconds)}</time>
          <span>{item?.name || purchase.ItemKey.replaceAll('_', ' ')}</span></li>;
      })}</ol>
      {limit < data.purchases.length && <button type="button" onClick={() => setLimit(value => value + 50)}>Show more purchases ({data.purchases.length - limit} remaining)</button>}
    </> : <p className="performance-message">{data.available ? 'No purchase events recorded for this player.' : 'Purchase history is unavailable for this match.'}</p>}</ReportState>
  </div>;
}

export default function MatchBuilds({ matchId, match, groups, initialPlayerId }) {
  const skills = useReport(`/api/matches/${matchId}/analysis/skills`);
  const inventory = useReport(`/api/matches/${matchId}/analysis/inventories`);
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayerId ?? null);
  const builds = new Map((skills.data?.players || []).map(player => [player.playerId, player.upgrades]));
  const inventories = new Map((inventory.data?.players || []).map(player => [player.playerId, player]));
  const startingSlots = Math.min(10, Math.max(6, ...[...inventories.values()].map(player => player.startingItems?.length || 0)));
  useEffect(() => {
    if (initialPlayerId != null) document.getElementById(`match-build-player-${initialPlayerId}`)?.scrollIntoView({ block: 'center' });
  }, [initialPlayerId]);
  return <div className="performance-report match-builds" style={{ '--starting-item-slots': startingSlots }}>
    <div className="match-section-heading"><div><h2>Player builds</h2><p>Starting items, final items and spell choices together. Open a player's purchases for the full order and timing.</p></div></div>
    {skills.error && <p className="performance-message" role="alert">Could not load spell upgrades. <button type="button" onClick={skills.retry}>Retry spells</button></p>}
    {inventory.error && <p className="performance-message" role="alert">Could not load items. <button type="button" onClick={inventory.retry}>Retry items</button></p>}
    {groups.map(({ side, players }) => <Panel key={side ?? 'unknown'} className="match-builds-panel">
      <div className={`match-scoreboard-team performance-side-${side}`}>
        <h2>{side === null ? 'Side unavailable' : <Link to={`/team/${side === 0 ? match.rad_team_id : match.dire_team_id}`}>
          {side === 0 ? match.rad_team_name : match.dire_team_name}</Link>}</h2>
        {side !== null && <MatchResultBadge winnerSide={match.WinnerSide} side={side === 0 ? 'r' : 'd'} />}
      </div>
      <div className="match-build-players">{players.map(player => <article className="match-build-player" key={player.PlayerId}
        id={`match-build-player-${player.PlayerId}`} aria-label={`${player.PlayerName}'s build`} data-selected={selectedPlayer === player.PlayerId}>
        <div className="match-build-player-main">
          <div className="match-build-player-heading">
            <Link to={`/player/${player.PlayerId}`}>{player.PlayerName}</Link>
            <HeroDisplay heroId={player.HeroId} heroName={player.HeroName} iconSize={26} />
          </div>
          <button type="button" className="match-build-purchase-button" aria-expanded={selectedPlayer === player.PlayerId}
            aria-controls={`match-purchases-${player.PlayerId}`} aria-label={`${selectedPlayer === player.PlayerId ? 'Hide' : 'Show'} ${player.PlayerName}'s purchases`}
            onClick={() => setSelectedPlayer(current => current === player.PlayerId ? null : player.PlayerId)}>
            {selectedPlayer === player.PlayerId ? 'Hide purchases' : 'Purchases'}
          </button>
        </div>
        <Equipment inventory={inventories.get(player.PlayerId)?.inventory} startingItems={inventories.get(player.PlayerId)?.startingItems}
          loading={inventory.loading} error={inventory.error} />
        <MatchSkillSequence playerName={player.PlayerName} upgrades={builds.get(player.PlayerId)} loading={skills.loading} error={Boolean(skills.error)} />
        {selectedPlayer === player.PlayerId && <Purchases matchId={matchId} player={player} />}
      </article>)}</div>
    </Panel>)}
    <p className="performance-note">Spell numbers show upgrade order. Empty inventory slots and unrecorded slots are shown separately.</p>
  </div>;
}
