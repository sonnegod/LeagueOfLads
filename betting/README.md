# Betting

The initial replacement sportsbook is implemented. Analytics supplies private
facts and inputs; `Betting.db` owns forecasts, prices, accepted tickets, season
wallets, and settlement. The public page is `/betting`; administration is under
**Site Management → Betting**. Betting controls and odds previews require the
site-manager role, independently of league-admin access. Site Management also has
Traffic and Analytics tabs. All amounts are site points.

Setup may be finalized with a temporary player registered on more than one team
in the season, provided each individual team still has five distinct players.
Analytics builds continue and flag ambiguous memberships; those appearances do
not become eligible roster statistics. The Betting panel lists conflicting
account IDs, and season betting remains held while the conflict exists (including
existing open markets and new ticket acceptance). Replace the placeholder with
a unique player, finalize setup again, then explicitly rebuild affected preseason odds.
Preseason odds previews still require unambiguous rosters.
Dashboard My Bets/Wallet also use season accounts. Retired betting endpoints
return 410; the new history page retains access to older tickets.

Live Markets has **Scheduled games** and **Preseason** sections. Preseason has
Player odds, Team odds, and Player leaders tabs. Expand a player to view aligned
totals/averages and Over/Under buttons; team tables group alphabetically by their
saved group names. Open live outcomes add real selections to the slip. The
historical preview shares these components but remains read-only.
Player-leader markets compare **only the players listed in that market**. A
player needs at least five verified historical observations for that statistic
and a ready pricing distribution; no baseline odds are invented for players
without history. At least two priced players are required. Each market freezes
its field when published, and settlement compares that same field. Unlisted
players do not affect its winner. Regular-season participation requirements and
dead-heat payouts still apply; unnamed TBD roster slots keep leaders held.

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

Routine Discord/admin scheduling changes and **Refresh matchup odds** run
`node scripts/betting/run.js` without rebuilding Analytics. They reuse the
approved historical features saved with the preseason generation, price upcoming
matchups and settle verified results. Saved historical inputs must still match
the canonical setup and import fingerprint; a mismatch waits for the scheduled
data refresh rather than reconstructing historical Analytics in a scheduling job.
The scheduled refresh saves current approved inputs even when no fixtures are
scheduled. Later scheduling jobs use those inputs independently of the frozen
preseason forecasts, so refreshing matchup inputs does not reprice preseason.

Published preseason prices, lines and selections stay fixed across routine and
nightly refreshes. Later Analytics timestamps or pending fixture updates do not
hold that book. Setup, roster, TBD leader, season cancellation and kickoff/live
checks still apply. A routine run repairs premature preseason locks when those
checks permit betting; it updates only status/cutoff metadata and quote versions,
preserving prices and accepted tickets. A changed finalized setup requires an
explicit rebuild with `node scripts/betting/run.js --rebuild-preseason` (add
`--refresh-analytics` only when the canonical Analytics generation also needs work).

To select an existing signup-era season for a worker run:

```bash
node scripts/betting/run.js --refresh-analytics --season-id 3
```

This selects an internal `SeasonId`, not a Dota league ID. An ended season can be
settled/inspected but does not open new markets. Historical Analytics preview
files are rejected as betting inputs. A new signup season can use the validated
historical-roster model described below; it does not need to wait for new seasons
of signup-era games. The automated tests use isolated synthetic fixtures;
they never populate the live point accounts with fabricated markets.

## Admin setup and results

### Current signup-season odds preview

Close signups, assign the groups and save qualification rules. Do not start the
league just to view preseason prices. With the current local SeasonId of 3:

```bash
npm run betting:preview -- --season-id 3
```

