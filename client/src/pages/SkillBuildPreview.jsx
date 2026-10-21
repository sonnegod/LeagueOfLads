import { useState } from 'react';
import { Flame, Snowflake, Sparkles, Info } from 'lucide-react';
import './SkillBuildPreview.css';

// Illustrative builds for the development preview, not archived match records.
const examples = [
  {
    id: 'mid', player: 'Sample mid player', hero: 'Lina', heroId: 25, role: 'Pos 2', Icon: Flame,
    abilities: [
      { id: 'lina_dragon_slave', name: 'Dragon Slave', key: 'Q', color: '#60a5fa' },
      { id: 'lina_light_strike_array', name: 'Light Strike Array', key: 'W', color: '#a78bfa' },
      { id: 'lina_fiery_soul', name: 'Fiery Soul', key: 'E', color: '#2dd4bf' },
      { id: 'lina_laguna_blade', name: 'Laguna Blade', key: 'R', color: '#fbbf24' },
      { id: 'talent', name: 'Talent', key: '✦', color: '#fb923c' },
    ],
    order: [0, 1, 0, 2, 0, 3, 0, 2, 2, 4, 2, 3, 1, 1, 4, 1, 3, 4],
  },
  {
    id: 'support', player: 'Sample support player', hero: 'Crystal Maiden', heroId: 5, role: 'Pos 5', Icon: Snowflake,
    abilities: [
      { id: 'crystal_maiden_crystal_nova', name: 'Crystal Nova', key: 'Q', color: '#60a5fa' },
      { id: 'crystal_maiden_frostbite', name: 'Frostbite', key: 'W', color: '#a78bfa' },
      { id: 'crystal_maiden_brilliance_aura', name: 'Arcane Aura', key: 'E', color: '#2dd4bf' },
      { id: 'crystal_maiden_freezing_field', name: 'Freezing Field', key: 'R', color: '#fbbf24' },
      { id: 'talent', name: 'Talent', key: '✦', color: '#fb923c' },
    ],
    order: [1, 0, 2, 1, 1, 3, 1, 0, 0, 4, 0, 3, 2, 2, 4, 2, 3, 4],
  },
  { id: 'missing', player: 'Sample carry player', hero: 'Juggernaut', heroId: 8, role: 'Pos 1', Icon: Info, order: null },
];

function AbilityIcon({ ability }) {
  const [failed, setFailed] = useState(false);
  return <span className="skill-preview-icon" style={{ '--skill-color': ability.color }}>
    {ability.id === 'talent' ? <Sparkles size={20} aria-hidden="true" /> : failed ? <span>{ability.key}</span> :
      <img src={`https://cdn.akamai.steamstatic.com/apps/dota2/images/dota_react/abilities/${ability.id}.png`}
        alt="" width="36" height="36" loading="lazy" onError={() => setFailed(true)} />}
  </span>;
}

