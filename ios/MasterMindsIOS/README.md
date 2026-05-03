# 神仙会 iOS

Native SwiftUI client for the 神仙会 writers' room server.

## What It Covers

- Project list and project creation via `/api/projects`
- Server URL settings for Simulator and physical devices
- Five-phase workflow display from `/api/workflow`
- Phase switching through `/api/projects`
- Phase summaries from `/api/phases`
- Roundtable execution through `/api/roundtable` with SSE event rendering
- Independent writing tasks through `/api/writing-tasks`
- Expansion chapter list, AI chapter drafting/revision, manual editing, and saving through `/api/beats` and `/api/writing-tasks`

## Generate The Xcode Project

```bash
cd ios/MasterMindsIOS
xcodegen generate
open MasterMindsIOS.xcodeproj
```

## Run

Start the web server first:

```bash
pnpm dev:lan
```

The app defaults to `http://192.168.1.232:3000` for physical-device testing on the current Mac network. In Simulator, open Settings and use `http://localhost:3000` if preferred.

## Build From CLI

```bash
xcodegen generate
xcodebuild -project MasterMindsIOS.xcodeproj \
  -scheme MasterMindsIOS \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Test From CLI

```bash
xcodebuild -project MasterMindsIOS.xcodeproj \
  -scheme MasterMindsIOS \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.2' \
  CODE_SIGNING_ALLOWED=NO test
```
