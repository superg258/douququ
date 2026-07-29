from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from backend.app.competition import (
    COMPLETED_MATCH_STATUSES,
    RUNNING_MATCH_STATUSES,
    is_completed_match_status,
    is_running_match_status,
    normalize_match_result,
    normalize_match_status,
)
from backend.app.team_identity import resolve_team_identity, team_identity_key

BEIJING_TZ = ZoneInfo("Asia/Shanghai")
OFFICIAL_ZONE_TO_EVENT = {
    "复活赛": "repechage",
    "全国赛": "nationals",
}
EXPECTED_MATCH_COUNTS = {
    "repechage": 32,
    "nationals": 96,
}
EXPECTED_GROUP_IDS = {
    "repechage": frozenset({"2715", "2716"}),
    "nationals": frozenset({"2717", "2718"}),
}
# The official nationals zone also contains two exhibition matches.  They are
# not part of the 96-match reference contract and must never be projected onto
# a formal match number.
NATIONALS_ALL_STAR_MATCHES = {
    97: {"groupId": "2722", "bestOf": 1},
    98: {"groupId": "2721", "bestOf": 2},
}
ALLOWED_STATUSES = frozenset(
    {
        "WAITING",
        "PENDING",
        "READY",
        *COMPLETED_MATCH_STATUSES,
        *RUNNING_MATCH_STATUSES,
    }
)


def is_official_schedule_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    data = payload.get("data")
    event = data.get("event") if isinstance(data, dict) else None
    return isinstance(event, dict) and isinstance(event.get("zones"), dict)


def _nodes(owner: dict[str, Any], field: str, *, context: str) -> list[dict[str, Any]]:
    connection = owner.get(field)
    if not isinstance(connection, dict) or not isinstance(connection.get("nodes"), list):
        raise ValueError(f"Official finals {context}.{field}.nodes is missing")
    rows = connection["nodes"]
    if not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"Official finals {context}.{field}.nodes contains a non-object")
    return rows


def _parse_timestamp(value: Any, *, context: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Official finals {context} is missing")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"Official finals {context} is invalid: {text}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"Official finals {context} must include a timezone")
    return parsed


def _positive_int(value: Any, *, context: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"Official finals {context} must be an integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Official finals {context} must be an integer") from exc
    if parsed < 1:
        raise ValueError(f"Official finals {context} must be positive")
    return parsed


