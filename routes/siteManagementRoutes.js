import express from 'express';
import { checkSiteManager } from '../middleware/checkSiteManager.js';
import { analyticsEnabled, getSiteAnalyticsStore } from '../config/siteAnalytics.js';

export function createSiteManagementRouter({ report = days => getSiteAnalyticsStore().report(days, analyticsEnabled()) } = {}) {
  const router = express.Router();
  router.use(checkSiteManager);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  router.get('/analytics', (req, res) => {
    const days = req.query.days === undefined ? '7' : req.query.days;
    if (!['1', '7', '30'].includes(days)) {
      return res.status(400).json({ error: 'Choose 1, 7, or 30 days' });
    }
    try { return res.json(report(Number(days))); }
    catch { return res.status(503).json({ error: 'Site analytics is temporarily unavailable' }); }
  });

  return router;
}
export default createSiteManagementRouter();
