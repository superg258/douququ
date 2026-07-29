from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from .artifacts import artifact_version, path_signature, read_json
from .competition import (
    FINAL_EVENT_MATCH_COUNTS,
    FINAL_EVENT_SLUGS,
    SUPPORTED_BEST_OF,
    normalize_match_outcome,
    source_age_seconds,
    validate_distinct_matchup,
)
from .team_identity import resolve_team_identity

ROOT = Path(__file__).resolve().parents[2]
FINALS_RUNTIME_PATH = ROOT / "data" / "runtime" / "rmuc_live" / "finals" / "normalized_schedule.json"
EVENT_SLUGS = FINAL_EVENT_SLUGS
EVENT_MATCH_COUNTS = FINAL_EVENT_MATCH_COUNTS
SOURCE_KINDS = {"official", "synthetic"}
RUNTIME_MATCH_FIELDS = (
    "officialStatus",
    "isCompleted",
    "isConfirmedMatchup",
    "hasLiveScoreline",
    "scoreline",
    "result",
    "redWins",
    "blueWins",
    "redSchoolKey",
    "redTeamKey",
    "redCollegeName",
    "redTeamName",
    "blueSchoolKey",
    "blueTeamKey",
    "blueCollegeName",
    "blueTeamName",
    "startsAt",
    "endsAt",
)
RUNTIME_EVENT_FIELDS = (
    "fieldCapacity",
    "drawStatus",
    "pendingEntryCount",
    "pendingEntrySlots",
)
_RUNTIME_MATCH_INPUT_FIELDS = frozenset(
    {"number", "bestOf", "officialMatchId", "sourceKind", "isSynthetic", *RUNTIME_MATCH_FIELDS}
)
_RUNTIME_EVENT_INPUT_FIELDS = frozenset({"participants", "matches", *RUNTIME_EVENT_FIELDS})


@lru_cache(maxsize=8)
def _load_runtime_cached(path_text: str, _mtime_ns: int, _size: int) -> dict[str, Any] | None:
    path = Path(path_text)
    if not path.exists():
        return None
    return validate_runtime_payload(read_json(path))


def load_finals_runtime() -> dict[str, Any] | None:
    return _load_runtime_cached(*path_signature(FINALS_RUNTIME_PATH))


load_finals_runtime.cache_clear = _load_runtime_cached.cache_clear  # type: ignore[attr-defined]


def runtime_artifact_version() -> str:
    return artifact_version([FINALS_RUNTIME_PATH])


def _side_is_present(match: dict[str, Any], side: str) -> bool:
    return bool(match.get(f"{side}TeamKey") or match.get(f"{side}CollegeName"))


def _runtime_timestamp(value: Any, *, context: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{context} is missing")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{context} is invalid: {text}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{context} must include a timezone")
    return parsed


