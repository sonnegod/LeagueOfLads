#!/bin/bash
set -e

cd /root/LeagueOfLads

# Ensure log directory exists
LOG_DIR="/root/LeagueOfLads/Logs/Bets"
mkdir -p "$LOG_DIR"

# Filename in format log_YYYY-MM-DD.txt
LOG_FILE="$LOG_DIR/log_$(date +%F).txt"

# Run job, redirecting stdout+stderr into log file
/usr/bin/node /root/LeagueOfLads/betting/lockMarkets.js >> "$LOG_FILE" 2>&1