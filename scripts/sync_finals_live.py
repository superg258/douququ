#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import (
    finals_live,  # noqa: E402
    rmuc_live,  # noqa: E402
)
from backend.app.artifacts import (  # noqa: E402
    read_json,
    semantic_digest,
    write_json_atomic,
)
from backend.app.artifacts import (
    read_versioned_json_if_exists as read_json_if_exists,
)
from backend.app.team_identity import team_identity_key  # noqa: E402
from scripts._live_sync_common import fetch_json  # noqa: E402
from scripts.finals_official_adapter import (  # noqa: E402
    is_official_schedule_payload,
    overlay_from_official_schedule,
)

DEFAULT_RUNTIME_DIR = ROOT / "data" / "runtime" / "rmuc_live" / "finals"
DEFAULT_BASE_SCHEDULE = ROOT / "data" / "reference" / "2026_finals" / "schedule.json"
DEFAULT_SOURCE_URL = rmuc_live.UPSTREAM_LIVE_URLS["schedule"]
LIVE_MATCH_FIELDS = finals_live.RUNTIME_MATCH_FIELDS
# startsAt/endsAt are valid controlled overrides, but the immutable reference
# already contains them for every match.  They therefore cannot by themselves
# make a reference row part of an enriched runtime overlay.
LIVE_MATCH_SELECTION_FIELDS = tuple(
    field for field in LIVE_MATCH_FIELDS if field not in {"startsAt", "endsAt"}
)
LIVE_EVENT_FIELDS = finals_live.RUNTIME_EVENT_FIELDS
SYNC_USER_AGENT = "douququ-rmuc-finals-live-sync/1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize finals live data into an atomic runtime overlay.")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--input", type=Path, help="Enriched finals schedule or normalized overlay JSON.")
    source.add_argument(
        "--source-url",
        help="Trusted schedule.json URL. Defaults to the official RMUC live schedule.",
    )
    parser.add_argument("--base-schedule", type=Path, default=DEFAULT_BASE_SCHEDULE)
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--source-kind", choices=("official", "synthetic"), default="official")
    parser.add_argument("--scenario-id")
    parser.add_argument("--source-updated-at")
    args = parser.parse_args()
    if args.input is None and args.source_url is None:
        args.source_url = DEFAULT_SOURCE_URL
    return args


def _participant_key(participant: dict[str, Any]) -> tuple[str, str]:
    return team_identity_key(participant.get("collegeName"), participant.get("teamName"))


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
            if not isinstance(match, dict) or not any(
                field in match for field in LIVE_MATCH_SELECTION_FIELDS
            ):
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
        event_overlay: dict[str, Any] = {"participants": participants, "matches": matches}
        for field in LIVE_EVENT_FIELDS:
            if field in enriched_event:
                event_overlay[field] = enriched_event[field]
        if participants or matches or any(field in event_overlay for field in LIVE_EVENT_FIELDS):
            events[event_slug] = event_overlay
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
    raw_source_updated_at = raw.get("sourceUpdatedAt")
    source_updated_at = (
        getattr(args, "source_updated_at", None)
        or source_headers.get("last-modified")
        or raw_source_updated_at
    )
    if not source_updated_at and args.source_kind != "official":
        source_updated_at = fetched_at.isoformat()
    if raw.get("schemaVersion") == "rmuc-finals-live-v1":
        normalized = {
            **raw,
            "sourceKind": args.source_kind,
            "sourceUpdatedAt": source_updated_at or "",
            "scenarioId": args.scenario_id or raw.get("scenarioId"),
        }
    elif is_official_schedule_payload(raw):
        if args.source_kind != "official":
            raise ValueError("The official RMUC schedule.json cannot be published as synthetic")
        if not source_updated_at:
            raise ValueError(
                "Official finals source has no Last-Modified/sourceUpdatedAt; "
                "provide --source-updated-at explicitly"
            )
        base = read_json(args.base_schedule)
        if not isinstance(base, dict):
            raise ValueError("Finals base schedule must be a JSON object")
        normalized = overlay_from_official_schedule(
            raw,
            base,
            source_updated_at=str(source_updated_at),
        )
    else:
        base = read_json(args.base_schedule)
        if not isinstance(base, dict):
            raise ValueError("Finals base schedule must be a JSON object")
        normalized = overlay_from_enriched_schedule(
            raw,
            base,
            source_kind=args.source_kind,
            scenario_id=args.scenario_id,
            # Let enriched-input contract errors (for example a missing
            # officialMatchId) surface before the independent provenance error.
            source_updated_at=str(source_updated_at or "1970-01-01T00:00:00+00:00"),
        )
    if not source_updated_at and args.source_kind == "official":
        raise ValueError(
            "Official finals source has no Last-Modified/sourceUpdatedAt; "
            "provide --source-updated-at explicitly"
        )
    normalized["lastCheckedAt"] = fetched_at.isoformat()
    normalized["sourceUrl"] = getattr(args, "source_url", None) or normalized.get("sourceUrl")
    normalized["etag"] = source_headers.get("etag") or normalized.get("etag")
    normalized["lastModified"] = source_headers.get("last-modified") or normalized.get("lastModified")
    return finals_live.validate_runtime_payload(normalized)