def normalize_runtime_match(raw_match: dict[str, Any], *, source_kind: str) -> dict[str, Any]:
    unsupported_fields = sorted(set(raw_match) - _RUNTIME_MATCH_INPUT_FIELDS)
    if unsupported_fields:
        raise ValueError(
            "Finals runtime match cannot override schedule fields: " + ", ".join(unsupported_fields)
        )
    match = {field: raw_match[field] for field in _RUNTIME_MATCH_INPUT_FIELDS if field in raw_match}
    official_match_id = str(match.get("officialMatchId") or "").strip()
    if not official_match_id:
        raise ValueError("Finals runtime match has no officialMatchId")
    if source_kind == "official" and official_match_id.upper().startswith("SYNTH-"):
        raise ValueError("Official finals runtime cannot use a synthetic match ID")
    match["officialMatchId"] = official_match_id
    match["number"] = int(match["number"])
    match["bestOf"] = int(match.get("bestOf") or 3)
    if match["bestOf"] not in SUPPORTED_BEST_OF:
        raise ValueError(f"Unsupported finals best-of value: {match['bestOf']}")
    has_starts_at = bool(str(match.get("startsAt") or "").strip())
    has_ends_at = bool(str(match.get("endsAt") or "").strip())
    if has_starts_at != has_ends_at:
        raise ValueError(f"Finals match {official_match_id} must provide startsAt and endsAt together")
    if has_starts_at:
        starts_at = _runtime_timestamp(
            match["startsAt"],
            context=f"Finals match {official_match_id} startsAt",
        )
        ends_at = _runtime_timestamp(
            match["endsAt"],
            context=f"Finals match {official_match_id} endsAt",
        )
        duration_seconds = (ends_at - starts_at).total_seconds()
        if duration_seconds <= 0 or duration_seconds > 2 * 60 * 60:
            raise ValueError(f"Finals match {official_match_id} has an invalid runtime duration")
        match["startsAt"] = starts_at.isoformat(timespec="seconds")
        match["endsAt"] = ends_at.isoformat(timespec="seconds")
    match["sourceKind"] = source_kind
    match["isSynthetic"] = source_kind == "synthetic"

    has_both_sides = _side_is_present(match, "red") and _side_is_present(match, "blue")
    requested_confirmed = match.get("isConfirmedMatchup") is True
    if requested_confirmed and not has_both_sides:
        raise ValueError(f"Confirmed finals match {official_match_id} is missing a team")
    match["isConfirmedMatchup"] = requested_confirmed and has_both_sides
    red_identity = (
        str(match.get("redTeamKey") or "").strip()
        or str(resolve_team_identity(match.get("redCollegeName"), match.get("redTeamName"))["teamKey"])
    )
    blue_identity = (
        str(match.get("blueTeamKey") or "").strip()
        or str(resolve_team_identity(match.get("blueCollegeName"), match.get("blueTeamName"))["teamKey"])
    )
    validate_distinct_matchup(
        is_confirmed=match["isConfirmedMatchup"],
        red_identity=red_identity,
        blue_identity=blue_identity,
        context=f"Finals match {official_match_id}",
    )
    outcome = normalize_match_outcome(
        status=match.get("officialStatus") or "WAITING",
        result=match.get("result"),
        scoreline=match.get("scoreline"),
        best_of=match["bestOf"],
        is_confirmed=match["isConfirmedMatchup"],
        is_completed=match.get("isCompleted") is True,
        has_live_scoreline=match.get("hasLiveScoreline") is True,
        context=f"finals match {official_match_id}",
    )
    match["officialStatus"] = outcome.status
    match["result"] = outcome.result
    if outcome.score is not None:
        match.update({"redWins": outcome.score.red_wins, "blueWins": outcome.score.blue_wins})
    else:
        match.pop("redWins", None)
        match.pop("blueWins", None)
    match["isCompleted"] = outcome.is_completed
    match["hasLiveScoreline"] = outcome.has_live_scoreline
    return match


def validate_runtime_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Finals runtime payload must be an object")
    if payload.get("schemaVersion") != "rmuc-finals-live-v1":
        raise ValueError("Unsupported finals runtime schemaVersion")
    if int(payload.get("season") or 0) != 2026:
        raise ValueError("Finals runtime season must be 2026")
    source_kind = str(payload.get("sourceKind") or "").strip().lower()
    if source_kind not in SOURCE_KINDS:
        raise ValueError("Finals runtime sourceKind must be official or synthetic")
    source_status = str(payload.get("sourceStatus") or "").strip().lower()
    if source_status not in {"active", "inactive", "missing"}:
        raise ValueError("Finals runtime sourceStatus is invalid")
    if source_status == "active" and not str(payload.get("sourceUpdatedAt") or "").strip():
        raise ValueError("Active finals runtime has no sourceUpdatedAt")
    if source_status == "active" and source_age_seconds(payload.get("sourceUpdatedAt")) is None:
        raise ValueError("Active finals runtime sourceUpdatedAt is invalid")
    events = payload.get("events")
    if not isinstance(events, dict) or not set(events).issubset(EVENT_SLUGS):
        raise ValueError("Finals runtime events are invalid")

    normalized = {**payload, "sourceKind": source_kind, "sourceStatus": source_status}
    normalized_events: dict[str, Any] = {}
    seen_match_ids: set[str] = set()
    for event_slug, raw_event in events.items():
        if not isinstance(raw_event, dict):
            raise ValueError(f"Invalid finals runtime event: {event_slug}")
        unsupported_fields = sorted(set(raw_event) - _RUNTIME_EVENT_INPUT_FIELDS)
        if unsupported_fields:
            raise ValueError(
                f"Finals runtime event {event_slug} cannot override schedule fields: "
                + ", ".join(unsupported_fields)
            )
        if not isinstance(raw_event.get("participants", []), list):
            raise ValueError(f"Finals runtime participants must be a list: {event_slug}")
        if not isinstance(raw_event.get("matches", []), list):
            raise ValueError(f"Finals runtime matches must be a list: {event_slug}")
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
