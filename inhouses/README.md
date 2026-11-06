# Inhouses

The Admin page has an Inhouses primary tab for Settings, Queue & Games,
and Activity. The **Inhouses** control at the right of its secondary tab bar
sets availability to one of three modes:

- **Closed:** stop new queue joins and tests, release waiting players, hide the
  player-facing navigation and block its data endpoints, including for admins
  and players with past games. Admin management controls remain available.
- **Admin testing:** keep the page and new queue participation private to admins.
- **Open to players:** allow everyone to browse. Queueing requires a vouch,
  community manager status, or admin status.

New installations and upgrades default to **Admin testing**. Availability is
saved independently of ticket and queue settings, so admins can close inhouses
even before configuring a ticket. Switching to Closed or Admin testing clears
the waiting queue; already reserved games continue through completion or
cancellation. Their players retain access to their own active lobby; once a
game finishes while Closed, access ends until inhouses reopen. Existing browser
connections close when their access ends. Bots stay
connected and idle between games; the worker does not need to be stopped.

## Community managers and vouching

Admins automatically inherit community manager and queue permissions from the
existing `Admins` table; no duplicate manager or vouch record is needed. Under
**Admin → Inhouses → Community Managers**, any admin can search users by name or
Dota account ID and add/remove designated community managers. An account ID can
also be added before its first site login. Managers cannot assign other managers,
change inhouse settings, start admin tests, or use admin recovery controls.

Admins and community managers have a **Vouching** tab on `/inhouses`, including
when the player queue is closed or limited to admin testing. Its two independently
searchable, paginated lists show vouched/automatically eligible players and players
who still need a vouch. Search accepts names or Dota account IDs; numeric IDs can
be vouched before login. Admin and manager rows identify inherited access and
cannot be removed through the vouch list. Admin testing still restricts new queue
joins to admins; the manager role does not bypass the availability setting.

Signing in, saving preferences, or having previous inhouse games does not grant
queue access. Existing players are not automatically vouched during upgrade.
Removing a vouch or a manager role removes an otherwise ineligible waiting player
from the queue immediately. Reserved/playing games continue, but a revoked player
cannot rejoin or be automatically requeued after an expired ready check. An
independent vouch survives losing the manager role.

Changes record their actor and target in the inhouse audit. Audit details
preserve their names at the time of the change, alongside account
IDs; the Activity view describes vouches, removals, manager roles, and availability
changes with those names. Older entries resolve names from available player data.
Unvouched players can browse open inhouses, standings, history, and player settings;
only the queue-entry controls have a grey vouch-required overlay.

The additive
`InhouseCommunityManagers`, `InhouseVouches`, and `InhouseAccessMeta` tables are
created on normal startup. Manager pages receive access-list revisions through a
dedicated SSE channel, with polling fallback. All open manager pages refresh their
current search/page after edits; new connections receive current permissions.
Existing connections lose management access after demotion, including external
admin-role changes. Unrelated bot heartbeats do not reload the manager lists.

## Five-bot workflow

Every new inhouse is hosted by one of five dedicated Steam accounts. One
account stays assigned from ready check through lobby cleanup. All five use
the same configurable inhouse ticket.

1. Vouched players, community managers, and admins sign in, save preferred
   positions, and join the solo queue when availability permits.
2. The server atomically reserves the selected players and an online bot. If
   every bot is busy or offline, players keep waiting in the queue.
3. Players confirm the 60-second ready check. Teams are either automatically
   balanced or chosen by the two captains using the configured draft rules.
   After teams are formed, a randomly selected captain chooses Radiant/Dire or
   first/second pick for the **Dota Captain's Mode hero draft**. The other
   captain then chooses the remaining category; each choice has a 60-second
   timer with automatic selection on expiry. The website player-draft order
   stays unchanged. All Pick offers side choice only. The bot uses the saved
   side/pick order when it prepares the Dota lobby.
4. The bot creates a public, password-protected Dota lobby with the saved
   ticket, game mode and region, moves itself out of the playing teams, and
   invites the selected accounts using their Dota player IDs.
   Once Dota confirms the owned lobby is configured and ready, the bot starts
   the saved join window (15 minutes by default). It publishes the start time
   and deadline to the site, which displays the countdown through SSE. Setup
   delays do not consume join time; reconnecting does not reset the deadline.
5. Players accept the invitation and join their assigned side:
   Radiant/Dire follows the captains' saved choices, shown on each team card.
   The bot removes outsiders and unseats
   players who occupy the wrong team. Any slot on the correct side is accepted.
   While the lobby is ready and waiting, participants can click **Ask bot to
   reinvite me** on their game card. Requests go to the assigned bot and are
   limited to one per player every 30 seconds; players already present need no
   additional invitation. The join deadline does not reset.
   Missing players are reinvited at most every 30 seconds. It starts only after
   the full roster is correct.
   The bot announces the join window in Dota lobby chat, greets arriving
   players by their site names with their assigned side, and reminds players
   who choose the wrong team. Messages are batched and paced; a chat outage
   never holds a complete roster indefinitely or changes its assigned teams.
