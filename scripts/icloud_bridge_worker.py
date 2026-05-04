#!/usr/bin/env python3
"""File-based iCloud bridge for the MasterMinds iOS app.

The iOS client writes JSON commands into:
  iCloud.com.angwei.shenxianhui/Documents/MasterMinds-Bridge/commands

This worker runs on the Mac, calls the local Next.js API, then writes JSON
responses into the matching responses directory. It is intentionally slow and
simple; the LAN API remains the primary path.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_API_URL = "http://127.0.0.1:3000"
APP_CONTAINER_BRIDGE = (
    Path.home()
    / "Library"
    / "Mobile Documents"
    / "iCloud~com~angwei~shenxianhui"
    / "Documents"
    / "MasterMinds-Bridge"
)
CLOUD_DOCS_BRIDGE = (
    Path.home()
    / "Library"
    / "Mobile Documents"
    / "com~apple~CloudDocs"
    / "MasterMinds-Bridge"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def bridge_root() -> Path:
    configured = os.environ.get("MASTERMINDS_ICLOUD_BRIDGE_DIR")
    if configured:
        return Path(configured).expanduser()
    if APP_CONTAINER_BRIDGE.parent.exists():
        return APP_CONTAINER_BRIDGE
    return CLOUD_DOCS_BRIDGE


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def api_url(path: str, query: dict[str, str] | None = None) -> str:
    base = os.environ.get("MASTERMINDS_API_URL", DEFAULT_API_URL).rstrip("/")
    if query:
        return f"{base}{path}?{urllib.parse.urlencode(query)}"
    return f"{base}{path}"


def request_json(method: str, path: str, *, query: dict[str, str] | None = None, body: Any = None, timeout: int = 180) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(api_url(path, query), data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8"))
            message = payload.get("error") or payload
        except Exception:
            message = raw.decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {message}") from exc
    return json.loads(raw.decode("utf-8")) if raw else {}


def request_sse(path: str, body: Any, timeout: int = 1200) -> list[dict[str, Any]]:
    req = urllib.request.Request(
        api_url(path),
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Accept": "text/event-stream", "Content-Type": "application/json"},
        method="POST",
    )
    events: list[dict[str, Any]] = []
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                event = json.loads(payload)
                events.append(event)
                if event.get("type") in {"done", "error"}:
                    break
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')}") from exc
    return events


def handle_command(command: dict[str, Any]) -> Any:
    action = command.get("action")
    payload = command.get("payload") or {}

    if action == "projects.list":
        return request_json("GET", "/api/projects")
    if action == "projects.create":
        return request_json("POST", "/api/projects", body=payload)
    if action == "projects.setPhase":
        return request_json(
            "PATCH",
            "/api/projects",
            body={"slug": payload["slug"], "action": "setPhase", "phase": payload["phase"]},
        )
    if action == "phases.summary":
        return request_json("GET", "/api/phases", query={"projectSlug": payload["projectSlug"], "phase": payload["phase"]})
    if action == "chapters.list":
        return request_json("GET", "/api/beats", query={"projectSlug": payload["projectSlug"], "unit": "chapter"})
    if action == "chapterDraft.get":
        return request_json(
            "GET",
            "/api/writing-tasks",
            query={"projectSlug": payload["projectSlug"], "kind": "chapter_draft", "chapterId": payload["chapterId"]},
        )
    if action == "chapterDraft.save":
        return request_json(
            "PATCH",
            "/api/writing-tasks",
            body={
                "projectSlug": payload["projectSlug"],
                "kind": "chapter_draft",
                "chapterId": payload["chapterId"],
                "content": payload["content"],
            },
        )
    if action == "writingTask.run":
        return request_json("POST", "/api/writing-tasks", body=payload, timeout=900)
    if action == "roundtable.run":
        return request_sse("/api/roundtable", payload, timeout=1200)

    raise RuntimeError(f"Unknown iCloud bridge action: {action}")


def process_command(path: Path, root: Path) -> None:
    command = read_json(path)
    command_id = command.get("id") or path.stem
    response_path = root / "responses" / f"{command_id}.json"
    processed_path = root / "processed" / path.name

    try:
        data = handle_command(command)
        response = {"id": command_id, "status": "ok", "data": data, "updatedAt": utc_now()}
    except Exception as exc:  # noqa: BLE001 - bridge should always produce a response
        response = {"id": command_id, "status": "error", "error": str(exc), "updatedAt": utc_now()}

    atomic_write_json(response_path, response)
    processed_path.parent.mkdir(parents=True, exist_ok=True)
    path.replace(processed_path)


def write_heartbeat(root: Path) -> None:
    atomic_write_json(
        root / "heartbeat.json",
        {
            "status": "online",
            "updatedAt": utc_now(),
            "apiURL": os.environ.get("MASTERMINDS_API_URL", DEFAULT_API_URL),
        },
    )


def run_once(root: Path) -> int:
    for folder in ("commands", "responses", "processed"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    try:
        write_heartbeat(root)
    except Exception as exc:  # noqa: BLE001 - status file must not block bridge work
        print(f"[{utc_now()}] heartbeat write skipped: {exc}", file=sys.stderr, flush=True)

    commands = sorted((root / "commands").glob("*.json"))
    for command in commands:
        process_command(command, root)
    return len(commands)


def main() -> int:
    parser = argparse.ArgumentParser(description="MasterMinds iCloud bridge worker")
    parser.add_argument("--once", action="store_true", help="process pending commands once and exit")
    parser.add_argument("--interval", type=float, default=5.0, help="poll interval in seconds")
    parser.add_argument("--root", type=Path, default=None, help="override bridge root directory")
    args = parser.parse_args()

    root = (args.root or bridge_root()).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    if args.once:
        print(f"processed={run_once(root)} root={root}")
        return 0

    print(f"MasterMinds iCloud bridge running at {root}", flush=True)
    while True:
        try:
            run_once(root)
        except Exception as exc:  # noqa: BLE001
            print(f"[{utc_now()}] bridge loop error: {exc}", file=sys.stderr, flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
