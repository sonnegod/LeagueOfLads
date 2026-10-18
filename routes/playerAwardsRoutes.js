import express from 'express';

export function createPlayerAwardsRouter(getAwards, getCatalog) {
  const router = express.Router();
  if (getCatalog) router.get('/awards', (req, res) => {
    try {
      return res.json(getCatalog());
    } catch (error) {
      console.error('Awards catalog unavailable:', error.message);
      return res.status(500).json({ error: 'Could not load awards' });
    }
  });
  router.get('/player/:accountId/awards', (req, res) => {
    const raw = req.params.accountId;
    const playerId = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(playerId) || playerId <= 0) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }
    try {
      return res.json(getAwards(playerId));
    } catch (error) {
      console.error('Player awards unavailable:', error.message);
      return res.status(500).json({ error: 'Could not load player awards' });
    }
  });
  return router;
}
