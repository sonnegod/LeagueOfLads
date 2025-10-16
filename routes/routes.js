import express from 'express';
import passport from 'passport';

import { checkAdmin } from '../middleware/checkAdmin.js';

import db from '../database.js';


import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

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
    console.log(result);
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

router.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) console.error(err);
    res.redirect('/');
  });
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

router.get('/player/:accountId', async (req, res) => {
  const { accountId } = req.params;
  try {
    const playerStats = await db.getPlayerByAccountId(accountId);
    const playerHeroStats = await db.getPlayerHeroesByAccountId(accountId);
    const playerTeamStats = await db.getPlayerDetails(accountId, null);

    if (!playerStats || !playerHeroStats || !playerTeamStats) return res.status(404).json({ error: 'Player Data not found' });

    res.json({
      playerStats,
      playerHeroStats,
      playerTeamStats
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
    
    const mostSuccessfulHero = await playerHeroStats.filter(hero => hero.GamesPlayed >= 3 && hero.WinPercentage >= 60).sort((a, b) => a.WinPercentage - b.WinPercentage).pop();
    const mostSuccessfulTeam = await playerTeamStats.sort((a, b) => a.WinPercentage - b.WinPercentage).pop();
    const recentLeagueStats = await playerStats.filter(stat => stat.LeagueId === currentLeagueId).slice(0, 5);
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
    const series = await db.getCurrentLeagueSeries();

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
    const groups = await db.getCurrentLeagueLeaderboard();

    const groupsWithTeams = await Promise.all(
      groups.map(async (group) => {
        const groupTeams = await db.getGroupStats(group);
        return {
          ...group,
          groupTeams, 
        };
      })
    );



    if (!groupsWithTeams) return res.status(404).json({ error: 'Groups and teams not found' });

    res.json(groupsWithTeams);

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
