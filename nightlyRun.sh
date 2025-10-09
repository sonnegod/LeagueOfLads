#!/bin/bash
set -e

# Ensure log directory exists
LOG_DIR="/root/DotaWebsite/Logs"
mkdir -p "$LOG_DIR"

# Filename in format log_YYYY-MM-DD.txt
LOG_FILE="$LOG_DIR/log_$(date +%F).txt"

# Run both jobs, redirecting stdout+stderr into log file
echo "$(date) - Starting nightly jobs" >> "$LOG_FILE"

/usr/bin/node /root/DotaWebsite/currentLeagueData.js >> "$LOG_FILE" 2>&1
/usr/bin/node /root/DotaWebsite/matchDetails.js >> "$LOG_FILE" 2>&1
/usr/bin/node /root/DotaWebsite/populateTeamNames.js >> "$LOG_FILE" 2>&1


echo "$(date) - Nightly jobs complete" >> "$LOG_FILE"
