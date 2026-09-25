import db from '../database.js';

const STEAM_ID64_BASE = BigInt('76561197960265728');

export function getAdminForSteamId(steamId64) {
  if (!/^\d+$/.test(String(steamId64 ?? ''))) return null;
  const accountId = BigInt(steamId64) - STEAM_ID64_BASE;
  if (accountId <= 0n || accountId > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return db.getAdminByPlayerId(accountId.toString());
}

export function checkAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized: not logged in' });
  }

  try {
    const admin = getAdminForSteamId(req.user.id);
    if (!admin) {
      return res.status(403).json({ error: 'Forbidden: admin access denied' });
    }

    req.admin = admin;
    return next();
  } catch (err) {
    console.error('Error in admin middleware:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export function checkHeadAdmin(req, res, next) {
  if (!req.admin?.HeadAdmin) {
    return res.status(403).json({ error: 'Forbidden: head admin access required' });
  }
  return next();
}