Open **Site Management → Betting → Open preseason odds preview**, or
`/betting?previewSeason=3`. Use **Rebuild preseason preview** on that page or in
Betting administration after changing rosters, groups or rules. The calculation
runs in a separate worker; the preview page reloads its prices on completion.
The normal **Refresh matchup odds** button updates live matchup quotes,
not these separate preview files. The command above also rebuilds the preview.
`--history-seasons 3` (default, range 1–5) and `--simulations 2000` are
optional. `--season-id` is mutually exclusive with historical reconstruction flags.

The command rebuilds the normal local Analytics dataset, reads its real signup
rosters and groups, and generates historical Analytics facts in memory for up to
three earlier league seasons. It does not copy the EDW, call external APIs, start
the season, finalize betting setup, or change live Betting wallets or tickets.
Only the generated candidate prices and private model inputs are written to
`Betting-preseason-3.db`. The live Betting store rejects this preview database.

Candidate player distributions use up to 100 personal appearances, a compatible
lane-role reference pool, a 180-day recency half-life and twice the weight for
the latest recorded patch represented in the history. A lane is inferred only
when it is a majority of the last ten appearances and has at least five samples;
it is not assumed to be a submitted carry/support position. Personal history
shrinks toward its reference pool with weight `n / (n + 10)`. Reference arrays
are shared across players and sampled with cached cumulative distributions.

Team priors combine private signup MMR with historical player win records.
Use up to 100 earlier appearances per player, soften the record toward 50% with
20 prior games, average the five player log-odds signals, cap that average at
+/-0.6 and apply a modest 0.35 weight alongside MMR. Players without history
receive a neutral history signal. The experimental performance regression and
resource-demand penalty have been removed. This choice does not establish that
the MMR-plus-record model is calibrated; the preview remains separate from live
pricing. Player-stat props still use their historical statistic distributions.
The existing 10% decimal-odds reduction applies to the reference odds.

Team tables also offer **Season wins** over/under: individual regular-season
game wins, not series wins. A BO2 split gives each team one win; tiebreakers and
playoffs do not count. Histograms are collected from the same group simulations
used for placement, without extra random draws. The initial half-point line is
near the simulated mean, bounded within the team's planned game count. Over and
under probabilities come from the histogram with small-sample smoothing. An
existing live market retains its accepted line when prices refresh. Team totals
use each group's own planned count, including unequal groups. These regular-
season markets can be priced when an unresolved tiebreaker or unsupported
playoff bracket prevents champion/placement prices.

The live publication/validation gates also apply to team-win markets; creating
them in the preview does not make them wagerable. Settlement waits for verified
regular-season completion and complete official team results. Player appearance
thresholds do not apply to a team total. Shortened/canceled seasons refund
unresolved bets, as does a regular-season forfeit involving that team; unplayed
forfeits are not assigned invented game wins. Zero wins is valid. Corrections
reconcile payouts idempotently. The normal Betting database's existing generic
market tables support `season_team` without a schema change.

Games must be completed and observed by the preview's UTC cutoff. All target-
season performances and results, future observations, and tiebreakers are
excluded. Legacy membership is explicitly unknown; those prior appearances
inform this offline candidate only, never season-market settlement. Player
statistics with fewer than five valid earlier samples are withheld independently.
Leader markets require a complete priced field. Regular-season totals use the
saved BO2 group schedule, including different game counts for uneven groups.

Only the existing supported playoff formats receive champion prices. Unsupported
brackets keep champion markets pending while group placement can still be priced.
The current 19-team local setup has 10/9-team groups (18/16 planned games). Two
upper and four lower qualifiers per group produce a supported 4-upper/8-lower
bracket. Five lower qualifiers per group produce an unsupported 4-upper/10-lower
layout and hold champion markets until its routing is implemented.

These previews are site-manager-only, contain no selectable real wagers, and expose no
MMR values or raw source records to the browser. They do not
override canonical signup-era scope or the temporal validation required before
candidate models can price live markets. The live historical-roster model is
validated independently and does not promote these MMR-based candidate prices.

