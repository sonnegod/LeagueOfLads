import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './CurrentLeaderboardTable.css';

export default function CurrentLeagueSeries({ leagueId }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [matrixPhase, setMatrixPhase] = useState('closed');
  const [selectedCardSize, setSelectedCardSize] = useState(null);
  const cardNodes = useRef(new Map());
  const movingCard = useRef(null);
  const cardAnimation = useRef(null);
  const closeTimer = useRef(null);
  const motionLayer = useRef(null);
  const motionClones = useRef([]);
  const originalCards = useRef(new Map());

  useEffect(() => () => {
    clearTimeout(closeTimer.current);
    cardAnimation.current?.cancel();
    clearMotionClones(motionClones);
  }, []);

  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      try {
        const url = leagueId
          ? `/api/currentLeaderboard?leagueId=${leagueId}`
          : '/api/currentLeaderboard';
        const res = await fetch(url);
        const data = await res.json();
        setGroups(data || []);
      } catch (err) {
        console.error(err);
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMatches();
  }, [leagueId]);

  const selectedGroup = groups.find(group => group.GroupId === selectedGroupId) || groups[0];
  const showMatrix = matrixPhase === 'open' && selectedGroup?.GroupId === selectedGroupId;

  useLayoutEffect(() => {
    const previous = movingCard.current;
    movingCard.current = null;
    if (!previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const card = cardNodes.current.get(previous.groupId);
    if (!card) return;

    const next = card.getBoundingClientRect();
    const deltaX = previous.left - next.left;
    const deltaY = previous.top - next.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

    cardAnimation.current?.cancel();
    cardAnimation.current = card.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' }
      ],
      { duration: 820, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'backwards' }
    );
  }, [matrixPhase, selectedGroupId]);

  function toggleMatrix(groupId, event) {
    const workspace = event.currentTarget.closest('.leaderboard-workspace');
    const workspaceRect = workspace?.getBoundingClientRect();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (selectedGroupId === groupId && matrixPhase === 'open') {
      cardAnimation.current?.cancel();
      clearMotionClones(motionClones);

      const selectedCard = cardNodes.current.get(groupId);
      const selectedRect = selectedCard?.getBoundingClientRect();
      const originalRect = originalCards.current.get(groupId);
      if (!reduceMotion && selectedCard && selectedRect && originalRect && workspaceRect) {
        const targetLeft = workspaceRect.left + originalRect.left;
        const targetTop = workspaceRect.top + originalRect.top;
        cardAnimation.current = selectedCard.animate(
          [
            { transform: 'translate(0, 0)' },
            { transform: `translate(${targetLeft - selectedRect.left}px, ${targetTop - selectedRect.top}px)` }
          ],
          { duration: 820, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }
        );

        for (const [otherGroupId, destination] of originalCards.current) {
          if (otherGroupId === groupId) continue;
          const otherCard = cardNodes.current.get(otherGroupId);
          if (!otherCard || !motionLayer.current) continue;

          const clone = createMotionClone(otherCard, destination, motionLayer.current);
          const deltaX = selectedRect.left - (workspaceRect.left + destination.left);
          const deltaY = selectedRect.top - (workspaceRect.top + destination.top);
          const animation = clone.animate(
            [
              { transform: `translate(${deltaX}px, ${deltaY}px) scale(.78)`, opacity: 0 },
              { transform: 'translate(0, 0) scale(1)', opacity: 1 }
            ],
            { duration: 820, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }
          );
          motionClones.current.push({ clone, animation });
        }
      }

      movingCard.current = null;
      setMatrixPhase('closing');
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        const card = cardNodes.current.get(groupId);
        if (card) {
          const { left, top } = card.getBoundingClientRect();
          movingCard.current = { groupId, left, top };
        }
        cardAnimation.current?.cancel();
        cardAnimation.current = null;
        clearMotionClones(motionClones);
        setMatrixPhase('closed');
      }, reduceMotion ? 0 : 840);
    } else {
      clearTimeout(closeTimer.current);
      clearMotionClones(motionClones);
      cardAnimation.current?.cancel();
      cardAnimation.current = null;
      if (selectedGroupId === groupId && matrixPhase === 'closing') {
        setMatrixPhase('open');
        return;
      }

      const card = event.currentTarget.closest('.leaderboard-group-card');
      if (card) {
        const { left, top, width, height } = card.getBoundingClientRect();
        movingCard.current = { groupId, left, top };
        setSelectedCardSize({ width, height });
      }
      if (workspaceRect) {
        originalCards.current = new Map(
          [...cardNodes.current].map(([id, node]) => {
            const rect = node.getBoundingClientRect();
            return [id, {
              left: rect.left - workspaceRect.left,
              top: rect.top - workspaceRect.top,
              width: rect.width,
              height: rect.height
            }];
          })
        );

        if (!reduceMotion && motionLayer.current) {
          for (const [otherGroupId, position] of originalCards.current) {
            if (otherGroupId === groupId) continue;
            const otherCard = cardNodes.current.get(otherGroupId);
            if (!otherCard) continue;

            const clone = createMotionClone(otherCard, position, motionLayer.current);
            const animation = clone.animate(
              [
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${-position.left}px, ${-position.top}px) scale(.78)`, opacity: 0 }
              ],
              { duration: 820, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }
            );
            motionClones.current.push({ clone, animation });
            animation.onfinish = () => {
              clone.remove();
              motionClones.current = motionClones.current.filter(item => item.clone !== clone);
            };
          }
        }
      }
      setSelectedGroupId(groupId);
      setMatrixPhase('open');
    }
  }

  return (
    <div className={`leaderboard-workspace${showMatrix ? ' is-expanded' : ''}${matrixPhase === 'closing' ? ' is-closing' : ''}`}>
      <div className="leaderboard-groups">
        {loading && <div className="leaderboard-loading">Loading leaderboard...</div>}
        {groups.map(group => {
          const showQualification = group.groupTeams.some(team => team.Wins + team.Losses > 0);
          const isSelected = matrixPhase !== 'closed' && selectedGroupId === group.GroupId;

          return (
            <section
              key={group.GroupId}
              ref={node => {
                if (node) cardNodes.current.set(group.GroupId, node);
                else cardNodes.current.delete(group.GroupId);
              }}
              className={`leaderboard-group-card${isSelected ? ' is-selected' : ''}`}
              style={isSelected && selectedCardSize
                ? {
                    '--leaderboard-card-start-width': `${selectedCardSize.width}px`,
                    '--leaderboard-card-start-height': `${selectedCardSize.height}px`
                  }
                : undefined}
            >
              <div className="leaderboard-group-heading">
                <div>
                  <span className="leaderboard-group-eyebrow">Group standings</span>
                  <h3>{group.GroupName || `Group ${group.GroupId}`}</h3>
                </div>
                <div className="leaderboard-heading-actions">
                  <span className="leaderboard-team-count">{group.groupTeams.length} teams</span>
                  <button
                    type="button"
                    className="leaderboard-matrix-toggle"
                    aria-expanded={showMatrix && isSelected}
                    aria-controls="leaderboard-active-matrix"
                    onClick={event => toggleMatrix(group.GroupId, event)}
                  >
                    {showMatrix && isSelected ? 'Hide H2H Matrix' : 'Show H2H Matrix'}
                  </button>
                </div>
              </div>

              <table className="leaderboard-standings">
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col">Wins</th>
                      <th scope="col">Losses</th>
                      <th scope="col">Neustadtl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.groupTeams.map(team => (
                      <tr
                        key={teamKey(team)}
                        className={showQualification && team.Qualification
                          ? `leaderboard-qualification-${team.Qualification}`
                          : undefined}
                      >
                        <th scope="row">
                          {team.TeamId == null
                            ? team.TeamName
                            : <Link to={`/team/${team.TeamId}`}>{team.TeamName}</Link>}
                        </th>
                        <td>{team.Wins}</td>
                        <td>{team.Losses}</td>
                        <td>{team.Score}</td>
                      </tr>
                    ))}
                  </tbody>
              </table>
            </section>
          );
        })}
      </div>
      {selectedGroup && (
        <div className="leaderboard-matrix-stage" aria-hidden={!showMatrix}>
          <section key={selectedGroup.GroupId} id="leaderboard-active-matrix" className="leaderboard-h2h-panel">
            <div className="leaderboard-matrix-heading">
              <div>
                <span className="leaderboard-group-eyebrow">{selectedGroup.GroupName || `Group ${selectedGroup.GroupId}`}</span>
                <h4>Head to head</h4>
              </div>
              <span>Columns match row numbers</span>
            </div>
            {buildH2HMatrix(selectedGroup)}
          </section>
        </div>
      )}
      <div ref={motionLayer} className="leaderboard-motion-layer" aria-hidden="true" />
    </div>
  );
}

function createMotionClone(card, position, layer) {
  const clone = card.cloneNode(true);
  clone.classList.add('leaderboard-motion-clone');
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  Object.assign(clone.style, {
    left: `${position.left}px`,
    top: `${position.top}px`,
    width: `${position.width}px`,
    height: `${position.height}px`
  });
  layer.appendChild(clone);
  return clone;
}

function clearMotionClones(clones) {
  clones.current.forEach(({ clone, animation }) => {
    animation.cancel();
    clone.remove();
  });
  clones.current = [];
}

function teamKey(team) {
  return team.EntryId == null ? `team:${team.TeamId}` : `entry:${team.EntryId}`;
}

function buildH2HMatrix(group) {
  const teams = group.groupTeams;
  const h2hMap = {};
  (Array.isArray(group.groupH2H) ? group.groupH2H : []).forEach(row => {
    h2hMap[`${row.TeamA}-${row.TeamB}`] = row;
  });

  return (
    <table
      className={`leaderboard-h2h-table${teams.length >= 10 ? ' is-dense' : ''}`}
      aria-label={`${group.GroupName || `Group ${group.GroupId}`} head to head results`}
    >
      <thead>
        <tr>
          <th scope="col">Team</th>
          {teams.map((team, index) => (
            <th key={teamKey(team)} scope="col" title={team.TeamName} aria-label={`${index + 1}: ${team.TeamName}`}>
              {index + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {teams.map((rowTeam, index) => (
          <tr key={teamKey(rowTeam)}>
            <th scope="row"><span className="leaderboard-matrix-row-number" aria-hidden="true">{index + 1}</span>{rowTeam.TeamName}</th>
            {teams.map(colTeam => {
              if (teamKey(rowTeam) === teamKey(colTeam)) {
                return <td key={teamKey(colTeam)} className="leaderboard-h2h-diagonal" aria-label="Same team">—</td>;
              }

              const match = rowTeam.TeamId != null && colTeam.TeamId != null ? (
                h2hMap[`${rowTeam.TeamId}-${colTeam.TeamId}`] ||
                h2hMap[`${colTeam.TeamId}-${rowTeam.TeamId}`]
              ) : null;

              if (!match) {
                return <td key={teamKey(colTeam)} className="leaderboard-h2h-unplayed">0–0</td>;
              }

              const winsRow = match.TeamA === rowTeam.TeamId ? match.WinsA : match.WinsB;
              const winsCol = match.TeamA === rowTeam.TeamId ? match.WinsB : match.WinsA;
              const resultClass = winsRow > winsCol
                ? 'leaderboard-h2h-win'
                : winsRow < winsCol
                  ? 'leaderboard-h2h-loss'
                  : winsRow > 0
                    ? 'leaderboard-h2h-tie'
                    : 'leaderboard-h2h-unplayed';

              return (
                <td key={teamKey(colTeam)} className={resultClass}>
                  {winsRow}–{winsCol}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
