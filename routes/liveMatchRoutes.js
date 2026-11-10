import express from 'express';
import {getAppLiveMatchesPayload,toAppLiveMatch,toNullableNumber,withLiveMatchJson} from './utility/liveMatchResponses.js';
import {createLiveMatchStream} from '../config/liveMatchStream.js';
import {attachLiveResultStatus,groupLiveSeries} from '../config/liveSeries.js';
import {createMatchResultsStream} from '../config/matchResultsStream.js';
import {ensureMatchResultsSchema} from '../config/matchResultsSchema.js';

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
const status=rows=>attachLiveResultStatus(db.db,rows.map(withLiveMatchJson));
if(db.db)ensureMatchResultsSchema(db.db);
const results=db.db?createMatchResultsStream(db.db):null;
const liveUpdates=createLiveMatchStream(()=>status(db.getLiveMatchCurrentStates()));
const closeLive=liveUpdates.close;
liveUpdates.close=()=>{closeLive();results?.close();};
router.liveUpdates=liveUpdates;
if(results)router.get('/match-results/stream',(req,res)=>results.subscribe(req,res));
router.get('/liveMatches/series',(req,res)=>{
  try{res.set('Cache-Control','no-store').json({series:groupLiveSeries(status(db.getLiveMatchCurrentStates()),status(db.getRecentLiveMatchSnapshots(24)))});}
  catch{res.status(500).json({error:'Unable to load live series'});}
});
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
    const matches = status(db.getLiveMatchCurrentStates());
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load live matches' });
  }
});

router.get('/liveMatches/recent', (req, res) => {
  try {
    const hours = Number(req.query.hours || 4);
    const matches = status(db.getRecentLiveMatchSnapshots(hours));
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