function Build({ player }) {
  const [selected, setSelected] = useState(5);
  const [view, setView] = useState('grid');
  if (!player.order) return <section className="skill-preview-panel skill-preview-empty">
    <Info size={28} aria-hidden="true" /><h2>No skill build recorded</h2>
    <p>This player’s saved match data does not contain an upgrade sequence.</p>
    <p>Other match statistics would remain available.</p>
  </section>;
  const { abilities, order } = player;
  const selectedAbility = abilities[order[selected]];
  const rankAt = (step) => order.slice(0, step + 1).filter(id => id === order[step]).length;
  const firstMax = order.findIndex((id, step) => id < 3 && rankAt(step) === 4);
  const ultimate = order.findIndex(id => id === 3);
  return <section className="skill-preview-panel">
    <div className="skill-preview-heading">
      <div><h2>Skill build</h2><p>Follow the player’s choices, one skill point at a time.</p></div>
      <div className="skill-preview-toggle" aria-label="Skill build view">
        {['grid', 'sequence'].map(value => <button key={value} type="button" aria-pressed={view === value}
          onClick={() => setView(value)}>{value === 'grid' ? 'Ability grid' : 'Upgrade sequence'}</button>)}
      </div>
    </div>
    <div className="skill-preview-highlights">
      <div><span>Opening skill</span><strong>{abilities[order[0]].name}</strong></div>
      <div><span>First maxed</span><strong>{abilities[order[firstMax]].name}<small>Upgrade {firstMax + 1}</small></strong></div>
      <div><span>Ultimate learned</span><strong>{abilities[3].name}<small>Upgrade {ultimate + 1}</small></strong></div>
    </div>
    {view === 'grid' ? <div className="skill-preview-scroll" tabIndex="0" role="region" aria-label="Ability upgrade grid; scroll horizontally for all upgrades">
      <table className="skill-preview-grid">
        <thead><tr><th scope="col">Upgrade order</th>{order.map((_, step) => <th scope="col" key={step}
          data-selected={step === selected}>{step + 1}</th>)}</tr></thead>
        <tbody>{abilities.map((ability, id) => <tr key={ability.id} style={{ '--skill-color': ability.color }}>
          <th scope="row"><span className="skill-preview-ability"><AbilityIcon ability={ability} /><span>{ability.name}<small>{ability.id === 'talent' ? 'Talent choices' : ability.key}</small></span></span></th>
          {order.map((picked, step) => <td key={step} data-selected={step === selected}>
            {picked === id ? <button type="button" className="skill-preview-rank" aria-pressed={selected === step}
              aria-label={`Upgrade ${step + 1}: ${ability.name}${id === 4 ? '' : ` rank ${rankAt(step)}`}`}
              title={`Upgrade ${step + 1} · ${ability.name}`} onClick={() => setSelected(step)}>{id === 4 ? '✦' : rankAt(step)}</button> : <span className="skill-preview-dot" aria-hidden="true">·</span>}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div> : <ol className="skill-preview-sequence" aria-label="Upgrade sequence">{order.map((id, step) => <li key={step}>
      <button type="button" aria-label={`Upgrade ${step + 1}: ${abilities[id].name}`} aria-pressed={selected === step}
        onClick={() => setSelected(step)} style={{ '--skill-color': abilities[id].color }}>
        <small>{step + 1}</small><AbilityIcon ability={abilities[id]} />
      </button>
    </li>)}</ol>}
    <div className="skill-preview-readout" aria-live="polite" aria-atomic="true">
      <AbilityIcon key={selectedAbility.id} ability={selectedAbility} />
      <div><span>Upgrade {selected + 1}</span><strong>{selectedAbility.name}
        {order[selected] !== 4 && <small>Rank {rankAt(selected)}</small>}</strong></div>
      <p>Click a skill point to inspect it.</p>
    </div>
    <p className="skill-preview-note"><Info size={15} aria-hidden="true" /> Order follows recorded upgrades. Hero levels, timestamps, and talent details would appear only when confirmed by match data.</p>
  </section>;
}

export default function SkillBuildPreview() {
  const [playerId, setPlayerId] = useState('mid');
  const player = examples.find(row => row.id === playerId);
  return <div className="skill-preview ui-page">
    <header className="skill-preview-page-heading"><div><span className="skill-preview-eyebrow">Match analysis · Design preview</span>
      <h1>Skill builds</h1><p>A closer look at how each player built their hero.</p></div>
      <span className="skill-preview-badge">Illustrative sample data</span>
    </header>
    <div className="skill-preview-players" aria-label="Select a sample player">{examples.map(example =>
      <button type="button" key={example.id} aria-pressed={example.id === playerId} onClick={() => setPlayerId(example.id)}>
        <img src={`/heroes/icons/${example.heroId}.png`} width="48" height="48" alt="" />
        <span><strong>{example.hero}</strong><small>{example.player}</small></span><span className="skill-preview-role"><example.Icon size={15} aria-hidden="true" />{example.role}</span>
      </button>)}</div>
    <Build key={player.id} player={player} />
  </div>;
}
