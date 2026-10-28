import express from 'express';
import {getAppLiveMatchesPayload,toAppLiveMatch,toNullableNumber,withLiveMatchJson} from './utility/liveMatchResponses.js';
import {createLiveMatchStream} from '../config/liveMatchStream.js';

function snapshotCursor(req,res,next) {
  const raw=req.query.afterSnapshotId;
  if(raw!==undefined&&(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))) {
    return res.status(400).json({error:'Invalid snapshot cursor'});
  }
  req.afterSnapshotId=raw===undefined?0:Number(raw);
  next();
}

export function createLiveMatchRouter(db) {
const router=express.Router();
const liveUpdates=createLiveMatchStream(()=>db.getLiveMatchCurrentStates().map(withLiveMatchJson));
router.liveUpdates=liveUpdates;
router.use(['/liveMatches','/app/live-matches'],(req,res,next)=>{
  res.set('Cache-Control','no-store');
  next();
});
router.get('/liveMatches/stream',(req,res)=>liveUpdates.subscribe(req,res));
router.get('/liveMatches/count', (req, res) => {
  try {
    res.json({ count: db.getLiveMatchCount() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load live match count' });
  }
});

router.get('/liveMatches', (req, res) => {
  try {
    const matches = db.getLiveMatchCurrentStates().map(withLiveMatchJson);
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load live matches' });
  }
});

router.get('/liveMatches/recent', (req, res) => {
  try {
    const hours = Number(req.query.hours || 4);
    const matches = db.getRecentLiveMatchSnapshots(hours).map(withLiveMatchJson);
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load recent live matches' });
  }
});

router.get('/liveMatches/:matchId/snapshots', snapshotCursor, (req, res) => {
  try {
    const snapshots = db.getLiveMatchSnapshots(req.params.matchId, req.afterSnapshotId).map(withLiveMatchJson);
    res.json({ snapshots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load live match snapshots' });
  }
});

router.get('/app/live-matches', (req, res) => {
  try {
    const includeRecent = req.query.includeRecent !== 'false';
    res.json(getAppLiveMatchesPayload(db, { includeRecent }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load app live matches' });
  }
});

router.get('/app/live-matches/count', (req, res) => {
  try {
    res.json({
      generatedAt: new Date().toISOString(),
      count: db.getLiveMatchCount(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load app live match count' });
  }
});

router.get('/app/live-matches/:matchId/snapshots', snapshotCursor, (req, res) => {
  try {
    const snapshots = db
      .getLiveMatchSnapshots(req.params.matchId, req.afterSnapshotId)
      .map((snapshot) => toAppLiveMatch(snapshot));

    res.json({
      generatedAt: new Date().toISOString(),
      matchId: toNullableNumber(req.params.matchId),
      count: snapshots.length,
      snapshots,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load app live match snapshots' });
  }
});

return router;
}
