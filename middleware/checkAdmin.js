import db from '../database.js';
import { getSteamAccountId } from '../utils/steamIds.js';

export function checkAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized: not logged in' });
  }

  try {
    const accountId = getSteamAccountId(req.user);
    if (!accountId) {
      return res.status(401).json({ error: 'Unauthorized: no account ID found' });
    }

    let isAdmin = req.session?.isAdmin;
    if (typeof isAdmin !== 'boolean') {
      const admin = db.getAdminInfo(accountId);
      isAdmin = !!admin;

      if (req.session) {
        req.session.isAdmin = isAdmin;
        req.session.headAdmin = !!admin?.HeadAdmin;
        req.session.systemAdmin = !!admin?.SystemAdmin;
      }
    }

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin access denied' });
    }

    next();
  } catch (err) {
    console.error('Error in admin middleware:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
