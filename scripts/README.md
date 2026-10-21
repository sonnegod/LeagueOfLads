# Scripts

Utility and scheduled-job scripts live here to keep the project root focused on
app entrypoints and shared modules.

Put temporary debugging or verification scripts and their output in `.scratch/`
at the repository root. That directory is ignored by Git, so these local checks
stay out of commits and deployments. Keep reusable regression tests in `tests/`
and application or scheduled-job tools in `scripts/`.

- `league/`: active league ingestion and standings jobs used by `nightlyRun.sh`
- `public/`: public match-data generation jobs used by `generatePublicMatchData.sh`
- `legacy/`: one-off historical league utilities
- `assets/`: asset download/build helpers
- `analytics/`: private derived-data builds and verified inactive-league source checks
- `betting/`: additive initialization, private forecasting, market publication, and settlement

Betting setup: `npm run betting:init`, `npm run betting:refresh`, then
`npm run betting:status`. The nightly and public-data jobs run Analytics then Betting;
admin/Discord scheduling changes queue a lighter worker using the existing
Analytics generation and saved historical pricing inputs. Routine workers keep
published preseason prices; an explicit `node scripts/betting/run.js --rebuild-preseason`
regenerates them after setup changes. See
[betting/README.md](../betting/README.md) for explicit actual-series links,
validation holds, season wallets, and Discord/locking cron configuration.
Read-only checks: `npm run betting:validate -- --season-id 3` reports model/source
readiness; `npm run betting:benchmark -- --season-id 3 --concurrency 5 --requests 100`
probes local market GET requests. Supply `--base-url` to target the deployment
host and monitor its RAM/CPU separately. Empty-season results do not establish
production player capacity.
Global worker runs persist pending revisions before work and report elapsed
time, peak process RSS and heap usage. Failed API refreshes retry with bounded
backoff; Admin Betting shows pending/retry/exhaustion status. Nightly and public
source wrappers attempt the derived refresh after partial ingestion while still
returning a failed cron result. For isolated wrapper tests, shell environment
overrides `LEAGUE_OF_LADS_ROOT` and `LEAGUE_OF_LADS_NODE` redirect their project
root and Node executable; production defaults remain `/root/LeagueOfLads` and
`/usr/bin/node`.

Analytics is created/migrated automatically by `node scripts/analytics/build.js`.
Use `--init-only` for schema creation or `--status` for a read-only status check.
Deployments build the client on a GitHub Actions runner with Node 22, then upload
the finished files to a per-run staging directory on the server. The server
updates its checkout with `git pull origin main`, installs server dependencies,
backs up databases, publishes the staged client and restarts PM2. Frontend installs
and Vite builds no longer compete with the live app for server memory. An install,
backup or Git pull failure leaves the published frontend untouched; staging
is cleaned up when the deployment command exits. Existing GitHub server secrets
are reused. Startup initializes additive source/Betting schemas; Analytics builds,
pricing and item downloads are handled separately. `nightlyRun.sh` builds even
without an active league, and admin controls can request an immediate refresh.
Source ingestion adds freshness/timestamp records
automatically on its next run. Details are in [analytics/README.md](../analytics/README.md).

The pull uses the server's existing Git configuration and retains its local
history; deployment does not push server commits to GitHub. Conflicting changes
still need to be resolved on the server. The published frontend is built from
GitHub source, so server-only frontend edits are not included in that build.

## Scheduled database backups

`db/backupDatabases.sh` keeps timestamped database backups for three days (72 hours)
by default. `nightlyRun.sh` prunes expired backups before ingestion and after its
final backup. An exported `BACKUP_RETENTION_DAYS` overrides the default; any existing
server override should be set to `3` for this policy. To apply retention immediately
after deployment without creating another backup:

```bash
bash scripts/db/backupDatabases.sh prune
```

This retention covers scheduled `.db` backups under `backups/`; one-off migration
and repair `.bak` files beside the source databases are managed separately.

## Match deletion and orphan repair

Admin match deletion and remake removal share one transaction that deletes draft
actions, series links, dependent telemetry, participation, player stats and league
membership before deleting the match. Admin audit recording is part of that
transaction. The series itself is retained because it can contain other games or
be referenced by a bracket. Live observations have their own retention lifecycle;
they can legitimately exist before a warehouse match is imported.

To repair existing warehouse children whose parent `MatchTeam` record was removed:

```bash
node scripts/db/cleanupOrphanMatchRecords.js db/LadsData.db
node scripts/db/cleanupOrphanMatchRecords.js db/LadsData.db --apply
```

The first command previews counts. `--apply` creates a SQLite backup beside the
database before deleting orphan rows in one transaction. It leaves valid duplicate
records, match dates, team/season alignment and series parents alone. It makes no
external API calls and is safe to rerun. Run this explicitly on the production
database after deploying; server restart does not perform historical cleanup.

`currentLeagueData.js` discovers new match IDs using the active league ID.
`matchDetails.js` fills details for warehouse matches without player rows.
Historical enrichment is a separate manual operation, not a deployment
step. Running a future backfill locally can spare production CPU and write load,
but does not bypass OpenDota request quotas. Use bounded, resumable collection
and import only the additional fields for curated existing match IDs; preserve
production corrections and newer data rather than replacing the live database.

### Extract saved skill builds

New match ingestion stores valid `ability_upgrades_arr` entries in
`MatchPlayerAbilityUpgrades` as `(MatchId, PlayerId, UpgradeIndex, AbilityId)`.
`UpgradeIndex` is zero based and preserves repeated ability IDs and talent IDs.
It represents upgrade order, not a confirmed hero level or timestamp. The compressed
archive remains available as source provenance. Missing or malformed sequences do
not replace an existing valid build; a valid newer parsed sequence can replace it.

