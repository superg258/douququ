from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
FINALS_RUNTIME_PATH = ROOT / "data" / "runtime" / "rmuc_live" / "finals" / "normalized_schedule.json"
EVENT_SLUGS = {"repechage", "nationals"}
EVENT_MATCH_COUNTS = {"repechage": 32, "nationals": 96}
SOURCE_KINDS = {"official", "synthetic"}
COMPLETED_STATUSES = {"DONE", "FINISHED", "ENDED", "COMPLETE", "COMPLETED"}
RUNNING_STATUSES = {"RUNNING", "STARTED", "ONGOING", "IN_PROGRESS", "LIVE"}
SCORELINE_RE = re.compile(r"^(\d+):(\d+)$")


def _path_signature(path: Path) -> tuple[str, int, int]:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return str(path), 0, -1
    return str(path), stat.st_mtime_ns, stat.st_size


@lru_cache(maxsize=8)
def _load_runtime_cached(path_text: str, _mtime_ns: int, _size: int) -> dict[str, Any] | None:
    path = Path(path_text)
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return validate_runtime_payload(payload)


def load_finals_runtime() -> dict[str, Any] | None:
    return _load_runtime_cached(*_path_signature(FINALS_RUNTIME_PATH))


load_finals_runtime.cache_clear = _load_runtime_cached.cache_clear  # type: ignore[attr-defined]


def runtime_artifact_version() -> str:
    path_text, mtime_ns, size = _path_signature(FINALS_RUNTIME_PATH)
    return f"{Path(path_text).name}:{mtime_ns}:{size}"


def _side_is_present(match: dict[str, Any], side: str) -> bool:
    return bool(match.get(f"{side}TeamKey") or match.get(f"{side}CollegeName"))


def _validate_scoreline(match: dict[str, Any], *, completed: bool) -> tuple[int, int] | None:
    scoreline = str(match.get("scoreline") or "").strip()
    if not scoreline:
        if completed:
            raise ValueError(f"Completed finals match {match.get('officialMatchId')} has no scoreline")
        return None
    parsed = SCORELINE_RE.fullmatch(scoreline)
    if parsed is None:
        raise ValueError(f"Invalid finals scoreline: {scoreline}")
    red_wins, blue_wins = int(parsed.group(1)), int(parsed.group(2))
    best_of = int(match.get("bestOf") or 3)
    wins_needed = best_of // 2 + 1
    if red_wins > wins_needed or blue_wins > wins_needed:
        raise ValueError(f"Finals scoreline exceeds BO{best_of}: {scoreline}")
    if completed and not (
        (red_wins == wins_needed and blue_wins < wins_needed)
        or (blue_wins == wins_needed and red_wins < wins_needed)
    ):
        raise ValueError(f"Completed finals scoreline is not decisive: {scoreline}")
    return red_wins, blue_wins


def normalize_runtime_match(raw_match: dict[str, Any], *, source_kind: str) -> dict[str, Any]:
    match = dict(raw_match)
    official_match_id = str(match.get("officialMatchId") or "").strip()
    if not official_match_id:
        raise ValueError("Finals runtime match has no officialMatchId")
    if source_kind == "official" and official_match_id.upper().startswith("SYNTH-"):
        raise ValueError("Official finals runtime cannot use a synthetic match ID")
    match["officialMatchId"] = official_match_id
    match["number"] = int(match["number"])
    match["officialStatus"] = str(match.get("officialStatus") or "WAITING").strip().upper()
    match["sourceKind"] = source_kind
    match["isSynthetic"] = source_kind == "synthetic"

    has_both_sides = _side_is_present(match, "red") and _side_is_present(match, "blue")
    requested_confirmed = match.get("isConfirmedMatchup") is True
    if requested_confirmed and not has_both_sides:
        raise ValueError(f"Confirmed finals match {official_match_id} is missing a team")
    match["isConfirmedMatchup"] = requested_confirmed and has_both_sides

    requested_completed = match.get("isCompleted") is True or match["officialStatus"] in COMPLETED_STATUSES
    result = str(match.get("result") or "").strip().lower()
    if requested_completed and (not match["isConfirmedMatchup"] or result not in {"red", "blue"}):
        raise ValueError(f"Completed finals match {official_match_id} lacks confirmed teams or winner")
    scores = _validate_scoreline(match, completed=requested_completed)
    if requested_completed and scores is not None:
        red_wins, blue_wins = scores
        expected_result = "red" if red_wins > blue_wins else "blue"
        if result != expected_result:
            raise ValueError(f"Finals winner conflicts with scoreline for {official_match_id}")
        match.update({"redWins": red_wins, "blueWins": blue_wins, "result": expected_result})
    elif result:
        raise ValueError(f"Unfinished finals match {official_match_id} must not declare a winner")

    match["isCompleted"] = requested_completed
    match["hasLiveScoreline"] = bool(
        match["isConfirmedMatchup"]
        and scores is not None
        and (requested_completed or match.get("hasLiveScoreline") is True or match["officialStatus"] in RUNNING_STATUSES)
    )
    return match


def validate_runtime_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Finals runtime payload must be an object")
    if payload.get("schemaVersion") != "rmuc-finals-live-v1":
        raise ValueError("Unsupported finals runtime schemaVersion")
    source_kind = str(payload.get("sourceKind") or "").strip().lower()
    if source_kind not in SOURCE_KINDS:
        raise ValueError("Finals runtime sourceKind must be official or synthetic")
    source_status = str(payload.get("sourceStatus") or "").strip().lower()
    if source_status not in {"active", "inactive", "missing"}:
        raise ValueError("Finals runtime sourceStatus is invalid")
    if source_status == "active" and not str(payload.get("sourceUpdatedAt") or "").strip():
        raise ValueError("Active finals runtime has no sourceUpdatedAt")
    events = payload.get("events")
    if not isinstance(events, dict) or not set(events).issubset(EVENT_SLUGS):
        raise ValueError("Finals runtime events are invalid")

    normalized = {**payload, "sourceKind": source_kind, "sourceStatus": source_status}
    normalized_events: dict[str, Any] = {}
    seen_match_ids: set[str] = set()
    for event_slug, raw_event in events.items():
        if not isinstance(raw_event, dict):
            raise ValueError(f"Invalid finals runtime event: {event_slug}")
        matches = []
        seen_numbers: set[int] = set()
        for raw_match in raw_event.get("matches", []):
            if not isinstance(raw_match, dict):
                raise ValueError(f"Invalid finals runtime match in {event_slug}")
            match = normalize_runtime_match(raw_match, source_kind=source_kind)
            match_number = match["number"]
            if match_number < 1 or match_number > EVENT_MATCH_COUNTS[event_slug]:
                raise ValueError(f"Finals match number out of range for {event_slug}: {match_number}")
            if match_number in seen_numbers:
                raise ValueError(f"Duplicate finals match number in {event_slug}: {match_number}")
            seen_numbers.add(match_number)
            if match["officialMatchId"] in seen_match_ids:
                raise ValueError(f"Duplicate finals officialMatchId: {match['officialMatchId']}")
            seen_match_ids.add(match["officialMatchId"])
            matches.append(match)
        normalized_events[event_slug] = {
            **raw_event,
            "participants": [dict(row) for row in raw_event.get("participants", []) if isinstance(row, dict)],
            "matches": matches,
        }
    normalized["events"] = normalized_events
    normalized["isSynthetic"] = source_kind == "synthetic"
    return normalized
