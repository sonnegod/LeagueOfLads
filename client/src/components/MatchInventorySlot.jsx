import items from '@dota-items';

export default function MatchInventorySlot({ id, label, round = false }) {
  const item = items[id], name = id == null ? 'Not recorded' : id === 0 ? 'Empty slot' : item?.name || `Item ${id}`;
  return <span className={`performance-item${id == null || id === 0 ? ' performance-item--empty' : ''}${round ? ' performance-item--neutral' : ''}`}
    role="img" aria-label={`${label}: ${name}`} title={name} tabIndex={0}>
    <span className="performance-item-fallback" aria-hidden="true">{id == null ? '?' : id === 0 ? '—' : name}</span>
    {item?.image && <img src={`https://cdn.cloudflare.steamstatic.com${item.image}`} alt="" loading="lazy"
      onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
}