def _score_count(value: Any, *, context: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"Official finals {context} must be a non-negative integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Official finals {context} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"Official finals {context} must be a non-negative integer")
    return parsed


def _reference_match_index(base_event: dict[str, Any], event_slug: str) -> dict[int, dict[str, Any]]:
    expected_count = EXPECTED_MATCH_COUNTS[event_slug]
    matches = base_event.get("matches")
    if not isinstance(matches, list):
        raise ValueError(f"Finals reference {event_slug} matches must be a list")
    index: dict[int, dict[str, Any]] = {}
    for row in matches:
        if not isinstance(row, dict):
            raise ValueError(f"Finals reference {event_slug} contains a non-object match")
        number = _positive_int(row.get("number"), context=f"reference {event_slug} match number")
        if number in index:
            raise ValueError(f"Duplicate finals reference match number in {event_slug}: {number}")
        index[number] = row
    expected_numbers = set(range(1, expected_count + 1))
    if set(index) != expected_numbers:
        raise ValueError(f"Finals reference {event_slug} does not cover 1..{expected_count}")
    return index


def _reference_duration(reference_match: dict[str, Any], *, context: str):
    starts_at = _parse_timestamp(reference_match.get("startsAt"), context=f"{context} reference startsAt")
    ends_at = _parse_timestamp(reference_match.get("endsAt"), context=f"{context} reference endsAt")
    duration = ends_at - starts_at
    if duration.total_seconds() <= 0 or duration.total_seconds() > 2 * 60 * 60:
        raise ValueError(f"Finals reference {context} has an invalid duration")
    return duration


def _side_identity(match: dict[str, Any], side: str, *, context: str) -> dict[str, str] | None:
    side_payload = match.get(f"{side}Side")
    if side_payload is None:
        return None
    if not isinstance(side_payload, dict):
        raise ValueError(f"Official finals {context} {side}Side must be an object")
    player = side_payload.get("player")
    if player is None:
        return None
    if not isinstance(player, dict):
        raise ValueError(f"Official finals {context} {side} player must be an object")
    team = player.get("team")
    if team is None:
        if player.get("teamId") not in {None, ""}:
            raise ValueError(f"Official finals {context} {side} player has teamId without team")
        return None
    if not isinstance(team, dict):
        raise ValueError(f"Official finals {context} {side} team must be an object")
    college_name = str(team.get("collegeName") or "").strip()
    team_name = str(team.get("name") or "").strip()
    if not college_name or not team_name:
        raise ValueError(f"Official finals {context} {side} team identity is incomplete")
    identity = resolve_team_identity(college_name, team_name)
    return {
        "schoolKey": str(identity["schoolKey"]),
        "teamKey": str(identity["teamKey"]),
        "collegeName": str(identity["collegeName"]),
        "teamName": str(identity["teamName"]),
    }


def _runtime_side_fields(side: str, identity: dict[str, str]) -> dict[str, str]:
    return {
        f"{side}SchoolKey": identity["schoolKey"],
        f"{side}TeamKey": identity["teamKey"],
        f"{side}CollegeName": identity["collegeName"],
        f"{side}TeamName": identity["teamName"],
    }


def _is_expected_all_star(match: dict[str, Any]) -> bool:
    try:
        order_number = int(match.get("orderNumber"))
    except (TypeError, ValueError):
        return False
    contract = NATIONALS_ALL_STAR_MATCHES.get(order_number)
    if contract is None:
        return False
    return (
        str(match.get("groupId") or "") == contract["groupId"]
        and str(match.get("matchType") or "").strip().upper() == "GROUP"
        and int(match.get("planGameCount") or 0) == contract["bestOf"]
    )


def _normalize_official_match(
    raw_match: dict[str, Any],
    *,
    event_slug: str,
    bucket: str,
    reference_match: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    number = _positive_int(
        raw_match.get("orderNumber"),
        context=f"{event_slug} orderNumber",
    )
    context = f"{event_slug} match #{number}"
    official_match_id = str(raw_match.get("id") or "").strip()
    if not official_match_id or not official_match_id.isdigit():
        raise ValueError(f"Official finals {context} has an invalid officialMatchId")

    expected_match_type = "GROUP" if bucket == "groupMatches" else "KNOCKOUT"
    match_type = str(raw_match.get("matchType") or "").strip().upper()
    if match_type != expected_match_type:
        raise ValueError(
            f"Official finals {context} matchType is {match_type or 'missing'}, "
            f"expected {expected_match_type}"
        )
    reference_is_group = str(reference_match.get("stageKey") or "") == "swiss"
    if reference_is_group != (bucket == "groupMatches"):
        raise ValueError(f"Official finals {context} does not match the reference stage family")
    if bucket == "groupMatches":
        group_id = str(raw_match.get("groupId") or "")
        if group_id not in EXPECTED_GROUP_IDS[event_slug]:
            raise ValueError(f"Official finals {context} has unexpected groupId: {group_id or 'missing'}")
    elif raw_match.get("groupId") not in {None, ""}:
        raise ValueError(f"Official finals {context} knockout unexpectedly has a groupId")

    best_of = _positive_int(raw_match.get("planGameCount"), context=f"{context} planGameCount")
    reference_best_of = _positive_int(reference_match.get("bestOf"), context=f"{context} reference bestOf")
    if best_of != reference_best_of:
        raise ValueError(
            f"Official finals {context} BO{best_of} does not match reference BO{reference_best_of}"
        )

    starts_at = _parse_timestamp(raw_match.get("planStartedAt"), context=f"{context} planStartedAt")
    duration = _reference_duration(reference_match, context=context)
    local_start = starts_at.astimezone(BEIJING_TZ)
    local_end = local_start + duration

    status = normalize_match_status(raw_match.get("status"))
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"Official finals {context} has unsupported status: {status or 'missing'}")
    result = normalize_match_result(raw_match.get("result"))
    if result not in {"", "RED", "BLUE"}:
        raise ValueError(f"Official finals {context} has unsupported result: {result}")
    red_wins = _score_count(raw_match.get("redSideWinGameCount"), context=f"{context} red score")
    blue_wins = _score_count(raw_match.get("blueSideWinGameCount"), context=f"{context} blue score")
    red_identity = _side_identity(raw_match, "red", context=context)
    blue_identity = _side_identity(raw_match, "blue", context=context)
    confirmed = red_identity is not None and blue_identity is not None
    if (
        is_completed_match_status(status)
        or is_running_match_status(status)
        or result
        or red_wins
        or blue_wins
    ) and not confirmed:
        raise ValueError(f"Official finals {context} has live/result data without both teams")

    runtime_match: dict[str, Any] = {
        "number": number,
        "bestOf": best_of,
        "officialMatchId": official_match_id,
        "officialStatus": status,
        "isCompleted": is_completed_match_status(status),
        "isConfirmedMatchup": confirmed,
        "hasLiveScoreline": bool(
            confirmed
            and (
                is_completed_match_status(status)
                or is_running_match_status(status)
                or red_wins
                or blue_wins
            )
        ),
        "scoreline": f"{red_wins}:{blue_wins}",
        "result": result.lower(),
        "redWins": red_wins,
        "blueWins": blue_wins,
        "startsAt": local_start.isoformat(timespec="seconds"),
        "endsAt": local_end.isoformat(timespec="seconds"),
    }
    participants: list[dict[str, str]] = []
    if red_identity is not None:
        runtime_match.update(_runtime_side_fields("red", red_identity))
        participants.append(red_identity)
    if blue_identity is not None:
        runtime_match.update(_runtime_side_fields("blue", blue_identity))
        participants.append(blue_identity)
    return runtime_match, participants


def overlay_from_official_schedule(
    payload: dict[str, Any],
    base: dict[str, Any],
    *,
    source_updated_at: str,
) -> dict[str, Any]:
    if not is_official_schedule_payload(payload):
        raise ValueError("Official finals source is not the RMUC schedule.json schema")
    event = payload["data"]["event"]
    title = str(event.get("title") or "").strip()
    season_match = re.search(r"(20\d{2})", title)
    season = int(season_match.group(1)) if season_match else None
    if season != 2026 or ("RMUC" not in title and "超级对抗赛" not in title):
        raise ValueError(f"Official finals source is not the RMUC 2026 event: {title or 'missing title'}")

    zones = _nodes(event, "zones", context="event")
    target_zones: dict[str, dict[str, Any]] = {}
    for zone in zones:
        zone_name = str(zone.get("name") or "").strip()
        if zone_name not in OFFICIAL_ZONE_TO_EVENT:
            continue
        if zone_name in target_zones:
            raise ValueError(f"Official finals source contains duplicate zone: {zone_name}")
        target_zones[zone_name] = zone
    missing_zones = sorted(set(OFFICIAL_ZONE_TO_EVENT) - set(target_zones))
    if missing_zones:
        raise ValueError("Official finals source is missing zones: " + ", ".join(missing_zones))

    base_events = base.get("events")
    if int(base.get("season") or 0) != 2026 or not isinstance(base_events, dict):
        raise ValueError("Finals reference must be the 2026 schedule")

    events: dict[str, Any] = {}
    seen_official_ids: set[str] = set()
    for zone_name, event_slug in OFFICIAL_ZONE_TO_EVENT.items():
        zone = target_zones[zone_name]
        base_event = base_events.get(event_slug)
        if not isinstance(base_event, dict):
            raise ValueError(f"Finals reference is missing event: {event_slug}")
        reference_matches = _reference_match_index(base_event, event_slug)
        expected_count = EXPECTED_MATCH_COUNTS[event_slug]

        groups = _nodes(zone, "groups", context=f"zone {zone_name}")
        group_ids = {str(group.get("id") or "") for group in groups}
        allowed_group_ids = set(EXPECTED_GROUP_IDS[event_slug])
        if event_slug == "nationals":
            allowed_group_ids.update(
                str(contract["groupId"]) for contract in NATIONALS_ALL_STAR_MATCHES.values()
            )
        if not EXPECTED_GROUP_IDS[event_slug].issubset(group_ids):
            raise ValueError(f"Official finals zone {zone_name} is missing a formal group")
        unexpected_group_ids = sorted(group_ids - allowed_group_ids)
        if unexpected_group_ids:
            raise ValueError(
                f"Official finals zone {zone_name} has unexpected groups: {unexpected_group_ids}"
            )

        runtime_matches: list[dict[str, Any]] = []
        participants_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        seen_numbers: set[int] = set()
        for bucket in ("groupMatches", "knockoutMatches"):
            for raw_match in _nodes(zone, bucket, context=f"zone {zone_name}"):
                order_number = _positive_int(
                    raw_match.get("orderNumber"),
                    context=f"{event_slug} orderNumber",
                )
                if order_number > expected_count:
                    if event_slug == "nationals" and _is_expected_all_star(raw_match):
                        continue
                    raise ValueError(
                        f"Official finals {event_slug} contains unexpected out-of-range "
                        f"match #{order_number}"
                    )
                if order_number in seen_numbers:
                    raise ValueError(
                        f"Official finals {event_slug} contains duplicate match #{order_number}"
                    )
                runtime_match, match_participants = _normalize_official_match(
                    raw_match,
                    event_slug=event_slug,
                    bucket=bucket,
                    reference_match=reference_matches[order_number],
                )
                official_match_id = runtime_match["officialMatchId"]
                if official_match_id in seen_official_ids:
                    raise ValueError(
                        f"Official finals source contains duplicate officialMatchId: {official_match_id}"
                    )
                seen_official_ids.add(official_match_id)
                seen_numbers.add(order_number)
                runtime_matches.append(runtime_match)
                for participant in match_participants:
                    key = team_identity_key(
                        participant["collegeName"],
                        participant["teamName"],
                    )
                    participants_by_key[key] = {
                        "collegeName": participant["collegeName"],
                        "teamName": participant["teamName"],
                        "status": "confirmed",
                    }

        expected_numbers = set(range(1, expected_count + 1))
        if seen_numbers != expected_numbers:
            missing = sorted(expected_numbers - seen_numbers)
            raise ValueError(
                f"Official finals {event_slug} does not cover 1..{expected_count}; "
                f"missing={missing}"
            )
        runtime_matches.sort(key=lambda row: int(row["number"]))
        events[event_slug] = {
            "participants": list(participants_by_key.values()),
            "matches": runtime_matches,
        }

    return {
        "schemaVersion": "rmuc-finals-live-v1",
        "season": 2026,
        "sourceStatus": "active",
        "sourceKind": "official",
        "sourceUpdatedAt": source_updated_at,
        "scenarioId": None,
        "mappingContract": "official-order-number-v1",
        "events": events,
    }
