#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/db"
BACKUP_ROOT="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

usage() {
    cat <<USAGE
Usage:
  ./scripts/db/backupDatabases.sh [all|LadsData|Betting|public]

Creates SQLite-safe timestamped backups under:
  backups/<database-name>/

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

target="${1:-all}"

case "$target" in
    all)
        backup_db "LadsData"
        backup_db "Betting"
        backup_db "public"
        ;;
    LadsData|Betting|public)
        backup_db "$target"
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
