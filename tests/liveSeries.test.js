import test from 'node:test';
import assert from 'node:assert/strict';
import {groupLiveSeries,isActiveLiveSeries} from '../shared/liveSeries.js';

const match=(extra={})=>({MatchId:1,TrackedSeriesId:4,SeriesStatus:'in_progress',SeriesBestOf:2,
  SeriesTeam1:10,SeriesTeam2:20,SeriesTeam1Name:'A',SeriesTeam2Name:'B',SeriesTeam1Wins:1,SeriesTeam2Wins:0,
  MatchStartedAt:'2026-11-14T02:00:00Z',CreatedAt:'2026-11-14 02:40:00',ImportStatus:{result:'imported'},...extra});

test('one-game live cards expire at 5 AM New York even when import/review has not closed the series',()=>{
  const before=new Date('2026-11-14T09:59:59Z'),after=new Date('2026-11-14T10:00:00Z');
  for(const status of ['in_progress','needs_review','needs_format',null]) {
    const row=match({SeriesStatus:status,ImportStatus:{result:'needs_review',label:'Import delayed'}});
    assert.equal(isActiveLiveSeries(groupLiveSeries([],[row],before)[0]),true);
    const [closed]=groupLiveSeries([],[row],after);
    assert.equal(closed.status,'closed');assert.equal(closed.live,false);assert.equal(closed.games.length,1);
    assert.equal(isActiveLiveSeries(closed),false);assert.deepEqual(closed.score,[1,0]);
    assert.equal(closed.games[0].ImportStatus.result,'needs_review','Closing the card preserves the admin review state');
    assert.equal(row.SeriesStatus,status,'Public grouping must not modify the saved match');
  }
});

test('stale current rows and repeated observations cannot keep yesterday’s unchanged match card active',()=>{
  const row=match({LastChangedAt:'2026-11-14 02:40:00',LastUpdated:'2026-11-14 16:00:00',ImportStatus:{result:'live'}});
  const [closed]=groupLiveSeries([row],[],new Date('2026-11-14T16:00:30Z'));
  assert.equal(closed.status,'closed');assert.equal(closed.live,false);assert.equal(closed.games[0].isLive,false);
  assert.equal(isActiveLiveSeries(closed),false);
  assert.equal(row.ImportStatus.result,'live');
});

test('a current playing window stays active, including after midnight and during long games with fresh snapshots',()=>{
  const afterMidnight=match({CreatedAt:'2026-11-14 06:00:00',ImportStatus:{result:'pending'}});
  const [waiting]=groupLiveSeries([],[afterMidnight],new Date('2026-11-14T09:59:59Z'));
  assert.equal(waiting.status,'in_progress');assert.equal(isActiveLiveSeries(waiting),true);
  const fresh=match({MatchId:2,LastChangedAt:'2026-11-14 10:01:00',LastUpdated:'2026-11-14 10:01:05',ImportStatus:{result:'live'}});
  const [playing]=groupLiveSeries([fresh],[afterMidnight],new Date('2026-11-14T10:01:10Z'));
  assert.equal(playing.live,true);assert.equal(isActiveLiveSeries(playing),true);
});

test('completed results remain completed and imported games are not treated as live when Steam still lists them',()=>{
  const [completed]=groupLiveSeries([match({SeriesStatus:'completed',SeriesTeam1Wins:2})],[],new Date('2026-11-14T15:00:00Z'));
  assert.equal(completed.status,'completed');assert.equal(completed.live,false);assert.deepEqual(completed.score,[2,0]);
  const [imported]=groupLiveSeries([match()],[],new Date('2026-11-14T03:00:00Z'));
  assert.equal(imported.games[0].isLive,false);
  assert.equal(imported.status,'in_progress','The next game can still arrive during the same playing window');
});

test('the playing window follows New York daylight saving changes, not UTC midnight',()=>{
  for(const [snapshot,cutoff] of [['2026-07-01 07:00:00','2026-07-01T09:00:00Z'],['2026-11-01 06:30:00','2026-11-01T10:00:00Z']]) {
    const row=match({CreatedAt:snapshot});
    assert.equal(groupLiveSeries([],[row],new Date(Date.parse(cutoff)-1000))[0].status,'in_progress');
    assert.equal(groupLiveSeries([],[row],new Date(cutoff))[0].status,'closed');
  }
});
