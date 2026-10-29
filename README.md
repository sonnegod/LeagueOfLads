# League of Lads

## Run locally

Use Node.js 22.12+ and npm (the current Vite client requires Node 20.19+ or 22.12+).
Run these commands from the repository root. SQLiteStudio is optional if you want
to inspect the databases. The pinned database driver includes SQLite's WAL
concurrency fix; run `npm install` after updating the checkout.

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

3. Populate `db/` from the backup databases as described below **before** starting the
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

Database backups are distributed separately from Git. Obtain the current
sanitized LadsData backup from a maintainer, decompress it if supplied as
`.db.gz`, and copy it from `backups/LadsData/` to `db/LadsData.db`. Create `db/`
if needed, stop the app, and preserve any existing database before replacing it.
See [backups/README.md](backups/README.md) for backup details.

Betting and Analytics databases do not need to be included in the backup. With
`ENVIRONMENT=DEV` configured in `.env`, initialize them locally:

```bash
npm run betting:init
npm run analytics:init
```

Run `npm run analytics:build` to populate derived analytics from the available
data. Public-match data is separate: restore a suitable public database to
`db/public.db` if needed. The current creation script creates only LadsData;
there is no bundled initializer for the base public database schema.

The sanitized LadsData backup retains match history and public rosters but removes
private signup MMR/screenshots, account activity and production permissions.
Developers must configure their own admin access. Local databases and backups
are ignored by Git.

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
shows the public feed when signup-era content exists. The nightly league wrapper
builds automatically, including between active leagues; admin refreshes can build
immediately. Deployments preserve the existing derived data. See
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
## Inhouses

Inhouses is currently an admin-only preview at `/inhouses`; public access is closed.
Admins configure the shared ticket and queue rules under the primary
**Inhouses** admin tab. A separate worker handles deadlines, match discovery,
and automatic win/loss resolution; no nightly import is needed.

See [inhouses/README.md](inhouses/README.md) for local setup, the one-time PM2
registration, production ticket verification, and tests.

## Suggested regular season matchups

Active league qualification rules are edited in **Admin → League → Settings →
Initial group setup → Edit rules**. Assign each finishing position once for all groups to upper, lower,
eliminated or a named tiebreaker pool. Pools combine selected rows across groups
and define their BO1/BO3 format and advancement counts. Standings and preseason
Betting use the same saved plan; historical seasons retain their existing rules.

Starting tiebreakers freezes each pool's entrants and rules. The league's
Tiebreakers tab has a separate subtab for each pool's standings and head-to-head
results. In League stages, review the completed results and confirm any tied
qualification cutoffs before starting playoffs. Closing tiebreakers saves the
final placements and supplies the bracket editor's upper/lower team pools.

Once a league starts, admins can open **Admin > League > Schedule** to set the first
window's date and the pace of play. The default is **3 series per team every 2 weeks**;
both counts are configurable. Save the pace, then randomize a single round robin
within each group, or add and edit individual pairings and their window numbers.
Leaving a team or opponent on Random selects an unused in-group pairing, favoring
teams with fewer suggestions in that window. Re-randomizing asks for confirmation
because it replaces the existing suggestions, including manual edits.
After changing the pace, save it and choose **Re-slot matchups** to redistribute
the existing pairings in their current order within each group. This keeps IDs
and opponents, including manual pairings. Small remainders go into the last
window: at four series per window, groups of 9/9/10 get 4+4, 4+4, and 4+5 series
per team. Complete windows are chosen close to the requested pace; larger
remainders can form a separate final window.

This is a pacing guide. Teams may play off-schedule opponents, early, or late;
suggestions do not restrict match ingestion or affect results and standings. Manual
plans can exceed the series target; the editor shows advisory workload notes.
Odd-sized groups can have byes, and final windows can contain more or fewer
series. Re-slotting preserves existing order, so manually arranged plans can
still have uneven loads; check the per-team counts and advisory notes.
Teams can find their assignments on the league page's **Schedule** tab and filter by
group or team. The Schedule tab is shown only while the league is active.
Signed-in players default to their confirmed current team. Players without one
unambiguous roster and guests see All teams. Selecting a single team shows compact
window cards with its opponents; All teams keeps the full matchup tables. The
public response includes only the viewer's matching entry ID and cannot be
shared-cached. Admin schedule editing still starts with All teams.

Server startup creates `SeasonScheduleSettings` and `SeasonMatchups` automatically
inside `LadsData.db`. Suggestions use stable `LeagueRosterEntries.EntryId` values,
so teams do not need a linked Dota Team ID before planning. No separate database
upload, migration command, or scheduled job is required. Public schedule JSON is at
`GET /api/leagues/:leagueId/schedule`; edits use the existing admin authorization.

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

