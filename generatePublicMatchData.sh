#!/bin/bash
set -e

SCRIPT_DIR="/root/LeagueOfLads"
LOG_ROOT="/root/LeagueOfLads/Logs"
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
/usr/bin/node "$SCRIPT_DIR/generatePlayerInfo.js" >> "$LOG_FILE" 2>&1
/usr/bin/node "$SCRIPT_DIR/generateMatchInfo.js" >> "$LOG_FILE" 2>&1
echo "$(date) - Public match generation complete" >> "$LOG_FILE"
