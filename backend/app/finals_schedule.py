from __future__ import annotations

from pathlib import Path
from typing import Any

from . import finals_live
from .artifacts import clear_versioned_json_cache, read_versioned_json
from .competition import (
    FINAL_EVENT_MATCH_COUNTS,
    FINAL_EVENT_SLUGS,
    RequestParameterError,
    UnknownResourceError,
    build_live_source_status,
    is_completed_match_status,
    is_running_match_status,
    normalize_match_status,
)
from .service import build_finals_team_rating_index
from .team_identity import resolve_team_identity, team_identity_key


ROOT = Path(__file__).resolve().parents[2]
FINALS_SCHEDULE_PATH = ROOT / "data" / "reference" / "2026_finals" / "schedule.json"
EVENT_SLUGS = FINAL_EVENT_SLUGS
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
    "fieldCapacity",
    "drawStatus",
    "pendingEntryCount",
    "pendingEntrySlots",
)


class UnknownFinalEventError(UnknownResourceError):
    resource_name = "finals event"


def load_finals_schedule() -> dict[str, Any]:
    payload = read_versioned_json(FINALS_SCHEDULE_PATH)
    _validate_payload(payload)
    return payload


load_finals_schedule.cache_clear = clear_versioned_json_cache  # type: ignore[attr-defined]