To populate this table from existing archives without OpenDota requests:

```bash
node scripts/db/backfillAbilityUpgrades.js db/LadsData.db
node scripts/db/backfillAbilityUpgrades.js db/LadsData.db --apply
```

To process the entire local archive in one invocation:

```bash
node scripts/db/backfillAbilityUpgrades.js db/LadsData.db --apply --all
```

`--all` continues automatically through the batches, prints progress and final
totals, and creates one backup for the invocation. It still loads and commits one
match at a time. It makes no external API requests. Omit `--apply` to preview the
entire archive. Ctrl+C stops the run; completed matches stay committed, and rerunning
the command is safe.

Preview is read only, including before the schema migration. Apply backs up the
database, creates the additive schema, checks archive hashes and current player/hero
identities, and commits one match at a time. Each invocation processes at most 1,000
archives by default; use `--limit N` to change this and the printed `--after-match-id N`
to continue. With `--all`, this limit controls batch size rather than the overall
total. Repeating a range is safe and does not duplicate upgrades. Errors are
reported with match IDs; rerun those ranges after correcting the source problem.
The backfill also records the new section's coverage for validation, preserving
original archive hashes, collection times and ingestion outcomes. Old archives are
not required to have upgrade rows until explicitly extracted or reimported.
This extraction is manual, separate from deployment and startup.

The match page has four views: Overview (combined player stats and team totals),
Builds (starting/final items, spell upgrades and expandable purchase timelines), Analysis (game
flow, player economy and teamfights), and Draft. The Builds view shows two team
cards with each player's hero, equipment and upgrade sequence together.
`/api/matches/:matchId/analysis/skills` reads the normalized table for
all players in one request; it does not decompress archives or collect new data.
Missing builds are labeled unavailable. Overview keeps the scoreboard available
without loading build or analysis requests. Team comparisons require complete
recorded values for the listed players, so absent statistics do not become zero.
Numbered spell icons show spell names on hover and upgrade details on selection;
numbers mean upgrade order, not inferred hero levels. Talent and attribute upgrades
have distinct symbols, and unknown IDs retain a placeholder.