Live matches use the existing `dota-live-poller` and web PM2 processes. The poller
targets five seconds between Steam request starts, including request time, and
never overlaps requests. After a successful poll is saved, it notifies the web
process through a local IPC socket. Linux uses `db/live-updates.sock` with mode
`0600`; Windows development uses a project-specific named pipe. The web process
creates the channel automatically. Both processes must run under the same OS user.
No new cron job, service, port, secret, or environment variable is required.

On the visible Live Matches page, one SSE connection at
`/api/liveMatches/stream` supplies both the cards and navbar badge. A full state is
sent on connection/reconnection and whenever match data changes. Unchanged Steam
polls send only observation timestamps, and heartbeats run every 15 seconds.
Disconnected and slow viewers are removed rather than accumulating buffered data.
If streaming is unavailable, the browser checks saved state every two seconds and
stops polling once streaming recovers. A watchdog also detects buffered/stalled
streams. Leaving the live page or hiding the tab closes the connection. The navbar
uses its lightweight count endpoint every five seconds on other pages.

Recent matches refresh separately every 30 seconds and when a live match
disappears. Timeline history loads when opened, then requests only snapshots newer
than its saved cursor. Background requests pause in hidden tabs. Live and app
endpoints send `Cache-Control: no-store`.

Cards distinguish when game data changed from when Steam last returned the match.
Unchanged upstream data will not advance the displayed game clock. A failed
request retains the last good card and retries automatically. Invalid Steam
responses do not prune matches; valid omissions retain the two-minute grace period.
Deploy through the normal workflow, which restarts both PM2 processes and creates
the snapshot lookup index at startup. No manual analytics refresh is needed.
The stream sends `X-Accel-Buffering: no` to disable standard Nginx proxy buffering,
and heartbeats keep the connection active. A custom proxy configuration that
ignores this header must disable buffering for `/api/liveMatches/stream`.
Verify `Live match push channel ready.` in the web logs and inspect
`curl -N https://www.leagueoflads.com/api/liveMatches/stream` for an initial `state`
event followed by updates or heartbeats (Ctrl+C to disconnect).
`node --test tests/liveMatches.test.js tests/liveMatchPush.test.js` exercises the
live reads, worker notification, stream fanout, reconnect state, and cleanup.

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

# Site management analytics

Site Management is separate from league administration and currently allows only Steam account
`49219700`. It reports real first-party public usage and aggregate API health. No Google Analytics
or external analytics service is needed.

- Collection defaults to **on in `ENVIRONMENT=PROD`**, and **off in development**. Override with
  `SITE_ANALYTICS_ENABLED=true` or `false` in the server `.env`, then restart the server.
- The server automatically creates `db/SiteAnalytics.db` and its schema. No migration, upload,
  historical import, or nightly analytics job is needed. Keep this file between deployments.
- For local testing, set `SITE_ANALYTICS_ENABLED=true`, restart, and browse public pages in a separate
  signed-out browser. Open Site Management as account `49219700` and click **Refresh**. Signed-in
  league admins and site managers are excluded from public usage counts, including on localhost.
- Visits mean anonymous browsers, not verified people. Navigation is counted once per route change;
  API polling is counted only in API health. Known bots, browser DNT/GPC signals, admin previews,
  and the Privacy Policy browser opt-out are excluded from public usage collection.
- Page IDs, account IDs, full URLs, query text, raw referral URLs, IP addresses, and form contents
  are not saved in this database. A hashed first-party browser identifier supports distinct counts.
  Daily records expire after 90 days. Normal session and league databases remain separate.
- Referral attribution uses the first source per browser in the selected period. Add
  `?utm_source=discord` to announcement links because Discord often sends no referral header.
- Signup stages count distinct browsers across seasons within the selected period. Submission is
  recorded only after a successful public signup API response; later stages imply earlier stages.
  Returning visitors have activity on an earlier calendar day. API error rate includes both 4xx and
  5xx. Approximate p95 uses latency bucket upper bounds, not client rendering or network time.
- API metrics are buffered for 15 seconds and flushed when the report is read. A forced process
  termination can lose the last buffer. No requests or browsing histories are stored individually.
- The existing `scripts/db/backupDatabases.sh all` also backs up SiteAnalytics when present; use
  `./scripts/db/backupDatabases.sh SiteAnalytics` for just this database. The standard backup
  retention is three days, so expired usage may remain in a backup until it expires too.
