# Scripts

Utility and scheduled-job scripts live here to keep the project root focused on
app entrypoints and shared modules.

- `league/`: active league ingestion and standings jobs used by `nightlyRun.sh`
- `public/`: public match-data generation jobs used by `generatePublicMatchData.sh`
- `legacy/`: one-off historical league utilities
- `assets/`: asset download/build helpers

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

## Match warehouse expansion

This is a shared EDW foundation in **LadsData**. Existing consumers retain their
current queries and behavior; adopting
the expanded data in those features is a later step. There is no new public API for
the source snapshots and no OpenDota patch identifier in the expanded schema.

### Schema and deployment

`config/warehouseSchema.js` applies versioned, repeatable migrations. Server startup
ensures the schema and seeds the shared patch calendar; the deployment workflow runs
the migration command before restarting PM2. This command makes a SQLite-safe backup
under `backups/LadsData/` before the first migration and verifies protected data:

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
Malformed or missing sections retain prior observations; conflicts are reported.
Substitute source team IDs and historical membership ID differences do not block
enrichment or create errors. Raw team IDs remain in the source snapshot; curated
team IDs and memberships stay authoritative and are never rewritten by EDW.
Admin deletion, remake removal and orphan repair include all expansion children.

The separate `syncWarehousePatches.js` job runs before active-league ingestion,
including between seasons. It requests Valve's calendar, applies the 1 AM New York
cutoff and updates patch assignments for landed kickoff times.

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
IDs remain unchanged. Substitute source team IDs are accepted. A season can have partial EDW coverage if
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
