#!/bin/bash
set -e

cd /root/LeagueOfLads

LOG_ROOT="/root/LeagueOfLads/Logs"
LOG_DIR="$LOG_ROOT/League"
mkdir -p "$LOG_DIR"

# Move existing nightly logs from the shared root into their own section.
find "$LOG_ROOT" -maxdepth 1 -type f -name 'log_*.txt' -exec mv {} "$LOG_DIR/" \;

# Keep today's log and the previous six calendar days.
CUTOFF_DATE="$(date -d '6 days ago' +%F)"
for file in "$LOG_DIR"/log_*.txt; do
    [ -e "$file" ] || continue
    FILE_DATE="${file##*/log_}"
    FILE_DATE="${FILE_DATE%.txt}"
    [[ "$FILE_DATE" < "$CUTOFF_DATE" ]] && rm -- "$file"
done

LOG_FILE="$LOG_DIR/log_$(date +%F).txt"

echo "$(date) - Starting nightly jobs" >> "$LOG_FILE"

ACTIVE_LEAGUE_ID="$(/usr/bin/node /root/LeagueOfLads/getActiveLeagueId.js)"

if [ -z "$ACTIVE_LEAGUE_ID" ]; then
    echo "$(date) - No active league. Skipping nightly jobs." >> "$LOG_FILE"
    exit 0
fi

echo "$(date) - Active league: $ACTIVE_LEAGUE_ID" >> "$LOG_FILE"

/usr/bin/node /root/LeagueOfLads/currentLeagueData.js >> "$LOG_FILE" 2>&1
/usr/bin/node /root/LeagueOfLads/matchDetails.js >> "$LOG_FILE" 2>&1
/usr/bin/node /root/LeagueOfLads/populateTeamNames.js >> "$LOG_FILE" 2>&1

/usr/bin/node /root/LeagueOfLads/updateNeustadtl.js >> "$LOG_FILE" 2>&1

/usr/bin/node /root/LeagueOfLads/checkPlayoffSeries.js >> "$LOG_FILE" 2>&1

/usr/bin/node /root/LeagueOfLads/betting/nightly-settlement-job.js >> "$LOG_FILE" 2>&1
/usr/bin/node /root/LeagueOfLads/betting/initialize-odds.js >> "$LOG_FILE" 2>&1

/bin/bash /root/LeagueOfLads/generatePublicMatchData.sh >> "$LOG_FILE" 2>&1

echo "$(date) - Nightly jobs complete" >> "$LOG_FILE"
