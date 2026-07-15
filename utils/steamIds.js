export const STEAM_ID64_BASE = BigInt('76561197960265728');

export function steamId64ToAccountId(steamId64) {
  if (steamId64 === null || steamId64 === undefined || steamId64 === '') {
    throw new Error('SteamID64 is required');
  }

  const accountId = BigInt(steamId64) - STEAM_ID64_BASE;
  if (accountId < 0n) {
    throw new Error('Invalid SteamID64');
  }

  return accountId.toString();
}

export function getSteamAccountId(user) {
  if (user?.accountId !== null && user?.accountId !== undefined && user?.accountId !== '') {
    return String(user.accountId);
  }

  return steamId64ToAccountId(user?.id);
}
