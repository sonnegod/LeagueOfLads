import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SiteAnalyticsStore } from './siteAnalyticsStore.js';
import { isSiteManagerSteamId } from '../middleware/checkSiteManager.js';

export const analyticsEnabled = () => process.env.SITE_ANALYTICS_ENABLED === 'true'
  || (process.env.SITE_ANALYTICS_ENABLED !== 'false' && process.env.ENVIRONMENT === 'PROD');
let store;
let lastFailure = 0;
export const getSiteAnalyticsStore = () => store ??= new SiteAnalyticsStore(
  fileURLToPath(new URL('../db/SiteAnalytics.db', import.meta.url)));
export function safelyRecord(action) {
  try { action(getSiteAnalyticsStore()); } catch (error) {
    if (Date.now() - lastFailure > 60000) {
      console.error('Site analytics unavailable:', error.message);
      lastFailure = Date.now();
    }
  }
}
export const trackingDeclined = req => req.get('DNT') === '1' || req.get('Sec-GPC') === '1';
export const excludedVisitor = req => trackingDeclined(req)
  || isSiteManagerSteamId(req.user?.id)
  || /bot|spider|crawler|headless|preview|lighthouse/i.test(req.get('user-agent') || '');
export function visitorToken(req) {
  const token = /(?:^|;\s*)lads_visitor=([a-f0-9]{64})(?:;|$)/.exec(req.get('cookie') || '')?.[1];
  return token || null;
}
export function setVisitor(req, res) {
  const token = visitorToken(req) || randomBytes(32).toString('hex');
  res.cookie('lads_visitor', token, { httpOnly: true, sameSite: 'lax',
    secure: process.env.ENVIRONMENT === 'PROD', path: '/', maxAge: 90 * 86400000 });
  return token;
}
// Aggregate every API response, including parser failures; no per-request records are retained.
export function createSiteApiHealth({ enabled = analyticsEnabled,
  record = (status, duration) => safelyRecord(db => db.recordApi(status, duration)),
} = {}) {
  return (req, res, next) => {
    if (!enabled() || !req.path.startsWith('/api/')
      || /^\/api\/(site-analytics|site-management)(\/|$)/.test(req.path)
      || /^\/api\/liveMatches\/stream\/?$/.test(req.path)) return next();
    const start = performance.now();
    res.once('finish', () => record(res.statusCode, performance.now() - start));
    next();
  };
}
export const siteApiHealth = createSiteApiHealth();
export function createSiteSignupProgress({ enabled = analyticsEnabled, excluded = excludedVisitor,
  record = (token, events) => safelyRecord(db => db.record(token, events)),
} = {}) {
  return (req, res, next) => {
    if (!enabled() || !visitorToken(req) || excluded(req)) return next();
    const isSubmission = req.method === 'POST'
      && /^\/\d+\/(teams|drafts\/[^/]+\/submit)\/?$/.test(req.path);
    if (isSubmission) res.once('finish', () => {
      if (res.statusCode === 201) record(visitorToken(req), [{ name: 'signup_submitted' }]);
    });
    next();
  };
}
export const siteSignupProgress = createSiteSignupProgress();
process.once('exit', () => { if (store) { try { store.close(); } catch { /* Process is exiting. */ } } });