6. That same bot tracks the lobby's match ID and explicit win/loss outcome
   through Dota's Game Coordinator. The server records ratings exactly once
   and releases the players. **Players click Join queue themselves** for their
   next game; completion does not automatically requeue them.
   Live site updates leave a postgame report above the queue, showing win/loss,
   before/after inhouse rating and each player's gain or loss. Reports also
   remain available in History, including reconciled ratings after corrections.
   Close a finished report with its **Dismiss report** button to hide it from
   the lobby. Dismissal is remembered per signed-in account in that browser's
   local storage, with no database write; History can still reopen the report.
7. The bot leaves the finished lobby before becoming available for another
   inhouse. Bot assignments and verified launch rosters survive restarts.

Inhouse hosting and results do not use Steam's public HTTP match/history
endpoints or OpenDota. The worker's logged-in Game Coordinator connections
also handle result recovery and admin match-link verification.

## Account setup and production deployment

Create five distinct dedicated Steam accounts and authorize **each account
as a league admin for the shared inhouse ticket**. Setting a ticket ID in the
website does not itself grant hosting permissions. Authenticate on the server;
no graphical Dota client runs on the server. If Steam reports that a new account
needs Dota access or initial account setup, complete that for that account.

Deploy normally. If `inhouse-worker` is already registered with PM2, keep using
that process. After installing the new dependencies, authenticate all five
accounts interactively with the worker stopped:

```bash
cd /root/LeagueOfLads
pm2 stop inhouse-worker
npm run inhouses:auth -- 1
npm run inhouses:auth -- 2
npm run inhouses:auth -- 3
npm run inhouses:auth -- 4
npm run inhouses:auth -- 5
pm2 restart inhouse-worker
pm2 save
```

If bot 1 is already authenticated, skip its authentication command and run
only slots 2 through 5 with four different accounts. Restarting the existing
worker loads all saved slots; no additional PM2 processes are needed.

Each command prompts for account name, hidden password and Steam Guard code,
then prints the Steam ID. It saves the Steam ID and refresh token in
`db/inhouse-bots/bot-N.json`. The directory is ignored by Git; authentication
files are not stored in the database or exposed to the frontend. On Linux the
directory is owner-only and files use mode 600. `INHOUSE_BOT_AUTH_DIR` can
override it with an absolute private path outside the checkout. Never paste
these files into chat or commit them. Renewed tokens are saved automatically;
stop the worker before reauthenticating a revoked session. Each slot requires
a different Steam account.

For the first installation only, register the worker:

```bash
pm2 start scripts/inhouses/run.js --name inhouse-worker --cwd /root/LeagueOfLads --kill-timeout 10000
pm2 save
```

