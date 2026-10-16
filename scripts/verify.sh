#!/bin/bash
# Build everything and run the unit tests.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
swift build
swift test 2>&1 | tail -3
