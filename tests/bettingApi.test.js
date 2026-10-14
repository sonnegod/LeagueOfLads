import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFixture,preseasonFixture } from './helpers/bettingFixture.js';
import { createBettingRoutes } from '../routes/bettingRoutes.js';
import { runBetting,fixtureGuard,seasonGuard } from '../betting/engine.js';
const now=new Date('2026-10-13T12:00:00.000Z');

test('public market reads expose only quotes, owned accounts require authentication, and submitted user IDs cannot debit another wallet',async()=>{
  const f=engineFixture();const directory=mkdtempSync(join(tmpdir(),'lads-bet-api-'));let server;
  try {
    f.analytics.exec("INSERT INTO PrivateRosterInputs VALUES(1,11,1,987654321,'PRIVATE_PUBLIC_INPUT');");
    const event=f.schedules.save(1,{team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-17T01:00:00Z'},null,now);
    runBetting({...f,now,simulations:50});
    const path=join(directory,'Analytics.db');await f.analytics.backup(path);
    f.book.eventGuard=(id,market)=>fixtureGuard(f.league,id,market,now);
    f.book.seasonGuard=(id,market)=>seasonGuard(f.league,path,id,market,now);
    const app=express();app.use(express.json());app.use((req,res,next)=>{
      const user=req.headers['x-test-user'];req.isAuthenticated=()=>!!user;if(user)req.user={id:String(76561197960265728n+BigInt(user))};next();
    });
    const routes=createBettingRoutes({...f,analyticsPath:path,refresh:()=>{},playerName:id=>`Player ${id}`});
    app.use('/betting',routes.publicRoutes);app.use('/admin',(req,res,next)=>req.headers['x-test-admin']==='yes'?next():res.status(403).json({error:'Forbidden'}),routes.adminRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/betting/wallet?seasonId=1`)).status,401);
    assert.equal((await fetch(`${base}/admin/status`)).status,403);
    const first=await (await fetch(`${base}/betting/markets?seasonId=1&type=series_winner&limit=1`)).json();
    assert.equal(first.markets.length,1);assert.equal(first.markets[0].status,'open');
    const all=await (await fetch(`${base}/betting/markets?seasonId=1&limit=1000`)).json();assert.ok(all.markets.length<=20);
    const serialized=JSON.stringify(all);
    for(const secret of ['987654321','PRIVATE_PUBLIC_INPUT','Probability','AnchorMicros','InputJson','ForecastJson','privatePlayerFeatures','SignupMMR'])assert.equal(serialized.includes(secret),false,secret);
    const internal=f.betting.prepare('SELECT * FROM BettingMarkets WHERE MarketId=?').get(first.markets[0].marketId);
    assert.equal(seasonGuard(f.league,path,1,internal,now),null);
    assert.equal(seasonGuard(f.league,path,1,{...internal,RulesJson:JSON.stringify({...JSON.parse(internal.RulesJson),usesPrivatePublic:true})},now),'Updated inputs are awaiting new quotes');
    const quote=first.markets[0];const headers={'Content-Type':'application/json','x-test-user':'99'};
    const response=await fetch(`${base}/betting/tickets`,{method:'POST',headers,body:JSON.stringify({userId:'100',seasonId:1,stake:100,
      requestKey:'api_ticket_0001',legs:[{selectionId:quote.selections[0].selectionId,quoteVersion:quote.quoteVersion}]})});
    assert.equal(response.status,201);assert.equal(f.book.wallet(1,'99').balance,9900);
    assert.equal(f.betting.prepare("SELECT 1 FROM BettingWallets WHERE UserId='100'").get(),undefined);
    const own=await (await fetch(`${base}/betting/tickets?seasonId=1`,{headers})).json();assert.equal(own.tickets.length,1);
    const other=await (await fetch(`${base}/betting/tickets?seasonId=1&userId=99`,{headers:{'x-test-user':'100'}})).json();assert.equal(other.tickets.length,0);
    f.schedules.save(1,{eventId:event.EventId,revision:event.Revision,team1Key:11,team2Key:12,stage:'regular',bestOf:2,scheduledStartUtc:'2026-10-18T01:00:00Z'},null,now);
    const closed=await fetch(`${base}/betting/tickets`,{method:'POST',headers,body:JSON.stringify({seasonId:1,stake:100,requestKey:'api_ticket_0002',
      legs:[{selectionId:quote.selections[1].selectionId,quoteVersion:f.betting.prepare('SELECT QuoteVersion FROM BettingMarkets WHERE MarketId=?').get(quote.marketId).QuoteVersion}]})});
    assert.equal(closed.status,409);assert.equal(f.book.wallet(1,'99').balance,9900);
    const status=await (await fetch(`${base}/admin/status`,{headers:{'x-test-admin':'yes','x-test-user':'99'}})).json();
    assert.equal(JSON.stringify(status).includes('987654321'),false);assert.equal(JSON.stringify(status).includes('PRIVATE_PUBLIC_INPUT'),false);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();rmSync(directory,{recursive:true,force:true});}
});

test('live grouped preseason reads keep full players together, sort group teams, preserve guards and accept their real selection IDs',async()=>{
  const f=preseasonFixture([4,5]),directory=mkdtempSync(join(tmpdir(),'lads-grouped-api-'));let server;
  try {
    runBetting({...f,seasonId:2,now,simulations:100});
    const path=join(directory,'Analytics.db');await f.analytics.backup(path);
    f.book.eventGuard=(id,m)=>fixtureGuard(f.league,id,m,now);f.book.seasonGuard=(id,m)=>seasonGuard(f.league,path,id,m,now);
    f.league.exec("CREATE TABLE GroupNames(LeagueId INTEGER,GroupId INTEGER,GroupName TEXT);INSERT INTO GroupNames VALUES(200,2,'Romeo'),(200,3,'Juliet');UPDATE SeasonTeams SET TeamName='Aardvark' WHERE TeamSubmissionId=29;");
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.isAuthenticated=()=>req.headers['x-test-user']==='99';req.user={id:'76561197960265827'};next();});
    app.use('/betting',createBettingRoutes({...f,analyticsPath:path,playerName:id=>`Captain ${id}`,refresh:()=>{}}).publicRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/betting`;
    const get=async query=>{const response=await fetch(`${base}/markets?seasonId=2&${query}`);assert.equal(response.status,200);return response.json();};
    const first=await get('view=player');assert.equal(first.players.length,20);assert.ok(first.nextBefore);
    assert.ok(first.players.every(p=>p.markets.length===16&&p.markets.every(m=>m.playerId===p.playerId&&m.status==='open')));
    const second=await get(`view=player&before=${first.nextBefore}`);assert.equal(second.players.length,20);
    assert.ok(second.players.every(p=>!first.players.some(a=>a.playerId===p.playerId)));
    const last=await get(`view=player&before=${second.nextBefore}`);assert.equal(last.players.length,5);assert.equal(last.nextBefore,null);
    const byName=await get('view=player&search=Captain%20210');assert.deepEqual(byName.players.map(p=>p.playerId),[210]);
    const byId=await get('view=player&search=210');assert.ok(byId.players.some(p=>p.playerId===210));
    const byStat=await get('view=player&search=Kills');assert.equal(byStat.players[0].markets.length,16);
    const byTeam=await get('view=player&search=Aardvark');assert.equal(byTeam.players.length,5);
    const teams=await get('view=team');assert.equal(teams.teamGroups.length,2);assert.deepEqual(teams.teamGroups.map(g=>g.name),['Juliet','Romeo']);
    assert.equal(teams.teamGroups[0].teams[0].name,'Aardvark');
    const champion=teams.teamGroups[0].teams[0].champion;assert.ok(champion.selection.selectionId);assert.ok(champion.market.quoteVersion);
    assert.equal((await get('view=team&search=Romeo')).teamGroups.length,1);
    for(const secret of ['AverageSignupMMR','privatePlayerFeatures','publicFeatureHistory','Probability','AnchorMicros','InputJson','ForecastJson'])
      assert.equal(JSON.stringify({first,teams}).includes(secret),false,secret);
    const market=first.players[0].markets[0],selection=market.selections[0];const headers={'Content-Type':'application/json','x-test-user':'99'};
    const place=key=>fetch(`${base}/tickets`,{method:'POST',headers,body:JSON.stringify({seasonId:2,stake:100,requestKey:key,
      legs:[{selectionId:selection.selectionId,quoteVersion:market.quoteVersion}]})});
    assert.equal((await place('grouped_real_selection')).status,201);assert.equal(f.book.wallet(2,'99').balance,9900);
    // A later worker publishes a new quote version while the browser has its old DTO.
    f.betting.prepare('UPDATE BettingMarkets SET QuoteVersion=QuoteVersion+1 WHERE MarketId=?').run(market.marketId);
    assert.equal((await place('grouped_stale_quote')).status,409);assert.equal(f.book.wallet(2,'99').balance,9900);
    const selectedChampion=await fetch(`${base}/tickets`,{method:'POST',headers,body:JSON.stringify({seasonId:2,stake:100,requestKey:'grouped_team_selection',
      legs:[{selectionId:champion.selection.selectionId,quoteVersion:champion.market.quoteVersion}]})});
    assert.equal(selectedChampion.status,201);
    const event=f.schedules.list(2)[0];f.schedules.save(2,{...event,eventId:event.EventId,revision:event.Revision,team1Key:event.Team1Key,team2Key:event.Team2Key,
      stage:'regular',bestOf:2,scheduledStartUtc:event.ScheduledStartUtc,status:'started'},'1',now);
    assert.ok((await get('view=player')).players.every(p=>p.markets.every(m=>m.status==='held')));
    const denied=await place('grouped_started_season');assert.equal(denied.status,409);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.close();rmSync(directory,{recursive:true,force:true});}
});
