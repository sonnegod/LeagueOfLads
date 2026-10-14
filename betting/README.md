# Betting

The initial replacement sportsbook is implemented. Analytics supplies private
facts and inputs; `Betting.db` owns forecasts, prices, accepted tickets, season
wallets, and settlement. The public page is `/betting`; administration is under
**Admin → League → Betting**. All amounts are site points.
Dashboard My Bets/Wallet also use season accounts. Retired betting endpoints
return 410; the new history page retains access to older tickets.

Live Markets has **Scheduled games** and **Preseason** sections. Preseason has
Player odds, Team odds, and Player leaders tabs. Expand a player to view aligned
totals/averages and Over/Under buttons; team tables group alphabetically by their
saved group names. Open live outcomes add real selections to the slip. The
historical preview shares these components but remains read-only.

## Run locally

From the repository root, with the existing source databases restored:

```bash
npm run betting:init
npm run betting:refresh
npm run betting:status
npm run dev
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`. Initialization creates
the additive schedule/roster/correction tables in LadsData and the new prefixed
tables in Betting. It preserves the original betting tables and snapshots the
old wallets into a separate legacy account. No manual SQL migration is needed.
Refresh rebuilds Analytics from committed local sources and then runs pricing
and settlement; it does not fetch Steam/OpenDota/Discord data.

To select an existing signup-era season for a worker run:

```bash
node scripts/betting/run.js --refresh-analytics --season-id 3
```

This selects an internal `SeasonId`, not a Dota league ID. An ended season can be
settled/inspected but does not open new markets. Historical Analytics preview
files are rejected as betting inputs. The current local test season has no
canonical signup-era games: validation holds are expected until real eligible
history is available. The automated tests use isolated synthetic fixtures;
they never populate the live point accounts with fabricated markets.

## Admin setup and results

### Season 21 historical test

```bash
npm run betting:preview -- --league-id 19817 --match-rosters
```

Sign in as an admin and open `/betting?previewLeague=19817`. The separate
`db/Betting-preview-19817.db` contains read-only illustrative markets; live wallets,
tickets, schedules, and Analytics publications are untouched. The live Betting
store refuses to open a preview file as its database.

The default training cohort is the latest wholly earlier dated league: Season
20 for this test. All training match IDs and played dates must precede Season
21’s first recorded match/day, and **every Season 21 performance/result is
excluded**, including for played-series examples. Scores are fetched separately
after pricing. A leakage regression changes all target-season statistics and
winners and requires identical input digests and prices.

`--match-rosters` uses each team’s first complete five-player match lineup, as
authorized for this test. The page shows its source match. This is retrospective
lineup metadata, not evidence of an actual opening signup roster. Planned games
use the saved groups’ BO2 round robin (different group sizes can have different
counts), and team futures use the saved qualification rules. Current group
alignment/rules may include later corrections. Never use actual eventual team
game counts, season standings, or awards to form these preseason prices.

Season 21’s test currently yields 1,129 preseason markets and 326 example-series
markets from 358 valid Season 20 games. Some reconstructed players occur on
multiple teams; their preseason selections are withheld, and league-wide
leader markets wait for a complete, unambiguous field. Players with fewer than
five earlier appearances are also withheld. Team markets use **neutral strength
priors** because the historical signup MMRs are unavailable. Player prop lines
use the earlier league history. Legacy membership and exact source-availability
times are unknown, so these prices are illustrations rather than a validated
historical betting backtest. None of the normal live publication gates are
disabled by the preview.

Options: `--training-league 19264`, `--examples 3` (1–10),
`--simulations 2000` (100–10000), or `--rosters historical-setup.json` instead of
`--match-rosters`. An original setup file has `recordedBefore` (an earlier day),
`regularGamesPerTeam`, optional `rules`, and `teams` with `teamId`, optional
per-team `regularGames`, and five `players` with `accountId` and optional
historical signup `mmr`. Private MMR inputs remain server-only. With no supplied
or reconstructed rosters, preseason markets hold and played-series illustrations
are still available. This explicit legacy exception applies only to the isolated
preview reader; the live Analytics consumer remains signup-era only.

### Live setup

1. Close signups; finalize team rosters, groups, and qualification rules.
2. Add verified fixtures with both teams, stage, BO format, and New York kickoff.
   Finalize the regular-season **individual game count per team**, not series
   count. The default **Use BO2 group round robin** calculates each team's game
   count from its group size, including unequal groups. Uncheck it for an
   explicitly supplied uniform count; nonstandard schedules do not enable the
   standard bracket simulation. Preseason markets require a first verified
   regular-season kickoff.
