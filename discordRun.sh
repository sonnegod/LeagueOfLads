#!/bin/bash
set -e

cd /root/LeagueOfLads

# Ensure log directory exists
LOG_DIR="/root/LeagueOfLads/Logs/Discord"
mkdir -p "$LOG_DIR"

# Filename in format log_YYYY-MM-DD.txt
LOG_FILE="$LOG_DIR/log_$(date +%F).txt"

# Run job, redirecting stdout+stderr into log file
/usr/bin/node /root/LeagueOfLads/discordbot/discordbot.js >> "$LOG_FILE" 2>&1