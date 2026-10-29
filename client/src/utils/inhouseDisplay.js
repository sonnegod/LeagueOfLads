import {INHOUSE_CALIBRATION_GAMES} from '../../../shared/inhouseRating.js';

export const inhouseStatus = {ready: 'Ready check', drafting: 'Captain draft', awaiting_game: 'Waiting for game',
  playing: 'In game · awaiting result', completed: 'Completed', cancelled: 'Cancelled'};
export const inhouseRating = value => Number(value ?? 1000).toLocaleString(undefined, {maximumFractionDigits: 0});
export const inhouseRoles = player => player.roles.length
  ? `${player.roles.map(role => `P${role}`).join(' › ')}${player.offRole ? ' · Fill' : ''}` : 'Any position';

export const inhouseCalibration = games => {
  const remaining = Math.max(0, INHOUSE_CALIBRATION_GAMES - Number(games || 0));
  return remaining ? `Calibrating (${remaining} ${remaining === 1 ? 'Game' : 'Games'} Left)` : null;
};

