from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path
import re
from typing import Any
import unicodedata

from . import finals_live
from .service import build_finals_prediction_matrix


ROOT = Path(__file__).resolve().parents[2]
FINALS_SCHEDULE_PATH = ROOT / "data" / "reference" / "2026_finals" / "schedule.json"
TEAM_RATINGS_PATH = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "preseason_ratings.csv"
EVENT_SLUGS = {"repechage", "nationals"}
SCHOOL_ALIASES = {
    "北京理工大学（珠海）": "北京理工大学珠海学院",
    "华北科技学院": "应急管理大学",
    "合肥工业大学（宣城校区）": "合肥工业大学(宣城校区)",
    "应急管理学院": "应急管理大学",
}
EVENT_RESPONSE_FIELDS = (
    "slug",
    "name",
    "shortName",
    "eyebrow",
    "statusLabel",
    "dateRange",
    "competitionRange",
    "advancementSlots",
    "groups",
    "drawRules",
    "ceremonySchedule",
)
COMPLETED_MATCH_STATUSES = {"DONE", "FINISHED", "ENDED", "COMPLETE", "COMPLETED"}
RUNNING_MATCH_STATUSES = {"RUNNING", "STARTED", "ONGOING", "IN_PROGRESS", "LIVE"}


@lru_cache(maxsize=1)
def load_finals_schedule() -> dict[str, Any]:
    with FINALS_SCHEDULE_PATH.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    _validate_payload(payload)
    return payload


def _validate_payload(payload: dict[str, Any]) -> None:
    if payload.get("timezone") != "Asia/Shanghai":
        raise ValueError("Finals schedule must use Asia/Shanghai")

    events = payload.get("events")
    if not isinstance(events, dict) or set(events) != EVENT_SLUGS:
        raise ValueError("Finals schedule must contain repechage and nationals")

    for event_slug, event in events.items():
        matches = event.get("matches")
        participants = event.get("participants")
        if not isinstance(matches, list) or not isinstance(participants, list):
            raise ValueError(f"Invalid list fields for {event_slug}")

        formal_match_count = int(event["formalMatchCount"])
        participant_count = int(event["participantCount"])
        if [match.get("number") for match in matches] != list(range(1, formal_match_count + 1)):
            raise ValueError(f"Non-contiguous formal match numbers for {event_slug}")
        if len(participants) != participant_count:
            raise ValueError(f"Participant count mismatch for {event_slug}")


def _identity_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"\s+", "", normalized)


def _canonical_school_name(value: Any) -> str:
    school_name = str(value or "").strip()
    return SCHOOL_ALIASES.get(school_name, school_name)


@lru_cache(maxsize=1)
def _load_team_identity_indexes() -> dict[str, dict[Any, dict[str, str]]]:
    by_pair: dict[tuple[str, str], dict[str, str]] = {}
    by_school: dict[str, dict[str, str]] = {}
    team_candidates: dict[str, list[dict[str, str]]] = {}

    if not TEAM_RATINGS_PATH.exists():
        return {"by_pair": by_pair, "by_school": by_school, "by_team": {}}

    with TEAM_RATINGS_PATH.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            identity = {
                "schoolKey": str(row.get("school_key") or row.get("college_name") or "").strip(),
                "teamKey": str(row.get("team_key") or "").strip(),
            }
            school_lookup = _identity_key(row.get("college_name"))
            team_lookup = _identity_key(row.get("team_name"))
            if school_lookup and team_lookup:
                by_pair[(school_lookup, team_lookup)] = identity
            if school_lookup:
                by_school[school_lookup] = identity
            if team_lookup:
                team_candidates.setdefault(team_lookup, []).append(identity)

    by_team = {
        team_lookup: candidates[0]
        for team_lookup, candidates in team_candidates.items()
        if len(candidates) == 1
    }
    return {"by_pair": by_pair, "by_school": by_school, "by_team": by_team}


