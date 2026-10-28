import test from 'node:test';
import assert from 'node:assert/strict';
import {playerStatDistribution,mergePlayerMetricHistory,validatePlayerStatHistory} from '../betting/playerForm.js';
import {statForecast,seededRandom} from '../betting/models.js';

const start=Date.parse('2026-09-01T00:00:00Z');
function row(id,value,season=1,player=1,duration=1800){
  const kickoff=start+id*3600000;
  return {MatchId:id,PlayerId:player,SeasonId:season,LeagueId:season*10,DurationSeconds:duration,
    StartedAtUtc:new Date(kickoff).toISOString(),SourceObservedAtUtc:new Date(kickoff+duration*1000).toISOString(),GPM:value,LastHits:value/2};
}
const old=(value=600)=>Array.from({length:30},(_,i)=>row(i+1,value+(i%3-1)*10));
const latest=(values,season=2)=>values.map((value,i)=>row(100+i,value,season));

test('consistent core-to-support and support-to-core stat changes shift most of the estimate to recent games',()=>{
  for(const [baseline,recent,direction] of [[600,[200,210,190],'down'],[250,[650,640,660],'up']]){
    const history=[...old(baseline),...latest(recent)];
    const changed=playerStatDistribution(history,old(500),'GPM',2);
    const normal=playerStatDistribution(history,old(500),'GPM',null);
    assert.equal(changed.form.direction,direction);assert.equal(changed.form.recentGames,3);
    assert.ok(Math.abs(changed.recentWeight-.6)<1e-12);
    assert.ok(Math.abs(changed.expected-recent[0])<Math.abs(normal.expected-recent[0]));
    assert.equal(changed.form.reason,'recent_stat_change');
    assert.ok(history.every(game=>!Object.hasOwn(game,'Role')));
  }
  const history=[...old(),...latest([200,210,190,205,195,200])];
  assert.equal(playerStatDistribution(history,old(500),'GPM',2).recentWeight,.8);
});

test('normal variation and returning to normal performance retain the historical baseline',()=>{
  for(const values of [[580,610,590,620],[600,20,600,610]]){
    const model=playerStatDistribution([...old(),...latest(values)],old(500),'GPM',2);
    assert.equal(model.recentWeight,0,JSON.stringify(values));
    assert.equal(model.form.reason,'historical_baseline');
  }
});

test('one large game changes the estimate immediately and more recent games smooth its influence',()=>{
  const estimate=values=>playerStatDistribution([...old(),...latest(values)],old(500),'GPM',2);
  for(const [values,weight] of [[[200],.4],[[200,210],.5],[[200,210,190],.6]]){
    const model=estimate(values);
    assert.equal(model.form.recentGames,values.length);assert.equal(model.form.direction,'down');
    assert.ok(Math.abs(model.recentWeight-weight)<1e-12);
  }
  assert.equal(estimate([600,600,5]).form.recentGames,1);
  const firstGameSpread=estimate([300]).expected-estimate([100]).expected;
  const thirdGameSpread=estimate([200,200,300]).expected-estimate([200,200,100]).expected;
  assert.ok(thirdGameSpread>0&&thirdGameSpread<firstGameSpread);
  const recovered=estimate([200,600]);
  assert.equal(recovered.recentWeight,0);
});

test('current-season changes are detected midseason without altering or relabelling older games',()=>{
  const history=[...old(),...Array.from({length:12},(_,i)=>row(50+i,600,2)),...latest([200,210,190])];
  const original=JSON.stringify(history),model=playerStatDistribution(history,old(500),'GPM',2);
  assert.ok(model.form.recentGames>=3&&model.form.recentGames<=4);assert.equal(model.form.direction,'down');
  assert.equal(JSON.stringify(history),original);
  assert.equal(playerStatDistribution(history,old(500),'GPM',3).recentWeight,0);
});

