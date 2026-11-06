import {INHOUSE_CALIBRATION_GAMES} from '../../../shared/inhouseRating.js';

export const inhouseStatus = {ready: 'Ready check', drafting: 'Captain draft', awaiting_game: 'Waiting for game',
  playing: 'In game · awaiting result', completed: 'Completed', cancelled: 'Cancelled'};
export const inhouseAvailabilityLabels = {closed: 'Closed', admin_testing: 'Admin testing', open: 'Open to players'};
export function inhouseAuditSummary(entry) {
  const person = (name, id) => id ? name && name !== `Account ${id}` ? `${name} (${id})` : `Account ${id}` : 'Automatic';
  const actor = person(entry.actorName || entry.details.actorName, entry.actorId);
  const target = person(entry.details.playerName, entry.details.playerId);
  if (entry.action === 'vouch-added') return `${target} was vouched by ${actor}.`;
  if (entry.action === 'vouch-removed') return `${target} was removed from the whitelist by ${actor}.`;
  if (entry.action === 'community-manager-added') return `${target} was added as a community manager by ${actor}.`;
  if (entry.action === 'community-manager-removed') return `${target} was removed as a community manager by ${actor}.`;
  if (entry.action === 'availability') return `${actor} changed availability from ${inhouseAvailabilityLabels[entry.details.from] || entry.details.from || 'Unknown'} to ${inhouseAvailabilityLabels[entry.details.to] || entry.details.to || 'Unknown'}.`;
  return entry.action.replaceAll('-', ' ');
}
export const inhouseRating = value => Number(value ?? 1000).toLocaleString(undefined, {maximumFractionDigits: 0});
export const inhouseRoles = player => player.roles.length
  ? `${player.roles.map(role => `P${role}`).join(' › ')}${player.offRole ? ' · Fill' : ''}` : 'Any position';

export const inhouseCalibration = games => {
  const remaining = Math.max(0, INHOUSE_CALIBRATION_GAMES - Number(games || 0));
  return remaining ? `Calibrating (${remaining} ${remaining === 1 ? 'Game' : 'Games'} Left)` : null;
};

