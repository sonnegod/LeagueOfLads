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
admins between Admin and Head Admin. Head admins can remove non-head admins.
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
