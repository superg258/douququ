from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import monotonic
from typing import Any, Iterable, Sequence

from backend.app import rmuc_live
from backend.app.artifacts import (
    read_versioned_json_if_exists as load_json_if_exists,
    write_json_atomic,
)


MINI_PROGRAM_PREDICTIONS_FILENAME = "mini_program_predictions.json"
DEFAULT_MINI_PROGRAM_TTL_SECONDS = 300
DEFAULT_MINI_PROGRAM_REFRESH_WINDOW_SECONDS = 60
DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS = 24
DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS = 48
DEFAULT_MINI_PROGRAM_MAX_MATCHES = 96
BEIJING_TZ = timezone(timedelta(hours=8))


def parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(str(value))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=BEIJING_TZ).astimezone(UTC)
    return parsed.astimezone(UTC)


def collect_match_ids(
    matches: Iterable[dict[str, Any]],
    *,
    now: datetime,
    timestamp_fields: Sequence[str],
    lookback_hours: int = DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS,
    lookahead_hours: int = DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS,
    max_matches: int | None = DEFAULT_MINI_PROGRAM_MAX_MATCHES,
) -> list[str]:
    window_start = now.astimezone(UTC) - timedelta(hours=max(0, lookback_hours))
    window_end = now.astimezone(UTC) + timedelta(hours=max(0, lookahead_hours))
    candidates: list[tuple[datetime, str]] = []
    seen: set[str] = set()
    for match in matches:
        official_id = str(match.get("officialMatchId") or "").strip()
        if not official_id or not official_id.isdigit() or official_id in seen:
            continue
        planned_start = next(
            (
                parsed
                for field in timestamp_fields
                if (parsed := parse_datetime(match.get(field))) is not None
            ),
            None,
        )
        if planned_start is None or not (window_start <= planned_start <= window_end):
            continue
        seen.add(official_id)
        candidates.append((planned_start, official_id))
    candidates.sort(key=lambda item: (item[0], item[1]))
    match_ids = [match_id for _, match_id in candidates]
    if max_matches is not None and max_matches > 0:
        return match_ids[:max_matches]
    return match_ids


def _prediction_is_fresh(
    prediction: dict[str, Any],
    *,
    now: datetime,
    ttl_seconds: int,
    refresh_window_seconds: int,
) -> bool:
    fetched_at = parse_datetime(prediction.get("fetchedAt"))
    if fetched_at is None:
        return False
    refresh_after = max(0, ttl_seconds - refresh_window_seconds)
    return (now.astimezone(UTC) - fetched_at).total_seconds() < refresh_after


def load_predictions(runtime_dir: Path) -> dict[str, dict[str, Any]]:
    payload = load_json_if_exists(runtime_dir / MINI_PROGRAM_PREDICTIONS_FILENAME)
    if not isinstance(payload, dict):
        return {}
    predictions = payload.get("predictions")
    if not isinstance(predictions, dict):
        return {}
    return {
        str(match_id): prediction
        for match_id, prediction in predictions.items()
        if isinstance(prediction, dict)
    }


def _unavailable_prediction(
    match_id: str,
    reason: str,
    *,
    fetched_at: datetime,
) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "matchId": match_id,
        "reason": reason,
        "fetchedAt": fetched_at.astimezone(UTC).isoformat(),
    }


def sync_predictions(
    match_ids: Sequence[str],
    *,
    runtime_dir: Path,
    fetched_at: datetime,
    fetcher=None,
    ttl_seconds: int = DEFAULT_MINI_PROGRAM_TTL_SECONDS,
    refresh_window_seconds: int = DEFAULT_MINI_PROGRAM_REFRESH_WINDOW_SECONDS,
    lookback_hours: int = DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS,
    lookahead_hours: int = DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS,
    deadline_seconds: float | None = None,
) -> dict[str, Any]:
    fetcher = fetcher or rmuc_live.MiniProgramPredictionClient().get
    started_at = monotonic()
    existing = load_predictions(runtime_dir)
    predictions: dict[str, dict[str, Any]] = dict(existing)
    errors: dict[str, str] = {}
    reused = 0
    refreshed = 0
    deferred = 0

    for index, match_id in enumerate(match_ids):
        cached = existing.get(match_id)
        if cached is not None and _prediction_is_fresh(
            cached,
            now=fetched_at,
            ttl_seconds=ttl_seconds,
            refresh_window_seconds=refresh_window_seconds,
        ):
            predictions[match_id] = cached
            reused += 1
            continue
        if (
            deadline_seconds is not None
            and deadline_seconds >= 0
            and monotonic() - started_at >= deadline_seconds
        ):
            deferred = len(match_ids) - index
            break
        try:
            prediction = fetcher(match_id)
        except Exception as exc:  # noqa: BLE001 - upstream failure is represented in runtime status.
            errors[match_id] = str(exc)
            prediction = _unavailable_prediction(match_id, str(exc), fetched_at=fetched_at)
        if not isinstance(prediction, dict):
            prediction = _unavailable_prediction(
                match_id,
                "invalid mini-program response",
                fetched_at=fetched_at,
            )
        predictions[match_id] = prediction
        refreshed += 1

    window_predictions = {
        match_id: predictions[match_id]
        for match_id in match_ids
        if match_id in predictions
    }
    status = {
        "sourceStatus": "active" if not errors else "partial_error",
        "enabled": True,
        "generatedAt": fetched_at.astimezone(UTC).isoformat(),
        "ttlSeconds": ttl_seconds,
        "refreshWindowSeconds": refresh_window_seconds,
        "lookbackHours": lookback_hours,
        "lookaheadHours": lookahead_hours,
        "candidateMatchIds": len(match_ids),
        "reused": reused,
        "refreshed": refreshed,
        "deferred": deferred,
        "available": sum(
            1 for prediction in window_predictions.values() if prediction.get("status") == "available"
        ),
        "unavailable": sum(
            1 for prediction in window_predictions.values() if prediction.get("status") != "available"
        ),
        "storedPredictions": len(predictions),
        "errorCount": len(errors),
        "errors": errors,
    }
    write_json_atomic(
        runtime_dir / MINI_PROGRAM_PREDICTIONS_FILENAME,
        {
            **status,
            "predictions": predictions,
        },
    )
    return status


def disabled_status(reason: str, *, fetched_at: datetime) -> dict[str, Any]:
    return {
        "sourceStatus": "disabled",
        "enabled": False,
        "generatedAt": fetched_at.astimezone(UTC).isoformat(),
        "reason": reason,
        "candidateMatchIds": 0,
        "reused": 0,
        "refreshed": 0,
        "deferred": 0,
        "available": 0,
        "unavailable": 0,
        "storedPredictions": 0,
        "errorCount": 0,
        "errors": {},
    }
