# Scripts

Utility and scheduled-job scripts live here to keep the project root focused on
app entrypoints and shared modules.

- `league/`: active league ingestion and standings jobs used by `nightlyRun.sh`
- `public/`: public match-data generation jobs used by `generatePublicMatchData.sh`
- `legacy/`: one-off historical league utilities
- `assets/`: asset download/build helpers

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

## Analytics and betting v2 foundations

Create the new analytics database without changing `LadsData.db` or `public.db`:

```bash
node scripts/db/createAnalyticsDb.js
```

This creates `db/Analytics.db` with private preseason features, model forecasts,
historical player stats, and public-safe homepage feed tables. To refresh the
historical league-player, recent public betting-form, weekly, and completed-match
data immediately:

```bash
node scripts/db/refreshAnalytics.js
```

Use `--league` for the homepage/league data only, or `--public` for the recent
public-match betting inputs only. The league nightly job uses `--league`; the
public-match generation job uses `--public` after ingestion. Neither mode needs
the other source database to be present.

The refresh reads `LadsData.db` and `public.db` without changing either one,
updates only derived data in `Analytics.db`. Historical player totals include matches
whose play date is missing; weekly/homepage timelines require dated matches.
The homepage queries **only league-derived tables**. Public-match form is kept
in a separate analytics table for future betting models; it is never returned
by the homepage endpoint. The homepage shows historical leaders, **not** odds
or a current signup-roster forecast. No forecast is created from absent signup
data. The backup job includes
`Analytics.db` once it exists.

For an **illustrative, non-bettable** player-market preview using the most recent
completed league as the player pool, run:

```bash
node scripts/db/buildSamplePlayerModel.js
# Or use a specific historical LeagueId:
node scripts/db/buildSamplePlayerModel.js 19264
```

The result is stored in `SampleModelRuns` and `SamplePlayerForecasts`, separate
from real-season `ModelForecasts` and `Betting.db`. Every category is built
separately for the regular season (`g`/group-stage matches) and playoffs (`p`
matches); tiebreakers are excluded. It covers most phase kills, deaths, and
assists; highest single-game kills, deaths, assists, and GPM; and highest
average GPM. Players need at least five regular-season games or two playoff
games for the respective preview. Each simulation assumes the player repeats
up to 35 regular-season or 16 playoff appearances. The model samples only
their games from that phase and blends recent public K/D/A at no more than 25%; GPM
uses league games alone because public rows have no GPM. The displayed fair odds
are simply `1 / simulated probability`, with no margin or calibration. They are
**not** safe to publish as betting lines: signups, participation, team context,
settlement rules, and model validation are still missing.

To inspect every player for one category, query `Analytics.db`:

```sql
SELECT PlayerName, PriorLeagueGames, RecentPublicGames, ProjectedGames,
       ProjectedValue, WinProbability, IllustrativeFairOdds
FROM SamplePlayerForecasts
WHERE SampleRunId = (SELECT MAX(SampleRunId) FROM SampleModelRuns)
  AND Phase = 'regular'
  AND MetricKey = 'regular:season_kills'
ORDER BY Rank;
```

Preview the betting v2 rebuild against an existing database using its absolute
path:

```bash
node betting/migrations/rebuildBettingV2Cli.js --db /root/LeagueOfLads/db/Betting.db --dry-run
```

After signups close and every team is grouped, create roster-specific regular
season forecasts with `node betting/analytics/buildPreseasonForecastsCli.js
<SeasonId>`. This models player K/D/A totals, averages, and game highs, GPM/XPM
averages and game highs, plus group winners, playoff qualification versus
elimination, and season champion. A team's scheduled regular-season map count
is twice its number of group opponents. Season-average settlement requires
appearance in at least 50% of those maps; exact leader ties void the affected
market. These forecasts are **draft inputs**,
not approved odds. Public match data influences only K/D/A, never signup MMR.

