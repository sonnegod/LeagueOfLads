To set up:
1. Clone the repository
2. Download SQLITE Studio for ui for the flat file
3. Add the database (choose the LadsData.db)
4. LadsDataProd.db will be considered the official record of data and should not be modified, it will be occasionally pushed to by the server

COMMANDS FOR THE SERVER
---
sudo nano /etc/nginx/sites-available/dotawebsite
sudo nginx -t
sudo systemctl reload nginx

sudo cp -r dist/* /var/www/leagueoflads/

pm2 start /root/LeagueOfLads/index.js --name LeagueOfLads
----


FOR UPDATING LEAGUE STANDINGS IF MESSED UP
-----
DELETE FROM LeagueStandings where LeagueId = 18664

-- Wins
INSERT INTO LeagueStandings (LeagueId, TeamId, Wins, Losses)
SELECT ml.LeagueId, mt.WinnerId, 1, 0
FROM MatchLeague ml
JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
LEFT JOIN LeagueStageBoundaries bm
  ON ml.LeagueId = bm.LeagueId
WHERE (bm.GroupEndMatchId IS NULL OR ml.MatchId <= bm.GroupEndMatchId)
  AND mt.WinnerId IS NOT NULL
  AND ml.LeagueId = 18664
ON CONFLICT(LeagueId, TeamId)
DO UPDATE SET Wins = Wins + 1;

-- Losses
INSERT INTO LeagueStandings (LeagueId, TeamId, Wins, Losses)
SELECT 
    ml.LeagueId,
    CASE WHEN mt.WinnerId = mt.TeamRad THEN mt.TeamDire ELSE mt.TeamRad END AS TeamId,
    0,
    1
FROM MatchLeague ml
JOIN MatchTeam mt ON ml.MatchId = mt.MatchId
LEFT JOIN LeagueStageBoundaries bm
  ON ml.LeagueId = bm.LeagueId
WHERE (bm.GroupEndMatchId IS NULL OR ml.MatchId <= bm.GroupEndMatchId)
  AND mt.WinnerId IS NOT NULL
    AND ml.LeagueId = 18664
ON CONFLICT(LeagueId, TeamId)
DO UPDATE SET Losses = Losses + 1;
-----