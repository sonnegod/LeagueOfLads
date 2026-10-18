import express from 'express';
import { checkDraftGodOwner } from '../middleware/checkDraftGod.js';

const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function createDraftGodRouter(store) {
  const router = express.Router();
  router.use(checkDraftGodOwner);
  const handle = fn => (req, res) => {
    try { return res.json(fn(req)); }
    catch (e) {
      if (!e.status) console.error('Draft God:', e);
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'Draft God data unavailable' });
    }
  };
  const id = req => { const value = positiveId(req.params.id); if (!value) throw Object.assign(new Error('Invalid ID'), { status: 400 }); return value; };
  router.get('/', handle(req => {
    const seasonId = req.query.seasonId === undefined ? null : positiveId(req.query.seasonId);
    if (req.query.seasonId !== undefined && !seasonId) throw Object.assign(new Error('Invalid season'), { status: 400 });
    return store.setup(seasonId);
  }));
  router.get('/players', handle(req => ({ players: store.searchPlayers(req.query.search) })));
  router.post('/context', handle(req => store.context(req.body?.config)));
  router.get('/drafts', handle(() => ({ drafts: store.listDrafts() })));
  router.post('/drafts', handle(req => store.saveDraft(null, req.body)));
  router.get('/drafts/:id', handle(req => store.getDraft(id(req))));
  router.patch('/drafts/:id', handle(req => store.saveDraft(id(req), req.body)));
  router.delete('/drafts/:id', handle(req => { store.deleteDraft(id(req)); return { success: true }; }));
  router.put('/heroes/:id', handle(req => ({ profile: store.saveHeroProfile(id(req), req.body) })));
  router.put('/meta/:patch', handle(req => store.saveMetaOverride(req.params.patch, req.body)));
  return router;
}
