export default function MatchResultBadge({ winnerSide, side }) {
  if (winnerSide !== 'r' && winnerSide !== 'd') return null;

  const won = winnerSide === side;
  return <span className={won ? 'winner-badge' : 'loser-badge'}>{won ? 'Winner' : 'Loser'}</span>;
}
