#!/bin/bash
set -e

SCRIPT_DIR="/root/LeagueOfLads"
LOG_DIR="/root/LeagueOfLads/Logs"
mkdir -p "$LOG_DIR"

# Filename in format log_YYYY-MM-DD.txt
LOG_FILE="$LOG_DIR/publicLog_$(date +%F).txt"

echo "$(date) - Starting public match generation"
/usr/bin/node "$SCRIPT_DIR/generatePlayerInfo.js" >> "$LOG_FILE" 2>&1
/usr/bin/node "$SCRIPT_DIR/generateMatchInfo.js" >> "$LOG_FILE" 2>&1
echo "$(date) - Public match generation complete"
