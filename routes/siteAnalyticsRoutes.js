import express from 'express';
import { analyticsEnabled, excludedVisitor, setVisitor, safelyRecord } from '../config/siteAnalytics.js';
import { CLIENT_EVENTS, PAGE_TYPES } from '../config/siteAnalyticsStore.js';

export function createSiteAnalyticsRouter({ enabled = analyticsEnabled, excluded = excludedVisitor,
  record = (token, events) => safelyRecord(db => db.record(token, events)),
  allowedOrigins = ['https://www.leagueoflads.com', 'https://leagueoflads.com',
    ...(process.env.ENVIRONMENT !== 'PROD' ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])],
} = {}) {
  const router = express.Router();
  // Only short-lived network rate counters; never persisted or exposed in reports.
  const rates = new Map();
  let cleanedAt = 0;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/config', (req, res) => res.json({ enabled: enabled() && !excluded(req) }));
  router.delete('/events', (req, res) => {
    res.clearCookie('lads_visitor', { path: '/' });
    return res.status(204).end();
  });
  router.post('/events', express.json({ limit: '8kb' }), (req, res) => {
    const origin = req.get('origin');
    if (!origin || !allowedOrigins.includes(origin) || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).end();
    }
    if (!enabled() || excluded(req)) return res.status(204).end();
    const now = Date.now();
    if (now - cleanedAt >= 60000) {
      for (const [address, entry] of rates) if (entry.until <= now) rates.delete(address);
      cleanedAt = now;
    }
    const key = req.ip;
    if (!rates.has(key) && rates.size >= 5000) {
      for (const [address, entry] of rates) if (entry.until <= now) rates.delete(address);
      if (rates.size >= 5000) return res.status(429).end();
    }
    let rate = rates.get(key);
    if (!rate || rate.until <= now) { rate = { count: 0, until: now + 60000 }; rates.set(key, rate); }
    if (++rate.count > 120) return res.status(429).end();
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length < 1 || events.length > 20
      || Object.keys(req.body).some(key => key !== 'events')
      || events.some(event => !event || !CLIENT_EVENTS.has(event.name)
        || Object.keys(event).some(key => !['name', 'page', 'source'].includes(key))
        || (event.name === 'page_view' && (!Object.hasOwn(PAGE_TYPES, event.page)
          || !['Discord', 'Direct', 'Google', 'Other'].includes(event.source)))
        || (event.name !== 'page_view' && (event.page !== undefined || event.source !== undefined)))) {
      return res.status(400).json({ error: 'Invalid analytics events' });
    }
    record(setVisitor(req, res), events);
    return res.status(204).end();
  });
  router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).end();
    if (error instanceof SyntaxError) return res.status(400).end();
    return next(error);
  });
  return router;
}