def normalize_input(args: argparse.Namespace, fetched_at: datetime) -> tuple[dict[str, Any], dict[str, Any]]:
    if args.input is None:
        raise ValueError("normalize_input requires --input")
    raw = read_json(args.input)
    return raw, normalize_raw_input(raw, args, fetched_at)


def _previous_last_success_at(check_status: Any) -> str | None:
    if not isinstance(check_status, dict):
        return None
    value = check_status.get("lastSuccessAt")
    if value:
        return str(value)
    if check_status.get("status") == "ok" and check_status.get("checkedAt"):
        return str(check_status["checkedAt"])
    return None


def sync_once(
    args: argparse.Namespace,
    *,
    fetched_at: datetime | None = None,
    fetcher=fetch_json,
) -> dict[str, Any]:
    fetched_at = fetched_at or datetime.now(tz=UTC)
    raw_dir = args.runtime_dir / "raw"
    headers_path = raw_dir / "upstream_headers.json"
    normalized_path = args.runtime_dir / "normalized_schedule.json"
    manifest_path = args.runtime_dir / "sync_manifest.json"
    check_status_path = args.runtime_dir / "check_status.json"
    previous_check_status = read_json_if_exists(check_status_path)
    source_headers: dict[str, str] = {}
    source_changed = True
    try:
        if args.source_url:
            previous_headers = read_json_if_exists(headers_path)
            if not isinstance(previous_headers, dict):
                previous_headers = {}
            raw, source_headers, source_changed = fetcher(
                args.source_url,
                previous_headers,
                user_agent=SYNC_USER_AGENT,
                require_object=True,
            )
            if raw is None:
                raw = read_json(raw_dir / "finals_schedule.json")
        else:
            raw = read_json(args.input)
        previous_normalized = read_json_if_exists(normalized_path)
        normalized = normalize_raw_input(raw, args, fetched_at, source_headers=source_headers)
        semantic_changed = semantic_digest(normalized) != semantic_digest(previous_normalized)
        if not semantic_changed and isinstance(previous_normalized, dict):
            normalized = {
                **previous_normalized,
                "lastCheckedAt": fetched_at.isoformat(),
            }

        timestamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
        if source_changed:
            write_json_atomic(raw_dir / "finals_schedule.json", raw)
            if semantic_changed:
                write_json_atomic(raw_dir / f"finals_schedule.{timestamp}.json", raw)
        if args.source_url:
            write_json_atomic(
                headers_path,
                {**source_headers, "source-url": args.source_url, "fetched-at": fetched_at.isoformat()},
            )
        # Always refresh lastCheckedAt, including a successful conditional 304.
        # write_json_atomic keeps readers on the previous complete generation
        # until the replacement is ready.
        write_json_atomic(normalized_path, normalized)

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
            "lastCheckedAt": normalized.get("lastCheckedAt"),
            "scenarioId": normalized.get("scenarioId"),
            "sourceUrl": normalized.get("sourceUrl"),
            "etag": normalized.get("etag"),
            "lastModified": normalized.get("lastModified"),
            "sourceChanged": source_changed,
            "matchCount": match_count,
            "completedMatches": completed_count,
        }
        if semantic_changed or not manifest_path.exists():
            write_json_atomic(manifest_path, manifest)
        write_json_atomic(
            check_status_path,
            {
                "schemaVersion": "rmuc-finals-live-check-v1",
                "status": "ok",
                "checkedAt": fetched_at.isoformat(),
                "lastSuccessAt": fetched_at.isoformat(),
                "sourceUrl": args.source_url,
                "sourceChanged": source_changed,
                "semanticChanged": semantic_changed,
                "etag": source_headers.get("etag") or normalized.get("etag"),
                "lastModified": source_headers.get("last-modified") or normalized.get("lastModified"),
                "matchCount": match_count,
                "completedMatches": completed_count,
                "lastKnownGoodPreserved": True,
            },
        )
        return manifest
    except Exception as exc:
        write_json_atomic(
            check_status_path,
            {
                "schemaVersion": "rmuc-finals-live-check-v1",
                "status": "failed",
                "checkedAt": fetched_at.isoformat(),
                "lastSuccessAt": _previous_last_success_at(previous_check_status),
                "sourceUrl": args.source_url,
                "sourceChanged": source_changed,
                "lastKnownGoodPreserved": normalized_path.is_file(),
                "errorType": type(exc).__name__,
                "error": str(exc),
            },
        )
        raise


def main() -> None:
    args = parse_args()
    manifest = sync_once(args)
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