test('duration-normalized detection does not interpret shorter matches as a last-hit role change',()=>{
  const history=old().map(game=>({...game,LastHits:300}));
  const shorter=latest([600,600,600]).map(game=>({...game,DurationSeconds:900,LastHits:150}));
  assert.equal(playerStatDistribution([...history,...shorter],history,'LastHits',2).recentWeight,0);
  const support=shorter.map(game=>({...game,LastHits:25}));
  assert.ok(playerStatDistribution([...history,...support],history,'LastHits',2).recentWeight>0);
  assert.equal(playerStatDistribution([...history,...support.map(game=>({...game,DurationSeconds:null}))],history,'LastHits',2).recentWeight,0);
});

test('live metric merge uses completed observed canonical rows and never resurrects cached current-season games',()=>{
  const history=old(),current=latest([200,210,190]);
  const cached=[...history,{...current[0],GPM:999},row(110,999,2),{...row(111,999,2),SeasonId:undefined}];
  const at=current[2].SourceObservedAtUtc;
  const future={...row(120,900,2),StartedAtUtc:current[0].StartedAtUtc,DurationSeconds:1,SourceObservedAtUtc:'2027-01-01T00:00:00Z'};
  const unfinished={...row(121,900,2),StartedAtUtc:at,SourceObservedAtUtc:at};
  const result=mergePlayerMetricHistory([...current,future,unfinished],cached,{SeasonId:2,LeagueId:20},at);
  assert.equal(result.length,33);assert.equal(result.find(game=>game.MatchId===100).GPM,200);
  assert.equal(result.some(game=>[110,111,120,121].includes(game.MatchId)),false);
  assert.equal(new Set(result.map(game=>`${game.MatchId}:${game.PlayerId}`)).size,result.length);
});

test('real stat forecast draws from adaptive distributions but keeps an existing market line',()=>{
  const history=[...old(),...latest([200,210,190]),...Array.from({length:60},(_,i)=>row(i+1,500,1,2))];
  history.sort((a,b)=>Date.parse(a.StartedAtUtc)-Date.parse(b.StartedAtUtc));
  const inputs={season:{SeasonId:2},metricHistory:history,modelMode:'historical_roster'};
  const prediction=statForecast(inputs,{playerId:1,stat:'gpm',scope:'average',line:550.5},seededRandom(1),10000);
  assert.equal(prediction.line,550.5);assert.ok(prediction.expected<400);
  assert.ok(prediction.under>.6);assert.equal(prediction.form.reason,'recent_stat_change');
  assert.equal(prediction.form.historyGames,33);
});

test('temporal validation excludes simultaneous, unfinished and not-yet-observed outcomes',()=>{
  const histories=[];
  for(let id=1;id<=30;id++)for(let player=1;player<=10;player++)histories.push(row(id,500,1,player));
  const report=validatePlayerStatHistory(histories,{gpm:'GPM'}).gpm;
  assert.ok(report.samples>=20);assert.equal(report.validated,true);
  assert.equal(report.brier,report.referenceBrier);
  const delayed=histories.map(game=>({...game,SourceObservedAtUtc:'2027-01-01T00:00:00Z'}));
  assert.equal(validatePlayerStatHistory(delayed,{gpm:'GPM'}).gpm.samples,0);
  assert.equal(validatePlayerStatHistory(delayed,{gpm:'GPM'},{retrospective:true}).gpm.method,'retrospective_completed_game_replay');
  assert.equal(validatePlayerStatHistory(histories.map(game=>({...game,DurationSeconds:9999999})),{gpm:'GPM'}).gpm.samples,0);
});

test('chronological replay adapts after the first completed current-season game without using that outcome early',()=>{
  const history=[];
  for(let id=1;id<=50;id++)for(let player=1;player<=10;player++){
    const current=id>30;
    history.push(row(id,player===1?(current?200:600):500,current?2:1,player));
  }
  const report=validatePlayerStatHistory(history,{gpm:'GPM'}).gpm;
  assert.equal(report.adaptedSamples,19);
  assert.ok(report.brier<report.referenceBrier);assert.equal(report.validated,true);
});