Under **Admin > Inhouses > Settings**, enter the shared ticket and choose
queue selection, team formation, launch window, Dota game mode (All Pick or
Captain's Mode), and server region (US East by default). There is no manual
hosting option. Check the five account cards for connection/assignment status.
No cron entry or additional Droplet is needed.

For a **one-player production smoke test**, sign in as an admin, join the queue
on `/inhouses`, and make sure you are the only waiting player. Click
**Start 1-player test**, confirm readiness and choose Radiant or Dire. An online
bot uses the configured region, creates a real **All Pick** lobby with the
**configured inhouse ticket** (the bot needs league-admin access to that ticket),
starts its join timer, invites your account and starts once you join your side.
The worker records Dota's confirmed outcome, releases you, and leaves a postgame
report on the site. Solo results are **unrated**: rating, wins/losses, calibration
games and standings do not change, including after admin corrections. Rejoin
manually when finished. The same start button is in Admin > Inhouses > Queue &
Games; it can only start a solo test for the requesting admin's own queue entry.
Global ticket/queue/game-mode settings stay unchanged. Existing tests retain
their saved ticket: cancel an older unticketed test and start a new solo test to
use the configured ticket. A single player cannot exercise
both captains' choices, so use the two-player test for Captain's Mode selection.

Use the **Start 2-player test** button when exactly two admins are queued and
a bot is available. Both confirm readiness, accept its invitations and join
their assigned teams. The bot launches and resolves the game through the same
workflow; test wins/losses and ratings count. Positive-duration two-player
tests can resolve below five minutes. Normal ten-player games treat shorter
results as unrated remakes.

First verify one real two-admin game end to end, then two overlapping games
before filling all five slots. Mocked tests cover concurrency and wire decoding;
they do not prove Steam account permissions or live outcome delivery.

## Operations and recovery

Inhouse admin tabs show only their own controls, with one compact **Worker &
bots** status card beside them (below the controls on narrow screens). It shows
the worker heartbeat, queue/game counts, all five bot statuses and connection
details. Availability is managed from the right of the secondary tab bar while
the Inhouses workspace is selected.

Under **Queue & Games**, **Unqueue everyone** clears all waiting players after
confirmation. Reserved and active games keep their players; this action is
admin-only and recorded in Activity.

The worker advances deadlines and bot state once per second under a database
lease. A second worker cannot start another set of Steam sessions against the
same queue. It sends at most one lobby command per bot per second, and paces
GC detail requests. While a lobby is actively playing, its outcome stream is
used without repeated detail requests. Last Steam update reflects an actual
Steam/GC update rather than the local heartbeat.

Ready checks and captain picks last 60 seconds; timed-out draft picks are
automatic. Failed ready checks remove absent players and return confirmations
to their original queue priority. The bot expires an unlaunched game after its
configured join window; website requests do not start or expire this timer.
Games allocating a server or already playing are not cancelled
just because that join deadline passes. A launch returning to its waiting
lobby without starting after five minutes is cancelled. Confirmed unscored
outcomes and short remakes cancel without rating changes. Disconnection or
disappearance alone never implies a winner.

After a launched game has only its hosting bot left in the **current** Dota
lobby membership for 60 seconds, the bot requests to leave its own game session.
The same rule applies to solo tests, two-player tests and ten-player games;
even one other lobby member keeps the bot assigned. A returning player resets
the grace period. The bot does not destroy the lobby or end the game server;
Dota/Steam handles the remaining lobby lifecycle.

The bot stays reserved until its live Steam/GC session confirms that it no
longer belongs to the lobby, then the unfinished inhouse is cancelled without
ratings and the bot returns to the idle pool. Departure requests retry at most
once every 15 seconds, and pending cleanup survives worker restarts. Confirmed
match results take precedence. Connection loss, unknown membership or a vanished
lobby without a recorded cleanup request cannot by themselves cancel a game.
New waiting lobbies retain their normal join window. A bot stranded alone in an
unassigned lobby uses the same grace period to recover from a blocked slot.

Lobby name/password are available only to that game's participants through a
separate authorized endpoint. The launch roster is saved before starting, so
players leaving the postgame lobby cannot erase the identities used to settle
it. Ticket, exact match ID, roster, teams, start window and duration are checked.

Admins can cancel an inhouse or correct its match link with a reason. An
uncached correction is queued for a connected bot to verify through Steam;
the game card displays pending/completed/failed status. Invalid identities or
unknown winners cannot change ratings. Correcting an earlier resolved game
replays affected rating history. Older unfinished manually hosted games remain
visible for cancellation or verification of their known match ID; the worker
does not discover additional manually hosted games.

All data uses `Inhouse` tables in `LadsData.db`. Schema initialization preserves
existing data; enabling solo tests transactionally updates the player-count
constraint while retaining game IDs, chat, reservations and bot assignments.
Existing daily database backups cover games and chat, but Steam authentication
files stay separate. Inhouses are not imported into official league matches,
Analytics or betting. Ratings start at 1,000 and use team-average Elo, K=48 for
the first five calibration games, then K=24. No private MMR is used.

## Frontend and local verification

The page has Lobby, Standings, History and Player Settings tabs. Reserved
players see their own lobby until completion/cancellation. The shared activity
SSE connection updates sidebar counts and private chat and stays connected in
background tabs for ready alerts. A ready check shows a flashing red favicon
and tab title until confirmation or expiry; reduced motion uses a steady dot.
Signing out removes a waiting entry but preserves an active game reservation.

For local development use the normal development database and `ENVIRONMENT=DEV`.
Steam accounts authenticated locally can create real ticketed lobbies when the
worker runs; the regression suite instead uses isolated databases and fake
sessions, without real invitations or production writes.

```bash
npm run inhouses:init
npm run dev
# Separate terminal, after authenticating the intended test accounts:
npm run inhouses:worker
# Automated checks:
npm run test:inhouses
npm --prefix client run build
```

On PowerShell use `npm.cmd` if execution policy blocks `npm.ps1`. One-off browser
checks stay in ignored `.scratch/`.

Protocol references:
[Valve lobby commands](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_gcmessages_client_match_management.proto),
[lobby snapshots and outcomes](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_gcmessages_common_lobby.proto).
`steam-user` provides the Steam session; `dota2-user` provides GC handshake and
response decoding, with a small explicit encoder for missing lobby commands.
