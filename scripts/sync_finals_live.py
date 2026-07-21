#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import finals_live, rmuc_live  # noqa: E402


DEFAULT_RUNTIME_DIR = ROOT / "data" / "runtime" / "rmuc_live" / "finals"
DEFAULT_BASE_SCHEDULE = ROOT / "data" / "reference" / "2026_finals" / "schedule.json"
LIVE_MATCH_FIELDS = (
    "officialStatus",
    "isCompleted",
    "isConfirmedMatchup",
    "hasLiveScoreline",
    "scoreline",
    "result",
    "redWins",
    "blueWins",
    "redTeamKey",
    "redCollegeName",
    "redTeamName",
    "blueTeamKey",
    "blueCollegeName",
    "blueTeamName",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize finals live data into an atomic runtime overlay.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Enriched finals schedule or normalized overlay JSON.")
    source.add_argument("--source-url", help="Trusted JSON endpoint returning the same accepted schema.")
    parser.add_argument("--base-schedule", type=Path, default=DEFAULT_BASE_SCHEDULE)
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--source-kind", choices=("official", "synthetic"), required=True)
    parser.add_argument("--scenario-id")
    parser.add_argument("--source-updated-at")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    return rmuc_live.read_json(path)


def read_json_if_exists(path: Path) -> Any | None:
    if not path.exists():
        return None
    return read_json(path)


def fetch_json(
    url: str,
    previous_headers: dict[str, str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, str], bool]:
    request_headers = {"User-Agent": "douququ-rmuc-finals-live-sync/1.0"}
    previous_headers = previous_headers or {}
    if previous_headers.get("etag"):
        request_headers["If-None-Match"] = str(previous_headers["etag"])
    if previous_headers.get("last-modified"):
        request_headers["If-Modified-Since"] = str(previous_headers["last-modified"])
    request = Request(url, headers=request_headers)
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - caller supplies a trusted endpoint.
            headers = {key.lower(): value for key, value in response.headers.items()}
            payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Finals upstream response must be a JSON object")
            return payload, headers, True
    except HTTPError as exc:
        if exc.code == 304:
            return None, dict(previous_headers), False
        raise


def _participant_key(participant: dict[str, Any]) -> tuple[str, str]:
    return str(participant.get("collegeName") or "").strip(), str(participant.get("teamName") or "").strip()


def overlay_from_enriched_schedule(
    enriched: dict[str, Any],
    base: dict[str, Any],
    *,
    source_kind: str,
    scenario_id: str | None,
    source_updated_at: str,
) -> dict[str, Any]:
    events: dict[str, Any] = {}
    for event_slug in finals_live.EVENT_SLUGS:
        enriched_event = enriched.get("events", {}).get(event_slug, {})
        base_event = base.get("events", {}).get(event_slug, {})
        base_participants = {
            _participant_key(row)
            for row in base_event.get("participants", [])
            if isinstance(row, dict)
        }
        participants = [
            dict(row)
            for row in enriched_event.get("participants", [])
            if isinstance(row, dict) and _participant_key(row) not in base_participants
        ]
        matches = []
        for match in enriched_event.get("matches", []):
            if not isinstance(match, dict) or not any(field in match for field in LIVE_MATCH_FIELDS):
                continue
            number = int(match["number"])
            official_match_id = str(match.get("officialMatchId") or "").strip()
            if source_kind == "official" and not official_match_id:
                raise ValueError(f"Official finals match {event_slug} #{number} has no upstream officialMatchId")
            runtime_match = {
                "number": number,
                "bestOf": int(match.get("bestOf") or 3),
                "officialMatchId": official_match_id or f"SYNTH-{event_slug.upper()}-{number:03d}",
                **{field: match[field] for field in LIVE_MATCH_FIELDS if field in match},
            }
            matches.append(runtime_match)
        if participants or matches:
            events[event_slug] = {"participants": participants, "matches": matches}
    return {
        "schemaVersion": "rmuc-finals-live-v1",
        "season": int(base.get("season") or enriched.get("season") or 2026),
        "sourceStatus": "active",
        "sourceKind": source_kind,
        "sourceUpdatedAt": source_updated_at,
        "scenarioId": scenario_id,
        "events": events,
    }


def normalize_raw_input(
    raw: Any,
    args: argparse.Namespace,
    fetched_at: datetime,
    *,
    source_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Finals live input must be a JSON object")
    source_headers = source_headers or {}
    source_updated_at = args.source_updated_at or source_headers.get("last-modified") or fetched_at.isoformat()
    if raw.get("schemaVersion") == "rmuc-finals-live-v1":
        normalized = {
            **raw,
            "sourceKind": args.source_kind,
            "sourceUpdatedAt": source_updated_at,
            "scenarioId": args.scenario_id or raw.get("scenarioId"),
        }
    else:
        base = read_json(args.base_schedule)
        if not isinstance(base, dict):
            raise ValueError("Finals base schedule must be a JSON object")
        normalized = overlay_from_enriched_schedule(
            raw,
            base,
            source_kind=args.source_kind,
            scenario_id=args.scenario_id,
            source_updated_at=source_updated_at,
        )
    normalized["sourceUrl"] = args.source_url or normalized.get("sourceUrl")
    normalized["etag"] = source_headers.get("etag") or normalized.get("etag")
    normalized["lastModified"] = source_headers.get("last-modified") or normalized.get("lastModified")
    return finals_live.validate_runtime_payload(normalized)


def normalize_input(args: argparse.Namespace, fetched_at: datetime) -> tuple[dict[str, Any], dict[str, Any]]:
    if args.input is None:
        raise ValueError("normalize_input requires --input")
    raw = read_json(args.input)
    return raw, normalize_raw_input(raw, args, fetched_at)


def main() -> None:
    args = parse_args()
    fetched_at = datetime.now(tz=UTC)
    raw_dir = args.runtime_dir / "raw"
    headers_path = raw_dir / "upstream_headers.json"
    source_headers: dict[str, str] = {}
    source_changed = True
    if args.source_url:
        previous_headers = read_json_if_exists(headers_path)
        if not isinstance(previous_headers, dict):
            previous_headers = {}
        raw, source_headers, source_changed = fetch_json(args.source_url, previous_headers)
        if raw is None:
            raw = read_json(raw_dir / "finals_schedule.json")
    else:
        raw = read_json(args.input)
    normalized = normalize_raw_input(raw, args, fetched_at, source_headers=source_headers)
    timestamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
    if source_changed:
        rmuc_live.write_json_atomic(raw_dir / "finals_schedule.json", raw)
        rmuc_live.write_json_atomic(raw_dir / f"finals_schedule.{timestamp}.json", raw)
    if args.source_url:
        rmuc_live.write_json_atomic(
            headers_path,
            {**source_headers, "source-url": args.source_url, "fetched-at": fetched_at.isoformat()},
        )
    rmuc_live.write_json_atomic(args.runtime_dir / "normalized_schedule.json", normalized)
    match_count = sum(len(event.get("matches", [])) for event in normalized["events"].values())
    completed_count = sum(
        1
        for event in normalized["events"].values()
        for match in event.get("matches", [])
        if match.get("isCompleted")
    )
    manifest = {
        "schemaVersion": "rmuc-finals-live-manifest-v1",
        "generatedAt": fetched_at.isoformat(),
        "sourceStatus": normalized["sourceStatus"],
        "sourceKind": normalized["sourceKind"],
        "sourceUpdatedAt": normalized.get("sourceUpdatedAt"),
        "scenarioId": normalized.get("scenarioId"),
        "sourceUrl": normalized.get("sourceUrl"),
        "etag": normalized.get("etag"),
        "lastModified": normalized.get("lastModified"),
        "sourceChanged": source_changed,
        "matchCount": match_count,
        "completedMatches": completed_count,
    }
    rmuc_live.write_json_atomic(args.runtime_dir / "sync_manifest.json", manifest)
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