3. Refresh Analytics and Betting. Job status explains missing sources/history or
   unsupported formats. Eligible validated outputs publish automatically.
4. After matches load, edit the fixture to link its **actual SeriesId**. This is
   an explicit admin verification step; a matching pair of names or teams is
   insufficient to settle repeated fixtures. Incomplete/unmatched results wait.
5. Verify regular-season completion and official upper/lower/eliminated outcomes
   in this panel. The existing league-stage widget supplies the official league
   champion. Mark shortened/canceled seasons explicitly rather than inferring
   cancellation from missing data.

Effective roster replacements/transfers and roster data corrections are under
**Admin → League → Roster Changes** during an active league. The Betting panel
records official/remake/abandoned match classifications, Discord team-role mappings,
unresolved scheduling posts, and verified legacy ticket outcomes. A replay must
be linked to the same actual series before settlement. Raw Discord messages and
private model inputs are never returned to the website.
Use its season selector to verify older fixtures/results. Ended seasons permit
edits to existing fixtures for late result links/corrections, but cannot open new
markets or add new fixtures.

New York DST gaps/repeated hours enter review. The optional exact UTC kickoff
field can resolve a repeated hour explicitly, e.g. `2026-11-01T06:00:00Z`.

## Markets and pricing

- BO2 result/draw and exact 2–0, 1–1, 0–2; BO3 and BO5 legal results/scores.
  Regular-season and playoff fixtures only. Tiebreakers stay separate and cannot
  contribute to either stage's betting statistics or pricing history.
- Player single-game and entire-series props. A series prop requires every
  official game; a game prop requires its specified game. Otherwise refunded.
- Preseason roster-only regular-season totals/averages for kills, deaths,
  assists, last hits, hero damage, tower damage, and healing; GPM/XPM averages.
- Total-kills, average-kills, average-GPM, and average-XPM leader markets.
- Champion and bracket-placement futures for supported standard BO2 round-robin
  groups and the existing playoff bracket. Initial champion simulation requires
  power-of-two upper/lower counts, with lower count equal to or twice upper;
  tiebreaker-enabled and nonstandard formats hold rather than invent a bracket.

Pricing retains a temporally validated, shrunk league-results/signup-MMR
baseline plus empirical player distributions and seeded simulations. Match
results enter historical validation only after completion and source observation;
players from the same game cannot inform one another's validation prediction.
Initial gates: at least 20 team validation samples, Brier ≤0.27/log loss ≤0.8;
metric distributions need at least 20 scored samples and Brier ≤0.30, with five
personal and fifty pooled observations before scoring. These checks do not claim
the model is calibrated for a new production dataset. Elo is excluded.

The `league-lineup-v3` candidates add these private, interpretable priors:

- Lineup strength averages five players' earlier rostered win records, shrunk
  toward 50% with 20 prior games and weighted at 0.75 in log-odds space alongside
  signup MMR. Up to 100 prior appearances per player are used. Same-season
  appearances are excluded from this prior to avoid double counting team form.
- An optional public-data candidate adds a modest 0.20 log-odds contribution
  from the five players' shrunk 90-day public win records. Each needs at least
  20 public samples, a supported feature version and fresh verified input.
- Betting privately retains the first available summary per player per UTC day
  in `BettingPrivateFeatureHistory`. Availability uses actual observation time;
  today's rolling summary cannot be backdated to validate an older kickoff.
- Each candidate needs 20 scored temporal samples, the existing score gates,
  and Brier no worse than its simpler reference on the same matches. Lineup
  validation requires five verified players with five earlier eligible games
  each. Public validation additionally requires all ten timely public summaries.
  The independently validated simpler model remains available as a fallback.

Neither feature values nor private forecast explanations appear in public or
admin API payloads. A public-dependent quote holds if its private source becomes
unavailable, until a validated fallback has actually been repriced.

The default fair decimal odds reduction is 10%, configurable through
`BETTING_ODDS_REDUCTION` (0–0.30). Exposure movement is smoothed and bounded to
±10% of each current analytical anchor, without compounding the margin. Quotes
use two decimals; accepted odds and rules are immutable. A changed quote requires
explicit review before acceptance. Stake and returns use exact centipoint
arithmetic, rounding the gross return down once.

Scheduled-fixture markets price the next seven days by default, configurable
with `BETTING_FIXTURE_LOOKAHEAD_DAYS` (1–60), to bound worker simulations. Future
fixtures remain visible in the schedule; preseason opening is independent of
this window. Models cache distributions/probabilities within a worker run.

