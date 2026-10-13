import dotabuffFavicon from '../assets/dotabuff.png';

export function DotabuffIcon() {
  return <img className="dotabuff-icon" src={dotabuffFavicon} width="20" height="20" alt="" aria-hidden="true" />;
}

export default function DotabuffLink({ playerId, teamId, name }) {
  const id = playerId ?? teamId;
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
  const kind = playerId ? 'players' : 'teams';
  const label = `View ${name || (playerId ? 'player' : 'team')} on Dotabuff`;
  return <a className="dotabuff-link" href={`https://www.dotabuff.com/esports/${kind}/${id}`}
    target="_blank" rel="noopener noreferrer" title={label} aria-label={label}>
    <DotabuffIcon />
  </a>;
}

