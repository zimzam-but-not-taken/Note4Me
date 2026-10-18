#!/bin/sh
# Build, install into /Applications, and relaunch so no stale window lingers.
set -e
cd "$(dirname "$0")/.."
sh build/package.sh
if pgrep -x Note4Me >/dev/null; then
  osascript -e 'tell application "Note4Me" to quit' >/dev/null 2>&1 || true
  for i in 1 2 3 4 5 6; do pgrep -x Note4Me >/dev/null || break; sleep 0.5; done
  pgrep -x Note4Me >/dev/null && pkill -x Note4Me && sleep 1
fi
rm -rf /Applications/Note4Me.app
cp -R out/Note4Me-darwin-arm64/Note4Me.app /Applications/
open -a Note4Me
echo "Installed and relaunched /Applications/Note4Me.app"