The signup preview also has a site-manager-only **Matchup simulations** tab. Each
within-group BO2 shows the model's single-game win chances and calculated score
probabilities, alongside actual score counts from the saved season simulations.
Diagnostics count the same random draws used for standings; collecting them does
not alter the simulation or its prices. They are saved with the preview and
regenerated by **Rebuild preseason preview**. Old previews need one rebuild.
The tab explains independent game draws, standings, playoff progression and
sampling noise. These diagnostics are not public markets and expose no MMRs or
raw historical player records.

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
multiple teams; their preseason selections are withheld, and leader markets
wait for an unambiguous roster. Leader fields include players with at least
five earlier observations for that statistic. Team markets use **neutral strength
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

### Local wager testing

Set `BETTING_LOCAL_TEST_MODE=true` in the ignored local `.env`, with
`ENVIRONMENT=DEV` and `NODE_ENV` unset or `development`. Production refuses this
configuration. Restart the local API after changing it. The API and worker both
use `db/Betting-local-test.db` (or `BETTING_LOCAL_TEST_DB`) for isolated wallets,
tickets and quotes; they retain the same league and Analytics sources. No EDW
copy is required. Test and normal Betting paths cannot coincide. A persistent
database marker prevents reopening the test store as a normal/production store.

For the current closed signup season:

```bash
npm run betting:refresh -- --season-id 3 --prepare-local-test
```

This explicit development command finalizes the saved BO2 round-robin Betting
setup and, if no future regular fixture exists, adds one same-group BO2 test
fixture three days ahead. It does not start the league or create match results.
Preparation is idempotent; repeating it reuses the future fixture. Generated
fixtures carry a `local-test:` source marker and are excluded from ordinary
scheduling, production pricing and kickoff selection.

Sign in and open `/betting`, then select **Preseason → Player odds / Team odds**
or **Scheduled games**. Both the normal betting page and admin panel visibly
identify local test mode. The separate `/betting?previewSeason=3` remains read
only. Wallets begin at 10,000 points. The background worker uses the same
signup-MMR/player-win-record model and empirical player distributions as the
preview, including the bounded exposure movement after wagers.

Only tagged local markets bypass historical model-validation and source-feed
publication gates. The canonical Analytics generation must still be complete,
recent and earlier than the quote. Authentication, funds, quote
versions, setup/roster checks and kickoff locking remain in force. During closed
signups, local player props verify membership against finalized, unchanged
Betting setup; they do not invent historical effective roster dates. Settlement
continues to require actual verified results; cancelling a fixture tests refunds.
No synthetic result or unrestricted payout endpoint is provided. Validation
reports flag the prices as development-only and not production approved.

Admin edits continue to queue background Analytics/Betting refreshes in this
mode. Set `BETTING_LOCAL_TEST_MODE=false` and restart to return to the normal
Betting store. Test balances/tickets are not migrated into it. The standalone
`betting:validate` command continues to report actual production-model readiness;
development test mode does not make those validation results pass.

### Production setup

1. Close signups; finalize team rosters, groups, and qualification rules.
2. Finalize the regular-season **individual game count per team**, not series
   count. The default **Use BO2 group round robin** calculates each team's game
   count from its group size, including unequal groups. Uncheck it for an
   explicitly supplied uniform count; nonstandard schedules do not enable the
   standard bracket simulation. Preseason betting opens once setup and pricing
   are ready, even with no scheduled fixtures. Add verified fixtures with both
   teams, stage, BO format, and New York kickoff when available. A first known
   regular-season kickoff closes preseason betting automatically; live games,
   started fixtures and imported results close it immediately even without a
   schedule. Without a known kickoff, preseason quotes have no scheduled expiry.
3. Refresh matchup odds. Job status explains missing sources/history or
   unsupported formats. Eligible validated outputs publish automatically.
