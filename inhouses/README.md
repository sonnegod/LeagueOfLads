# Inhouses

The player-facing page is `/inhouses`, currently **admin preview only**. The
navigation link and badges are shown only to existing league admins; non-admin
visitors are redirected home. Every player-facing API and SSE endpoint also
uses the existing server admin check, and non-admin browsers do not connect to
the activity feed. Deploying this version does not open public participation.
The existing Admin page has a primary
**Inhouses** tab with Settings, Queue & Games, and Activity sections.

The page separates Lobby, Standings, History, and Player Settings. Preview admins get an
optional role setup popup on their first visit; saving or skipping is remembered
per account. Skipping a new profile leaves it flexible for any position, without
a ranked preference. Settings remain editable until the player is reserved.

Selected players switch into a focused lobby view for ready check, draft,
launch, and play. Queue/waiting cards and the general history/standings return
after completion or cancellation. Ready checks are shown only to their selected
players on the public page; the admin operational view remains available.

Signing out removes a player's waiting entry through either logout URL. Ready,
drafting, and playing reservations remain protected. The sidebar's Inhouses
count bubble shows the waiting players' names on hover, focus, or touch. Its
live updates use the shared `/api/inhouses/activity/stream` SSE endpoint, not a
Steam request. Signing out removes the admin-only link and closes the stream.

## Storage and isolation

All tables use the `Inhouse` prefix in `LadsData.db`. The web app and worker
initialize these tables additively; neither imports inhouse games into the
official league match tables. The existing daily LadsData backup includes them.
There is no additional backup job or nightly inhouse import.

The worker opens the database directly. It does not import `database.js`, preload
league history, run Analytics, or start betting refreshes. Admin inhouse routes
are mounted before the general betting mutation hook.

## Local development

Restore the normal development database and configure `ENVIRONMENT=DEV` and the
existing `STEAM_API_KEY` in `.env`. No new dependency or bot account is needed.

```bash
npm run inhouses:init
npm run dev
```

In a separate terminal, start the worker:

```bash
npm run inhouses:worker
```

On PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`. Use the
Settings section in Admin > Inhouses to enter the shared ticket ID and choose
queue mode, draft mode, and launch window. Queueing is unavailable until the
ticket is configured. The worker is required for unattended deadlines, automatic
picks, match linking, and resolution.

To run one worker pass without leaving a process running:

```bash
node scripts/inhouses/run.js --once
```

## Production rollout

1. Deploy the code and client build through the existing deployment workflow.
   Keep the server's existing HTTPS/session configuration. Startup creates only
   the additive inhouse tables; no historical backfill is needed.
2. On the server, register the separate worker once:

   ```bash
   cd /root/LeagueOfLads
   npm run inhouses:init
   pm2 start scripts/inhouses/run.js --name inhouse-worker --cwd /root/LeagueOfLads --kill-timeout 10000
   pm2 save
   ```

3. In **Admin > Inhouses > Settings**, configure the actual dedicated inhouse
   ticket ID. There is one shared setting for every queue and draft mode. Existing
   inhouses retain their saved ticket/settings if this configuration changes.
   IDs already recorded as official league/season tickets are rejected so the
   overnight league importer cannot also treat these inhouses as season games.
4. Check **Queue & Games** for the worker heartbeat and source messages. Use
   `pm2 logs inhouse-worker --lines 60` for process errors. The normal deployment
   already restarts registered PM2 processes; do not add this worker to cron.
5. Before opening participation generally, play a controlled game under the
   configured ticket. Verify all ten account IDs and sides are discoverable,
   automatic linking occurs within the launch window, and a confirmed outcome
   releases reservations and updates ratings exactly once. Real ticket/API
   verification cannot be replaced by the local mocked tests.

## Processing behavior

- Local maintenance runs every second, including while Steam requests await a
  response. It advances 60-second ready checks and draft turns.
- Steam discovery runs approximately every ten seconds when games are pending.
  Linked results are requested at most every fifteen seconds per game. There
  are no Steam requests while there are no games awaiting play or resolution.
- Requests in each client are serialized with at least one second between
  starts and an eight-second network timeout. Each discovery pass has a work
  budget so a busy ticket does not create an unbounded loop.
- A database lease prevents two worker instances from operating simultaneously.
  SIGINT/SIGTERM abort pending requests and release that lease. Transactions and
  unique constraints independently protect reservations, picks, and match links.
- Live discovery uses `GetLiveLeagueGames`; recent league history recovers games
  missed during a restart; `GetMatchDetails` supplies confirmed results. Account
  IDs, ticket, team membership, and available start times are verified. Endpoint
  parameters are listed in the [extracted Steam API definitions](https://github.com/SteamTracking/SteamTracking/blob/master/API/IDOTA2Match_570.json).
- Missing live data does not prove a game ended. Short results below five minutes
  are held unrated as possible draft-only remakes; admins can cancel the inhouse
  or correct its link to the replacement game. Incomplete identities or unknown
  outcomes also remain unresolved. Full match statistics are not required.
- Unlinked games cancel after the configured launch window (15 minutes by
  default). Discovery gets a final attempt before deadline cancellation. Linked
  games are not cancelled by that launch timeout.
- Ratings use 1,000 starting points, team-average Elo with a 400-point scale,
  individual K=48 for the first five rated calibration games and K=24 afterward. Ratings are
  stored as SQLite REAL values; rounding is for display. No private MMR is used.
- Ordinary results append small rating updates. Corrections or out-of-order
  results replay the outcome ledger ordered by start time, match ID, and inhouse
  ID, updating later expectations and calibration counts atomically. Historical
  rosters, captain choices, and drafts stay unchanged.

The frontend subscribes to `/api/inhouses/stream`. The web process checks the
database revision once per second while viewers are connected and fans out a
shared snapshot when it changes. Nginx buffering is disabled by the SSE response
header. Browsers fall back to non-overlapping three-second reads on stream
failure, pause while hidden, and resynchronize on return. Standings searching,
sorting, and pagination use the already-loaded list.

The page tabs are Lobby, Standings, History, and Player Settings. Lobby shows
queueing and active games; completed/cancelled games and their details live in
History. Tab and historical game selection persist in the URL. Reserved players
remain focused on their assigned lobby until it completes or is cancelled.

The sidebar queue bubble uses `/api/inhouses/activity/stream`. Changes made by
the web process publish immediately after commit; changes from the separate
worker are checked every 500 ms while subscribers are connected. The same
connection carries private chat for the participant's current lobby, so adding
chat does not create a separate connection per component. Reconnects restore
the latest queue and 100 messages, with a polling fallback during interruptions.

Beside the queued-player badge, a green gamepad badge counts active inhouses
(ready check, draft, waiting to start, or playing). Its hover panel lists each
game's stage and player count. Both panels show the combined player pool:
queued players plus players reserved in active lobbies. Completed/cancelled
games leave these counts automatically. This summary uses the same activity
stream without another connection or worker.

Lobby chat appears below the assigned game from ready check through play.
Only its ten participants can read or send messages. Messages use the stored
player name and plain text (up to 500 characters); Enter sends and Shift+Enter
adds a line. Five messages per ten seconds per player are allowed, and retried
sends use an idempotent client identifier. Completed/cancelled lobbies reject
new messages. `InhouseChat` stores messages in the existing LadsData database,
covered by its existing backup. Chat writes do not invalidate full game or
standings snapshots. The additive table is created automatically at startup;
no new service or scheduled job is required.

## Verification

```bash
npm run test:inhouses
npm --prefix client run build
```

The regression suite uses isolated databases and mocked Steam responses. It
covers role selection, FIFO, waiting priority, balancing, draft authorization,
timeouts, durable reservations, concurrent claims, simultaneous games, reversed
sides, result delays, exactly-once ratings, corrections, API authorization, and
SSE updates. One-off browser checks remain in ignored `.scratch/`.
