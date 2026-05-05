#!/bin/zsh
set -euo pipefail

ROOT="/Users/angwei/Sandbox/MasterMinds"
APP="$ROOT/.build/MasterMindsBridgeHelper.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"

mkdir -p "$MACOS"
mkdir -p "$ROOT/.build/ModuleCache"
cp "$ROOT/macos/MasterMindsBridgeHelper/Info.plist" "$CONTENTS/Info.plist"
swiftc \
  -module-cache-path "$ROOT/.build/ModuleCache" \
  -parse-as-library \
  "$ROOT/macos/MasterMindsBridgeHelper/MasterMindsBridgeHelper.swift" \
  -o "$MACOS/MasterMindsBridgeHelper"

echo "$APP"
