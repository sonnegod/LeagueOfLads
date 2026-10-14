# League of Lads

## Run locally

Use Node.js 22.12+ and npm (the current Vite client requires Node 20.19+ or 22.12+).
Run these commands from the repository root. SQLiteStudio is optional if you want
to inspect the databases. The root `package.json` still lists Node 16; that
engine field is outdated for the current client.

1. Clone the repository (or use your existing checkout), change into it, and
   install both sets of dependencies:

   ```bash
   git clone https://github.com/sonnegod/LeagueOfLads.git
   cd LeagueOfLads
   npm install
   npm --prefix client install
   ```

2. Copy `.env.example` to `.env` in the repository root (unless you already have
   a `.env`), then replace the Steam API key placeholder with a development key
   from a maintainer. Do not commit `.env`. The key lets the Steam login strategy
   fetch the signed-in user's Steam profile after authentication; the example
   ports match the Vite API proxy and Steam login callback.

3. Populate `db/` from the backups as described below **before** starting the
   server. `ENVIRONMENT=DEV` selects the local database paths; without it the code
   uses production paths. SQLite can create missing local files as empty databases,
   so do not mistake those for restored data.

4. Start the API and Vite client together:

   ```bash
   npm run dev
   ```

   Open <http://localhost:5173>. The API runs on port 3000, and Vite proxies
   `/api` requests to it. On Windows PowerShell, use `npm.cmd` in place of `npm`
   if execution policy blocks `npm.ps1`.

## Restore backup databases for local use

The timestamped files in `backups/` are SQLite-safe snapshots, not the live paths
used by the app. Create `db/`, then **copy** the newest backup for each available
database to the corresponding filename below. Leave the originals in `backups/`.

| Backup folder | Local file required by the app |
| --- | --- |
| `backups/LadsData/` | `db/LadsData.db` |
| `backups/public/` | `db/public.db` |
| `backups/Betting/` | `db/Betting.db` |

The Betting database is stale, and this checkout does not include a current
Betting backup. Ask a maintainer for an up-to-date copy if you need betting data.
If a local database already exists, stop the server and preserve it before
replacing it. Local copies in `db/` are git-ignored.

Finalized signup rosters are stored in `TeamRosterPlayers` when a league starts.
Server startup creates this table and fills it from submissions for leagues that
have already started. Membership is tied to the signup team's stable ID; linking,
correcting, or unlinking its Dota Team ID resolves the same roster through
`SeasonTeams.ExternalTeamId`. Players absent from that roster are counted as
stand-ins for matches in that league. Teams without signup rosters remain
unclassified for stand-in counts. Active roster cards show finalized signups;
historical match lineups remain available in roster history. No separate roster
migration command is required. `TeamRosterPeriods` records each signup roster's effective start and
end dates. New dates are captured at league start/end; older start dates are
estimated from the first recorded league match where available. The team page's
expandable roster history also groups observed match lineups for leagues without
declared signup rosters; those observations do not change stand-in classification.

## Analytics

Build the private derived database with `npm run analytics:build` and inspect its
safe status with `npm run analytics:status`. Admin → League → Overview includes
an Analytics status card with automatic highlight previews and hide/edit/pause
controls. Builds publish league highlights and daily/weekly recaps; the homepage
shows the public feed when signup-era content exists. Deployment and the nightly league wrapper run the
build automatically, including between active leagues. See
[analytics/README.md](analytics/README.md) for source freshness, signup-era scope,
private inputs, deployment, and automatic highlights.

## Betting

The replacement sportsbook is available at `/betting`, with setup and schedules
under **Admin → League → Betting**. Run `npm run betting:init`, then
`npm run betting:refresh` and `npm run betting:status`. Migrations are additive;
old tickets and wallets remain in a separate legacy account. Eligible models
publish automatically; insufficient signup-era history or stale sources hold
new prices. See [betting/README.md](betting/README.md) for setup, market types,
verified result links, deployment, and Discord scheduling.

COMMANDS FOR THE SERVER
---
sudo nano /etc/nginx/sites-enabled/dotawebsite
sudo nginx -t
sudo systemctl reload nginx

cd client
npm run build
sudo cp -r dist/* /var/www/leagueoflads/

crontab -l


cd .. 
pm2 start /root/LeagueOfLads/index.js --name LeagueOfLads
mkdir -p /root/LeagueOfLads/Logs/LiveMatches
pm2 start /root/LeagueOfLads/pollLiveMatchData.js \
  --name dota-live-poller \
  --output /root/LeagueOfLads/Logs/LiveMatches/output.log \
  --error /root/LeagueOfLads/Logs/LiveMatches/error.log \
  --time

# One-time PM2 log rotation setup
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
----

FOR UPDATING SeriesInfo when the job doesnt catch all matches
----
1. Find the Duplicate series with only one match id
2. UPDATE SeriesMatch set SeriesId = 49 WHERE SeriesId = 51
3. DELETE FROM Series Info where SeriesId = ^
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
