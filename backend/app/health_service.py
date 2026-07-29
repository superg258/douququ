from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import finals_live, service
from .revisions import build_live_revisions_payload


def _file_check(path: Path, *, required: bool) -> dict[str, Any]:
    exists = path.is_file() and path.stat().st_size > 0
    return {
        "ok": exists or not required,
        "required": required,
        "detail": f"{path.name}: {'present' if exists else 'missing'}",
    }


def _source_age_seconds(value: Any) -> int | None:
    text = str(value or "").strip().replace("Z", "+00:00")
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return max(0, int((datetime.now(tz=UTC) - parsed.astimezone(UTC)).total_seconds()))


def build_readiness_payload() -> tuple[dict[str, Any], bool]:
    published_dir = service._effective_published_dir()
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

    finals_runtime = finals_live.load_finals_runtime()
    sync = {
        "regions": {
            "mode": "automatic-30s",
            "sourceUpdatedAt": (
                revisions
                and revisions.get("regions", {}).get("south_region", {}).get("sourceUpdatedAt")
            ),
        },
        "finals": {
            "mode": "manual",
            "sourceUpdatedAt": (finals_runtime or {}).get("sourceUpdatedAt"),
        },
    }
    for status in sync.values():
        status["sourceAgeSeconds"] = _source_age_seconds(status["sourceUpdatedAt"])

    ready = all(check["ok"] for check in checks.values() if check["required"])
    return {
        "status": "ready" if ready else "not-ready",
        "checks": checks,
        "revisions": revisions,
        "sync": sync,
    }, ready