def _participant_identity(participant: dict[str, Any]) -> dict[str, str | None]:
    school_name = _canonical_school_name(participant.get("collegeName"))
    team_name = str(participant.get("teamName") or "").strip()
    school_lookup = _identity_key(school_name)
    team_lookup = _identity_key(team_name)
    indexes = _load_team_identity_indexes()

    identity = indexes["by_pair"].get((school_lookup, team_lookup))
    if identity is None:
        identity = indexes["by_team"].get(team_lookup)
    if identity is None:
        identity = indexes["by_school"].get(school_lookup)
    if identity is not None:
        return {
            "schoolKey": identity["schoolKey"],
            "teamKey": identity["teamKey"] or None,
        }
    return {"schoolKey": school_name, "teamKey": None}


def _is_confirmed_real_participant(participant: dict[str, Any]) -> bool:
    return participant.get("status") == "confirmed"


def _official_match_status(match: dict[str, Any]) -> str:
    return str(match.get("officialStatus") or "").strip().upper()


def _event_status_label(participant_count: int, matches: list[dict[str, Any]]) -> str:
    total = len(matches)
    completed = sum(
        match.get("isCompleted") is True or _official_match_status(match) in COMPLETED_MATCH_STATUSES
        for match in matches
    )
    running = sum(_official_match_status(match) in RUNNING_MATCH_STATUSES for match in matches)
    if running:
        return f"{running} 场进行中 · 已完赛 {completed} / {total} 场"
    if completed:
        return f"已完赛 {completed} / {total} 场"
    confirmed_matchups = sum(
        match.get("isConfirmedMatchup") is True
        and bool(match.get("redCollegeName") or match.get("redTeamKey"))
        and bool(match.get("blueCollegeName") or match.get("blueTeamKey"))
        for match in matches
    )
    if confirmed_matchups:
        return f"{participant_count} 队抽签已完成 · 等待开赛"
    return f"{participant_count} 队名单已确认 · 抽签待定"


def _build_event_payload(event: dict[str, Any]) -> dict[str, Any]:
    participants = [
        {**participant, **_participant_identity(participant)}
        for participant in event.get("participants", [])
        if isinstance(participant, dict) and _is_confirmed_real_participant(participant)
    ]
    matches = [
        dict(match)
        for match in event.get("matches", [])
        if isinstance(match, dict) and match.get("kind") == "formal"
    ]
    response_event = {
        field: event[field]
        for field in EVENT_RESPONSE_FIELDS
        if field in event
    }
    response_event.update(
        {
            "participantCount": len(participants),
            "confirmedParticipantCount": len(participants),
            "statusLabel": _event_status_label(len(participants), matches),
            "formalMatchCount": len(matches),
            "participants": participants,
            "matches": matches,
        }
    )
    response_event["predictionMatrix"] = build_finals_prediction_matrix(participants)
    response_event["predictionBasis"] = "finals_sequential_elo"
    return response_event


def _merge_runtime_event(event: dict[str, Any], runtime_event: dict[str, Any] | None) -> dict[str, Any]:
    if not runtime_event:
        return dict(event)
    merged = dict(event)
    participants = [dict(row) for row in event.get("participants", []) if isinstance(row, dict)]
    participant_index = {
        (_identity_key(row.get("collegeName")), _identity_key(row.get("teamName"))): index
        for index, row in enumerate(participants)
    }
    for participant in runtime_event.get("participants", []):
        if not isinstance(participant, dict):
            continue
        key = (_identity_key(participant.get("collegeName")), _identity_key(participant.get("teamName")))
        if key in participant_index:
            participants[participant_index[key]].update(participant)
        else:
            participant_index[key] = len(participants)
            participants.append(dict(participant))
    for index, participant in enumerate(participants, start=1):
        participant["order"] = index
    merged["participants"] = participants
    merged["participantCount"] = len(participants)

    runtime_matches = {
        int(row["number"]): row
        for row in runtime_event.get("matches", [])
        if isinstance(row, dict) and row.get("number") is not None
    }
    merged["matches"] = [
        {**match, **runtime_matches.get(int(match["number"]), {})}
        for match in event.get("matches", [])
        if isinstance(match, dict)
    ]
    return merged