4. After matches load, Betting refreshes automatically link an unlinked fixture
   to a unique played series with the same league, external team IDs (either
   order), stage and New York match date. Different nights remain separate.
   Existing links are preserved; a series cannot be reused by another fixture.
   Duplicate fixtures or played series on the same night enter review. For
   those cases, or a match played on a different date, edit the fixture and link
   its **actual SeriesId** manually. Complete verified results mark the fixture
   completed and settle eligible bets; an incomplete BO2 still waits for both games.
5. Verify regular-season completion and official upper/lower/eliminated outcomes
   in this panel. The existing league-stage widget supplies the official league
   champion. Mark shortened/canceled seasons explicitly rather than inferring
   cancellation from missing data.

Effective roster replacements/transfers and roster data corrections are under
**Admin → League → Roster Changes** during an active league. The roster-change
form accepts a completely new replacement account ID, with an optional name;
without a name, the player is initially displayed as `Player <account ID>`. Existing
player names and the original signup submission stay unchanged. Effective
membership intervals retain earlier appearances on the outgoing roster.
The **Team details** card beside **Roster order** edits a selected team's
name and Dota team ID. Its captain control selects a confirmed
current teammate. Captain changes update public team/roster displays and are
audited separately; they do not create roster transfers or refresh betting odds.
The Betting panel
records official/remake/abandoned match classifications, Discord team-role mappings,
unresolved scheduling posts, and verified legacy ticket outcomes. A replay must
be linked to the same actual series before settlement. Raw Discord messages and
private model inputs are never returned to the website.
Roster administration uses the separate league-admin `/api/admin/rosters` routes,
which expose season/team choices and roster changes without Betting controls.
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
- Total-kills, average-kills, average-GPM, and average-XPM leader markets among
  their listed players with verified history.
- Champion and bracket-placement futures for supported standard BO2 round-robin
  groups and the existing playoff bracket. Initial champion simulation requires
  power-of-two upper/lower counts, with lower count equal to or twice upper;
  unresolved tiebreakers and nonstandard formats hold rather than invent a bracket.

### Active group qualification and tiebreakers

In **Admin → League → Settings → Initial group setup → Edit rules**, assign
finishing positions to upper, lower, eliminated, or a named tiebreaker
pool. The same position rules apply to every group, including groups of different sizes. Rows assigned to the
same pool combine across groups; several independent pools may coexist. The
editor uses one set of color-coded finishing positions across all groups, shows
pool entrants, and summarizes direct and tiebreaker qualification totals beside
the rules. Smaller groups use only the positions they have.
For each pool, choose a BO1 or BO3 round robin and the numbers advancing to upper,
lower and elimination. These counts must account for every entrant. For example,
third place from three groups can send its top two to upper and the last to lower.
A separate lower pool can advance one to lower and eliminate its other two.

The active league stores this explicit plan in `LeagueRules.QualificationJson`.
Existing historical rules and draft-season count settings are retained. Startup
adds the nullable column; no deploy-time data validation or migration script is
needed. Saves check group sizes, destinations, outcome counts, active league and
the rules revision so another admin's edits are not overwritten. Before play
starts, saving updates an existing finalized Betting setup and queues refresh.

Starting tiebreakers snapshots entrants and rules in `LeagueQualificationStages`
and locks rule editing. Each named pool has its own league subtab with standings
and a head-to-head matrix. League stages reviews the BO1/BO3 round-robin results
using series wins then Neustadtl. All pairings must be complete; an admin must
confirm remaining tied orders that cross upper/lower/elimination cutoffs.
Starting playoffs atomically saves final pool ranks, bracket destinations and
`PlayoffSeeding`, together with the tiebreaker stage boundary. Stale result
reviews are rejected. Saved placements and scores survive restarts and later
standings changes; the bracket editor uses the stored upper/lower qualifiers.

