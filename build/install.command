#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/Screencap.app"
DEST="/Applications/Screencap.app"

if [ ! -d "$SRC" ]; then
	osascript -e 'display dialog "Screencap.app not found next to installer." buttons {"OK"} default button 1 with icon stop'
	exit 1
fi

CMD="rm -rf \"$DEST\"; ditto \"$SRC\" \"$DEST\"; xattr -dr com.apple.quarantine \"$DEST\" 2>/dev/null || true; xattr -dr com.apple.provenance \"$DEST\" 2>/dev/null || true"
osascript -e "do shell script \"${CMD//\"/\\\\\\\"}\" with administrator privileges"
open -a "$DEST"
