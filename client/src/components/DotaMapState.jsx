import { useMemo, useRef, useState } from 'react';

const MINIMAP_SRC = '/maps/dota_minimap.png';
const MARKER_STORAGE_KEY = 'leagueOfLadsDotaMapMarkerPositions';
const MAP_WORLD_MIN = -8200;
const MAP_WORLD_MAX = 8200;
const PLAYER_MAP_SCALE_X = 0.78;
const PLAYER_MAP_SCALE_Y = 0.78;
const PLAYER_MAP_OFFSET_X = 0;
const PLAYER_MAP_OFFSET_Y = 0;

const towerMarkers = [
  { side: 'radiant', bit: 0, label: 'Radiant Top T1', x: 19.9, y: 38.5 },
  { side: 'radiant', bit: 1, label: 'Radiant Top T2', x: 19.3, y: 54.5 },
  { side: 'radiant', bit: 2, label: 'Radiant Top T3', x: 18.7, y: 64.9 },
  { side: 'radiant', bit: 3, label: 'Radiant Mid T1', x: 43.8, y: 54.8 },
  { side: 'radiant', bit: 4, label: 'Radiant Mid T2', x: 34.8, y: 63.3 },
  { side: 'radiant', bit: 5, label: 'Radiant Mid T3', x: 28.2, y: 68.3 },
  { side: 'radiant', bit: 6, label: 'Radiant Bot T1', x: 75.5, y: 77.4 },
  { side: 'radiant', bit: 7, label: 'Radiant Bot T2', x: 48.5, y: 79 },
  { side: 'radiant', bit: 8, label: 'Radiant Bot T3', x: 32.4, y: 77.9 },
  { side: 'radiant', bit: 9, label: 'Radiant Ancient Tower 1', x: 22.6, y: 72.2 },
  { side: 'radiant', bit: 10, label: 'Radiant Ancient Tower 2', x: 24.9, y: 74.3 },
  { side: 'dire', bit: 0, label: 'Dire Top T1', x: 24.6, y: 21.5 },
  { side: 'dire', bit: 1, label: 'Dire Top T2', x: 50.1, y: 20.5 },
  { side: 'dire', bit: 2, label: 'Dire Top T3', x: 66.2, y: 21.9 },
  { side: 'dire', bit: 3, label: 'Dire Mid T1', x: 54.4, y: 44.8 },
  { side: 'dire', bit: 4, label: 'Dire Mid T2', x: 64, y: 37.2 },
  { side: 'dire', bit: 5, label: 'Dire Mid T3', x: 70.5, y: 32 },
  { side: 'dire', bit: 6, label: 'Dire Bot T1', x: 79.8, y: 58.6 },
  { side: 'dire', bit: 7, label: 'Dire Bot T2', x: 80.7, y: 46.6 },
  { side: 'dire', bit: 8, label: 'Dire Bot T3', x: 81.2, y: 35.3 },
  { side: 'dire', bit: 9, label: 'Dire Ancient Tower 1', x: 75.2, y: 25.6 },
  { side: 'dire', bit: 10, label: 'Dire Ancient Tower 2', x: 77.6, y: 27.3 },
];

const barracksMarkers = [
  { side: 'radiant', bit: 0, label: 'Radiant Top Melee Barracks', x: 17.3, y: 67.5 },
  { side: 'radiant', bit: 1, label: 'Radiant Top Ranged Barracks', x: 20.3, y: 67.6 },
  { side: 'radiant', bit: 2, label: 'Radiant Mid Melee Barracks', x: 25.6, y: 68.9 },
  { side: 'radiant', bit: 3, label: 'Radiant Mid Ranged Barracks', x: 27.8, y: 71.2 },
  { side: 'radiant', bit: 4, label: 'Radiant Bot Melee Barracks', x: 30.1, y: 79.6 },
  { side: 'radiant', bit: 5, label: 'Radiant Bot Ranged Barracks', x: 30, y: 76.4 },
  { side: 'dire', bit: 0, label: 'Dire Top Melee Barracks', x: 68.7, y: 20.7 },
  { side: 'dire', bit: 1, label: 'Dire Top Ranged Barracks', x: 68.8, y: 23.4 },
  { side: 'dire', bit: 2, label: 'Dire Mid Melee Barracks', x: 73.7, y: 30.6 },
  { side: 'dire', bit: 3, label: 'Dire Mid Ranged Barracks', x: 71.5, y: 28.5 },
  { side: 'dire', bit: 4, label: 'Dire Bot Melee Barracks', x: 82.6, y: 32.5 },
  { side: 'dire', bit: 5, label: 'Dire Bot Ranged Barracks', x: 79.2, y: 32.4 },
];