Analytics carries the plan into private Betting inputs. Each season simulation
plays the regular BO2 groups, then the configured pools, then the supported
playoff bracket. Pool ranking uses series wins and Neustadtl, with remaining ties
randomized within simulations. Tiebreaker games do not add to regular-season win
totals or player props. Completed pools contribute to upper/lower/elimination
probabilities; champion odds also require the final counts to fit the existing
playoff generator (power-of-two upper/lower fields, lower equal to or twice upper).
Legacy single-position rules without outcomes remain unresolved for those odds.

Pricing retains a temporally validated, shrunk league-results/signup-MMR
baseline plus empirical player distributions and seeded simulations. Match
results enter historical validation only after completion and source observation;
players from the same game cannot inform one another's validation prediction.
Initial gates: at least 20 team validation samples, Brier ≤0.27/log loss ≤0.8;
metric distributions need at least 20 scored samples and Brier ≤0.30, with five
personal and fifty pooled observations before scoring. These checks do not claim
the model is calibrated for a new production dataset. Elo is excluded.

### Historical pricing for a new signup season

The worker also reads up to three earlier leagues into temporary in-memory
Analytics generations. These facts remain separate from canonical signup-era
ownership and settlement. When canonical validation is unavailable, or cannot
price new teams, `historical-roster-v1` can publish after its own validation passes.

This is explicitly a retrospective season holdout using recorded match
participants. For each scored game, only completed games from other leagues
with earlier completion times can inform the prediction. It assumes earlier
season results were available after completion; it does not claim that later
imports, historical signup rosters or historical MMR were recorded at kickoff.
Original observation timestamps remain intact. Current inputs must have been
observed by the worker's cutoff; unfinished, malformed and tiebreaker games are
excluded, as is the entire target league. No synthetic games or player records
are added to a live database.

Team priors use each confirmed player's last 100 historical wins/losses, shrunk
toward 50% with 20 prior games. Average the five player log-odds signals, cap at
plus/minus 0.6, multiply by 0.35, then apply log5 between teams. Unknown players
and TBD slots contribute a neutral signal. Signup MMR and current-season team
records do not enter this model. At least 20 held-out matches with an informed
player on each side must pass Brier <=0.27 and log loss <=0.8 before publication.

Historical player distributions use the last 100 personal samples and last 2,000
pooled samples. Each prop needs five personal and fifty pooled observations;
each stat independently needs 20 held-out predictions and Brier <=0.30. Players
without enough history receive no invented prop or leader odds. Each leader
market needs at least two history-qualified players and freezes those listed
entrants for pricing and settlement. Existing setup, kickoff, TBD and
roster-change guards still apply.

Historical facts do not expire just because their matches are old. New matchup
pricing requires a fresh canonical roster generation (under 48 hours) and binds
quotes to historical import metadata. New or repaired source imports hold matchup
quotes until repricing. Published preseason prices retain their approved inputs
and remain subject to canonical setup/roster and kickoff checks. The model does
not require a current-season match feed to have
run before that season has any matches. The other live models retain their
normal source freshness checks. `betting:validate` reports both kinds of model
readiness, including the retrospective assumption and independent stat scores.

The `league-lineup-v4` candidates add these private, interpretable priors:

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

For the canonical league/signup models, required league source loads must be complete and less than 48 hours old;
rebuilding Analytics does not reset their true freshness. New data or source
edits hold acceptance while refreshed quotes are prepared. Private public-input
outages do not prevent a validated league/signup baseline from running.

## Tickets, refunds, corrections

Each account receives 10,000 points once per season. Previous season/legacy
wallets remain separate, including late credits. All acceptance uses the signed-in
Steam account; a submitted account ID cannot spend another user's balance.

Users can stake up to their available season-wallet balance, including repeated
tickets on the same market. There is no fixed per-ticket or cumulative per-market
stake cap. The minimum stake is 0.01 points, with at most two decimal places;
wallet debits remain atomic and potential returns must fit exact point arithmetic.
The metadata API reports `stakeCap: null`. Tickets have up to eight legs.
Scheduled player props can combine within a fixture or across fixtures, including
one matchup-result selection per fixture. Each market allows one outcome only.
For the same player/stat/fixture, series totals and averages cannot combine with
each other or with individual-game props; separate individual games can combine.
Every preseason bet is a standalone single and cannot combine with scheduled
markets or another preseason selection. The slip and API share these checks.
Idempotent request keys prevent duplicate debits.

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

