import { useEffect, useRef, useState } from 'react';
import DotaMapState from '../components/DotaMapState';
import HeroDisplay from '../components/HeroDisplay';
import useLiveResource from '../hooks/useLiveResource';
import useLiveSnapshots from '../hooks/useLiveSnapshots';
import {useLiveMatches} from '../context/liveMatches';
import './LiveMatchesPage.css';

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'Draft / pre-game';
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 'Draft / pre-game';

  const minutes = Math.floor(Math.abs(value) / 60);
  const remaining = Math.floor(Math.abs(value) % 60).toString().padStart(2, '0');
  return `${value < 0 ? '-' : ''}${minutes}:${remaining}`;
}

function formatStat(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number).toLocaleString();
}

function totalNetWorth(players) {
  return players.reduce((total, player) => {
    const netWorth = Number(player.net_worth);
    return Number.isFinite(netWorth) ? total + netWorth : total;
  }, 0);
}

function TeamPicks({ title, picks = [], bans = [] }) {
  if (!picks.length && !bans.length) return null;

  return (
    <div className="live-draft-panel" style={pickBanPanelStyle}>
      <h4 style={{ margin: '0 0 8px' }}>{title}</h4>
      {picks.length > 0 && (
        <div style={heroRowStyle}>
          <strong>Picks</strong>
          {picks.map((pick, index) => (
            <HeroDisplay
              key={`pick-${pick.hero_id}-${index}`}
              heroId={pick.hero_id}
              heroName={`Hero ${pick.hero_id}`}
              showName={false}
              iconSize={36}
            />
          ))}
        </div>
      )}
      {bans.length > 0 && (
        <div style={heroRowStyle}>
          <strong>Bans</strong>
          {bans.map((ban, index) => (
            <HeroDisplay
              key={`ban-${ban.hero_id}-${index}`}
              heroId={ban.hero_id}
              heroName={`Hero ${ban.hero_id}`}
              showName={false}
              iconSize={28}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerRows({ players = [] }) {
  if (!players.length) return null;

  return (
    <div style={playersGridStyle}>
      {players.map((player) => (
        <div className="live-player-row" key={`${player.team}-${player.account_id}`} style={playerRowStyle}>
          <div style={playerIdentityStyle}>
            {Number(player.hero_id) > 0 ? (
              <HeroDisplay heroId={player.hero_id} heroName={`Hero ${player.hero_id}`} showName={false} />
            ) : (
              <span style={unpickedStyle}>No hero</span>
            )}
            <div>
              <div className="live-player-name-row" style={playerNameRowStyle}>
                <span style={playerNameStyle}>{player.name || player.account_id}</span>
                <span style={playerInlineMetaStyle}>Lvl {formatStat(player.level)}</span>
                <span style={playerInlineMetaStyle}>NW {formatStat(player.net_worth)}</span>
              </div>
              <div className="live-player-stats" style={playerStatsLineStyle}>
                <span>KDA {formatStat(player.kills)}/{formatStat(player.death)}/{formatStat(player.assists)}</span>
                <span>CS {formatStat(player.last_hits)}/{formatStat(player.denies)}</span>
                <span>{formatStat(player.gold_per_min)} GPM</span>
                <span>{formatStat(player.xp_per_min)} XPM</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveMatchCard({ match, variant = 'live' }) {
  const [historyOpen,setHistoryOpen]=useState(false);
  const {snapshots,error:historyError,loading:historyLoading,retry}=useLiveSnapshots(match,historyOpen);
  const [selectedSnapshotIndex, setSelectedSnapshotIndex] = useState(null);
  const timeline = snapshots.length ? snapshots : [match];
  const latestIndex = timeline.length - 1;
  const isLive = selectedSnapshotIndex === null || selectedSnapshotIndex >= latestIndex;
  const selectedIndex = isLive ? latestIndex : selectedSnapshotIndex;
  const selected = isLive ? match : timeline[selectedIndex] || match;
  const latestStatusLabel = variant === 'recent' ? 'Recent match' : 'Live view';

  useEffect(() => {
    setSelectedSnapshotIndex(null);
  }, [match.MatchId]);

  useEffect(() => {
    setSelectedSnapshotIndex((current) => {
      if (current === null) return null;
      return Math.min(current, latestIndex);
    });
  }, [latestIndex]);

  const radiantPlayers = (selected.Players || []).filter((player) => Number(player.team) === 0);
  const direPlayers = (selected.Players || []).filter((player) => Number(player.team) === 1);
  const radiantNetWorth = totalNetWorth(radiantPlayers);
  const direNetWorth = totalNetWorth(direPlayers);

  return (
    <section className="live-match-card" style={matchCardStyle}>
      <div className="live-match-header" style={matchHeaderStyle}>
        <div style={teamHeaderStyle}>
          <div style={teamNameStyle}>{selected.RadiantTeamName || `Radiant ${selected.RadiantTeamId}`}</div>
          <div style={teamNetWorthStyle}>NW {formatStat(radiantNetWorth)}</div>
        </div>
        <div style={scoreBlockStyle}>
          <div style={isLive ? (variant === 'recent' ? recentStatusStyle : liveStatusStyle) : historyStatusStyle}>
            {isLive ? latestStatusLabel : 'History view'}
          </div>
          <div style={scoreStyle}>
            {selected.RadiantScore ?? 0} - {selected.DireScore ?? 0}
          </div>
          <div style={metaStyle}>{formatDuration(selected.GameDuration)}</div>
        </div>
        <div style={teamHeaderStyle}>
          <div style={teamNameStyle}>{selected.DireTeamName || `Dire ${selected.DireTeamId}`}</div>
          <div style={teamNetWorthStyle}>NW {formatStat(direNetWorth)}</div>
        </div>
      </div>

      {Number(match.MatchId)>0&&<div className="live-match-id">Match ID: <span>{match.MatchId}</span></div>}
      <LiveFreshness match={match} variant={variant}/>

      <div className="live-overview-grid" style={liveOverviewGridStyle}>
        <div className="live-radiant-players" style={sidePlayersStyle}>
          <div style={sidePlayersTitleStyle}>Radiant Players</div>
          <PlayerRows players={radiantPlayers} />
        </div>
        <div className="live-map-panel" style={mapPanelStyle}>
          <div style={mapTitleStyle}>Dota Map State</div>
          <DotaMapState
            radiantTowerState={selected.RadiantTowerState}
            direTowerState={selected.DireTowerState}
            radiantBarracksState={selected.RadiantBarracksState}
            direBarracksState={selected.DireBarracksState}
            players={selected.Players || []}
          />
        </div>
        <div className="live-dire-players" style={sidePlayersStyle}>
          <div style={sidePlayersTitleStyle}>Dire Players</div>
          <PlayerRows players={direPlayers} />
        </div>
      </div>

      <div className="live-timeline-actions"><button type="button" aria-expanded={historyOpen}
        onClick={()=>{setHistoryOpen(open=>!open);setSelectedSnapshotIndex(null);}}>
        {historyOpen?'Hide match timeline':'Show match timeline'}
      </button>{historyOpen&&historyLoading&&<span role="status">Loading timeline…</span>}</div>
      {historyOpen&&historyError&&<p className="live-update-error" role="status">Timeline unavailable. Live scores keep updating. <button type="button" onClick={retry}>Retry timeline</button></p>}
      {historyOpen && timeline.length > 1 && (
        <div style={timelineStyle}>
          <label>
            Snapshot {selectedIndex + 1} / {timeline.length}
            <input
              type="range"
              min="0"
              max={latestIndex}
              value={selectedIndex}
              onChange={(event) => {
                const nextIndex = Number(event.target.value);
                setSelectedSnapshotIndex(nextIndex >= latestIndex ? null : nextIndex);
              }}
              style={{ width: '100%' }}
            />
          </label>
          <div style={metaStyle}>
            Showing {selected.CreatedAt || selected.LastUpdated}.{' '}
            {!isLive && 'New snapshots will load without moving this view. '}
            {variant === 'live' && (
              <button type="button" onClick={() => setSelectedSnapshotIndex(null)} style={smallButtonStyle}>
                Return to live
              </button>
            )}
          </div>
        </div>
      )}

      <div className="live-draft-grid" style={draftGridStyle}>
        <TeamPicks title="Radiant Draft" picks={selected.RadiantPicks} bans={selected.RadiantBans} />
        <TeamPicks title="Dire Draft" picks={selected.DirePicks} bans={selected.DireBans} />
      </div>
    </section>
  );
}

function liveTimestamp(value) {
  if (!value) return null;
  const milliseconds=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:value.replace(' ','T')+'Z');
  return Number.isFinite(milliseconds)?milliseconds:null;
}

function ageLabel(milliseconds,now) {
  if(milliseconds===null)return 'unavailable';
  const seconds=Math.max(0,Math.floor((now-milliseconds)/1000));
  if(seconds<2)return 'just now';
  if(seconds<60)return `${seconds}s ago`;
  return `${Math.floor(seconds/60)}m ago`;
}

function LiveFreshness({match,variant}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[]);
  const seen=liveTimestamp(match.LastUpdated);
  const changed=liveTimestamp(match.LastChangedAt||match.CreatedAt);
  return <div className="live-freshness" data-delayed={variant==='live'&&seen!==null&&now-seen>20000}>
    <span title="When the saved game data last changed">{variant==='recent'?'Last tracked':'Game data updated'} {ageLabel(changed,now)}</span>
    {variant==='live'&&<span title="When the worker last received this match from Steam">Checked {ageLabel(seen,now)}</span>}
    {Number(match.StreamDelaySeconds)>0&&<span>Broadcast delay {formatDuration(match.StreamDelaySeconds)}</span>}
  </div>;
}

export default function LiveMatchesPage() {
  const live=useLiveMatches();
  const recent=useLiveResource('/api/liveMatches/recent?hours=24',30000);
  const matches=live.data?.matches||[];
  const currentMatchIds=new Set(matches.map(match=>Number(match.MatchId)));
  const recentMatches=(recent.data?.matches||[]).filter(match=>!currentMatchIds.has(Number(match.MatchId)));
  const previousIds=useRef([]);
  const refreshRecent=recent.refresh;
  useEffect(()=>{
    const ids=new Set((live.data?.matches||[]).map(match=>Number(match.MatchId)));
    if(previousIds.current.some(id=>!ids.has(id)))refreshRecent();
    previousIds.current=[...ids];
  },[live.data,refreshRecent]);

  return (
    <div className="live-matches-page ui-page" style={pageStyle}>
      <header className="ui-page-heading"><div><h1>Live matches</h1><p style={metaStyle}>Scores, players, and draft updates</p></div>
        <button type="button" onClick={()=>{live.refresh();recent.refresh();}}>Refresh</button></header>
      {!live.loading&&<p className="live-connection-status" data-connection={live.connection}>{live.connection==='live'?'Live updates connected':live.connection==='polling'?'Refreshing automatically while live updates reconnect':live.connection==='paused'?'Updates paused while this tab is hidden':'Connecting to live updates…'}</p>}
      {live.loading&&<p role="status">Loading live matches…</p>}
      {live.error&&<p className="live-update-error" role="status">{live.data?live.error:'Unable to load live matches. Retrying automatically.'}</p>}
      {!live.loading&&!live.error&&!matches.length&&<p style={metaStyle}>No matches are live right now.</p>}
      <div style={cardsStyle}>
        {matches.map((match) => (
          <LiveMatchCard
            key={match.MatchId}
            match={match}
          />
        ))}
      </div>

      <section style={recentSectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ margin: 0 }}>Recent Matches</h2>
          <span style={metaStyle}>Last 24 hours</span>
        </div>
        {recent.error&&<p className="live-update-error" role="status">Recent matches could not be refreshed. Retrying automatically.</p>}
        {recentMatches.length > 0 ? (
          <div style={cardsStyle}>
            {recentMatches.map((match) => (
              <LiveMatchCard
                key={`recent-${match.MatchId}`}
                match={match}
                variant="recent"
              />
            ))}
          </div>
        ) : (
          <p style={metaStyle}>{recent.loading?'Loading recent matches…':recent.error?'':'No recently tracked matches.'}</p>
        )}
      </section>

      <div style={attributionStyle}>
        Dota 2 minimap image © Valve Corporation. Used under Valve fan content guidelines.
      </div>
    </div>
  );
}

const pageStyle = {
  padding: '1rem',
  color: 'var(--text, #e6e6e6)',
};

const cardsStyle = {
  display: 'grid',
  gap: '20px',
};

const recentSectionStyle = {
  marginTop: '34px',
  paddingTop: '18px',
  borderTop: '1px solid var(--border, #222428)',
};

const sectionHeaderStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '14px',
};

const attributionStyle = {
  marginTop: '24px',
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.72rem',
  textAlign: 'center',
};

const matchCardStyle = {
  border: '1px solid var(--border, #222428)',
  borderRadius: '12px',
  padding: '18px',
  background: 'var(--surface, #121315)',
};

const matchHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  gap: '16px',
  alignItems: 'center',
};

const teamHeaderStyle = {
  textAlign: 'center',
};

const teamNameStyle = {
  fontSize: '1.35rem',
  fontWeight: 800,
};

const teamNetWorthStyle = {
  marginTop: '4px',
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.95rem',
  fontWeight: 800,
};

const scoreBlockStyle = {
  textAlign: 'center',
  minWidth: '150px',
};

const scoreStyle = {
  fontSize: '2.5rem',
  fontWeight: 900,
};

const metaStyle = {
  color: 'var(--muted-text, #9aa0b4)',
};

const liveStatusStyle = {
  display: 'inline-block',
  marginBottom: '6px',
  padding: '3px 8px',
  borderRadius: '999px',
  background: '#123326',
  color: '#4fd6a3',
  fontSize: '0.8rem',
  fontWeight: 900,
  textTransform: 'uppercase',
};

const historyStatusStyle = {
  ...liveStatusStyle,
  background: '#332712',
  color: '#ffd166',
};

const recentStatusStyle = {
  ...liveStatusStyle,
  background: '#1f2c3f',
  color: '#8fbfff',
};

const liveOverviewGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 0.85fr) minmax(320px, 1.15fr) minmax(220px, 0.85fr)',
  gap: '14px',
  alignItems: 'start',
  marginTop: '18px',
};

const sidePlayersStyle = {
  display: 'grid',
  gap: '8px',
};

const sidePlayersTitleStyle = {
  textAlign: 'center',
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.82rem',
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const mapPanelStyle = {
  padding: '16px',
  borderRadius: '12px',
  border: '1px solid #2d4039',
  background:
    'radial-gradient(circle at 20% 20%, rgba(79, 214, 163, 0.2), transparent 30%), radial-gradient(circle at 80% 80%, rgba(255, 139, 139, 0.18), transparent 32%), #111816',
};

const mapTitleStyle = {
  textAlign: 'center',
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: '12px',
  color: '#d8efe5',
};

const draftGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '14px',
  marginTop: '14px',
};

const pickBanPanelStyle = {
  border: '1px solid var(--border, #222428)',
  borderRadius: '8px',
  padding: '12px',
};

const heroRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  marginTop: '8px',
};

const playersGridStyle = {
  border: '1px solid var(--border, #222428)',
  borderRadius: '8px',
  padding: '12px',
  display: 'grid',
  gap: '8px',
};

const playerRowStyle = {
  padding: '8px',
  borderRadius: '8px',
  background: 'rgba(255, 255, 255, 0.03)',
};

const playerIdentityStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  minWidth: 0,
};

const playerNameRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
  minWidth: 0,
  whiteSpace: 'nowrap',
};

const playerNameStyle = {
  fontWeight: 800,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const playerInlineMetaStyle = {
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.72rem',
  fontWeight: 800,
  flexShrink: 0,
};

const playerStatsLineStyle = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'nowrap',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.72rem',
  fontWeight: 700,
  marginTop: '2px',
};

const unpickedStyle = {
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.85rem',
};

const timelineStyle = {
  marginTop: '18px',
  paddingTop: '12px',
  borderTop: '1px solid var(--border, #222428)',
};

const smallButtonStyle = {
  padding: '4px 8px',
  fontSize: '0.85rem',
};
