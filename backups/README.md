# Database Backups

Timestamped SQLite backups created by `scripts/db/backupDatabases.sh` live here.

These backups are separate from the live databases in `db/`, so they can be
committed intentionally when you need to move a prod snapshot between machines.

Before the nightly backup runs, live-match snapshots older than seven days and
their associated player and draft rows are deleted. The database is compacted
after cleanup so deleted snapshot data does not remain in future backup files.

Database backup files are also retained for seven days. The nightly job removes
expired backups even when there is no active league. Run
`./scripts/db/backupDatabases.sh prune` to apply backup retention manually.
