from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from . import finals_live, service
from .artifacts import read_versioned_json_if_exists
from .revisions import build_live_revisions_payload

DEFAULT_SYNC_MAX_AGE_SECONDS = 900
REGIONAL_LIVE_LEAD_SECONDS = 3600
REGIONAL_END_GRACE_SECONDS = 6 * 3600
DEFAULT_EXPORT_WORKER_URL = "http://127.0.0.1:3010/render"


def _file_check(path: Path, *, required: bool) -> dict[str, Any]:
    exists = path.is_file() and path.stat().st_size > 0
    return {
        "ok": exists or not required,
        "required": required,
        "detail": f"{path.name}: {'present' if exists else 'missing'}",
    }


def _parse_timestamp(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _source_age_seconds(value: Any, *, now: datetime | None = None) -> int | None:
    parsed = _parse_timestamp(value)
    if parsed is None:
        return None
    current = (now or datetime.now(tz=UTC)).astimezone(UTC)
    return max(0, int((current - parsed).total_seconds()))


def _env_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _worker_endpoint_check(url: str, *, required: bool) -> dict[str, Any]:
    try:
        parsed = urlsplit(url)
        if not parsed.hostname or parsed.scheme not in {"http", "https"}:
            raise ValueError("invalid worker URL")
        readiness_url = urlunsplit(
            (parsed.scheme, parsed.netloc, "/health/ready", "", "")
        )
        request = Request(readiness_url, headers={"Accept": "application/json"})
        with urlopen(request, timeout=0.75) as response:
            status = int(response.status)
            payload = json.loads(response.read(4096).decode("utf-8"))
        available = status == 200 and isinstance(payload, dict) and payload.get("ready") is True
        detail = (
            f"{readiness_url}: ready"
            if available
            else f"{readiness_url}: invalid readiness response"
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        available = False
        detail = f"{url}: unavailable ({type(exc).__name__})"
    return {
        "ok": available or not required,
        "required": required,
        "available": available,
        "detail": detail,
    }


def _load_json_object(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        payload = read_versioned_json_if_exists(path)
    except (OSError, TypeError, ValueError) as exc:
        return None, f"{type(exc).__name__}: {exc}"
    if payload is None:
        return None, None
    if not isinstance(payload, dict):
        return None, "TypeError: expected a JSON object"
    return payload, None


def _sync_max_age_seconds() -> int:
    try:
        value = int(os.getenv("RMUC_LIVE_MAX_AGE_SECONDS", str(DEFAULT_SYNC_MAX_AGE_SECONDS)))
    except ValueError:
        return DEFAULT_SYNC_MAX_AGE_SECONDS
    return value if value > 0 else DEFAULT_SYNC_MAX_AGE_SECONDS


def _load_sync_check_status(
    path: Path,
    *,
    now: datetime,
    pending_path: Path | None = None,
) -> dict[str, Any]:
    loaded, load_error = _load_json_object(path)
    payload = loaded or {}
    status = (
        "invalid"
        if load_error
        else str(payload.get("status") or "missing").strip().lower()
    )
    checked_at = payload.get("checkedAt")
    last_success_at = payload.get("lastSuccessAt")
    if not last_success_at and status in {"ok", "success"}:
        last_success_at = checked_at
    max_age = _sync_max_age_seconds()
    checked_age = _source_age_seconds(checked_at, now=now)
    last_success_age = _source_age_seconds(last_success_at, now=now)
    publish_pending = payload.get("publishPending") is True or bool(
        pending_path and pending_path.is_file()
    )
    healthy = (
        status in {"ok", "success"}
        and last_success_age is not None
        and last_success_age <= max_age
        and not publish_pending
    )
    return {
        "status": status,
        "checkedAt": checked_at,
        "checkedAgeSeconds": checked_age,
        "lastSuccessAt": last_success_at,
        "lastSuccessAgeSeconds": last_success_age,
        "maxAgeSeconds": max_age,
        "publishPending": publish_pending,
        "healthy": healthy,
        "error": load_error or payload.get("error"),
        "rawSnapshots": payload.get("rawSnapshots"),
    }


def _regional_event_state(
    normalized: dict[str, Any],
    *,
    now: datetime,
) -> dict[str, Any]:
    matches = [
        match
        for region in normalized.get("regions", {}).values()
        if isinstance(region, dict)
        for match in region.get("matches", [])
        if isinstance(match, dict)
    ]
    completed = sum(match.get("isCompleted") is True for match in matches)
    event_complete = bool(matches) and completed == len(matches)
    planned_times = [
        parsed
        for match in matches
        if (parsed := _parse_timestamp(match.get("plannedStartAt"))) is not None
    ]
    earliest = min(planned_times) if planned_times else None
    latest = max(planned_times) if planned_times else None
    current = now.astimezone(UTC)
    concluded_by_schedule = bool(
        latest and current.timestamp() > latest.timestamp() + REGIONAL_END_GRACE_SECONDS
    )
    has_live_match = any(
        not match.get("isCompleted")
        and (
            match.get("hasLiveScoreline") is True
            or str(match.get("officialStatus") or "").strip().upper()
            in {"LIVE", "RUNNING", "ONGOING", "IN_PROGRESS"}
        )
        for match in matches
    )
    incomplete_planned_times = [
        parsed
        for match in matches
        if not match.get("isCompleted")
        and (parsed := _parse_timestamp(match.get("plannedStartAt"))) is not None
    ]
    live_window_active = any(
        planned.timestamp() - REGIONAL_LIVE_LEAD_SECONDS
        <= current.timestamp()
        <= planned.timestamp() + REGIONAL_END_GRACE_SECONDS
        for planned in incomplete_planned_times
    )
    source_active = str(normalized.get("sourceStatus") or "").strip().lower() == "active"
    freshness_required = bool(
        source_active
        and matches
        and not event_complete
        and not concluded_by_schedule
        and (
            has_live_match
            or live_window_active
            or not incomplete_planned_times
        )
    )
    return {
        "matchCount": len(matches),
        "completedMatches": completed,
        "eventComplete": event_complete,
        "concludedBySchedule": concluded_by_schedule,
        "liveWindowActive": live_window_active,
        "freshnessRequired": freshness_required,
        "earliestPlannedAt": earliest.isoformat() if earliest else None,
        "latestPlannedAt": latest.isoformat() if latest else None,
    }


def build_readiness_payload(*, now: datetime | None = None) -> tuple[dict[str, Any], bool]:
    current = (now or datetime.now(tz=UTC)).astimezone(UTC)
    published_dir = service._effective_published_dir()
    export_worker_required = _env_enabled("RMUC_CANVAS_EXPORT_REQUIRED")
    checks = {
        "preseasonRatings": _file_check(service.PRESEASON_RATINGS_CSV, required=True),
        "publishedManifest": _file_check(
            service._published_manifest_path_for(published_dir),
            required=True,
        ),
        "publishedSnapshot": _file_check(
            service._published_current_snapshot_path_for(published_dir),
            required=True,
        ),
        "finalsReference": _file_check(
            service.ROOT / "data" / "reference" / "2026_finals" / "schedule.json",
            required=True,
        ),
        "regionalRuntime": _file_check(service.NORMALIZED_LIVE_SCHEDULE_PATH, required=False),
        "finalsRuntime": _file_check(finals_live.FINALS_RUNTIME_PATH, required=False),
        "canvasExportWorker": _worker_endpoint_check(
            os.getenv("RMUC_EXPORT_WORKER_URL", DEFAULT_EXPORT_WORKER_URL),
            required=export_worker_required,
        ),
    }
    revisions: dict[str, Any] | None = None
    try:
        revisions = build_live_revisions_payload()
        checks["revisionContract"] = {
            "ok": True,
            "required": True,
            "detail": str(revisions["etag"]),
        }
    except (OSError, TypeError, ValueError, KeyError) as exc:
        checks["revisionContract"] = {
            "ok": False,
            "required": True,
            "detail": f"{type(exc).__name__}: {exc}",
        }

    normalized, regional_runtime_error = _load_json_object(
        service.NORMALIZED_LIVE_SCHEDULE_PATH
    )
    normalized = normalized or {}
    regional_event = _regional_event_state(normalized, now=current)
    regional_check = _load_sync_check_status(
        service.NORMALIZED_LIVE_SCHEDULE_PATH.with_name("check_status.json"),
        now=current,
        pending_path=service.NORMALIZED_LIVE_SCHEDULE_PATH.with_name("publish_pending.json"),
    )
    regional_source_updated_at = normalized.get("sourceUpdatedAt") or (
        revisions
        and revisions.get("regions", {}).get("south_region", {}).get("sourceUpdatedAt")
    )
    regional_source_age = _source_age_seconds(regional_source_updated_at, now=current)
    regional_source_fresh = (
        regional_source_age is not None
        and regional_source_age <= _sync_max_age_seconds()
    )
    regional_freshness_required = bool(regional_event["freshnessRequired"])
    regional_required = bool(
        regional_runtime_error
        or regional_freshness_required
        or regional_check["publishPending"]
    )
    regional_healthy = bool(
        not regional_runtime_error
        and not regional_check["publishPending"]
        and (
            not regional_freshness_required
            # Last-Modified describes when the official document changed, not
            # whether our poller is alive. Successful 304 checks renew the
            # readiness lease through check_status.lastSuccessAt.
            or regional_check["healthy"]
        )
    )
    checks["regionalRealtime"] = {
        "ok": regional_healthy if regional_required else True,
        "required": regional_required,
        "detail": (
            f"required={regional_required}; sourceAgeSeconds={regional_source_age}; "
            f"lastSuccessAgeSeconds={regional_check['lastSuccessAgeSeconds']}; "
            f"status={regional_check['status']}; "
            f"runtimeError={regional_runtime_error}"
        ),
    }

    finals_runtime_error: str | None = None
    try:
        finals_runtime = finals_live.load_finals_runtime()
    except (OSError, TypeError, ValueError, KeyError) as exc:
        finals_runtime = None
        finals_runtime_error = f"{type(exc).__name__}: {exc}"
    finals_configured_required = _env_enabled("RMUC_FINALS_LIVE_REQUIRED")
    finals_check = _load_sync_check_status(
        finals_live.FINALS_RUNTIME_PATH.with_name("check_status.json"),
        now=current,
        pending_path=finals_live.FINALS_RUNTIME_PATH.with_name("publish_pending.json"),
    )
    finals_source_status = str((finals_runtime or {}).get("sourceStatus") or "missing").lower()
    finals_source_kind = str((finals_runtime or {}).get("sourceKind") or "missing").lower()
    finals_is_synthetic = (finals_runtime or {}).get("isSynthetic") is True
    finals_events = (finals_runtime or {}).get("events")
    finals_events = finals_events if isinstance(finals_events, dict) else {}
    finals_match_count = sum(
        len(event.get("matches", []))
        for event in finals_events.values()
        if isinstance(event, dict) and isinstance(event.get("matches", []), list)
    )
    finals_full_coverage = all(
        isinstance(finals_events.get(event_slug), dict)
        and isinstance(finals_events[event_slug].get("matches"), list)
        and len(finals_events[event_slug].get("matches", [])) == expected_count
        for event_slug, expected_count in finals_live.EVENT_MATCH_COUNTS.items()
    )
    finals_matches = [
        match
        for event in finals_events.values()
        if isinstance(event, dict)
        and isinstance(event.get("matches"), list)
        for match in event.get("matches", [])
        if isinstance(match, dict)
    ]
    finals_completed_count = sum(
        match.get("isCompleted") is True for match in finals_matches
    )
    finals_event_complete = bool(
        finals_runtime
        and not finals_runtime_error
        and finals_source_status == "active"
        and finals_source_kind == "official"
        and not finals_is_synthetic
        and finals_full_coverage
        and finals_match_count == sum(finals_live.EVENT_MATCH_COUNTS.values())
        and finals_completed_count == finals_match_count
    )
    finals_required = bool(finals_configured_required and not finals_event_complete)
    finals_healthy = bool(
        finals_runtime
        and not finals_runtime_error
        and finals_source_status == "active"
        and finals_source_kind == "official"
        and not finals_is_synthetic
        and finals_full_coverage
        and finals_check["healthy"]
    )
    checks["finalsRealtime"] = {
        "ok": finals_healthy if finals_required else True,
        "required": finals_required,
        "detail": (
            f"configuredRequired={finals_configured_required}; "
            f"required={finals_required}; eventComplete={finals_event_complete}; "
            f"sourceStatus={finals_source_status}; "
            f"sourceKind={finals_source_kind}; matchCount={finals_match_count}; "
            f"lastSuccessAgeSeconds={finals_check['lastSuccessAgeSeconds']}; "
            f"status={finals_check['status']}; runtimeError={finals_runtime_error}"
        ),
    }

    sync = {
        "regions": {
            "mode": "automatic-30s",
            "sourceUpdatedAt": regional_source_updated_at,
            "sourceAgeSeconds": regional_source_age,
            "freshnessLabel": (
                "fresh"
                if regional_source_fresh
                else "unknown" if regional_source_age is None else "stale"
            ),
            "event": regional_event,
            "checkStatus": regional_check,
        },
        "finals": {
            "mode": "automatic-30s",
            "sourceUpdatedAt": (finals_runtime or {}).get("sourceUpdatedAt"),
            "sourceKind": finals_source_kind,
            "isSynthetic": finals_is_synthetic,
            "matchCount": finals_match_count,
            "completedMatches": finals_completed_count,
            "fullCoverage": finals_full_coverage,
            "eventComplete": finals_event_complete,
            "sourceAgeSeconds": _source_age_seconds(
                (finals_runtime or {}).get("sourceUpdatedAt"),
                now=current,
            ),
            "configuredRequired": finals_configured_required,
            "required": finals_required,
            "runtimeError": finals_runtime_error,
            "checkStatus": finals_check,
        },
    }

    ready = all(check["ok"] for check in checks.values() if check["required"])
    return {
        "status": "ready" if ready else "not-ready",
        "checks": checks,
        "revisions": revisions,
        "sync": sync,
    }, ready