def _validate_payload(payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Finals schedule must be an object")
    if int(payload.get("season") or 0) != 2026:
        raise ValueError("Finals schedule season must be 2026")
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
        if formal_match_count != FINAL_EVENT_MATCH_COUNTS[event_slug]:
            raise ValueError(f"Formal match count mismatch for {event_slug}")
        if [match.get("number") for match in matches] != list(range(1, formal_match_count + 1)):
            raise ValueError(f"Non-contiguous formal match numbers for {event_slug}")
        if len(participants) != participant_count:
            raise ValueError(f"Participant count mismatch for {event_slug}")
        if any(match.get("kind") != "formal" for match in matches):
            raise ValueError(f"Non-formal match in formal schedule for {event_slug}")
        if any(int(match.get("bestOf") or 0) not in {3, 5} for match in matches):
            raise ValueError(f"Unsupported best-of value for {event_slug}")


def _participant_identity_key(participant: dict[str, Any]) -> tuple[str, str]:
    return team_identity_key(
        participant.get("collegeName"),
        participant.get("teamName"),
    )


def resolve_final_participant_identity(participant: dict[str, Any]) -> dict[str, str]:
    """Keep the seeder-facing adapter while sharing the canonical resolver."""
    identity = resolve_team_identity(participant.get("collegeName"), participant.get("teamName"))
    return {
        "schoolKey": str(identity["schoolKey"]),
        "teamKey": str(identity["teamKey"]),
    }


def _is_confirmed_real_participant(participant: dict[str, Any]) -> bool:
    return participant.get("status") == "confirmed"


def _official_match_status(match: dict[str, Any]) -> str:
    return normalize_match_status(match.get("officialStatus"))


def _event_status_label(
    participant_count: int,
    matches: list[dict[str, Any]],
    *,
    field_capacity: int | None = None,
    pending_entry_count: int = 0,
    draw_status: str = "pending",
) -> str:
    field_capacity = max(participant_count, int(field_capacity or participant_count))
    pending_suffix = (
        f" · {pending_entry_count} 个席位待确认"
        if pending_entry_count > 0
        else ""
    )
    total = len(matches)
    completed = sum(
        match.get("isCompleted") is True or is_completed_match_status(_official_match_status(match))
        for match in matches
    )
    running = sum(is_running_match_status(_official_match_status(match)) for match in matches)
    if running:
        return f"{running} 场进行中 · 已完赛 {completed} / {total} 场{pending_suffix}"
    if completed:
        return f"已完赛 {completed} / {total} 场{pending_suffix}"
    confirmed_matchups = sum(
        match.get("isConfirmedMatchup") is True
        and bool(match.get("redCollegeName") or match.get("redTeamKey"))
        and bool(match.get("blueCollegeName") or match.get("blueTeamKey"))
        for match in matches
    )
    if confirmed_matchups:
        if pending_entry_count > 0:
            return f"抽签已完成 · {participant_count} / {field_capacity} 队已确认 · {pending_entry_count} 个席位待确认"
        return f"{participant_count} 队抽签已完成 · 等待开赛"
    if draw_status == "completed":
        return f"抽签已完成 · {participant_count} / {field_capacity} 队已确认 · {pending_entry_count} 个席位待确认"
    return f"{participant_count} 队名单已确认 · 抽签待定"


def _build_event_payload(event: dict[str, Any]) -> dict[str, Any]:
    participants = [
        {**participant, **resolve_final_participant_identity(participant)}
        for participant in event.get("participants", [])
        if isinstance(participant, dict) and _is_confirmed_real_participant(participant)
    ]
    seen_team_keys: set[str] = set()
    for participant in participants:
        team_key = str(participant.get("teamKey") or "")
        if team_key and team_key in seen_team_keys:
            raise ValueError(f"Duplicate canonical finals participant: {team_key}")
        if team_key:
            seen_team_keys.add(team_key)
    matches = [
        dict(match)
        for match in event.get("matches", [])
        if isinstance(match, dict) and match.get("kind") == "formal"
    ]
    group_capacity = sum(
        int(group.get("teamCount") or 0)
        for group in event.get("groups", [])
        if isinstance(group, dict)
    )
    declared_capacity = int(event.get("fieldCapacity") or 0)
    field_capacity = max(len(participants), group_capacity, declared_capacity)
    pending_slots = [
        dict(slot)
        for slot in event.get("pendingEntrySlots", [])
        if isinstance(slot, dict)
    ]
    pending_entry_count = max(
        0,
        int(event.get("pendingEntryCount") or len(pending_slots) or field_capacity - len(participants)),
    )
    confirmed_matchups = sum(
        match.get("isConfirmedMatchup") is True
        and bool(match.get("redCollegeName") or match.get("redTeamKey"))
        and bool(match.get("blueCollegeName") or match.get("blueTeamKey"))
        for match in matches
    )
    draw_status = str(event.get("drawStatus") or "").strip().lower()
    if draw_status not in {"pending", "completed"}:
        draw_status = "completed" if confirmed_matchups else "pending"
    response_event = {
        field: event[field]
        for field in EVENT_RESPONSE_FIELDS
        if field in event
    }
    response_event.update(
        {
            "participantCount": len(participants),
            "confirmedParticipantCount": len(participants),
            "statusLabel": _event_status_label(
                len(participants),
                matches,
                field_capacity=field_capacity,
                pending_entry_count=pending_entry_count,
                draw_status=draw_status,
            ),
            "formalMatchCount": len(matches),
            "participants": participants,
            "matches": matches,
            "fieldCapacity": field_capacity,
            "drawStatus": draw_status,
            "pendingEntryCount": pending_entry_count,
            "pendingEntrySlots": pending_slots,
        }
    )
    response_event["teamRatingIndex"] = build_finals_team_rating_index(participants)
    response_event["predictionBasis"] = "finals_sequential_elo"
    return response_event


def _merge_runtime_event(event: dict[str, Any], runtime_event: dict[str, Any] | None) -> dict[str, Any]:
    if not runtime_event:
        return dict(event)
    merged = dict(event)
    for field in ("fieldCapacity", "drawStatus", "pendingEntryCount", "pendingEntrySlots"):
        if field in runtime_event:
            merged[field] = runtime_event[field]
    participants = [dict(row) for row in event.get("participants", []) if isinstance(row, dict)]
    participant_index = {
        _participant_identity_key(row): index
        for index, row in enumerate(participants)
    }
    for participant in runtime_event.get("participants", []):
        if not isinstance(participant, dict):
            continue
        key = _participant_identity_key(participant)
        if key in participant_index:
            participants[participant_index[key]].update(participant)
        else:
            participant_index[key] = len(participants)
            participants.append(dict(participant))
    for index, participant in enumerate(participants, start=1):
        participant["order"] = index
    merged["participants"] = participants
    merged["participantCount"] = len(participants)

    reference_matches = {
        int(row["number"]): row
        for row in event.get("matches", [])
        if isinstance(row, dict) and row.get("number") is not None
    }
    runtime_matches = {
        int(row["number"]): row
        for row in runtime_event.get("matches", [])
        if isinstance(row, dict) and row.get("number") is not None
    }
    unknown_numbers = sorted(set(runtime_matches) - set(reference_matches))
    if unknown_numbers:
        raise ValueError(f"Finals runtime contains unknown match numbers: {unknown_numbers}")
    for number, runtime_match in runtime_matches.items():
        reference_match = reference_matches[number]
        if int(runtime_match.get("bestOf") or 0) != int(reference_match.get("bestOf") or 0):
            raise ValueError(f"Finals runtime BO does not match schedule for match #{number}")
    merged["matches"] = [
        {
            **match,
            **{
                field: runtime_matches[int(match["number"])][field]
                for field in ("officialMatchId", "sourceKind", "isSynthetic", *finals_live.RUNTIME_MATCH_FIELDS)
                if int(match["number"]) in runtime_matches and field in runtime_matches[int(match["number"])]
            },
        }
        for match in event.get("matches", [])
        if isinstance(match, dict)
    ]
    return merged


def _runtime_status(
    runtime: dict[str, Any] | None,
    event_slug: str,
    *,
    enabled: bool = True,
    artifact_version: str | None = None,
) -> dict[str, Any]:
    artifact = artifact_version or finals_live.runtime_artifact_version()
    if not enabled:
        return build_live_source_status(
            source_status="inactive",
            source_kind=None,
            source_updated_at=None,
            artifact_version=artifact,
            completed_matches=0,
            confirmed_matches=0,
            source_reason="模拟模式未合并实时数据",
            validation_state="disabled",
        )
    if not runtime:
        return build_live_source_status(
            source_status="missing",
            source_kind=None,
            source_updated_at=None,
            artifact_version=artifact,
            completed_matches=0,
            confirmed_matches=0,
            source_reason="尚未同步赛事实时数据",
        )
    runtime_events = runtime.get("events", {})
    runtime_event = runtime_events.get(event_slug) if isinstance(runtime_events, dict) else None
    global_status = str(runtime.get("sourceStatus") or "inactive").strip().lower()
    source_reason = runtime.get("reason")
    matches = [
        match
        for match in (runtime_event or {}).get("matches", [])
        if isinstance(match, dict)
    ]
    return build_live_source_status(
        source_status=global_status,
        source_kind=str(runtime.get("sourceKind")) if runtime.get("sourceKind") else None,
        source_updated_at=runtime.get("sourceUpdatedAt"),
        artifact_version=artifact,
        completed_matches=sum(match.get("isCompleted") is True for match in matches),
        confirmed_matches=sum(match.get("isConfirmedMatchup") is True for match in matches),
        is_synthetic=runtime.get("isSynthetic") is True,
        source_reason=source_reason,
        validation_state="validated" if global_status == "active" else global_status,
        scenario_id=runtime.get("scenarioId"),
        scope_present=isinstance(runtime_event, dict),
        missing_scope_reason="实时源未包含当前赛事",
    )


def _build_final_event_from_snapshot(
    event_slug: str,
    *,
    mode: str,
    payload: dict[str, Any],
    runtime: dict[str, Any] | None,
    runtime_artifact_version: str,
) -> dict[str, Any]:
    runtime_status = _runtime_status(
        runtime,
        event_slug,
        enabled=mode == "live",
        artifact_version=runtime_artifact_version,
    )
    runtime_active = runtime_status["sourceStatus"] == "active"
    runtime_event = runtime.get("events", {}).get(event_slug) if runtime_active else None
    merged_event = _merge_runtime_event(payload["events"][event_slug], runtime_event)
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
        "verifiedAt": runtime_status["sourceUpdatedAt"] if runtime_active else payload["verifiedAt"],
        "sources": sources,
        "liveStatus": runtime_status,
        "event": _build_event_payload(merged_event),
    }


