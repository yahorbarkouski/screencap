#!/bin/bash
# Build everything, run the unit tests, then build for release.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
swift build
swift test 2>&1 | tail -3
# The release build checks Swift 6 concurrency more strictly than the debug build: a data race it reports as an
# error passes the debug build and the tests, and then stops scripts/build-app.sh.
swift build -c release 2>&1 | grep -E "error:|Build complete!"
