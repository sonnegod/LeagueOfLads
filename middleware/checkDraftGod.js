const STEAM_BASE = 76561197960265728n;
export const DRAFT_GOD_OWNER_ID = 49219700;

export function isDraftGodOwner(steamId) {
  return typeof steamId === 'string' && /^\d{17}$/.test(steamId)
    && BigInt(steamId) - STEAM_BASE === BigInt(DRAFT_GOD_OWNER_ID);
}

export function checkDraftGodOwner(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  if (!req.isAuthenticated?.() || !req.user) return res.status(401).json({ error: 'Sign in to use Draft God' });
  if (!isDraftGodOwner(req.user.id)) return res.status(403).json({ error: 'Draft God is restricted to its owner' });
  return next();
}
