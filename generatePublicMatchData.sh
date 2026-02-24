#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "$(date) - Starting public match generation"
/usr/bin/node "$SCRIPT_DIR/generatePlayerInfo.js"
/usr/bin/node "$SCRIPT_DIR/generateMatchInfo.js"
echo "$(date) - Public match generation complete"