`client/src/data/dotaAbilities.json` is a bundled ID/name catalog derived from the
[OpenDota constants](https://github.com/odota/dotaconstants) revision recorded in its
`source` field; ability artwork uses Valve's image CDN, like item artwork. It is
loaded with the Builds view, not downloaded during deployment or
per match. Historical builds still need the explicit archive extraction above.

### Recover missing historical match durations

Historical enrichment preserved the original `MatchTeam.Duration`, including null
values. A missing duration prevents per-minute statistics and checkpoint eligibility
even when some recorded gameplay data is present. Recover these values from the
already saved source responses, without calling OpenDota:

```bash
node scripts/db/repairWarehouseDurations.js db/LadsData.db
node scripts/db/repairWarehouseDurations.js db/LadsData.db --apply
```

Preview is read only. Optionally scope either command with `--league=19264`.
Apply creates a SQLite backup and JSON report beside the database, verifies the
archive hash and match ID, and fills only null/zero/negative durations using positive
whole-second source durations. Existing valid durations, results, teams, player stats
and source archives are preserved. Changed/deleted records are skipped if they no
longer match the preview. This repair is explicit, not a server-start migration.
Keep it separate from an active backfill so that the backfill's preservation check
does not mistake the duration changes for unrelated edits. Reports refresh through
their existing cache; unavailable parsed timelines or support stats remain unknown.

## Match warehouse expansion

This is a shared EDW foundation in **LadsData**. Existing consumers retain their
current queries and behavior; adopting
the expanded data in those features is a later step. There is no new public API for
the source snapshots and no OpenDota patch identifier in the expanded schema.

### Schema and deployment

`config/warehouseSchema.js` applies versioned, repeatable migrations. Server startup
ensures the schema and seeds the shared patch calendar. Deployments do not launch
warehouse-wide data validation or protected-data fingerprint scans. Nightly ingestion
and refresh jobs continue on their existing schedule.

For manual maintenance, this command makes a SQLite-safe backup under
`backups/LadsData/` before the first migration and verifies protected data:

```bash
node scripts/db/migrateWarehouse.js db/LadsData.db
node scripts/db/migrateWarehouse.js db/LadsData.db --apply
```

The first command previews only. Scheduled retention also covers these timestamped
`.db` backups. Clean database creation includes the same expansion. Schema migration
does not fetch historical matches, infer rosters, correct results or regroup series.

### Concurrent site access during ingestion

`config/warehouseConnection.js` enables and verifies **WAL** on writable LadsData
connections used by the API, new-database creation, migrations and EDW workers.
The pinned `better-sqlite3` 12.8.0 includes SQLite 3.51.3's WAL concurrency fix.
Run `npm install` after updating the checkout. The deployment workflow installs it
and checks Node compatibility first (Node 22.12+ recommended). An unpatched SQLite
runtime is rejected before configuring concurrent WAL access.

- Readers can continue during a background write; writers still take turns.
- API writes wait up to 500 ms for a lock. Background connections wait up to
  100 ms, then the pilot yields and retries database work up to five times using
  its already-fetched response. Persistent contention stops the pilot batch.
- Migration connections allow 5 seconds; read-only validation connections allow
  1 second. Preview and validation do not change journal mode.
- `synchronous=FULL` retains committed-write durability. Automatic passive
  checkpoints run at 1,000 WAL pages, and the pilot attempts another passive
  checkpoint when finished. Readers can defer checkpoint completion; no blocking
  restart/truncate checkpoint is forced during live traffic.
- Match writes remain short transactions with network access outside them.
  WAL does not eliminate schema-change locks or CPU/disk contention.

SQLite manages the adjacent `-wal` and `-shm` files; do not delete them while the
database is active. Continue using the existing SQLite backup commands, which
include committed WAL data in a consistent backup. Three-day retention is unchanged.

References: [SQLite WAL](https://www.sqlite.org/wal.html),
[driver release and SQLite fix](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.8.0).

### Tables and added fields

| Table | Grain / contents |
| --- | --- |
| `Patches` | Our own integer key, patch name, 1 AM New York reporting cutoff, major flag and Valve source |
| `MatchTeam` additions | Actual kickoff as Unix UTC seconds, our patch ID, Radiant/Dire scores and first-blood time |
| `MatchPlayer` additions | Source player slot, denies, level, lane/roaming, vision, stacks, stun seconds and additional unit/objective kill counts |
| `MatchTeamTimeline` | One match/time sample of Radiant gold and XP advantage |
| `MatchPlayerTimeline` | One match/player/time sample of source `gold_t`, `xp_t` and `lh_t` values |
| `MatchPlayerPurchases` | Every supplied purchase, including repeats and pregame purchases |
| `MatchObjectives` | Every supplied objective event; retain source detail and unresolved actor attribution |
| `MatchTeamfights` / `MatchTeamfightPlayers` | Every supplied fight and its player observations; no winner or importance classification |
| `MatchIngestionState` | Importer/parser version, status, coverage, hash, attempts, errors and identity conflicts |
| `MatchSourceResponses` | One compressed, retained gameplay snapshot per match, merging available sections to preserve richer prior data |
| `WarehouseMigrations` | Applied schema versions |

Additions are nullable. Missing data remains unavailable; zero is retained. Source
snapshots allowlist gameplay fields and supplementary kill, ward, buyback, rune,
ability and item observations. They exclude chat, ranks, MMR and public scouting.
`Gold` stores the source `gold_t` value without substituting final net worth.

### Ongoing ingestion and maintenance

`matchDetails.js` sends its existing fetched response to `ingestWarehouseMatch`.
There is no extra OpenDota request for a new match. The importer validates existing
player/hero identities and writes expansion data in one transaction. It
preserves original results, team IDs, league membership, dates, series and player
statistics. Repeated core inserts do not append additional identical records.

For deliberately refreshing incomplete historical core records from a more
complete response, the numbered batch runner supports `--repair-incomplete`.
It preserves warehouse team IDs and season/series metadata, records exact
before/after changes, and validates all remaining protected data. See
[repairing incomplete records](league/warehouse-batches/README.md#repair-incomplete-historical-records)
for eligibility, preview/apply commands and report details. Ordinary nightly
ingestion and batches without this flag retain their additive behavior.
Malformed or missing sections retain prior observations; conflicts are reported.
Substitute source team IDs and historical membership ID differences do not block
enrichment or create errors. Raw team IDs remain in the source snapshot; curated
team IDs and memberships stay authoritative and are never rewritten by EDW.
Admin deletion, remake removal and orphan repair include all expansion children.

The separate `syncWarehousePatches.js` job runs before active-league ingestion,
including between seasons. It requests Valve's calendar, applies the 1 AM New York
cutoff and updates patch assignments for landed kickoff times.

### Public match, player and team analysis

`config/warehouseReporting.js` reads the landed EDW without fetching OpenDota or
changing match records. `routes/warehouseReportingRoutes.js` provides these public
endpoints, mounted under `/api`:

- `/matches/:matchId/analysis`: scoreboard, patch/kickoff, team and all-player timelines, and objectives.
- `/matches/:matchId/analysis/inventories`: all players' final inventories and starting purchases in one response, from one cached source read. Starting items are normalized purchases at or before 0:00; repeated buys are retained and missing purchase logs remain unavailable. Builds uses one shared starting-slot count for the match (6–10 columns), aligning every player's panels while keeping starting and final icons equal in size. Extra starting purchases wrap.
- `/matches/:matchId/analysis/events`: timed hero kills from the cached gameplay archive, with victim icons assigned opposite their own side.
- `/matches/:matchId/analysis/draft?scope=season|patch&period=full|before`: final lineups, hero familiarity, league hero pick/ban counts and opposing-player experience for banned heroes. Full season is the default.
- `/matches/:matchId/analysis/draft/views`: all available season/patch and full/before views in one response for the Picks & bans tab.
- `/matches/:matchId/analysis/players/:playerId`: player timelines, purchases and final inventory.
- `/matches/:matchId/analysis/fights`: expandable fight observations and side totals.
- `/player/:playerId/performance`: farming, combat/support rates, hero/patch/team breakdowns and examples.
- `/teams/:teamId/performance`: early advantages, lead conversion, objectives, contribution distribution and examples.

Performance endpoints accept `leagueId` and `patchId` (numeric IDs or `all`);
the player endpoint also accepts `heroId`. Each metric includes its own eligible
sample count. Only successfully enriched `ready`/`partial` games contribute;
unenriched games remain in the coverage denominator. Zero remains a value,
missing data is unavailable, and checkpoint metrics exclude games that ended
before that checkpoint. Team sums require five recorded players. Duplicate
legacy membership/player rows do not multiply the reported observations.

Game flow overlays gold and XP advantages with independently selectable lines.
The chart uses full panel width, with the event log below. Hero death, tower and
Roshan icons can be toggled independently. Same-side events within 30 seconds
of a stack's first event align vertically at their mean time; neighboring columns
are separated to avoid overlap. Hover details and highlight lines retain exact
event times. Hovering or focusing an icon or log entry highlights both. Hero
death times come from archived `kills_log` entries, so creep/world deaths may
be absent. No source response or private fields are exposed by the events endpoint.
Player economy supports any combination of players, retaining the selection
across gold, XP and last-hit views. Overview → Items shows all final inventories
and a separate player selector for purchases. Scoreboard Details buttons open
Items with that player selected. `gold_t` is total earned gold, not net worth; the scoreboard retains
the separately recorded final net worth. Team header GP/WR use the match's season.

Draft context loads all period/patch combinations in one request when Picks &
bans is opened. Changing the period dial, patch filter or context view uses that
loaded snapshot without fetching again. Leaving and reopening the tab requests
the snapshot again; normal server report caching still applies. Full season is selected
by default, including the current match and later games in the same season.
The labeled period switch applies to every draft context view. Before this match
limits history to earlier match IDs, also rejecting known kickoff times at or
after this match. Missing kickoff times use match order, disclosed in that view.
The optional same-patch view excludes games without a matching patch assignment.
Legacy scoreboards contribute without requiring EDW enrichment. Duplicate player
rows and bans do not multiply samples; unknown results do not become losses.
Hero familiarity includes stand-in appearances and makes no claim about a ban's
intent. This report does not fetch external data or alter warehouse records.
Draft frequency is the default context view, with Team Specific and League
Specific groups showing pick, ban and same-phase percentages with explicit
counts/denominators. Team samples follow the acting team's curated ID across
Radiant and Dire and count only its own actions. Team phase samples require an
action by that team in the phase. Phase labels follow
consecutive pick/ban blocks in the actual ordered draft, accommodating different
season formats. Picks and pick rates use deduplicated played lineups, including
valid games without a stored draft. League pick samples require ten known unique
heroes; team pick samples require five known heroes assigned to that team.
Bans, phases and contest rates use complete, unambiguous recorded drafts.
Contest keeps its own numerator from those drafts rather than adding played
picks from the larger game sample. The UI labels game and draft samples separately.
Matches without draft actions show played heroes without inferred order or phases.
Same-phase denominators include only
drafts containing that phase. Missing history is unavailable, not 0%.
On ban rows, Team Specific Ban % also shows a secondary opponent pick rate,
using only the opposing team's played heroes and known team lineups. Hover reveals
the opponent name and sample count. Unknown opponent history is unavailable.

Source player slots determine sides; legacy fallback requires an unambiguous
membership in a recorded match team. Corrected warehouse team IDs are retained.
Tower events caused by creeps can be assigned from the destroyed structure;
player credit remains unknown. Denies are excluded from first-tower rates.
First-objective rates require an identifiable first event. Lead-conversion rates
exclude tied checkpoints and unknown winners. Comebacks/leads lost use an
explicit 10,000-gold threshold. Team reports show gold/XP advantage and ahead/behind
win rates at 30, 40, 50 minutes and later ten-minute checkpoints using the existing
minute timelines. Only games reaching each checkpoint with the relevant recorded
sample contribute. Percentage colors progress from red to yellow to green, with a
50% midpoint for win/objective rates and 20% for role-dependent damage share.
Fight windows do not imply a verified fight winner.

Player farming and contribution metrics show percentiles of player averages within
the selected season, patch and hero. Each metric requires five eligible games per
player and two qualifying players; ties use the midpoint rank, including the viewed
player. The cached comparison pool includes all eligible league players, not just
opponents of the viewed player. Shares remain role-dependent context. Team
distribution includes average per-game final net worth share, requiring all five
players' net worth. Expanded team game examples include every available later gold
checkpoint. Performance filters include Season alongside Patch and Hero; the
single-series player trend uses its statistic dropdown without a line-toggle legend.

Team performance cards show percentiles against team averages/rates in the selected
season and patch. The comparison pool is cached across team pages and built in one
pass over league data, including teams that have not faced the viewed team. Each
metric requires five eligible games per team and at least two qualifying teams;
conditional win rates require five games meeting that condition. Ties share a rank.
Earlier first-tower and first-Roshan timings receive higher percentiles. Team cards
keep eligible-game counts in hover text rather than repeating them below values.

### Hero and league performance

The read-only reporting router also exposes:

- `/api/hero/:heroId/performance`
- `/api/leagues/:leagueId/performance`

Filters are `leagueId`, `patchId` (`all` or a positive ID), and `stage` (`all`,
`regular`, `tiebreakers`, `playoffs`, `unknown`). Explicit series stages take priority over stored
league stage boundaries. Missing or conflicting classifications remain unknown;
they are included in All stages and are not guessed into another stage.

Hero Performance and League Performance load on opening their tabs. Responses use
the existing bounded, revision-aware 60-second cache. Completed backfill imports
become visible without another Analytics job, schema change or API download.
No source-match or roster records are modified by these views.
Hero Performance exposes Season and Patch filters; Stage is available on League Performance.

Hero reports distinguish played picks from complete-draft bans/contest rates,
show usage/results, player rankings on that hero, patch results, and item purchase
timings. Role-mixed farming/contribution cards and cross-hero percentiles are omitted.
Purchase timing is the median of the first recorded
purchase of each item in each game; recipes, negative pregame times and events
after match end are excluded. Purchase win rate is descriptive, not causal.
Player-table percentiles compare players on the selected hero; roles can still
differ. Damage/net-worth shares are role-dependent context.

League reports include season averages, sortable team and player comparisons,
hero draft trends, 10K comeback wins, smallest final gold gaps, longest games and
standout player performances. Player/team combinations remain separate records.
Percentiles compare the full eligible population in the filters, not only the
rows visible after search/minimum-game filtering. Tables initially show 50 rows;
sorting applies to the complete dataset before the row limit.

New performance tables have no exterior frame inside cards, center numeric columns
and leave the first column left aligned. Game samples remain in hover text when a
Games column or coverage label already exists. Percentiles display as `X% out of Y`
players, teams, heroes or player/team records as appropriate; five eligible samples
per entry and two entries are required. Frequency percentages remain neutral;
win/contribution percentages and percentiles use the red/yellow/green gradient.

Fight breakdowns compare recorded deaths, gold/XP edges, team damage shares,
healing and buybacks. The summary names the team with fewer deaths; gold/XP
edges are shown separately. Team totals and resource edges require all five player
records and the relevant values on each side. Deaths and buybacks are grouped
by team beside the comparison table. Deaths count events,
so a player can die more than once after buying back. The overview counts fight
windows containing buybacks; overlapping windows prevent safely summing unique
buybacks across the match. Resource changes include everything recorded during
the window, including farming. Objective context shows non-denied structures,
Roshan, Tormentor and Aegis events during a fight and within 90 seconds afterward,
stopping at the next fight's start or match end. This timing does not establish
that the fight caused an objective to be taken.
Collapsed fight summaries also show this aftermath as team-colored objective
badges or "No objective gained". Missing objective data is shown as unavailable.

The reporting cache is limited to 48 entries with a 60-second TTL, and is cleared
on detected database changes. Detailed analysis and the player/team Performance
tabs load on demand. The final-item name/icon catalog is bundled from
[OpenDota dotaconstants](https://github.com/odota/dotaconstants/blob/master/build/items.json);
inventory images use Steam's CDN. The compressed source archive is decoded only
for the requested match/player inventory, and no raw archive, ranks, MMR or
public-match scouting is sent to these endpoints. These reports do not depend
on Draft God. There is no additional schema migration for the views.

### Item catalog refresh

Run `node scripts/assets/refreshDotaItems.js` manually from the repository root
when the item catalog needs an update, then rebuild the client locally. GitHub
deployment builds use the tracked bundled `client/src/data/dotaItems.json` without
downloading a catalog; the server's ignored generated file is not part of that
build. To publish a catalog update, review the generated data and update the
bundled snapshot in Git. The command fetches
OpenDota's item constants with a 15-second timeout and an 8 MB response limit,
then keeps only the frontend's item ID, key, display name and Steam image path.
Unnamed internal entries are skipped. Malformed schemas, duplicate IDs, unsafe
image paths and suspiciously small responses are rejected.

The generated catalog is `client/src/data/dotaItems.generated.json`, ignored by
Git so local catalog updates do not block later pulls. Updates merge into the last
valid catalog, retaining retired items and refusing to remap an existing item's
ID to a different key. A temporary file and atomic rename protect the last good
file. A source or write failure logs a warning and lets the next build use the
existing catalog. If no usable bundled catalog exists, the command fails.

Vite resolves `@dota-items` to the validated generated catalog, falling back to
the bundled `dotaItems.json` when the generated file is absent or invalid.
New metadata takes effect on the next frontend build. Images still load from
Steam's CDN; failed images retain the visible item-name fallback.

Local examples with the Season 20 pilot data:
`/match/8687558273`, `/player/99623012` and `/team/9592563` (select Season 20,
then Performance on player/team pages).

### Season 20 validation run: explicit, bounded and manual

The planner reads **existing warehouse match IDs only**, including undated
games. It excludes remakes and identical-team records. Stale winner references are
listed separately as data-quality notes and do not block enrichment. Preview makes
no API calls and does not alter the database:

```bash
node scripts/league/enrichWarehouse.js db/LadsData.db --league=19264 --limit=400
```

Season 20 has 365 stored matches. A limit of 400 covers the whole eligible season,
using at most 365 GETs on the initial import; completed imports are skipped.
Match 8687581783 is eligible despite its stale winner reference. The stored winner
is preserved and reported for separate review. The run does not discover additional
matches from OpenDota.

When ready to fetch the reviewed season on the server:

```bash
node scripts/db/validateWarehouse.js db/LadsData.db --baseline=season20-before.json
node scripts/league/enrichWarehouse.js db/LadsData.db --league=19264 --limit=400 --apply
node scripts/db/validateWarehouse.js db/LadsData.db --league=19264 --deep --compare=season20-before.json
```

`--apply` backs up first and checks protected data before/after the run.
Use `--no-backup` when deliberately loading a local database without a backup;
the protected-data comparison and deep source validation still run.
Each selected ID gets at most one GET, with no automatic retries or replay-parse requests. The
default batch is 25, maximum 500, with at least 1,100 ms between requests. HTTP
401/403/429 stops the batch. Ctrl+C stops collection; completed imports persist.
Ready imports are skipped; other attempts have a seven-day cooldown. `--force`
bypasses those skips and can repeat requests, so use it only for a reviewed rerun.

These are **per-run** request limits, not account-wide daily quota accounting.
OpenDota's [published configuration](https://github.com/odota/core/blob/master/config.ts)
defaults to 3,000 requests per day and 60 per minute without an API key. Allow for
other jobs sharing the server's quota; a run still stops on a quota response.
The full initial season needs about 6 minutes 40 seconds of spacing alone, plus
network and database processing time. Missing historical parsed data may leave
some imports partial; the script does not request replay parsing.
The numbered batch runner below adds persisted request accounting and minute-limit
cooldowns for the remaining seasons. Neither historical runner is added to cron or
deployment. Do not concurrently edit protected
data during reconciliation: legitimate admin edits will also appear as differences.

### Numbered whole-season batches

Use `league/backfillWarehouse.js` with a numbered file under
[`league/warehouse-batches/`](league/warehouse-batches/README.md). Each season belongs
to exactly one file. Run one file, review its validation report, then run the next
file manually on another day. There is no automatic handoff to another batch.

| File | Whole seasons | Stored matches before skips/exclusions | Maximum initial requests including retry allowances |
| --- | --- | ---: | ---: |
| `batch-01.json` | 21 through 15 | 2,292 | 2,327 |
| `batch-02.json` | 14 through 5 | 2,380 | 2,430 |

These counts reflect the current warehouse. Completed EDW imports, including the
125-match local sample, are skipped. Preview recalculates counts against the chosen
database; it makes no API calls and writes no reports, ledger or backup.

From the repository root, preview and then run the first file:

```bash
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-01.json
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-01.json --apply
```

After reviewing the report, on another day:

```bash
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-02.json
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-02.json --apply
```

Append `--no-backup` for an intentional local run without a backup. Otherwise apply
creates one SQLite-safe backup under `backups/LadsData/` before the batch; scheduled
three-day retention covers it.

Settings are in `league/warehouseBackfill.json`:

- At most **2,500 requests per UTC day**, with every retry counted. Five extra
  requests per season are reserved when planning. A file that does not fit its
  remaining allowance is refused before any requests are sent.
- A persistent counter beside the database, `LadsData.db.warehouse-backfill.json`,
  survives restarts and is shared by both numbered files. Do not delete it to reset
  a budget. A `.warehouse-backfill.lock` prevents two batch workers for that database;
  after a hard crash, verify the worker is stopped before removing a stale lock.
- Other OpenDota jobs do not share this counter. Actual remaining-day response
  headers are also checked, preserving **300 requests** for other work. Other jobs
  or a lower provider quota can still interrupt a planned file.
- Requests start at least **2 seconds** apart. Minute-limit responses wait at least
  **120 seconds**, honor a longer `Retry-After`, then retry the same match. Further
  minute responses increase the cooldown. Low remaining-minute headers also pause
  proactively. Retries are bounded by three per match and five per season.
- Daily limits, authentication errors, persistent database contention or an unknown
  rate-limit response stop collection. Minute limits do not mark a match as bad data.
  Individual source errors, identity conflicts, partial responses and source
  warnings are recorded for end-of-batch review; the remaining matches and seasons
  continue. Protected-data changes, structural errors and deep source
  reconciliation failures still stop progression to the next season.
- Ctrl+C stops collection. If a quota or interruption prevents completion, rerun
  the **same file** later; completed imports are skipped. No season moves into a
  different batch file. Partial/error attempts retain the seven-day retry cooldown;
  review them rather than repeatedly requesting permanently unavailable old data.

The printed report directory is under `Logs/warehouse-backfill/`. It contains:

- `validation.md`: readable batch summary.
- `summary.json`: totals, coverage, integrity checks, deep source reconciliation and
  `reviewRequired` for match errors, warnings or partial coverage.
- `league-<id>.json`: each attempted season's results and discrepancies.
- `plan.json`: selected IDs, exclusions and request allowances.
- `baseline.json`: hashes/counts of protected original data, not a database backup.
- `events.jsonl`: progress, waits, match IDs and rate-limit responses.

Remakes and identical-team records remain excluded and listed in the plan.
Stale winner references appear under `dataQualityNotes` and in the readable report;
they do not block imports, fail validation or stop the next season. Original winner
IDs remain unchanged. `winner_not_recorded_team` notes alone also do not set
`reviewRequired` or produce a nonzero exit code. Substitute source team IDs are
accepted. A season can have partial EDW coverage if
OpenDota no longer has its parsed sections. Exit code `0` means the selected imports
finished, `1` requires review of errors/validation, and `2` means the file stopped or
could not fit the remaining allowance. Review exclusions and coverage even on exit 0.

### Validation gates

The baseline streams hashes and row counts for every existing table and original
column, including existing private feature tables. Only EDW tables and the added
match fields are excluded. Deep validation checks compressed source hashes, patch
assignment, player additions, timelines, repeated purchases, objectives and fights
against landed records. Coverage distinguishes ready, partial, conflict, error and
not imported; structural validity alone does not mean every match has complete data.

Before approving Season 20, review discrepancies and coverage, compare existing
match/player/team/league/series/awards output, and check live API latency and memory.
Do not schedule the remaining seasons until that review passes.

## Draft God

Draft God is private to Steam account ID **49219700**. Every `/api/draftgod`
request checks the authenticated Steam identity. League admin status, the legacy
`DraftAccess` table, session permission flags, and `ADMIN_ID` do not grant access.
Responses use `Cache-Control: private, no-store`.

The normal server restart creates the private draft, patch calendar, meta override,
patch-specific hero profile, and compact telemetry tables and indexes in LadsData.
It seeds the bundled patch calendar. Existing drafts are not overwritten. It also
adds `PublicPlayerSync` and public match date/player indexes when public.db is
initialized. No manual migration or database upload is required.

### Workflow

1. Open **DraftGod → Preparation**, select a season and the two teams. Signup
   teams work before their external team IDs are linked or their first game is played.
2. Confirm five different players on each side, replacing stand-ins through the
   player search. Positions are optional; configured positions must be unique.
   Historical lineups are suggestions, not finalized rosters.
3. Set first/second pick independently of Radiant/Dire, verify the action sequence,
   and choose the data cutoff. The default sequence is `league-cm-24-v1`; custom
   sequences are stored with each draft. Start the draft to freeze the config.
4. In **Live draft**, record actions, assign players or leave heroes as flex picks,
   undo/redo, and click a recorded pick/ban to edit it. The assignment solver uses
   each player once and respects known hero position constraints.
5. Drafts autosave after 750 ms idle. Refresh restores the last opened draft in
   this browser. **Save alternative** creates an independent scenario. A stale
   revision from another tab stops autosave and offers reopening or an alternative.
6. **Scouting** shows player pools, public practice, team tendencies and observed
   hero pairs. Private hero profiles let the owner maintain positions and traits
   for the league's patch. Unclassified traits stay unknown. These profiles are
   saved per patch. Reopened drafts use that patch's current private curation,
   identified as curated with today's knowledge rather than historical observations.
7. **Matchup overview** compares chemistry, pool pressure, player style, recent
   form, draft phases and responses, game-length results, and timeline evidence.
   Choose adaptive outcomes, current-patch-only outcomes, or the last 30 days.
   Meta overrides apply to a global patch boundary or one hero and can be reset.

The assessment is a symmetric heuristic on a 0–100 scale, not a win probability.
Player comfort uses games, smoothed results and usable recent public observations;
it does not compare raw farm/damage between support and core players. An empty
draft has unknown confidence. Team pick rates divide by completed team games.
Hero-pair results are historical associations, not causal counter estimates.
Composition coverage requires owner-provided hero metadata; no traits are invented.

### Data and performance

The API returns aggregated player/hero/team/matchup summaries, not raw duplicated
match histories. League summaries are cached for up to 60 seconds with database
revision invalidation and a three-entry bound. The browser only recalculates draft
analysis on those summaries. The page is loaded as a separate frontend chunk.
Legacy scouting continues to read league history directly; this does not expand
Analytics beyond its signup-era scope or change Betting's ownership of odds.

League inputs use dated history from up to five years at/before the selected league.
Seasons are not treated as patches. Only completed official games with valid teams and
winners count. Remakes marked `Rehost`, conflicting memberships, duplicate imports,
future games, and undated games are excluded. Since a date-only record does not
establish kickoff time, all such games on the cutoff day are excluded.

Public observations cover the 30 days before the cutoff with a 14-day half-life.
The existing `generatePublicMatchData.sh` job now discovers signup players before
their first game and records per-player collection successes/failures. It must
still be scheduled as before; opening Draft God does not fetch OpenDota. Missing
or stale public data falls back to league-only scoring. The UI distinguishes
last observed match date from successful collection. No Elo/MMR is used.

### Meta-aware evidence and timeline enrichment

The calendar comes from Valve's public datafeed, retaining major/minor boundaries.
Hero-change markers come from corresponding patch notes. Rework/replacement text
is conservatively flagged as a reset, not an inferred balance score. Unmentioned
heroes still receive a global discount because items, systems and opponents change.
Pair evidence checks both heroes.

Default policy (heuristic, not fitted probabilities):

- Outcome half-life: 60 days; major boundary transfer: 35%; minor: 90%.
- Additional hero transfer: changed 45%, reset 0%, unmentioned with notes 97%,
  unknown notes 65%. Owner overrides adjust the global or hero component.
- Familiarity half-life: 365 days; a reset retains 20% at that boundary. Older
  practice can support comfort without carrying an old win rate forward.
- Unknown patch outcome transfer: 10% in adaptive mode, excluded in strict modes.
- Matchup/pair scoring requires five retained outcome games. Retained games are
  the sum of policy weights, not an independent sample size estimate.

Descriptive tables show raw counts and patch splits. Current/recent modes filter
overview observations; familiarity can still carry older experience in the live
pool model. Team-ID history can contain other lineups; chemistry and lineup hero
pairs follow confirmed players across team IDs. Result changes are not asserted
to be caused by the patch. Profiles and overrides are current owner judgement,
not a reconstruction of what the owner knew at a historical date.

New league ingestion stores a compact whitelist from the OpenDota response it
already fetches. No extra request is needed for those games; rank, chat, MMR and
raw replay arrays are not retained. `nightlyRun.sh` refreshes the patch calendar
(up to 8 missing note summaries) and enriches up to 20 existing active-league
games. Source failures are logged without blocking standings or settlement.
Opening the page never performs external collection. Tables alone do not backfill
historical replays; run a bounded enrichment for a chosen season:

```bash
node scripts/league/syncDraftPatches.js db/LadsData.db 50
node scripts/league/enrichDraftGod.js db/LadsData.db --league=19264 --limit=20
# Optional targeted historical preview:
node scripts/league/enrichDraftGod.js db/LadsData.db --league=19264 --team=10027233 --before=2026-03-03 --limit=20
node --test tests/draftGod.test.js tests/draftIntelligence.test.js
```

Enrichment reads public endpoints at about one request per second, never requests
a paid replay parse, skips ready matches, and retries partial/error records after
7 days. `--force` deliberately refreshes ready matches. Each run is capped at 200
games. Some old replays remain unavailable. Lane snapshots, lead conversion,
comebacks, first objectives, fight follow-up and item timing medians each show
their own observation counts. Missing stays unknown; zero remains zero. Item
medians are among observed buyers. Lane gold baselines match hero, patch and
parsed lane, require five other-player observations, and do not infer numbered
farm positions.

Sources: [Valve calendar](https://www.dota2.com/datafeed/patchnoteslist?language=english),
[OpenDota API](https://docs.opendota.com/).

### Historical replay

```bash
node scripts/league/replayDraftGod.js db/LadsData.db db/public.db 19817 50
node --test tests/draftGod.test.js
```

The replay reads source databases without modifying them, uses a disposable SQLite
backup, and analyzes complete recorded drafts with their known five-player lineups.
Analytical match/public inputs must precede each game's cutoff. It reports scores,
coverage, outcomes and skipped records for inspection; it does not calibrate odds
or prove predictive accuracy. Patch-specific hero metadata is used where available.
Date-only games use
the start of their day to prevent same-day result leakage.

Create a new, empty LadsData database with the schema committed in this repo:

```bash
node scripts/db/createLadsDataDb.js db/LadsData.db
```

The target must not already exist. This creates tables and indexes only; it does
not copy leagues, matches, users, or other data. To refresh the schema snapshot
from the current database after a schema change:

```bash
node scripts/db/exportLadsDataSchema.js db/LadsData.db scripts/db/ladsData.schema.sql
```

The exporter reads through SQLite, including committed WAL changes.

Historical league winners are imported into `LeagueSeasons` automatically when the
updated server starts. The import uses the same final-match winner the older league
pages already displayed, creates ended season records, and preserves existing saved
champions and the active league. Rerunning it adds no duplicates. Known historical
end dates are preserved; missing dates remain unknown.

To preview or apply the same backfill manually against an existing initialized database:

```bash
node scripts/db/backfillLeagueChampions.js db/LadsData.db
node scripts/db/backfillLeagueChampions.js db/LadsData.db --apply
```

The manual apply creates a SQLite backup beside the database before writing. No full
database upload is needed; the normal deployment restart runs this backfill in production.

The server also creates `ChampionshipRosterPlayers` and the league/match/player
lookup indexes it needs automatically on startup.
Under **Admin → Champions**, select a completed legacy season and its champion,
then move five players into **Active players** and save. Candidates come only
from that team's matches in that season. The saved five receive championship
trophies instead of using the inferred majority-appearance lineup. Selections
are stored per season and team, and changes are audited. Seasons with finalized
signup rosters continue to use those rosters. No manual migration is required.

After deploying the updated code, add the base rulebook to the existing
production database. The deploy workflow already restarts PM2. From the
project directory on the server, preview the import, apply it, then verify
that no items remain to be added:

```bash
cd /root/LeagueOfLads
node scripts/db/importRulebook2024.js /root/LeagueOfLads/db/LadsData.db
node scripts/db/importRulebook2024.js /root/LeagueOfLads/db/LadsData.db --apply
node scripts/db/importRulebook2024.js /root/LeagueOfLads/db/LadsData.db
```

The importer creates the `SiteRules` table if needed, backs up the database
before changing it, and adds the rulebook's headers and rules in source order.
It preserves existing matching entries and can be rerun without duplicating
them. The final preview should report `"add": 0`. Reload the public Rules page
and the admin Rules tab to see the imported entries.

Before starting the updated server in production, run the additive preseason
admin migration against its existing database:

```bash
node scripts/db/migratePreseasonAdmin.js /root/LeagueOfLads/db/LadsData.db
```

The script creates a SQLite backup beside the database before changing it.
It adds `LeagueTeamNames`, `GroupResultOverrides`, `LeagueRosterEntries`, and
the roster name index. Existing league, group, team, and match rows are kept.
Running it again reports that the schema is already present.

Before starting the server version that uses database-backed admin access, seed
the current admin in production:

```bash
node scripts/db/migrateAdmins.js /root/LeagueOfLads/db/LadsData.db <current-admin-account-id> "Admin Name"
```

The ID is the Steam account ID previously used as `ADMIN_ID`, rather than the
64-bit Steam ID. This migration creates `Admins` with `AdminPlayerId`,
`AdminPlayerName`, and boolean `HeadAdmin`, then inserts that admin as a head
admin. It backs up the database first and can be rerun safely. The new server
checks this table for every `/admin` request. Admin Management in the portal
shows the current list to every admin. Head admins can select an existing
`PlayerInfo` player by account ID or display name, choose their role, and change existing
admins between Admin and Head Admin. They can also add an account manually by
Steam account ID and name if it is absent from `PlayerInfo`. Head admins can
remove non-head admins.
There is no cap on head admins; the final head admin cannot be demoted.

The active league's preseason roster is entered in the Admin tab before teams
have Dota TeamIds. After each nightly match load, `populateTeamNames.js` links
newly played teams to roster rows only when their names match uniquely after
case and whitespace normalization. Matches still load when names differ. Admins
can link those rows manually in the group setup table using a team ID from a
played match. Tiebreakers and playoffs require every preseason row to be linked
or removed.

The root shell wrappers remain at the project root because server cron/PM2 jobs
may call those paths directly.

Before deploying compact live snapshots, stop the live poller and server, then run:

```bash
node scripts/db/migrateCompactLiveSnapshots.js /root/LeagueOfLads/db/LadsData.db
```

The migration backs up the database, moves snapshot team names into columns,
removes the raw API response from `LiveMatchSnapshots` and
`LiveMatchCurrentState`, and compacts the database file. Player and draft data
remain in their existing tables. Check the site after restarting, then remove the migration's
`.bak` file when the backup is no longer needed to reclaim that space.
