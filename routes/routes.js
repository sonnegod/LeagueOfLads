import express from 'express';
import passport from 'passport';

import { checkAdmin } from '../middleware/checkAdmin.js';

import db from '../database.js';
import dbBet from '../databaseBet.js';

import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

function resolveActiveLeague() {
  const active = db.getActiveLeague();
  let leagueId = active?.[0]?.LeagueId;

  if (!leagueId) {
    const recent = db.getCurrentLeague();
    leagueId = recent?.[0]?.LeagueId;
  }

  return leagueId;
}

router.get('/auth/steam',
  passport.authenticate('steam')
);

router.get('/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    db.login(req.user.displayName, req.user.id, new Date().toISOString());
    if(process.env.ENVIRONMENT === 'DEV')
      res.redirect(`http://localhost:${process.env.FRONTEND_PORT}/dashboard`);
    else if(process.env.ENVIRONMENT === 'PROD')
      res.redirect(`https://www.leagueoflads.com/dashboard`); 
  }
);

router.get('/auth/user', (req, res) => {
  if (req.isAuthenticated() && req.user) {
    // You can customize what user info to send here
    res.json({
      steamid: req.user.id,
      personaname: req.user.displayName,
      avatar: req.user.photos[2]?.value || req.user.photos[0]?.value,
      profileurl: req.user._json?.profileurl || '',
    });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

router.get('/auth/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(err => {
      res.clearCookie('connect.sid'); 
      res.redirect('/');
    });
  });
});

