from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path
import re
from typing import Any
import unicodedata


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
            "statusLabel": f"{len(participants)} 队名单已确认 · 抽签待定",
            "formalMatchCount": len(matches),
            "participants": participants,
            "matches": matches,
        }
    )
    return response_event


def build_final_event_payload(event_slug: str) -> dict[str, Any]:
    if event_slug not in EVENT_SLUGS:
        raise KeyError(event_slug)
    payload = load_finals_schedule()
    return {
        "schemaVersion": payload["schemaVersion"],
        "season": payload["season"],
        "timezone": payload["timezone"],
        "timezoneLabel": payload["timezoneLabel"],
        "scheduleStatus": payload["scheduleStatus"],
        "verifiedAt": payload["verifiedAt"],
        "sources": payload["sources"],
        "event": _build_event_payload(payload["events"][event_slug]),
    }