Required league source loads must be complete and less than 48 hours old;
rebuilding Analytics does not reset their true freshness. New data or source
edits hold acceptance while refreshed quotes are prepared. Private public-input
outages do not prevent a validated league/signup baseline from running.

## Tickets, refunds, corrections

Each account receives 10,000 points once per season. Previous season/legacy
wallets remain separate, including late credits. All acceptance uses the signed-in
Steam account; a submitted account ID cannot spend another user's balance.

A user's cumulative stake across tickets is capped at 1,000 points per market.
The full parlay stake counts against each market. Tickets have up to eight legs,
one selection per fixture and one preseason future, excluding unsupported
correlated combinations. Idempotent request keys prevent duplicate debits.

Both season total and average selections require ≥5 rostered regular-season
games and strictly more than half of the team's official games. Ineligible
players are refunded. Leader ties divide the gross return among tied eligible
winners using unrounded metrics. Pushes refund. A void parlay leg contributes
factor one; all void means a full stake refund.

Same-fixture reschedules preserve accepted prices. Started/kickoff-locked markets
cannot reopen. Changed teams/stage/BO format create a replacement fixture and
refund the old markets. Cancellation/forfeit refunds series markets. Permanent
roster changes refund affected unsettled preseason player selections. Shortened
seasons refund unsettled totals; eligible averages and verified team outcomes can
settle. Canceled seasons refund unresolved preseason markets. Already settled
preseason results are preserved.

Every settlement revision has evidence and an idempotent ledger adjustment.
Invalidated data can reverse an earlier payout and hold the ticket until repaired;
corrections can return to an earlier result without double credit. A correction
can leave an older wallet negative if its prior credit was already spent.
Legacy malformed tickets remain untouched and appear as source-repair issues
instead of being partially settled; valid old tickets can be resolved in Admin.

## Tables

| Database / tables | Responsibility |
| --- | --- |
| LadsData: `ScheduledEvents`, `ScheduleEventRevisions` | Stable fixtures, revisions, start status, actual series links. |
| LadsData: `ScheduleMessages`, `DiscordScheduleCursors`, `TeamDiscordAliases` | Parser evidence, bounded catch-up/edit reconciliation, role identity. |
| LadsData: `SeasonBettingSetup`, `BettingOfficialOutcomes` | Finalized launch revision, planned game count, verified completion/placement. |
| LadsData: `SeasonRosterChanges`, `TeamRosterMembershipHistory`, `OfficialMatchStatus` | Effective roster and official/replay corrections. |
| LadsData: `BettingRefreshState` | Persistent dirty revision, attempts/retry status; blocks stale acceptance during refresh. |
| LadsData: `DiscordSchedulePollLocks` | Per-channel polling lease prevents overlapping Discord imports. |
| Betting: `BettingSeasons`, `BettingWallets`, `BettingLedger` | Season accounts, credits, debits, traceable correction history. |
| Betting: `BettingInputSnapshots`, `BettingForecasts` | Exact private consumed inputs, generation/model/validation/seed provenance. |
| Betting: `BettingMarkets`, `BettingSelections`, `BettingQuoteHistory` | Definitions, typed outcomes, current/versioned offers. |
| Betting: `BettingTickets`, `BettingTicketLegs`, `BettingMarketSettlements` | Accepted immutable prices/rules, outcomes, settlement evidence/revisions. |
| Betting: `BettingJobs`, `BettingWorkerLock`, `BettingLegacyImportIssues` | Safe operational state, single-worker lease, legacy repair flags. |

Do not use private input/forecast tables as public content. Public API payloads
use explicit safe fields. Ordinary market pages return at most 20 markets;
grouped preseason pages return 20 complete players, while team tables cover the
season's groups (bounded to 200 teams). Ticket pages return 50. Jobs retain 100
metadata rows; financial/provenance history persists.

## Deployment and workers

The deploy workflow checks Node 22.12+, installs dependencies/builds the client,
backs up databases, initializes additive Betting/roster tables, and runs Analytics
then Betting. It publishes the built client after these steps succeed, then
restarts PM2. Deployments serialize instead of overlapping. No production deploy
was performed during local verification.

Nightly ingestion refreshes Analytics/Betting even after an ingestion step fails;
the overall job still exits unsuccessfully and logs the failed steps. A failed
active-league lookup never creates a false successful inactive-source check.
The public-data wrapper also refreshes Analytics/Betting after either a successful
or failed source load, so a validated fallback can replace public-dependent
quotes without waiting for the next league ingestion. Actual source watermarks
still determine whether any new quote is allowed.

