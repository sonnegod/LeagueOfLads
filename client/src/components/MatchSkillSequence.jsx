import { useState } from 'react';
import { CircleHelp, Plus, Sparkles } from 'lucide-react';
import catalog from '../data/dotaAbilities.json';
import './MatchSkillSequence.css';

function AbilityIcon({ ability }) {
  const [failed, setFailed] = useState(false);
  if (!ability) return <CircleHelp size={22} aria-hidden="true" />;
  if (ability.kind === 'talent') return <Sparkles size={22} aria-hidden="true" />;
  if (ability.kind === 'attributes') return <Plus size={22} aria-hidden="true" />;
  return failed ? <CircleHelp size={22} aria-hidden="true" /> :
    <img src={`https://cdn.akamai.steamstatic.com/apps/dota2/images/dota_react/abilities/${ability.key}.png`}
      alt="" width="28" height="28" loading="lazy" onError={() => setFailed(true)} />;
}

export default function MatchSkillSequence({ upgrades, playerName, loading = false, error = false }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const ranks = new Map();
  const sequence = (upgrades || []).map(upgrade => {
    const ability = catalog.abilities[upgrade.abilityId];
    const rank = (ranks.get(upgrade.abilityId) || 0) + 1;
    ranks.set(upgrade.abilityId, rank);
    const label = ability?.name === 'Talent' ? `Talent #${upgrade.abilityId}` : ability?.name || `Ability #${upgrade.abilityId}`;
    return { ...upgrade, ability, label, description: `Upgrade ${upgrade.index + 1} · ${label}${ability?.kind === 'talent' ? '' : ` · Rank ${rank}`}` };
  });
  const selected = sequence.find(upgrade => upgrade.index === selectedIndex);
  return <div className="match-skill-build" aria-label={`${playerName}'s skill build`}>
    {!sequence.length ? <span className="match-skill-empty">{loading ? 'Loading skill build…' : error ? 'Could not load skill build.' : 'Skill build unavailable.'}</span> :
      <div className="match-skill-content">
        <ol className="match-skill-sequence" aria-label="Ability upgrade order">{sequence.map(upgrade =>
          <li key={upgrade.index}>
            <button type="button" className={`match-skill-point match-skill-point--${upgrade.ability?.kind || 'unknown'}`}
              title={upgrade.label} aria-label={upgrade.description} aria-pressed={selectedIndex === upgrade.index}
              onClick={() => setSelectedIndex(current => current === upgrade.index ? null : upgrade.index)}>
              <small aria-hidden="true">{upgrade.index + 1}</small>
              <span className="match-skill-icon"><AbilityIcon key={upgrade.abilityId} ability={upgrade.ability} /></span>
            </button>
          </li>)}</ol>
        {selected && <p className="match-skill-selection" role="status">{selected.description}</p>}
      </div>}
  </div>;
}