The deploy workflow checks Node 20.19+ or 22.12+ (22.12+ recommended), installs dependencies/builds the client,
backs up databases, publishes the built client and restarts PM2. Startup initializes
additive Betting/roster tables. Scheduled jobs and admin refreshes run Analytics
and Betting separately; deployments keep existing forecasts and do not download
the item catalog. Deployments serialize instead of overlapping. No production deploy
was performed during local verification.

Nightly ingestion refreshes Analytics/Betting even after an ingestion step fails;
the overall job still exits unsuccessfully and logs the failed steps. A failed
active-league lookup never creates a false successful inactive-source check.
The public-data wrapper also refreshes Analytics/Betting after either a successful
or failed source load, so a validated fallback can replace public-dependent
quotes without waiting for the next league ingestion. Actual source watermarks
still determine whether any new quote is allowed.

Successful admin
mutations debounce a separate matchup refresh worker for three seconds; changes arriving
during a run queue another. Durable pending revisions survive API restarts.
Failed automatic refreshes retry after 5, 10, 20, 40 and 60 seconds, stopping after
six failed attempts per trigger. Pending revisions remain held; Admin Betting
shows retry/failure status and allows a manual retry. API restart or a later
change resumes pending work. Standalone/cron worker runs also record pending
revisions, attempt/completion times and failures. CLI results include elapsed
time, peak process RSS and heap usage for host-side inspection.
Routine workers reuse saved inputs; scheduled data jobs own Analytics builds.
The worker runs in a separate process, computes simulations outside the SQLite
publication transaction, and holds a single-worker lease. It does not simulate
prices in ordinary website requests.

Existing `discordRun.sh` now uses the new parser and refreshes after changed
fixtures; `closeBets.sh` locks v2 markets. Retired initializer/settlement/player
entrypoints forward to the new worker and no longer mutate legacy tables.
Verify the server's existing cron entries (`crontab -l`); deployment does not
install cron or enable Discord credentials. Recommended initial cadence: Discord
every two minutes, locking every minute, plus existing nightly ingestion.
For the Discord entry, use `*/2 * * * * /bin/bash /root/LeagueOfLads/discordRun.sh`.
An existing `0 * * * *` entry only checks on the hour; replace that entry rather
than adding a second one. Restarting the website does not change the cadence.
Acceptance also checks kickoff/live/actual-series signals synchronously, so a
missed locking cron cannot accept bets after a known kickoff.

Discord requires `DISCORD_TOKEN`, `DISCORD_SCHEDULE_CHANNEL_ID`, read/history
permissions, and the message-content intent. It only reads posts, pages at most
2,000 messages per run with persisted catch-up progress, reconciles fifty old
posts, and ignores posts authored before the season's creation. No live Discord
network run or production load test has been performed in local verification.
Scheduling posts use numeric dates and weekday abbreviations such as `weds`.
A complete numeric timestamp such as `10/25/2026 8:00 PM` takes precedence over
surrounding weekday/date prose and repeated times, including when it appears in
parentheses. The post's timezone still applies, defaulting to New York. Invalid
explicit timestamps and multiple complete timestamps need review; they do not
fall back to a different weekday.
If the date cannot be verified but one weekday is clear, Discord uses its next
occurrence at the posted time (including today if that time has not passed).
Month names and typos are not interpreted: `weds oc 21st 9 est` uses the next
Wednesday. Valid numeric dates take precedence. The assumption is recorded with
the post, and admins can edit the fixture. Multiple weekdays or unclear times
still need review. As with other scheduling posts, `9 est` means 9 PM in New York;
omitted AM/PM and year are recorded assumptions.
Discord emphasis and inline-code formatting around the time is ignored, so
`Sunday **8 EST**` is interpreted the same as `Sunday 8 EST`.
Polling uses a ten-minute per-channel lease with heartbeat/ownership checks.
Tracked edits remain subject to review even when team mentions disappear;
permission/network failures cannot be mistaken for deleted messages. Dirty
revisions persist when an import partly succeeds or its following refresh fails.
The next poll can retry refresh without needing a new scheduling post. BO3
tiebreaker posts retain the separate tiebreaker stage and do not create markets.

