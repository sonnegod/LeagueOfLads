import express from 'express';
import { ExpandedPerformanceReporting } from '../config/expandedPerformanceReporting.js';

function positive(value) {
  const raw = String(value ?? '');
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed <= 0) throw Object.assign(new Error('Invalid ID'), { status: 400 });
  return parsed;
}
function filter(value) { return value == null || value === 'all' ? null : positive(value); }

export function createWarehouseReportingRouter(db) {
  const router = express.Router(), reporting = new ExpandedPerformanceReporting(db);
  const handle = build => (req, res) => {
    try {
      const data = build(req);
      if (data == null) return res.status(404).json({ error: 'Requested record not found' });
      return res.json(data);
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      console.error('League performance report unavailable:', error.message);
      return res.status(500).json({ error: 'Could not load performance data' });
    }
  };
  const performanceFilters = req => {
    const stage = req.query.stage || 'all';
    if (!['all', 'regular', 'tiebreakers', 'playoffs', 'unknown'].includes(stage)) throw Object.assign(new Error('Invalid stage'), { status: 400 });
    return { leagueId: filter(req.query.leagueId), patchId: filter(req.query.patchId), stage };
  };
  router.get('/hero/:heroId/performance', handle(req => reporting.heroPerformance(positive(req.params.heroId), performanceFilters(req))));
  router.get('/leagues/:leagueId/performance', handle(req => reporting.leaguePerformance(positive(req.params.leagueId), performanceFilters(req))));
  router.get('/matches/:matchId/analysis', handle(req => reporting.match(positive(req.params.matchId))));
  router.get('/matches/:matchId/analysis/skills', handle(req => reporting.skillBuilds(positive(req.params.matchId))));
  router.get('/matches/:matchId/analysis/inventories', handle(req => reporting.inventories(positive(req.params.matchId))));
  router.get('/matches/:matchId/analysis/events', handle(req => reporting.events(positive(req.params.matchId))));
  router.get('/matches/:matchId/analysis/draft/views', handle(req => reporting.draftViews(positive(req.params.matchId))));
  router.get('/matches/:matchId/analysis/draft', handle(req => {
    if (req.query.scope != null && !['season', 'patch'].includes(req.query.scope)) throw Object.assign(new Error('Invalid draft history scope'), { status: 400 });
    if (req.query.period != null && !['full', 'before'].includes(req.query.period)) throw Object.assign(new Error('Invalid draft history period'), { status: 400 });
    return reporting.draft(positive(req.params.matchId), { samePatch: req.query.scope === 'patch', beforeMatch: req.query.period === 'before' });
  }));
  router.get('/matches/:matchId/analysis/fights', handle(req => reporting.fights(positive(req.params.matchId))));
  router.get('/matches/:matchId/analysis/players/:playerId', handle(req => reporting.playerMatch(positive(req.params.matchId), positive(req.params.playerId))));
  for (const [path, type] of [['player', 'player'], ['teams', 'team']]) {
    router.get(`/${path}/:id/performance`, handle(req => reporting.performance(type, positive(req.params.id), {
      leagueId: filter(req.query.leagueId), patchId: filter(req.query.patchId), heroId: type === 'player' ? filter(req.query.heroId) : null,
    })));
  }
  return router;
}
