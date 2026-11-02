#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/db"
BACKUP_ROOT="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DAY="${TIMESTAMP%%_*}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-3}"
BACKUP_TIMEOUT_SECONDS="${BACKUP_TIMEOUT_SECONDS:-120}"

usage() {
    cat <<'USAGE'
Usage:
  ./scripts/db/backupDatabases.sh [all|LadsData|Betting|public|Analytics|SiteAnalytics|prune]

Creates at most one SQLite-safe backup per database per server calendar day under:
  backups/<database-name>/

Existing timestamped backups from today also satisfy the daily backup.
Backup files older than three days are removed before a backup run. Use `prune`
to apply retention without creating a new backup.

Backups use a fixed read snapshot so background WAL writes cannot restart the
copy. Each copy and the wait for another backup are limited to 120 seconds;
set BACKUP_TIMEOUT_SECONDS to override. PM2 processes stay running.

Examples:
  ./scripts/db/backupDatabases.sh
  ./scripts/db/backupDatabases.sh all
  ./scripts/db/backupDatabases.sh LadsData
USAGE
}

backup_db() (
    local name="$1"
    local source="$SOURCE_DIR/$name.db"
    local dest_dir="$BACKUP_ROOT/$name"
    local dest="$dest_dir/${name}_${BACKUP_DAY}.db"
    local existing
    local temporary
    local status

    if [ ! -f "$source" ]; then
        echo "Skipping $name: $source not found"
        return
    fi

    mkdir -p "$dest_dir"
    # Recognize both daily names and the older per-run timestamped names.
    for existing in "$dest" "$dest_dir/${name}_${BACKUP_DAY}_"*.db; do
        if [ -s "$existing" ]; then
            echo "Skipping $name: today's backup already exists ($existing)"
            return
        fi
    done

    # Publish only completed backups so a failed or interrupted attempt can retry.
    temporary="$(mktemp "${dest}.tmp.XXXXXX")"
    trap 'rm -f -- "$temporary" "$temporary-journal" "$temporary-wal" "$temporary-shm"' EXIT
    echo "Backing up $name (timeout: ${BACKUP_TIMEOUT_SECONDS}s)"
    # Establish the source snapshot before starting the incremental copy.
    # WAL writers (including idle bot heartbeats) can continue without causing
    # .backup to restart after every write. Never take a source write lock.
    if timeout --kill-after=10s "${BACKUP_TIMEOUT_SECONDS}s" nice -n 10 \
        sqlite3 -readonly -batch -bail "$source" > /dev/null <<SQL
.timeout 5000
BEGIN;
SELECT count(*) FROM sqlite_master;
.backup '$temporary'
COMMIT;
SQL
    then
        test -s "$temporary"
    else
        status=$?
        if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
            echo "Backup of $name timed out after ${BACKUP_TIMEOUT_SECONDS}s; incomplete copy discarded" >&2
        else
            echo "Backup of $name failed (exit $status); incomplete copy discarded" >&2
        fi
        return "$status"
    fi
    mv -- "$temporary" "$dest"
    echo "Created $dest"
)

prune_backups() {
    local retention_days="$BACKUP_RETENTION_DAYS"
    local retention_minutes
    local deleted=0

    if [[ ! "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
        echo "BACKUP_RETENTION_DAYS must be a positive whole number" >&2
        return 1
    fi

    [ -d "$BACKUP_ROOT" ] || return 0
    retention_minutes=$((retention_days * 24 * 60))

    while IFS= read -r -d '' backup; do
        rm -- "$backup"
        echo "Removed expired backup $backup"
        deleted=$((deleted + 1))
    done < <(
        find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -type f -name '*.db' \
            -mmin "+$retention_minutes" -print0
    )

    echo "Backup retention complete: removed $deleted file(s) older than $retention_days days"
}

target="${1:-all}"

case "$target" in
    all|LadsData|Betting|public|Analytics|SiteAnalytics|prune)
        if [[ ! "$BACKUP_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
            echo "BACKUP_TIMEOUT_SECONDS must be a positive whole number" >&2
            exit 1
        fi
        # Manual runs and the nightly job may overlap. Serialize their backup
        # checks, writes and pruning; flock releases automatically on process exit.
        mkdir -p "$BACKUP_ROOT"
        exec 9>"$BACKUP_ROOT/.backup.lock"
        if ! flock -w "$BACKUP_TIMEOUT_SECONDS" 9; then
            echo "Timed out waiting for another database backup to finish" >&2
            exit 1
        fi
        prune_backups
        if [ "$target" = all ]; then
            for name in LadsData Betting public Analytics SiteAnalytics; do
                backup_db "$name"
            done
        elif [ "$target" != prune ]; then
            backup_db "$target"
        fi
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "Unknown database target: $target" >&2
        usage >&2
        exit 1
        ;;
esac
