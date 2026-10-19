import { runWithAuditActor } from '../config/adminAuditContext.js';

const STEAM_ID64_BASE = 76561197960265728n;
const SITE_MANAGER_ACCOUNT_IDS = new Set(['49219700']);

// Site access is managed separately from the league's Admins table.
export function isSiteManagerSteamId(steamId64) {
  if (typeof steamId64 !== 'string' || !/^\d{17}$/.test(steamId64)) return false;
  return SITE_MANAGER_ACCOUNT_IDS.has((BigInt(steamId64) - STEAM_ID64_BASE).toString());
}

export function checkSiteManager(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: 'Sign in to access site management' });
  }
  if (!isSiteManagerSteamId(req.user.id)) {
    return res.status(403).json({ error: 'Site manager access required' });
  }
  return runWithAuditActor({ AdminPlayerId: (BigInt(req.user.id) - STEAM_ID64_BASE).toString(),
    AdminPlayerName: req.user.displayName || null }, next);
}
