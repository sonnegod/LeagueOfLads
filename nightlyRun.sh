#!/bin/bash
set -e

PROJECT_ROOT="${LEAGUE_OF_LADS_ROOT:-/root/LeagueOfLads}"
NODE_BIN="${LEAGUE_OF_LADS_NODE:-/usr/bin/node}"
cd "$PROJECT_ROOT"

LOG_ROOT="$PROJECT_ROOT/Logs"
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

"$NODE_BIN" "$PROJECT_ROOT/scripts/db/cleanupLiveMatchSnapshots.js" 7 >> "$LOG_FILE" 2>&1
/bin/bash "$PROJECT_ROOT/scripts/db/backupDatabases.sh" prune >> "$LOG_FILE" 2>&1

FAILED_STEPS=0
run_step() {
    if ! "$@" >> "$LOG_FILE" 2>&1; then
        echo "$(date) - Failed step: $*" >> "$LOG_FILE"
        FAILED_STEPS=$((FAILED_STEPS + 1))
    fi
}

ACTIVE_CHECK_OK=1
if ! ACTIVE_LEAGUE_ID="$("$NODE_BIN" "$PROJECT_ROOT/scripts/league/getActiveLeagueId.js" 2>> "$LOG_FILE")"; then
    echo "$(date) - Active league check failed; source freshness will not be advanced." >> "$LOG_FILE"
    ACTIVE_CHECK_OK=0
    FAILED_STEPS=$((FAILED_STEPS + 1))
fi

if [ "$ACTIVE_CHECK_OK" -eq 1 ] && [ -z "$ACTIVE_LEAGUE_ID" ]; then
    echo "$(date) - No active league. Checking preseason sources." >> "$LOG_FILE"
    run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/analytics/recordLeagueCheck.js"
elif [ "$ACTIVE_CHECK_OK" -eq 1 ]; then
    echo "$(date) - Active league: $ACTIVE_LEAGUE_ID" >> "$LOG_FILE"
    run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/league/currentLeagueData.js"
    run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/league/matchDetails.js"
    run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/league/populateTeamNames.js"
    run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/league/updateNeustadtl.js"
    run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/league/checkPlayoffSeries.js"
fi

# Run even after partial ingestion. Source watermarks hold unsafe markets;
# the refresh can still settle verified results or publish a validated fallback.
run_step "$NODE_BIN" "$PROJECT_ROOT/scripts/betting/run.js" --refresh-analytics
run_step /bin/bash "$PROJECT_ROOT/scripts/db/backupDatabases.sh"

echo "$(date) - Nightly jobs complete; failed steps: $FAILED_STEPS" >> "$LOG_FILE"
if [ "$FAILED_STEPS" -gt 0 ]; then exit 1; fi