def _source_age_seconds(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = parsedate_to_datetime(text) if "," in text else datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return max(0, int((datetime.now(tz=UTC) - parsed.astimezone(UTC)).total_seconds()))


def _runtime_status(runtime: dict[str, Any] | None, event_slug: str) -> dict[str, Any]:
    if not runtime:
        return {
            "sourceStatus": "missing",
            "sourceKind": None,
            "isSynthetic": False,
            "sourceUpdatedAt": None,
            "sourceAgeSeconds": None,
            "freshnessLabel": "missing",
            "validationState": "missing",
            "scenarioId": None,
            "runtimeArtifactVersion": finals_live.runtime_artifact_version(),
            "completedMatches": 0,
            "confirmedMatches": 0,
        }
    matches = [
        match
        for match in runtime.get("events", {}).get(event_slug, {}).get("matches", [])
        if isinstance(match, dict)
    ]
    source_age_seconds = _source_age_seconds(runtime.get("sourceUpdatedAt"))
    return {
        "sourceStatus": runtime.get("sourceStatus"),
        "sourceKind": runtime.get("sourceKind"),
        "isSynthetic": runtime.get("isSynthetic") is True,
        "sourceUpdatedAt": runtime.get("sourceUpdatedAt"),
        "sourceAgeSeconds": source_age_seconds,
        "freshnessLabel": (
            "synthetic"
            if runtime.get("isSynthetic") is True
            else "unknown"
            if source_age_seconds is None
            else "fresh"
            if source_age_seconds <= 900
            else "stale"
        ),
        "validationState": "validated",
        "scenarioId": runtime.get("scenarioId"),
        "runtimeArtifactVersion": finals_live.runtime_artifact_version(),
        "completedMatches": sum(match.get("isCompleted") is True for match in matches),
        "confirmedMatches": sum(match.get("isConfirmedMatchup") is True for match in matches),
    }


def build_final_event_payload(event_slug: str) -> dict[str, Any]:
    if event_slug not in EVENT_SLUGS:
        raise KeyError(event_slug)
    payload = load_finals_schedule()
    runtime = finals_live.load_finals_runtime()
    runtime_active = runtime is not None and runtime.get("sourceStatus") == "active"
    runtime_event = runtime.get("events", {}).get(event_slug) if runtime_active else None
    merged_event = _merge_runtime_event(payload["events"][event_slug], runtime_event)
    runtime_status = _runtime_status(runtime, event_slug)
    sources = list(payload["sources"])
    if runtime_active:
        sources.append(
            {
                "kind": "synthetic_runtime" if runtime_status["isSynthetic"] else "official_runtime",
                "title": runtime_status["scenarioId"] or "RMUC finals live runtime",
                "updatedAt": runtime_status["sourceUpdatedAt"],
                "coverage": "对阵、局中比分与完赛赛果运行时覆盖层",
                "isSynthetic": runtime_status["isSynthetic"],
            }
        )
    return {
        "schemaVersion": payload["schemaVersion"],
        "season": payload["season"],
        "timezone": payload["timezone"],
        "timezoneLabel": payload["timezoneLabel"],
        "scheduleStatus": (
            "synthetic_scenario_active"
            if runtime_status["isSynthetic"] and runtime_active
            else "official_live_active"
            if runtime_active
            else payload["scheduleStatus"]
        ),
        "verifiedAt": runtime_status["sourceUpdatedAt"] or payload["verifiedAt"],
        "sources": sources,
        "liveStatus": runtime_status,
        "event": _build_event_payload(merged_event),
    }