For an active season's scheduled Bo2, run `node
betting/analytics/buildSeriesForecastsCli.js <ScheduledSeries.UID>`. This
generates one three-way 2–0/1–1/0–2 series-result market and per-player
K/D/A-total and GPM/XPM-average over/under forecasts. To inspect or insert
either run's v2 draft markets, use:

```bash
node betting/analytics/draftForecastMarketsCli.js --db /absolute/path/to/Betting.db --run-id <RunId>
node betting/analytics/draftForecastMarketsCli.js --db /absolute/path/to/Betting.db --run-id <RunId> --apply-drafts
```

The default is a read-only preview. `--apply-drafts` requires an already-v2
Betting database and writes only `DRAFT` markets. It does not publish them or
accept wagers. After reviewing all preseason odds, preview publication with
`node betting/publishPreseasonMarketsCli.js --lads /absolute/LadsData.db
--db /absolute/Betting.db --season 7 --close-at 2026-10-20T01:00:00.000Z`,
using the actual first-map kickoff in UTC. Repeat with `--apply
--confirm-publish PUBLISH-PRESEASON-7` to open all complete futures together.
This is available only while signups are closed and the season has not started.
Scheduled and completed series have no
database foreign key; settlement must explicitly validate the completed
SeriesInfo ID against the ScheduledSeries UID. Once both maps are recorded,
preview the resolution with `node betting/analytics/resolveSeriesForecastsCli.js
--db /absolute/path/to/Betting.db --scheduled <ScheduledSeries.UID> --completed
<SeriesInfo.SeriesId>` and review the returned scheduled and played dates.
This command is read-only. The v2 API now reads markets and places wagers using
authenticated account IDs and saved option prices. To settle validated
completed-series results, `betting/settleCompletedSeriesCli.js` previews by
default and can apply with `--apply --confirm-settle
SETTLE-<scheduled-UID>-<completed-series-ID>`. The v2 nightly job also settles
a locked series automatically when exactly one completed series has the same
teams, league ID, and nearby played date; ambiguous cases remain locked for
review. Champion futures can be settled after the season is marked ended with
`betting/settleChampionCli.js --lads /absolute/LadsData.db --db
/absolute/Betting.db --season 7` (preview by default; add `--apply
--confirm-settle CHAMPION-7`). Review regular-season player leaders after all
group maps are recorded with `betting/settleRegularPlayerMarketsCli.js --lads
/absolute/LadsData.db --db /absolute/Betting.db --season 7`; add `--apply
--confirm-fingerprint <fingerprint-from-preview>` after reviewing. The resolver excludes
appearances on other teams and voids exact ties. After playoff seeds and both
stage boundaries are final, preview group winners and qualification with
`betting/settleRegularTeamMarketsCli.js --lads /absolute/LadsData.db --db
/absolute/Betting.db --season 7`. Review all seeds, then add `--apply
--confirm-fingerprint <fingerprint-from-preview>`. Identical duplicate seed
rows are accepted; conflicting rows fail. The fingerprint detects a changed
seeding but cannot certify that an administrator finalized it.

At playoff start, save the finalized, still-unplayed `PlayoffBracket` JSON.
Run `node betting/analytics/buildPlayoffForecastsCli.js <SeasonId>` to simulate
its actual upper/lower routes, Bo3 series, and Bo5 final. The run drafts 13
playoff player-leader markets and a separate playoff-champion market; it does
not change preseason bets. Review and insert these with
`draftForecastMarketsCli.js` as above. Publish with
`betting/publishPlayoffMarketsCli.js --lads /absolute/LadsData.db --db
/absolute/Betting.db --season 7 --close-at <first-playoff-map-ISO-UTC>`;
repeat with `--apply --confirm-publish PUBLISH-PLAYOFFS-7` only after reviewing
prices. Publication refuses a bracket or seeding changed since forecasting.
Playoff average-stat leaders require at least half of their team's *actual*
playoff maps. After the champion is final, preview playoff player settlement
with `betting/settlePlayoffPlayerMarketsCli.js --lads /absolute/LadsData.db
--db /absolute/Betting.db --season 7`. It checks the final bracket's series
scores against the league's recorded playoff maps; apply only with the exact
preview fingerprint via `--apply --confirm-fingerprint <fingerprint>`.
`settleChampionCli.js` then settles both preseason and playoff champion
markets if both exist. Exact player-leader ties void the affected market.

These simulation probabilities are preliminary, low-confidence drafts. They
assume registered players appear in every team map and use a shrunk
group-stage win-rate adjustment to roster MMR. Real calibration is not yet
possible without settled v2 markets. Once results exist, run the read-only
`betting/auditForecastCalibrationCli.js --db /absolute/Betting.db` for Brier
score and log loss by market type. Do not run the destructive v2 cutover on a
serving DB yet.

The Discord schedule importer now drafts Bo2 odds automatically for any
scheduled series that can be mapped to an active season and roster, **only**
when `Betting.db` is already v2. Repeated imports leave existing series
markets untouched; failed forecasts are logged per series. The importer parses
`9 pm est`, `9est`, and `tonight 9 est` as Eastern local time (including
daylight saving), saving the UTC kickoff in `ScheduledSeriesTimes`. A post
without an unambiguous time cannot be published. After reviewing a draft,
preview with `node betting/publishSeriesMarketsCli.js --db
/absolute/path/to/Betting.db --scheduled 123`; add `--apply --confirm-publish
PUBLISH-123` to open the complete series market set until kickoff.
If a post moves kickoff earlier, the importer tightens the close time of
already-open markets and locks them if the new time has passed. A move to a
different date creates a new scheduled row and requires operator review of
the old market.

If a scheduled series is played without the league ID (or otherwise cannot
be reliably graded), an operator can explicitly push all of its v2 markets:

```bash
node betting/voidScheduledSeriesCli.js --db /absolute/path/to/Betting.db \
  --scheduled 123 --reason wrong-league-id --confirm-push PUSH-123
```

The push is atomic and repeat-safe. A single-leg ticket is refunded. For a
parlay, the affected leg is voided at 1.0 odds; its remaining legs stay
pending, win at recalculated odds, or lose normally. The script does **not**
push an overdue scheduled series automatically: postponement and a bad league
ID cannot be distinguished from the schedule table alone. The legacy betting
tables/jobs do not use this new v2 push logic.

The confirmed rebuild discards old markets, tickets, legs, and transaction
history. It retains wallet IDs and the wallet table layout, resets every
balance to 10,000 and wagered/won totals to zero, and writes a verified SQLite
backup before changing the database. **Do not run the confirmed rebuild on a
serving database yet:** real-data calibration and end-to-end staging tests
remain. Stop the server and betting
jobs for the eventual cutover. The confirmation token and full command are
printed by the CLI.

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