router.post('/nameChange', (req, res) => {

  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const newName = req.body.newName;
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'Invalid name' });
  }

   const userId = req.body.userId; // or steamId / accountId
   try {
    // Call your DB function that handles validation & update
    const result = db.changeName(userId, newName);
    if (!result.success) {
      // e.g., result.message could be "You must wait X days"
      return res.status(400).json({ error: result.message });
    }

    res.json({ success: true, message: 'Name updated successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const user = req.user;
  res.send(`
    <h1>Hello, ${user.displayName}</h1>
    <img src="${user.photos[2]?.value}" />
    <p>SteamID: ${user.id}</p>
    <a href="/logout">Logout</a>
  `);
});

router.get('/admin', checkAdmin, (req, res) => {
  res.json({ message: 'Welcome to the admin portal!' });
});

router.post('/admin/updateMatchTeams', (req, res) => {
  
  const matchId = req.body.matchId;
  const teamRad = req.body.team1;
  const teamDire = req.body.team2;
  const winnerId = req.body.winner;

  const originalTeamRad = req.body.team1Old;
  const originalTeamDire = req.body.team2Old;

  try {
    // Call your DB function that handles validation & update
    const result = db.adminUpdateMatch(matchId, teamRad, teamDire, winnerId, originalTeamRad, originalTeamDire);
    if (!result.success) {

      return res.status(400).json({ error: result.message });
    }

    res.json({ success: true});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/currentLeagueTeams', (req, res) => {
  try {

    const result = db.adminCurrentTeams();

      res.json({ result });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/admin/currentLeagueTeamMatches/:teamId', (req, res) => {
  try {
    const { teamId } = req.params;

    const result = db.adminCurrentTeamMatches(teamId);

      res.json({ result });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/admin/teamStandings/:teamId', (req, res) => {
  try {
    const { teamId } = req.params;

    const result = db.adminCurrentTeamStandings(teamId);

      res.json({ result });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/admin/updateTeamStandings', (req, res) => {
  try {
      const teamId = req.body.teamId;
      const wins = req.body.wins;
      const losses = req.body.losses;

      const result = db.adminUpdateTeamStandings(teamId,wins,losses);
      
      if (!result.success) {

        return res.status(400).json({ error: result.message });
      }
      res.json({ success:true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/admin/deleteMatch', (req, res) => {
  try {
      const matchId = req.body.matchId;

      const result = db.adminDeleteMatch(matchId);
      
      if (!result.success) {

        return res.status(400).json({ error: result.message });
      }
      res.json({ success:true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.post("/admin/activateTiebreakers", (req, res) => {

  const last = db.getLastMatchForActiveLeague();
  if (!last) return res.json({ success: false, error: "No matches found" });

  const activeLeague = db.getActiveLeague();

  const existing = db.getLeagueStageBoundaries(activeLeague[0].LeagueId);

  // Case 1: No record — create new one
  if (existing.length === 0) {
    db.insertNewLeagueStageBoundaries(activeLeague[0].LeagueId, last[0].MatchId, null);

    db.setSeeding();

    return res.json({ 
      success: true, 
      created: true
     });
  }
  else{
    // Case 2: Record exists — not allowed if GroupEndMatchId already set
    return res.json({ success: false, error: "Group stage already closed" });
  }
});

router.post("/admin/activatePlayoffs", (req, res) => {
  const activeLeague = db.getActiveLeague();

  const last = db.getLastMatchForActiveLeague();
  if (!last) return res.json({ success: false, error: "No matches found" });

  const existing = db.getLeagueStageBoundaries(activeLeague[0].LeagueId);

  // Case 1: No record — create both fields set
  if (existing.length === 0) {
    db.insertNewLeagueStageBoundaries(activeLeague[0].LeagueId, last[0].MatchId, last[0].MatchId);
    return res.json({ 
      success: true, 
      created: true
    });
  }

  // Case 2: Set only TieBreakerEndMatchId
  db.updateLeagueStageBoundariesTieBreaker(last[0].MatchId, activeLeague[0].LeagueId);

  return res.json({ success: true });
});

router.post("/admin/endSeason", (req, res) => {
  const activeLeague = db.getActiveLeague();
  const activeLeagueId = activeLeague[0].LeagueId;

  /*  Dont Really need right now
  
  const last = db.getLastMatchForActiveLeague();
  if (!last) return res.json({ success: false, error: "No matches found" });
  const existing = db.getLeagueStageBoundaries(activeLeague[0].LeagueId);
  */

  db.closeSeason(activeLeagueId);

  return res.json({ success: true });
});

router.get('/leagueStage', (req, res) => {
  try {
    const leagueId = req.query.leagueId || resolveActiveLeague();

    if (!leagueId) {
      return res.json({
        exists: false,
        stageInfo: {
          GroupEndMatchId: null,
          TieBreakerEndMatchId: null
        }
      });
    }

    const row = db.getLeagueStageBoundaries(leagueId);

    if (row.length === 0) {
      return res.json({
        exists: false,
        stageInfo: {
          GroupEndMatchId: null,
          TieBreakerEndMatchId: null
        }
      });
    }
    return res.json({
      exists: true,
      ...row
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load league stage" });
  }
});


router.get('/tiebreakerInfo', async (req, res) => {
  try {
    const leagueId = req.query.leagueId || resolveActiveLeague();

    if (!leagueId) {
      return res.json({
        success: true,
        groups: [],
        tiebreakerTeams: [],
        upperBracketTeams: [],
        lowerBracketTeams: [],
        eliminatedTeams: [],
      });
    }

    const groups = await db.getLeagueLeaderboard(leagueId);

    const groupsWithTeams = await Promise.all(
      groups.map(async (group) => {
        const groupTeams = await db.getGroupStats(group);

        // Ensure teams are sorted correctly
        groupTeams.sort((a, b) => {
          // Sort by Wins DESC
          if (b.Wins !== a.Wins) return b.Wins - a.Wins;
          // Then by Neustadtl DESC (if available)
          return b.Neustadtl - a.Neustadtl;

        });

        // ---- BUCKET LOGIC ----
        const upper = groupTeams.slice(0, 2);        // top 2
        const tiebreaker = groupTeams.slice(2, 3);   // 3rd place → 1 per group
        const lower = groupTeams.slice(3, 8);        // next 5
        const eliminated = groupTeams.slice(8);      // rest

        return {
          ...group,
          groupTeams,
          upperBracket: upper,
          tiebreakerTeams: tiebreaker,
          lowerBracket: lower,
          eliminatedTeams: eliminated,
        };
      })
    );

    // Aggregate tiebreakers (3 teams across all groups)
    const allTiebreakerTeams = groupsWithTeams.flatMap(
      (g) => g.tiebreakerTeams
    );

    const allUpperBracketTeams = groupsWithTeams.flatMap(
      (g) => g.upperBracket
    );

    const allLowerBracketTeams = groupsWithTeams.flatMap(
      (g) => g.lowerBracket
    );

    const allEliminatedTeams = groupsWithTeams.flatMap(
      (g) => g.eliminatedTeams
    );


    return res.json({
      success: true,
      groups: groupsWithTeams,
      tiebreakerTeams: allTiebreakerTeams,
      upperBracketTeams: allUpperBracketTeams,
      lowerBracketTeams: allLowerBracketTeams,
      eliminatedTeams: allEliminatedTeams,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load league stage" });
  }
});


router.get('/tiebreakerMatches', (req, res) => {
  try{

    const leagueId = req.query.leagueId || resolveActiveLeague();

    if (!leagueId) {
      return res.json([]);
    }

    const boundaries = db.getLeagueStageBoundaries(leagueId);

    if (!boundaries || !boundaries[0].GroupEndMatchId) {
      // No tiebreaker stage started yet
      return res.json([]);
    }

    const groupEndMatchId = boundaries[0].GroupEndMatchId;
    const tieBreakerEndMatchId = boundaries[0].TieBreakerEndMatchId ?? 9999999999999;



    const matches = db.getTieBreakerMatches(leagueId,groupEndMatchId,tieBreakerEndMatchId);


    if(matches.length === 0)
      return res.json([]);

    const h2h = {};

    for (const m of matches) {
      const key = `${m.TeamA}-${m.TeamB}`;
      if (!h2h[key]) {
        h2h[key] = {
          TeamA: m.TeamA,
          TeamAName: m.TeamAName,
          TeamB: m.TeamB,
          TeamBName: m.TeamBName,
          WinsA: 0,
          WinsB: 0
        };
      }

      if (m.WinnerId == m.TeamA) h2h[key].WinsA++;
      else if (m.WinnerId == m.TeamB) h2h[key].WinsB++;
    }

    return res.json(Object.values(h2h));

  }
  catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load tiebreaker matches" });
  }
});

router.get('/admin/playoffBracket', (req, res) => {
  try {

    let result = -1;

    const playoff = db.adminGetCurrentPlayoffBracket();

    if(playoff.length === 0){
      //return playoff teams
      result = db.adminGetCurrentPlayoffTeams();

      return res.json({ result });
    }
    else{
      const playoffBracket = JSON.parse(playoff[0].PlayoffStructure);

      return res.json({ playoffBracket });
    }


    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/getCurrentBracket', (req, res) => {
  try {
    const leagueId = req.query.leagueId || resolveActiveLeague();

    if (!leagueId) {
      return res.json({ playoffBracket: null });
    }

    const playoff = db.getPlayoffBracket(leagueId);

    if (!playoff || playoff.length === 0) {
      return res.json({ playoffBracket: null });
    }

    const playoffBracket = JSON.parse(playoff[0].PlayoffStructure);

    return res.json({ playoffBracket });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/admin/saveBracket', (req, res) => {
  try {

    const bracket = req.body.bracketData;

    db.insertBracket(bracket);
 
    return res.json({success : true})

    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
});



router.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) console.error(err);
    res.redirect('/');
  });
});

router.post('/user/request', (req, res) => {
  try {
      const userId = req.body.userId;
      const message = req.body.requestText;

      const result = db.insertRequest(userId,message);
      
      if (!result.success) {

        return res.status(400).json({ error: result.message });
      }
      res.json({ success:true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/search', async (req, res) => {
  const { query } = req.query;

  try{
    const searchRes = await db.search(query); 

    res.json(searchRes);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get('/leagueData', async (req, res) => {
  try {
    const leagues = await db.getLeagueInfo();

    res.json(leagues);
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch leagues' });
    }
});




router.get('/matches/recentMatches', async (req, res) => {
  try {
    // Assuming db has a method to get matches sorted by date descending, limit 10
    const recentMatches = await db.getRecentMatches(10); 

    const matchesWithPlayers = await Promise.all(
      recentMatches.map(async (match) => {
        const players = await db.getMatchPlayerInformation(match.MatchId);
        return {
          ...match,
          players, 
        };
      })
    );

    res.json(matchesWithPlayers);
  } catch (err) {
    console.error('Failed to fetch recent matches', err);
    res.status(500).json({ error: 'Failed to fetch recent matches' });
  }
});

router.get('/matches/:matchId/players', async (req, res) => {
  const { matchId } = req.params;

  try {
    const matchPlayers = await db.getMatchPlayerInformation(matchId);
    if (!matchPlayers) return res.status(404).json({ error: 'Match Player not found' });

    res.json(matchPlayers);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/matches', async (req, res) => {
  const { leagueId } = req.query;

  try {
    // Assuming db has a method to get matches sorted by date descending, limit 10
    const matches = await db.getAllMatches(leagueId); 

    if (!matches) return res.status(404).json({ error: 'Matches not found' });

    const matchesWithPlayers = await Promise.all(
      matches.map(async (match) => {
        const players = await db.getMatchPlayerInformation(match.MatchId);
        return {
          ...match,
          players, 
        };
      })
    );

    res.json(matchesWithPlayers);

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

router.get('/matches/:matchId', async (req, res) => {
  const { matchId } = req.params;

  try {
    const match = await db.getMatch(matchId);
    const matchPlayers = await db.getMatchPlayerInformation(matchId);
    const matchPicksBans = await db.getMatchPickBanInformation(matchId);

    const teamSeasonRad = await db.getTeamSeasonStats(match[0].rad_team_id,match[0].LeagueId);
    const teamSeasonDire = await db.getTeamSeasonStats(match[0].dire_team_id,match[0].LeagueId);

    if (!matchPlayers) return res.status(404).json({ error: 'Match Player not found' });
    
    res.json({
      match,
      matchPlayers,
      matchPicksBans,
      teamSeasonDire,
      teamSeasonRad
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/series/:seriesId', async (req, res) => {
  const { seriesId } = req.params;

  try {
    const series = await db.getSeriesInfo(seriesId);
    const seriesMatches = await db.getSeriesMatches(seriesId);

     const seriesMatchesWithData = await Promise.all(
      seriesMatches.map(async (match) => {
        const matchInfo = await db.getMatch(match.MatchId);
        const matchPlayers = await db.getMatchPlayerInformation(match.MatchId);
        const matchPicksBans = await db.getMatchPickBanInformation(match.MatchId);
        return {
          ...match,
          matchInfo, 
          matchPlayers,
          matchPicksBans
        };
      })
    );

    
    res.json({
      series,
      seriesMatchesWithData
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/players', async (req, res) => {
  const { leagueId } = req.query;

  try {
    const player = await db.getAllPlayers(leagueId);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/h2h/:p1Id/:p2Id', async (req, res) => {
    const { p1Id, p2Id } = req.params;
        console.log( p1Id, p2Id);

    try {
        const p1Raw = await db.getPlayerStats(p1Id); // Using your new return format
        const p2Raw = await db.getPlayerStats(p2Id);
        const matches = await db.getHeadToHeadMatches(p1Id, p2Id);


        console.log(matches);

        const formatStats = (raw) => {
            if (!raw) return { name: "N/A", winrate: 0, kda: 0, gpm: 0, cs: 0, recent: [] };
            
            // Calculate KDA (prevent division by zero)
            const kda = raw.avg_deaths > 0 
                ? ((raw.avg_kills + raw.avg_assists) / raw.avg_deaths).toFixed(2)
                : (raw.avg_kills + raw.avg_assists).toFixed(2);

            return {
                name: raw.PlayerName,
                winrate: raw.games_played > 0 ? Math.round((raw.wins / raw.games_played) * 100) : 0,
                kda: kda,
                gpm: Math.round(raw.avg_gpm || 0),
                cs: Math.round(raw.avg_cs || 0),
                recent: [] // Add your form logic here if available
            };
        };

        res.json({
            p1: formatStats(p1Raw),
            p2: formatStats(p2Raw),
            history: {
                matches: matches || [],
                p1Wins: matches.filter(m => m.P1Won === 1).length,
                p2Wins: matches.filter(m => m.P1Won === 0).length
            }
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.get('/player/:accountId', async (req, res) => {
  const { accountId } = req.params;
  try {
    const playerStats = await db.getPlayerByAccountId(accountId);
    const playerHeroStats = await db.getPlayerHeroesByAccountId(accountId);
    const playerTeamStats = await db.getPlayerDetails(accountId, null);
    const currentLeague = await db.getCurrentLeague()
    const currentLeagueId = currentLeague[0]
    if (!playerStats || !playerHeroStats || !playerTeamStats) return res.status(404).json({ error: 'Player Data not found' });

    res.json({
      playerStats,
      playerHeroStats,
      playerTeamStats,
      ...currentLeagueId
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/playerDashboard/:accountId', async (req, res) => {
  const { accountId } = req.params;
  try {
    const playerStats = await db.getPlayerByAccountId(accountId);
    const playerHeroStats = await db.getPlayerHeroesByAccountId(accountId);
    const playerTeamStats = await db.getPlayerDetails(accountId, null);
    const currentLeagueId = await db.getCurrentLeague();
    const getPlayerSeasonStats =  await db.getPlayerSeasonStatsByAccountId(accountId)
    
    const mostSuccessfulHero = await playerHeroStats.filter(hero => hero.GamesPlayed >= 5 && hero.WinPercentage >= 60).sort((a, b) => a.WinPercentage - b.WinPercentage).pop();
    const mostSuccessfulTeam = await playerTeamStats.sort((a, b) => a.WinPercentage - b.WinPercentage).pop();
    const recentLeagueStats = await playerStats.filter(stat => stat.LeagueId === currentLeagueId[0].LeagueId).slice(0, 5);
    const currentSeasonMSH = await getPlayerSeasonStats.pop() || null

    if (!playerStats || !playerHeroStats || !playerTeamStats) return res.status(404).json({ error: 'Player Data not found' });

    res.json({
      playerStats,
      mostSuccessfulHero,
      mostSuccessfulTeam,
      recentLeagueStats,
      playerTeamStats,
      getPlayerSeasonStats,
      currentSeasonMSH
    });
    } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/players/:playerId/details', async (req, res) => {
  const { playerId } = req.params;
  const { leagueId } = req.query;

  try {
    const player = await db.getPlayerDetails(playerId,leagueId);

    if (!player) return res.status(404).json({ error: 'Player not found' });

    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/hero/:heroId', async (req, res) => {
  const { heroId } = req.params;

  try {
    const hero = await db.getHeroById(heroId);
    const heroPlayerStats = await db.getHeroesPlayerByHeroId(heroId)
    const heroTeamStats = await db.getHeroesTeamByHeroId(heroId)
    const leagueHeroStats = await db.getHeroesLeagueByHeroId(heroId)
    if (!hero) return res.status(404).json({ error: 'Hero not found' });

    res.json({
      hero,
      heroPlayerStats,
      heroTeamStats,
      leagueHeroStats
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/heroes', async (req, res) => {
  try {
    const hero = await db.getHeroes();


    if (!hero) return res.status(404).json({ error: 'Hero not found' });

    res.json(
      hero
    );
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teams', async (req, res) => {
  const { leagueId } = req.query;


  try {
    const teams = await db.getAllTeams(leagueId);

    if (!teams) return res.status(404).json({ error: 'Team not found' });
    
    res.json({
      teams
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/activeTeams', async (req, res) => {
  try {
    const teams = await db.getActiveTeams();

    if (!teams) return res.status(404).json({ error: 'Teams not found' });
    
    res.json({
      teams
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/matchEdit/:matchId', async (req, res) => {
  const { matchId } = req.params;
  try {
    const matchTeams = await db.getTeamsMatchEdit(matchId);

    if (!matchTeams) return res.status(404).json({ error: 'Teams not found' });
    
    res.json({
      team1: { TeamId: matchTeams[0].TeamRad, TeamName:  matchTeams[0].RadTeamName },
      team2: { TeamId:  matchTeams[0].TeamDire, TeamName:  matchTeams[0].DireTeamName },
      winner: { TeamId:  matchTeams[0].WinnerId, TeamName:  matchTeams[0].WinnerTeamName }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teams/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { leagueId } = req.query;


  try {
    const teamName = await db.getTeamInfo(teamId);
    const teamMatches = await db.getTeamRecentMatches(teamId, leagueId);
    const teamLeagues = await db.getLeaguesByTeam(teamId);
    const teamHeroes = await db.getTeamHeroData(teamId, leagueId);

    if (!teamMatches) return res.status(404).json({ error: 'Team not found' });
    
    res.json({
      teamName,
      teamMatches,
      teamLeagues,
      teamHeroes
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});



router.get('/teams/:teamId/players', async (req, res) => {
  const { teamId } = req.params;
  const { leagueId } = req.query;

  try {
    const teamPlayerStats = await db.getTeamPlayerStats(teamId,leagueId);

    if (!teamPlayerStats) return res.status(404).json({ error: 'Players not found' });

    const heroesWithPlayers = await Promise.all(
      teamPlayerStats.map(async (player) => {
        const heroes = await db.getPlayerHeroHighlights(player.PlayerId, leagueId);
        return {
          ...player,
          heroes, 
        };
      })
    );

    res.json(heroesWithPlayers);

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/leagues', async (req, res) => {

  try {
    const leagues = await db.getLeagues();

    if (!leagues) return res.status(404).json({ error: 'Leagues not found' });

    res.json(leagues);

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/leagues/:leagueId', async (req, res) => {
  const { leagueId } = req.params;

  try {
    const league = await db.getLeagueData(leagueId);
    const players = await db.getLeaguePlayerData(leagueId);
    const teams = await db.getAllTeams(leagueId);
    const matches = await db.getLeagueMatchesData(leagueId);
    const heroes = await db.getLeagueHeroData(leagueId);

    const matchesWithPlayers = await Promise.all(
      matches.map(async (match) => {
        const matchPlayers = await db.getMatchPlayerInformation(match.MatchId);
        return {
          ...match,
          matchPlayers, 
        };
      })
    );
    const heroesWithPlayers = await Promise.all(
      heroes.map(async (hero) => {
        const heroPlayers = await db.getHeroPlayerInfo(hero.HeroId, leagueId);
        return {
          ...hero,
          heroPlayers, 
        };
      })
    );

    if (!league || !players || !matches || !teams || !heroesWithPlayers) return res.status(404).json({ error: 'League Data not found' });

    res.json({
      league,
      teams,
      players,
      matchesWithPlayers,
      heroesWithPlayers
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/homepageSeries', async (req, res) => {

  try {
    const leagueId = req.query.leagueId || resolveActiveLeague();

    if (!leagueId) {
      return res.json([]);
    }

    const series = await db.getLeagueSeriesGroupstage(leagueId);

    const seriesWithMatches = await Promise.all(
      series.map(async (series) => {
        const seriesMatches = await db.getSeriesMatches(series.SeriesId);
        return {
          ...series,
          seriesMatches, 
        };
      })
    );

    if (!series) return res.status(404).json({ error: 'Series not found' });

    res.json(seriesWithMatches);

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/currentLeaderboard', async (req, res) => {

  try {
    const leagueId = req.query.leagueId || resolveActiveLeague();

    if (!leagueId) {
      return res.json([]);
    }

    const groups = await db.getLeagueLeaderboard(leagueId);

    const groupsWithTeams = await Promise.all(
      groups.map(async (group) => {
        const groupTeams = await db.getGroupStats(group);
        const groupH2H = await db.getHeadToHeadStats(group);
        return {
          ...group,
          groupTeams, 
          groupH2H
        };
      })
    );



    if (!groupsWithTeams) return res.status(404).json({ error: 'Groups and teams not found' });

    res.json(groupsWithTeams);

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/markets', async (req, res) => {
    const activeMarkets = dbBet.getActiveMarkets(); 

    const activeMarketsWithOptions = await Promise.all(
      activeMarkets.map(async(market) => {
        const options = dbBet.getOptions(market.id)
        const pools = dbBet.getPools(market.id);
        return {
          ...market,
          options,
          pools
        }
      })
    )
    res.status(200).json(activeMarketsWithOptions);
})

router.get('/bettingLeaderboard', async (req, res) => {
    const leaderboard = dbBet.getPlayerLeaderboard(); 

    const leaderboardWithNames = await Promise.all(
      leaderboard.map(async(row) => {
        const player = db.getPlayerInfo(row.user_id)
        const name = player[0].PlayerName
        return {
          ...row,
          name
        }
      })
    )
    res.status(200).json(leaderboardWithNames);
})

router.get('/wallet/:userId', async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
          return res.status(400).json({ success: false, message: "User ID is required." });
      }
      
      // Assume getWalletBalance queries the UserWallets table
      const walletData = dbBet.getWalletBalance(userId); 

      if (walletData) {
          return res.status(200).json(walletData);
      } else {
          // This should rarely happen if login is handled correctly, but good to guard against.
          return res.status(404).json({ success: false, message: "Wallet not found. User may not exist." });
      }
})

router.get('/bets/:userId', async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
          return res.status(400).json({ success: false, message: "User ID is required." });
      }
      
      // Assume getWalletBalance queries the UserWallets table
      const betData = dbBet.getBets(userId); 

      console.log(betData)

      if (betData) {
          return res.status(200).json(betData);
      } else {
          // This should rarely happen if login is handled correctly, but good to guard against.
          return res.status(404).json({ success: false, message: "Bets not found." });
      }
})

router.post('/parlay', async (req, res) => {
    const { user, totalWager, betLegs } = req.body;

    
    // 1. Basic Input Validation
    if (!user || !totalWager || totalWager <= 0 || !betLegs || betLegs.length === 0) {
        return res.status(400).json({ success: false, message: "Invalid bet payload: Missing user, wager, or legs." });
    }
    
    // 2. Execute the Core Transaction Logic
    // This function will handle all database reads, writes, and validation inside a single transaction.
    const result = dbBet.placeParlayBet(user.accountId, totalWager, betLegs);

    if (result.success) {
        // HTTP 201 Created is appropriate for a new ticket
        return res.status(201).json({ 
            success: true, 
            ticketId: result.ticketId, 
            message: "Bet placed successfully.",
            finalOdds: result.finalOdds,
        });
    } else {
        // If the transaction failed due to validation (e.g., wallet insufficient, market locked)
        return res.status(400).json({ success: false, message: result.message });
    }
});

export default router;
