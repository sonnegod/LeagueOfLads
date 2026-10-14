import express from 'express';
import { existsSync } from 'node:fs';
import { analyticsPaths, positiveId, previewAnalyticsPath } from '../analytics/config.js';
import { openAnalytics, readAnalyticsStatus } from '../analytics/store.js';
import { readLeagueCatalog } from '../analytics/catalog.js';
import { readHighlightFeed, highlightDTO } from '../analytics/highlightFeed.js';
import { moderateHighlight } from '../analytics/highlights.js';
import { getAuditActor } from '../config/adminAuditContext.js';
import { readLeagueDashboard } from '../analytics/leagueDashboard.js';
import { contentWindow } from '../analytics/contentWindows.js';

export function createAnalyticsRoutes({ getPaths = analyticsPaths, listLeagues = readLeagueCatalog, audit = () => {} } = {}) {
  const adminRoutes = express.Router();
  const publicRoutes = express.Router();
  const cache = new Map();
  function dataset(req) {
    const id = positiveId(req.query.previewLeague, 'preview league');
    const paths = getPaths();
    if (id) {
      let leagues;
      try { leagues = listLeagues(paths.league); }
      catch { const error = new Error('League list is temporarily unavailable'); error.status = 503; throw error; }
      if (!leagues.some(league => league.leagueId === id)) {
        const error = new Error('League not found'); error.status = 404; throw error;
      }
    }
    return id ? previewAnalyticsPath(paths.analytics, id) : paths.analytics;
  }
  function pagination(req, admin) {
    const before = positiveId(req.query.before, 'highlight cursor');
    const limit = positiveId(req.query.limit, 'highlight limit') ?? (admin ? 20 : 6);
    if (limit > (admin ? 50 : 20)) throw new Error('Invalid highlight limit');
    const status = req.query.status ?? 'published';
    const period = req.query.period ?? 'all';
    contentWindow(period);
    if (admin && !['published', 'candidate', 'withdrawn', 'all'].includes(status)) throw new Error('Invalid highlight status');
    return { before, limit, leagueId: positiveId(req.query.leagueId, 'league'), period, admin, ...(admin ? { status } : {}) };
  }
  function dashboardOptions(req, preview = false) {
    const options = pagination(req, false);
    options.period = req.query.period ?? (preview ? 'historical' : 'overnight');
    if (!['overnight', 'week', ...(preview ? ['historical'] : [])].includes(options.period)) throw new Error('Invalid results period');
    options.limit = positiveId(req.query.limit, 'results limit') ?? 20;
    return options;
  }
  const invalid = (res, error) => res.status(error.status ?? 400).json({ error: error.message });

  publicRoutes.get('/highlights', (req, res) => {
    if (req.query.previewLeague !== undefined) return res.status(400).json({ error: 'Historical previews are available in Admin' });
    let options;
    try { options = pagination(req, false); }
    catch (error) { return invalid(res, error); }
    const path = getPaths().analytics;
    const key = JSON.stringify([path, options]);
    res.set('Cache-Control', 'public, max-age=15');
    try {
      const hit = cache.get(key);
      if (hit && Date.now() < hit.until) return res.json(hit.payload);
      const payload = readHighlightFeed(path, options);
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(key, { payload, until: Date.now() + 15000 });
      return res.json(payload);
    } catch { return res.status(503).json({ error: 'League highlights are temporarily unavailable' }); }
  });
  publicRoutes.get('/dashboard', (req, res) => {
    if (req.query.previewLeague !== undefined || req.query.period === 'historical') {
      return res.status(400).json({ error: 'Historical previews are available in Admin' });
    }
    let options;
    try { options = dashboardOptions(req); }
    catch (error) { return invalid(res, error); }
    const path = getPaths().analytics;
    const key = JSON.stringify(['dashboard', path, options]);
    res.set('Cache-Control', 'public, max-age=15');
    try {
      const hit = cache.get(key);
      if (hit && Date.now() < hit.until) return res.json(hit.payload);
      const payload = readLeagueDashboard(path, options);
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(key, { payload, until: Date.now() + 15000 });
      return res.json(payload);
    } catch { return res.status(503).json({ error: 'League results are temporarily unavailable' }); }
  });

  // All admin routes are mounted behind the existing checkAdmin middleware.
  adminRoutes.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  adminRoutes.get('/status', (req, res) => {
    let path;
    try { path = dataset(req); } catch (error) { return invalid(res, error); }
    try { return res.json(readAnalyticsStatus(path)); }
    catch { return res.status(503).json({ error: 'Analytics status is temporarily unavailable' }); }
  });
  adminRoutes.get('/leagues', (req, res) => {
    try { return res.json({ leagues: listLeagues(getPaths().league) }); }
    catch { return res.status(503).json({ error: 'League list is temporarily unavailable' }); }
  });
  adminRoutes.get('/highlights', (req, res) => {
    let path; let options;
    try { path = dataset(req); options = pagination(req, true); } catch (error) { return invalid(res, error); }
    try { return res.json(readHighlightFeed(path, options)); }
    catch { return res.status(503).json({ error: 'League highlights are temporarily unavailable' }); }
  });
  adminRoutes.get('/highlights/preview', (req, res) => {
    let path; let options;
    try {
      if (!positiveId(req.query.previewLeague, 'preview league')) throw new Error('Choose a preview league');
      path = dataset(req); options = pagination(req, false);
    } catch (error) { return invalid(res, error); }
    try { return res.json(readHighlightFeed(path, { ...options, allowPreview: true })); }
    catch { return res.status(503).json({ error: 'Highlight preview is temporarily unavailable' }); }
  });
  adminRoutes.get('/dashboard/preview', (req, res) => {
    let path; let options;
    try {
      if (!positiveId(req.query.previewLeague, 'preview league')) throw new Error('Choose a preview league');
      path = dataset(req); options = dashboardOptions(req, true);
    } catch (error) { return invalid(res, error); }
    try { return res.json(readLeagueDashboard(path, { ...options, allowPreview: true })); }
    catch { return res.status(503).json({ error: 'League results preview is temporarily unavailable' }); }
  });
  function write(req, res, action) {
    let path;
    try { path = dataset(req); } catch (error) { return invalid(res, error); }
    if (!existsSync(path)) return res.status(409).json({ error: 'Build this Analytics dataset first' });
    let db;
    try {
      db = openAnalytics(path); db.pragma('busy_timeout = 1000');
      const result = action(db); cache.clear(); return res.json(result);
    } catch (error) {
      if (error.status) return invalid(res, error);
      return res.status(503).json({ error: 'Could not update highlights; retry after the Analytics build finishes' });
    } finally { db?.close(); }
  }
  adminRoutes.patch('/highlights/settings', (req, res) => {
    if (typeof req.body?.paused !== 'boolean' || Object.keys(req.body).some(key => key !== 'paused')) {
      return res.status(400).json({ error: 'Provide a paused boolean' });
    }
    return write(req, res, db => {
      db.prepare('UPDATE HighlightSettings SET Paused = ?, UpdatedAtUtc = ?, UpdatedBy = ? WHERE Id = 1')
        .run(Number(req.body.paused), new Date().toISOString(), String(getAuditActor()?.AdminPlayerId ?? ''));
      audit('Highlights Publication', (req.body.paused ? 'Paused automatic highlight publication' : 'Resumed automatic highlight publication')
        + (req.query.previewLeague ? ` in preview league ${req.query.previewLeague}` : ''));
      return { paused: req.body.paused };
    });
  });
  adminRoutes.patch('/highlights/:id', (req, res) => {
    let id;
    try { id = positiveId(req.params.id, 'highlight'); if (!id) throw new Error('Invalid highlight'); }
    catch (error) { return invalid(res, error); }
    const changes = req.body;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length
      || Object.keys(changes).some(key => !['hidden', 'title', 'body'].includes(key))
      || (changes.hidden !== undefined && typeof changes.hidden !== 'boolean')
      || ['title', 'body'].some(key => changes[key] !== undefined && changes[key] !== null
        && (typeof changes[key] !== 'string' || !changes[key].trim() || changes[key].length > (key === 'title' ? 180 : 1500)))) {
      return res.status(400).json({ error: 'Provide hidden, title (up to 180 characters), or body (up to 1500 characters); null restores generated text' });
    }
    return write(req, res, db => {
      const row = moderateHighlight(db, id, changes, String(getAuditActor()?.AdminPlayerId ?? ''));
      if (!row) { const error = new Error('Highlight not found'); error.status = 404; throw error; }
      audit('Highlight Updated', `Updated highlight ${id}${req.query.previewLeague ? ` in preview league ${req.query.previewLeague}` : ''}`);
      return { highlight: highlightDTO(row, true) };
    });
  });
  return { adminRoutes, publicRoutes };
}
