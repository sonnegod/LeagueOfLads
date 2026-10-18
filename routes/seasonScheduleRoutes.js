import express from 'express';

const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function respond(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'This matchup conflicts with the current plan. Refresh and try again.' });
  }
  console.error('Schedule request failed:', error);
  return res.status(500).json({ error: 'Unable to update the schedule' });
}

export function createAdminScheduleRouter(store) {
  const router = express.Router();
  router.use('/:seasonId/schedule', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!positiveId(req.params.seasonId)) return res.status(400).json({ error: 'Invalid season' });
    next();
  });
  const action = operation => (req, res) => {
    try { return res.json(operation(Number(req.params.seasonId), req.body || {}, req)); }
    catch (error) { return respond(res, error); }
  };
  router.get('/:seasonId/schedule', action(seasonId => store.read(seasonId)));
  router.put('/:seasonId/schedule', action((seasonId, body) => store.saveSettings(seasonId, body)));
  router.post('/:seasonId/schedule/randomize', action((seasonId, body) => store.generate(seasonId, body)));
  router.post('/:seasonId/schedule/matchups', action((seasonId, body) => store.saveMatchup(seasonId, body)));
  router.post('/:seasonId/schedule/matchups/random', action((seasonId, body) => store.randomMatchup(seasonId, body)));
  router.patch('/:seasonId/schedule/matchups/:matchupId', action((seasonId, body, req) => {
    if (!positiveId(req.params.matchupId)) throw Object.assign(new Error('Invalid matchup'), { status: 400 });
    return store.saveMatchup(seasonId, body, Number(req.params.matchupId));
  }));
  router.delete('/:seasonId/schedule/matchups/:matchupId', action((seasonId, body, req) => {
    if (!positiveId(req.params.matchupId)) throw Object.assign(new Error('Invalid matchup'), { status: 400 });
    return store.remove(seasonId, Number(req.params.matchupId));
  }));
  return router;
}

export function createPublicScheduleRouter(store) {
  const router = express.Router();
  router.get('/leagues/:leagueId/schedule', (req, res) => {
    if (!positiveId(req.params.leagueId)) return res.status(400).json({ error: 'Invalid league' });
    try { return res.json(store.forLeague(Number(req.params.leagueId))); }
    catch (error) { return respond(res, error); }
  });
  return router;
}
