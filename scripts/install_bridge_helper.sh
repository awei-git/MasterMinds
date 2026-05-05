#!/bin/zsh
set -euo pipefail

ROOT="/Users/angwei/Sandbox/MasterMinds"
APP_SOURCE="$ROOT/.build/MasterMindsBridgeHelper.app"
APP_TARGET="/Users/angwei/Applications/MasterMindsBridgeHelper.app"
PLIST_SOURCE="$ROOT/config/launchd/com.angwei.masterminds-bridge-helper.plist"
PLIST_TARGET="/Users/angwei/Library/LaunchAgents/com.angwei.masterminds-bridge-helper.plist"

"$ROOT/scripts/build_bridge_helper.sh" >/dev/null

mkdir -p "/Users/angwei/Applications" "/Users/angwei/Library/LaunchAgents"
rm -rf "$APP_TARGET"
cp -R "$APP_SOURCE" "$APP_TARGET"
cp "$PLIST_SOURCE" "$PLIST_TARGET"

launchctl bootout "gui/$(id -u)/com.angwei.masterminds-bridge-helper" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
launchctl kickstart -k "gui/$(id -u)/com.angwei.masterminds-bridge-helper"

echo "$APP_TARGET"
