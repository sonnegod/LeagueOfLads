#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/db"
BACKUP_ROOT="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

usage() {
    cat <<'USAGE'
Usage:
  ./scripts/db/backupDatabases.sh [all|LadsData|Betting|public|prune]

Creates SQLite-safe timestamped backups under:
  backups/<database-name>/

Backup files older than seven days are removed after a backup run. Use `prune`
to apply retention without creating a new backup.

Examples:
  ./scripts/db/backupDatabases.sh
  ./scripts/db/backupDatabases.sh all
  ./scripts/db/backupDatabases.sh LadsData
USAGE
}

backup_db() {
    local name="$1"
    local source="$SOURCE_DIR/$name.db"
    local dest_dir="$BACKUP_ROOT/$name"
    local dest="$dest_dir/${name}_${TIMESTAMP}.db"

    if [ ! -f "$source" ]; then
        echo "Skipping $name: $source not found"
        return
    fi

    mkdir -p "$dest_dir"
    sqlite3 "$source" ".backup '$dest'"
    echo "Created $dest"
}

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
    all)
        backup_db "LadsData"
        backup_db "Betting"
        backup_db "public"
        prune_backups
        ;;
    LadsData|Betting|public)
        backup_db "$target"
        prune_backups
        ;;
    prune)
        prune_backups
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
