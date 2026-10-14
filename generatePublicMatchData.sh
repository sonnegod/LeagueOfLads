#!/bin/bash
set -e

SCRIPT_DIR="${LEAGUE_OF_LADS_ROOT:-/root/LeagueOfLads}"
NODE_BIN="${LEAGUE_OF_LADS_NODE:-/usr/bin/node}"
cd "$SCRIPT_DIR"
LOG_ROOT="$SCRIPT_DIR/Logs"
LOG_DIR="$LOG_ROOT/Public"
mkdir -p "$LOG_DIR"

# Move existing public logs from the shared root into their own section.
find "$LOG_ROOT" -maxdepth 1 -type f -name 'publicLog_*.txt' -exec mv {} "$LOG_DIR/" \;

# Keep today's log and the previous six calendar days.
CUTOFF_DATE="$(date -d '6 days ago' +%F)"
for file in "$LOG_DIR"/publicLog_*.txt; do
    [ -e "$file" ] || continue
    FILE_DATE="${file##*/publicLog_}"
    FILE_DATE="${FILE_DATE%.txt}"
    [[ "$FILE_DATE" < "$CUTOFF_DATE" ]] && rm -- "$file"
done

LOG_FILE="$LOG_DIR/publicLog_$(date +%F).txt"

echo "$(date) - Starting public match generation" >> "$LOG_FILE"
PUBLIC_STATUS=0
if ! "$NODE_BIN" "$SCRIPT_DIR/scripts/public/generatePlayerInfo.js" >> "$LOG_FILE" 2>&1; then
    echo "$(date) - Public player load failed; refreshing with verified fallback inputs." >> "$LOG_FILE"
    PUBLIC_STATUS=1
fi
if ! "$NODE_BIN" "$SCRIPT_DIR/scripts/public/generateMatchInfo.js" >> "$LOG_FILE" 2>&1; then
    echo "$(date) - Public match load failed or was partial; refreshing with verified fallback inputs." >> "$LOG_FILE"
    PUBLIC_STATUS=1
fi
"$NODE_BIN" "$SCRIPT_DIR/scripts/betting/run.js" --refresh-analytics >> "$LOG_FILE" 2>&1
echo "$(date) - Public match generation complete" >> "$LOG_FILE"
exit "$PUBLIC_STATUS"
