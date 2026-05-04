#!/bin/zsh
set -euo pipefail

cd /Users/angwei/Sandbox/MasterMinds
exec /usr/bin/python3 scripts/icloud_bridge_worker.py --interval 5
