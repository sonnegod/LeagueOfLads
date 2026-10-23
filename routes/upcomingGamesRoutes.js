import express from 'express';
import {localBettingTestMode} from '../betting/localTestPolicy.js';

export function createUpcomingGamesRouter({league,now=()=>new Date(),env=process.env,readOdds=()=>new Map()}) {
  const router=express.Router();
  const includeLocalTests=localBettingTestMode(env);
  router.get('/upcoming-games',(req,res)=>{
    try {
      const current=now();
      const games=league.prepare(`SELECT e.EventId AS eventId,a.TeamName AS team1,b.TeamName AS team2,
        e.ScheduledStartUtc AS startAt,e.SourceMessageId FROM ScheduledEvents e
        JOIN LeagueSeasons s ON s.SeasonId=e.SeasonId
        JOIN SeasonTeams a ON a.TeamSubmissionId=e.Team1Key AND a.SeasonId=e.SeasonId
        JOIN SeasonTeams b ON b.TeamSubmissionId=e.Team2Key AND b.SeasonId=e.SeasonId
        WHERE s.Status IN ('signup_closed','active') AND e.Status='scheduled' AND e.StartedAtUtc IS NULL
          AND e.ScheduledStartUtc>? AND (?=1 OR e.SourceMessageId IS NULL OR e.SourceMessageId NOT LIKE 'local-test:%')
        ORDER BY e.ScheduledStartUtc,e.EventId LIMIT 20`).all(current.toISOString(),Number(includeLocalTests))
        .map(({SourceMessageId,...game})=>({...game,...(SourceMessageId?.startsWith('local-test:')?{localTestFixture:true}:{})}));
      res.set('Cache-Control','no-store');
      let odds=new Map();
      try{odds=readOdds(games,current);}catch(error){console.error('Upcoming odds request failed:',error.code||'internal');}
      return res.json({games:games.map(game=>({...game,...(odds.has(game.eventId)?{sweepOdds:odds.get(game.eventId)}:{})}))});
    }catch(error){
      console.error('Upcoming games request failed:',error.code||'internal');
      return res.status(500).json({error:'Unable to load upcoming games'});
    }
  });
  return router;
}