function bitActive(value, bit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  return (number & (1 << bit)) !== 0;
}

function getStateForMarker(marker, states) {
  if (marker.side === 'radiant' && marker.type === 'barracks') return states.radiantBarracksState;
  if (marker.side === 'dire' && marker.type === 'barracks') return states.direBarracksState;
  if (marker.side === 'radiant') return states.radiantTowerState;
  return states.direTowerState;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function markerId(marker) {
  return `${marker.type}-${marker.side}-${marker.bit}-${marker.label}`;
}

function loadSavedPositions() {
  if (typeof window === 'undefined') return {};

  try {
    return JSON.parse(window.localStorage.getItem(MARKER_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePositions(positions) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MARKER_STORAGE_KEY, JSON.stringify(positions));
}

function StructureMarker({ marker, states, draggable, dragging, onPointerDown }) {
  const alive = bitActive(getStateForMarker(marker, states), marker.bit);
  const radiant = marker.side === 'radiant';
  const barracks = marker.type === 'barracks';

  return (
    <span
      title={`${marker.label}: ${alive ? 'standing' : 'destroyed'}`}
      style={{
        ...markerStyle,
        ...(barracks ? barracksMarkerStyle : towerMarkerStyle),
        ...(draggable ? draggableMarkerStyle : {}),
        ...(dragging ? draggingMarkerStyle : {}),
        left: `${marker.x}%`,
        top: `${marker.y}%`,
        background: alive ? (radiant ? '#42e6a4' : '#ff6b6b') : '#241719',
        borderColor: alive ? (radiant ? '#c4ffe4' : '#ffd1d1') : '#75545a',
        boxShadow: alive
          ? `0 0 10px ${radiant ? 'rgba(66, 230, 164, 0.8)' : 'rgba(255, 107, 107, 0.8)'}`
          : 'none',
        opacity: alive ? 1 : 0.55,
      }}
      onPointerDown={draggable ? (event) => onPointerDown(event, marker.id) : undefined}
    />
  );
}

function playerPositionToPercent(player) {
  const positionX = Number(player.position_x);
  const positionY = Number(player.position_y);
  if (!Number.isFinite(positionX) || !Number.isFinite(positionY)) return null;
  if (positionX === 0 && positionY === 0) return null;

  const worldSpan = MAP_WORLD_MAX - MAP_WORLD_MIN;
  const rawX = ((positionX - MAP_WORLD_MIN) / worldSpan) * 100;
  const rawY = 100 - ((positionY - MAP_WORLD_MIN) / worldSpan) * 100;

  return {
    x: clamp(50 + (rawX - 50) * PLAYER_MAP_SCALE_X + PLAYER_MAP_OFFSET_X, 0, 100),
    y: clamp(50 + (rawY - 50) * PLAYER_MAP_SCALE_Y + PLAYER_MAP_OFFSET_Y, 0, 100),
  };
}

function PlayerMarker({ player }) {
  const position = playerPositionToPercent(player);
  if (!position) return null;

  const radiant = Number(player.team) === 0;
  const heroId = Number(player.hero_id);
  const hasHero = Number.isFinite(heroId) && heroId > 0;

  return (
    <span
      style={{
        ...playerMarkerStyle,
        left: `${position.x}%`,
        top: `${position.y}%`,
        borderColor: radiant ? '#0f6b48' : '#7b2222',
      }}
    >
      {hasHero ? (
        <img
          src={`/heroes/icons/${heroId}.png`}
          alt=""
          style={playerHeroIconStyle}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span style={{ ...playerFallbackDotStyle, background: radiant ? '#9dffd2' : '#ff9a9a' }} />
      )}
    </span>
  );
}

export default function DotaMapState({
  radiantTowerState,
  direTowerState,
  radiantBarracksState,
  direBarracksState,
  players = [],
}) {
  const mapWrapRef = useRef(null);
  const [savedPositions, setSavedPositions] = useState(loadSavedPositions);
  const [draggingMarkerId, setDraggingMarkerId] = useState(null);
  const showDebugGrid =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mapDebug') === '1';
  const states = {
    radiantTowerState,
    direTowerState,
    radiantBarracksState,
    direBarracksState,
  };
  const baseMarkers = useMemo(() => [
    ...towerMarkers.map((marker) => ({ ...marker, type: 'tower' })),
    ...barracksMarkers.map((marker) => ({ ...marker, type: 'barracks' })),
  ].map((marker) => ({ ...marker, id: markerId(marker) })), []);
  const markers = useMemo(() => baseMarkers.map((marker) => ({
    ...marker,
    ...(savedPositions[marker.id] || {}),
  })), [baseMarkers, savedPositions]);
  const exportText = useMemo(() => JSON.stringify(
    markers.map(({ id, side, type, bit, label, x, y }) => ({ id, side, type, bit, label, x, y })),
    null,
    2
  ), [markers]);

  function updateMarkerPosition(event, markerIdToUpdate) {
    const rect = mapWrapRef.current?.getBoundingClientRect();
    if (!rect) return;

    const nextPosition = {
      x: Number(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100).toFixed(1)),
      y: Number(clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100).toFixed(1)),
    };

    setSavedPositions((current) => {
      const next = {
        ...current,
        [markerIdToUpdate]: nextPosition,
      };
      savePositions(next);
      return next;
    });
  }

  function handlePointerDown(event, markerIdToDrag) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingMarkerId(markerIdToDrag);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateMarkerPosition(event, markerIdToDrag);
  }

  function handlePointerMove(event) {
    if (!draggingMarkerId) return;
    updateMarkerPosition(event, draggingMarkerId);
  }

  function stopDragging() {
    setDraggingMarkerId(null);
  }

  function resetSavedPositions() {
    setSavedPositions({});
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(MARKER_STORAGE_KEY);
    }
  }

  return (
    <div style={panelStyle}>
      <div
        ref={mapWrapRef}
        data-map-wrap
        style={mapWrapStyle}
        onPointerMove={showDebugGrid ? handlePointerMove : undefined}
        onPointerUp={showDebugGrid ? stopDragging : undefined}
        onPointerCancel={showDebugGrid ? stopDragging : undefined}
        onPointerLeave={showDebugGrid ? stopDragging : undefined}
      >
        <img src={MINIMAP_SRC} alt="Dota 2 minimap" style={mapImageStyle} />
        <div style={overlayStyle}>
          {showDebugGrid && <CoordinateGrid />}
          {markers.map((marker) => (
            <StructureMarker
              key={`${marker.side}-${marker.type}-${marker.bit}-${marker.label}`}
              marker={marker}
              states={states}
              draggable={showDebugGrid}
              dragging={draggingMarkerId === marker.id}
              onPointerDown={handlePointerDown}
            />
          ))}
          {players.map((player) => (
            <PlayerMarker
              key={`${player.team}-${player.account_id}-${player.player_slot}`}
              player={player}
            />
          ))}
        </div>
      </div>
      {showDebugGrid && (
        <div style={debugPanelStyle}>
          <div style={debugHeaderStyle}>
            <strong>Map Marker Editor</strong>
            <button type="button" onClick={resetSavedPositions} style={debugButtonStyle}>
              Reset local positions
            </button>
          </div>
          <div style={debugHintStyle}>
            Drag markers to tune coordinates. Positions save in this browser automatically.
            Copy this export when it looks right.
          </div>
          <textarea readOnly value={exportText} style={debugTextareaStyle} />
        </div>
      )}
    </div>
  );
}

