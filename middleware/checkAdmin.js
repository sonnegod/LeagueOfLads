import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const ADMIN_ID = process.env.ADMIN_ID; 
const STEAM_ID64_BASE = BigInt('76561197960265728');

export function checkAdmin(req, res, next) {


  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized: not logged in' });
  }

  try {
    const steamId64 = req.user.id;
    if (!steamId64) {
      return res.status(401).json({ error: 'Unauthorized: no Steam ID found' });
    }

    // Convert SteamID64 to accountId
    const accountId = (BigInt(steamId64) - STEAM_ID64_BASE).toString();


    if (accountId !== ADMIN_ID) {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }

    // User is admin, proceed
    next();

  } catch (err) {
    console.error('Error in admin middleware:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
