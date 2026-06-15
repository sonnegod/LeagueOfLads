#!/bin/bash
set -e

SCRIPT_DIR="/root/LeagueOfLads"
LOG_ROOT="/root/LeagueOfLads/Logs"
LOG_DIR="$LOG_ROOT/Public"
mkdir -p "$LOG_DIR"

# Move existing public logs from the shared root into their own section.
find "$LOG_ROOT" -maxdepth 1 -type f -name 'publicLog_*.txt' -exec mv {} "$LOG_DIR/" \;

# Keep today's log and the previous six days.
find "$LOG_DIR" -maxdepth 1 -type f -name 'publicLog_*.txt' -mtime +6 -delete

LOG_FILE="$LOG_DIR/publicLog_$(date +%F).txt"

echo "$(date) - Starting public match generation" >> "$LOG_FILE"
/usr/bin/node "$SCRIPT_DIR/generatePlayerInfo.js" >> "$LOG_FILE" 2>&1
/usr/bin/node "$SCRIPT_DIR/generateMatchInfo.js" >> "$LOG_FILE" 2>&1
echo "$(date) - Public match generation complete" >> "$LOG_FILE"