function CoordinateGrid() {
  const ticks = Array.from({ length: 9 }, (_, index) => (index + 1) * 10);

  return (
    <>
      {ticks.map((tick) => (
        <span key={`x-${tick}`} style={{ ...gridLineStyle, left: `${tick}%`, top: 0, bottom: 0 }} />
      ))}
      {ticks.map((tick) => (
        <span key={`y-${tick}`} style={{ ...gridLineStyle, top: `${tick}%`, left: 0, right: 0 }} />
      ))}
      {ticks.map((tick) => (
        <span key={`label-x-${tick}`} style={{ ...gridLabelStyle, left: `${tick}%`, top: 4 }}>
          {tick}
        </span>
      ))}
      {ticks.map((tick) => (
        <span key={`label-y-${tick}`} style={{ ...gridLabelStyle, left: 4, top: `${tick}%` }}>
          {tick}
        </span>
      ))}
    </>
  );
}

const panelStyle = {
  display: 'grid',
  justifyItems: 'center',
  gap: '10px',
};

const mapWrapStyle = {
  position: 'relative',
  width: 'min(100%, 520px)',
  aspectRatio: '1 / 1',
  borderRadius: '14px',
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  boxShadow: '0 18px 45px rgba(0, 0, 0, 0.35)',
  background: '#111',
};

const mapImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const overlayStyle = {
  position: 'absolute',
  inset: 0,
};

const gridLineStyle = {
  position: 'absolute',
  borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
  borderTop: '1px solid rgba(255, 255, 255, 0.2)',
  pointerEvents: 'none',
};

const gridLabelStyle = {
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
  padding: '1px 3px',
  borderRadius: '3px',
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#fff',
  fontSize: '10px',
  fontWeight: 800,
  pointerEvents: 'none',
};

const markerStyle = {
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
  border: '2px solid',
  transition: 'opacity 160ms ease, transform 160ms ease',
  touchAction: 'none',
  userSelect: 'none',
};

const draggableMarkerStyle = {
  cursor: 'grab',
};

const draggingMarkerStyle = {
  cursor: 'grabbing',
  transform: 'translate(-50%, -50%) scale(1.35)',
  zIndex: 2,
};

const towerMarkerStyle = {
  width: '12px',
  height: '12px',
  borderRadius: '999px',
};

const barracksMarkerStyle = {
  width: '10px',
  height: '10px',
  borderRadius: '3px',
};

const playerMarkerStyle = {
  position: 'absolute',
  width: '18px',
  height: '18px',
  borderRadius: '999px',
  border: '2px solid',
  transform: 'translate(-50%, -50%)',
  boxShadow: '0 0 8px rgba(0, 0, 0, 0.9)',
  zIndex: 3,
  pointerEvents: 'none',
  overflow: 'hidden',
  background: '#111',
  display: 'grid',
  placeItems: 'center',
};

const playerHeroIconStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const playerFallbackDotStyle = {
  width: '8px',
  height: '8px',
  borderRadius: '999px',
};

const debugPanelStyle = {
  width: 'min(100%, 620px)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '10px',
  padding: '10px',
  background: 'rgba(0, 0, 0, 0.28)',
};

const debugHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '6px',
};

const debugHintStyle = {
  color: 'var(--muted-text, #9aa0b4)',
  fontSize: '0.82rem',
  marginBottom: '8px',
};

const debugButtonStyle = {
  padding: '4px 8px',
  borderRadius: '6px',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'inherit',
  cursor: 'pointer',
};

const debugTextareaStyle = {
  width: '100%',
  minHeight: '180px',
  boxSizing: 'border-box',
  borderRadius: '8px',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  background: 'rgba(0, 0, 0, 0.35)',
  color: '#e6e6e6',
  fontFamily: 'monospace',
  fontSize: '0.78rem',
  padding: '8px',
  resize: 'vertical',
};