Successful admin
mutations debounce a separate refresh worker for three seconds; changes arriving
during a run queue another. Durable pending revisions survive API restarts.
Failed automatic refreshes retry after 5, 10, 20, 40 and 60 seconds, stopping after
six failed attempts per trigger. Pending revisions remain held; Admin Betting
shows retry/failure status and allows a manual retry. API restart or a later
change resumes pending work. Standalone/cron worker runs also record pending
revisions, attempt/completion times and failures. CLI results include elapsed
time, peak process RSS and heap usage for host-side inspection.
The worker runs in a separate process, computes simulations outside the SQLite
publication transaction, and holds a single-worker lease. It does not simulate
prices in ordinary website requests.

Existing `discordRun.sh` now uses the new parser and refreshes after changed
fixtures; `closeBets.sh` locks v2 markets. Retired initializer/settlement/player
entrypoints forward to the new worker and no longer mutate legacy tables.
Verify the server's existing cron entries (`crontab -l`); deployment does not
install cron or enable Discord credentials. Recommended initial cadence: Discord
every two minutes, locking every minute, plus existing nightly ingestion.
Acceptance also checks kickoff/live/actual-series signals synchronously, so a
missed locking cron cannot accept bets after a known kickoff.

Discord requires `DISCORD_TOKEN`, `DISCORD_SCHEDULE_CHANNEL_ID`, read/history
permissions, and the message-content intent. It only reads posts, pages at most
2,000 messages per run with persisted catch-up progress, reconciles fifty old
posts, and ignores posts authored before the season's creation. No live Discord
network run or production load test has been performed in local verification.
Polling uses a ten-minute per-channel lease with heartbeat/ownership checks.
Tracked edits remain subject to review even when team mentions disappear;
permission/network failures cannot be mistaken for deleted messages. Dirty
revisions persist when an import partly succeeds or its following refresh fails.
The next poll can retry refresh without needing a new scheduling post. BO3
tiebreaker posts retain the separate tiebreaker stage and do not create markets.

```bash
npm run test:betting
npm run test:analytics
npm --prefix client run build
```

Tests cover pricing bounds, atomic/idempotent accounts and caps, quote changes,
temporal availability, public privacy/authentication, series results/participation,
season eligibility/ties, refunds, corrections, legacy isolation, and scheduling.

Local browser verification covered anonymous access, placing a ticket, desktop/
mobile layout, Admin Betting, and Dashboard My Bets/Wallet with no JavaScript
errors. An isolated 50-game/10-player fixture produced 342 scheduled markets with
2,000 simulations in about 140 ms; that harness used about 88 MB Node RSS and a
20-market HTTP response took about 20 ms. This is a small local fixture, not a
concurrency capacity estimate or a production 1 GB host load test. Migration on
copies of the existing databases imported both pending legacy tickets without
changing any original legacy table.

### Read-only readiness and HTTP checks

```bash
npm run betting:validate -- --season-id 3
npm run betting:benchmark -- --season-id 3 --base-url http://127.0.0.1:5173 --concurrency 5 --requests 100
```

Validation reads the canonical databases without migrations or publication. It
reports source readiness, coverage and each model's temporal scores; it never
backfills legacy previews into production validation. Use the internal SeasonId.
The benchmark sends anonymous market GET requests only and reports failures,
latency, response size and throughput. Empty seasons underestimate real load.
Run it against the deployment host and monitor that host's RSS/CPU/database
latency; local throughput is not a maximum-player estimate.

October 14 local verification used an isolated 9-team/45-player fixture with
scheduled, player and team markets: 60 requests at concurrency 5 completed
without failures, about 102 requests/second with 55 ms p95. The harness process
used about 118 MB RSS, including its in-memory test databases. Live desktop/
mobile browser checks placed both player and champion tickets, verified paging,
and found no JavaScript exceptions or viewport overflow. These measurements do
not represent the full application on the production 1 GB host.

Remaining work includes real prospective calibration, uncertainty estimates,
additional explicitly defined competition formats and production Discord/job/
resource verification. Tiebreaker-dependent futures hold while advancement rules
are unspecified. Production prices also remain held where real signup-era
validation coverage is insufficient.

Additional local operational verification covers real worker migration/recovery,
bounded-heap publication, queued retry/exhaustion, Discord backfill/edit/delete/
lease behavior with a simulated channel, and shell pipelines with simulated
successful/failed commands. A separate 9-team/45-player worker published 1,076
markets at the standard 2,000 simulations using roughly 130 MB peak RSS under
`--max-old-space-size=256`. That flag limits V8 heap, not total process RAM;
the measurement excludes the main API, live poller and other server services.
There is no staging URL, so real Discord permissions, the deployment workflow,
installed cron jobs and the complete 1 GB production host remain unverified.