The betting worker locks the full refresh before rebuilding Analytics. A second
worker exits with code 75 (deferred), keeps pending revisions, and does not use
the API's failure retry budget. The API checks again after thirty seconds.
Locks record the owning host/process, with boot/start identity on Linux; an
exited owner is reclaimed immediately while a live owner keeps its lock even
for a long build. Older locks without process metadata retain their existing
fifteen-minute expiry. Normal completion and failures release owned locks.

The live betting page checks for published updates every thirty seconds while
visible and immediately when its tab becomes visible again. These reads do not
start pricing jobs or reset filters, pagination, or the bet slip.

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
reports canonical source readiness, coverage, each model's temporal scores and
the separate historical-roster season-holdout scores. It never copies legacy
facts into canonical ownership or settlement. Use the internal SeasonId.
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

### Pending preseason roster spots

Admin → League → Roster Changes is also available after signups close. An admin
can mark an empty slot or a duplicated cross-team placeholder as **Player TBD**,
with an estimated whole-number MMR above 5,500. Confirmed players must use the
normal roster-change process. TBD declarations and estimate changes are limited
to before the season's first regular kickoff or imported match.

`SeasonPendingRosterSlots` in LadsData stores these slot overrides and later
confirmations. Original submissions remain intact. Active rosters, Analytics and
Betting exclude the placeholder identity from that team. Analytics v8 privately
includes the estimated MMR in the five-slot team average; the missing historical
player contribution is neutral. No player record, stats or prop is invented.
Team odds display **Provisional roster** without exposing the estimate. Confirmed
player props and team futures may publish through the existing source, model,
schedule and setup checks. Player-leader markets remain held until
all pending slots are confirmed. Unresolved duplicate memberships still block.

Confirm the actual player using the searchable picker, their MMR, and optionally
an effective New York time (default now). This fills a declared vacancy, creates
effective roster membership, and preserves accepted tickets and odds. It does
not create a permanent-replacement refund. New quotes refresh; existing market
lines remain fixed. Ordinary confirmed-player replacements retain their refund
policy. Existing finalized setup is updated automatically, and refresh is queued.
If no setup exists, finalize it from Site Management → Betting after groups and
qualification rules are ready. Preseason previews must be rebuilt separately.

The source slot table initializes on server/worker startup; the next Analytics
build migrates v8 and rebuilds the facts. No manual database edits are required.

Remaining work includes real prospective calibration, uncertainty estimates,
additional explicitly defined competition formats and production Discord/job/
resource verification. Tiebreaker-dependent futures hold while advancement rules
are unspecified. Production prices remain held where neither canonical nor
historical-roster validation passes.

Additional local operational verification covers real worker migration/recovery,
bounded-heap publication, queued retry/exhaustion, Discord backfill/edit/delete/
lease behavior with a simulated channel, and shell pipelines with simulated
successful/failed commands. A separate 9-team/45-player worker published 1,076
markets at the standard 2,000 simulations using roughly 130 MB peak RSS under
`--max-old-space-size=256`. That flag limits V8 heap, not total process RAM;
the measurement excludes the main API, live poller and other server services.
There is no staging URL, so real Discord permissions, the deployment workflow,
installed cron jobs and the complete 1 GB production host remain unverified.
