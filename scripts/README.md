# Scripts

Utility and scheduled-job scripts live here to keep the project root focused on
app entrypoints and shared modules.

- `league/`: active league ingestion and standings jobs used by `nightlyRun.sh`
- `public/`: public match-data generation jobs used by `generatePublicMatchData.sh`
- `legacy/`: one-off historical league utilities
- `assets/`: asset download/build helpers
- `analytics/`: private derived-data builds and verified inactive-league source checks
- `betting/`: additive initialization, private forecasting, market publication, and settlement

Betting setup: `npm run betting:init`, `npm run betting:refresh`, then
`npm run betting:status`. The deploy/nightly workflows run Analytics then Betting;
admin changes queue a separate debounced worker. See
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
The deploy workflow builds before PM2 restarts, and `nightlyRun.sh` builds even
without an active league. Source ingestion adds freshness/timestamp records
automatically on its next run. Details are in [analytics/README.md](../analytics/README.md).

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