def _load_finals_snapshot(mode: str) -> tuple[dict[str, Any], dict[str, Any] | None, str]:
    if mode not in {"live", "sim"}:
        raise RequestParameterError(f"Unsupported finals mode: {mode}")
    payload = load_finals_schedule()
    if mode == "sim":
        return payload, None, "disabled"
    for _ in range(2):
        version_before = finals_live.runtime_artifact_version()
        runtime = finals_live.load_finals_runtime()
        version_after = finals_live.runtime_artifact_version()
        if version_before == version_after:
            return payload, runtime, version_after
    raise RuntimeError("Finals runtime changed repeatedly while building a snapshot")


def build_final_event_payload(event_slug: str, *, mode: str = "live") -> dict[str, Any]:
    if event_slug not in EVENT_SLUGS:
        raise UnknownFinalEventError(event_slug)
    payload, runtime, runtime_artifact_version = _load_finals_snapshot(mode)
    return _build_final_event_from_snapshot(
        event_slug,
        mode=mode,
        payload=payload,
        runtime=runtime,
        runtime_artifact_version=runtime_artifact_version,
    )


def build_finals_snapshot_payload(*, mode: str = "live") -> dict[str, Any]:
    """Build both finals events from one reference/runtime snapshot."""
    from .competition_graph import COMPETITION_GRAPH_VERSION
    from .revisions import current_model_version, finals_revisions

    payload, runtime, runtime_artifact_version = _load_finals_snapshot(mode)
    return {
        "schemaVersion": payload["schemaVersion"],
        "season": payload["season"],
        "mode": mode,
        "modelVersion": current_model_version(),
        "topologyVersion": COMPETITION_GRAPH_VERSION,
        **finals_revisions(reference=payload, runtime=runtime, runtime_loaded=True),
        "runtimeArtifactVersion": runtime_artifact_version,
        "events": {
            event_slug: _build_final_event_from_snapshot(
                event_slug,
                mode=mode,
                payload=payload,
                runtime=runtime,
                runtime_artifact_version=runtime_artifact_version,
            )
            for event_slug in sorted(EVENT_SLUGS)
        },
    }
