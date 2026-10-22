# Database Backups

Database backups are separate from the live databases in `db/` and are
distributed separately from Git. This directory's database files are ignored.

For local development, obtain the current sanitized LadsData backup from a
maintainer. Decompress its `.db.gz` if necessary and copy the database to
`db/LadsData.db` before starting the app. Stop the app and preserve any existing
local database before replacing it.

The sanitized backup retains recorded match history, expanded match data and
public rosters. Private signup MMR/screenshots, account activity and production
permissions are removed. It is a development dataset, not a full production
recovery backup. Create an updated sanitized backup with:

```bash
node --max-old-space-size=256 scripts/db/exportCollaboratorData.js db/LadsData.db backups/LadsData/LadsData_collaborator_YYYYMMDD.db
```

Betting and Analytics can be initialized locally; they are not included in this
backup. Public-match data must be loaded separately. See the root
[README](../README.md#restore-backup-databases-for-local-use) for setup commands.

Regular operational backups are created by `scripts/db/backupDatabases.sh` and
retain private production data. Normal retention is three days. Run
`./scripts/db/backupDatabases.sh prune` to apply retention manually. Retention
also applies to `.db` files in this directory, so keep distributed copies
separately when needed.
