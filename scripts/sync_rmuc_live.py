#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import rmuc_live  # noqa: E402
from research.trueskill2.fit import (  # noqa: E402
    _build_published_current_snapshot,
    build_published_live_state_updates,
)


DEFAULT_RUNTIME_DIR = ROOT / "data" / "runtime" / "rmuc_live"
DEFAULT_BASE_PUBLISHED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "published_2026"
DEFAULT_PRESEASON_RATINGS = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "preseason_ratings.csv"
MINI_PROGRAM_PREDICTIONS_FILENAME = "mini_program_predictions.json"
SYNC_MANIFEST_FILENAME = "sync_manifest.json"
DEFAULT_MINI_PROGRAM_TTL_SECONDS = 300
DEFAULT_MINI_PROGRAM_REFRESH_WINDOW_SECONDS = 60
DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS = 6
DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS = 48
DEFAULT_MINI_PROGRAM_MAX_MATCHES = 96


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize official RMUC live schedule data into runtime artifacts.")
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--base-published-dir", type=Path, default=DEFAULT_BASE_PUBLISHED_DIR)
    parser.add_argument("--preseason-ratings", type=Path, default=DEFAULT_PRESEASON_RATINGS)
    parser.add_argument("--snapshot-date", default=datetime.now(tz=UTC).date().isoformat())
    parser.add_argument("--skip-fetch", action="store_true", help="Use existing raw schedule.json instead of fetching upstream.")
    parser.add_argument("--skip-mini-program", action="store_true", help="Do not refresh mini-program prediction cache.")
    parser.add_argument("--mini-program-ttl-seconds", type=int, default=DEFAULT_MINI_PROGRAM_TTL_SECONDS)
    parser.add_argument("--mini-program-refresh-window-seconds", type=int, default=DEFAULT_MINI_PROGRAM_REFRESH_WINDOW_SECONDS)
    parser.add_argument("--mini-program-lookback-hours", type=int, default=DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS)
    parser.add_argument("--mini-program-lookahead-hours", type=int, default=DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS)
    parser.add_argument("--mini-program-max-matches", type=int, default=DEFAULT_MINI_PROGRAM_MAX_MATCHES)
    return parser.parse_args()


def fetch_json(url: str, previous_headers: dict[str, str] | None = None) -> tuple[dict[str, Any] | None, dict[str, str], bool]:
    request_headers = {"User-Agent": "douququ-rmuc-live-sync/1.0"}
    previous_headers = previous_headers or {}
    if previous_headers.get("etag"):
        request_headers["If-None-Match"] = str(previous_headers["etag"])
    if previous_headers.get("last-modified"):
        request_headers["If-Modified-Since"] = str(previous_headers["last-modified"])
    request = Request(url, headers=request_headers)
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed trusted URLs.
            headers = {key.lower(): value for key, value in response.headers.items()}
            return json.loads(response.read().decode("utf-8")), headers, True
    except HTTPError as exc:
        if exc.code == 304:
            return None, dict(previous_headers), False
        raise


def write_json_atomic(path: Path, payload: Any) -> None:
    rmuc_live.write_json_atomic(path, payload)


def load_json(path: Path) -> Any:
    return rmuc_live.read_json(path)


def load_json_if_exists(path: Path) -> Any | None:
    if not path.exists():
        return None
    return load_json(path)


def mini_program_sync_disabled_from_env() -> bool:
    return os.getenv("RMUC_MINI_PROGRAM_ENABLED", "1").strip().lower() in {"0", "false", "no", "off"}


def _parse_datetime(value: Any) -> datetime | None:
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
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def write_raw_snapshot(raw_dir: Path, name: str, payload: dict[str, Any], fetched_at: datetime) -> None:
    safe_timestamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
    write_json_atomic(raw_dir / f"{name}.json", payload)
    write_json_atomic(raw_dir / f"{name}.{safe_timestamp}.json", payload)


def _iter_normalized_matches(normalized: dict[str, Any]):
    regions = normalized.get("regions", {})
    if not isinstance(regions, dict):
        return
    for region in regions.values():
        if not isinstance(region, dict):
            continue
        matches = region.get("matches", [])
        if not isinstance(matches, list):
            continue
        for match in matches:
            if isinstance(match, dict):
                yield match


def collect_mini_program_match_ids(
    normalized: dict[str, Any],
    *,
    now: datetime,
    lookback_hours: int = DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS,
    lookahead_hours: int = DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS,
    max_matches: int | None = DEFAULT_MINI_PROGRAM_MAX_MATCHES,
) -> list[str]:
    if normalized.get("sourceStatus") != "active":
        return []
    window_start = now.astimezone(UTC) - timedelta(hours=max(0, lookback_hours))
    window_end = now.astimezone(UTC) + timedelta(hours=max(0, lookahead_hours))
    candidates: list[tuple[datetime, str]] = []
    seen: set[str] = set()
    for match in _iter_normalized_matches(normalized):
        official_id = str(match.get("officialMatchId") or "").strip()
        if not official_id or not official_id.isdigit() or official_id in seen:
            continue
        planned_start = _parse_datetime(match.get("plannedStartAt"))
        if planned_start is None or not (window_start <= planned_start <= window_end):
            continue
        seen.add(official_id)
        candidates.append((planned_start, official_id))
    candidates.sort(key=lambda item: (item[0], item[1]))
    match_ids = [match_id for _, match_id in candidates]
    if max_matches is not None and max_matches > 0:
        return match_ids[:max_matches]
    return match_ids


def _prediction_is_fresh(prediction: dict[str, Any], *, now: datetime, ttl_seconds: int, refresh_window_seconds: int) -> bool:
    fetched_at = _parse_datetime(prediction.get("fetchedAt"))
    if fetched_at is None:
        return False
    refresh_after = max(0, ttl_seconds - refresh_window_seconds)
    return (now.astimezone(UTC) - fetched_at).total_seconds() < refresh_after


def _load_existing_mini_program_predictions(runtime_dir: Path) -> dict[str, dict[str, Any]]:
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


def _unavailable_prediction(match_id: str, reason: str, *, fetched_at: datetime) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "matchId": match_id,
        "reason": reason,
        "fetchedAt": fetched_at.astimezone(UTC).isoformat(),
    }


def sync_mini_program_predictions(
    normalized: dict[str, Any],
    *,
    runtime_dir: Path,
    fetched_at: datetime,
    fetcher=None,
    ttl_seconds: int = DEFAULT_MINI_PROGRAM_TTL_SECONDS,
    refresh_window_seconds: int = DEFAULT_MINI_PROGRAM_REFRESH_WINDOW_SECONDS,
    lookback_hours: int = DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS,
    lookahead_hours: int = DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS,
    max_matches: int | None = DEFAULT_MINI_PROGRAM_MAX_MATCHES,
) -> dict[str, Any]:
    fetcher = fetcher or rmuc_live.MiniProgramPredictionClient().get
    match_ids = collect_mini_program_match_ids(
        normalized,
        now=fetched_at,
        lookback_hours=lookback_hours,
        lookahead_hours=lookahead_hours,
        max_matches=max_matches,
    )
    existing = _load_existing_mini_program_predictions(runtime_dir)
    predictions: dict[str, dict[str, Any]] = {}
    errors: dict[str, str] = {}
    reused = 0
    refreshed = 0

    for match_id in match_ids:
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
        try:
            prediction = fetcher(match_id)
        except Exception as exc:  # noqa: BLE001 - upstream failure should be represented in runtime status.
            errors[match_id] = str(exc)
            prediction = _unavailable_prediction(match_id, str(exc), fetched_at=fetched_at)
        if not isinstance(prediction, dict):
            prediction = _unavailable_prediction(match_id, "invalid mini-program response", fetched_at=fetched_at)
        predictions[match_id] = prediction
        refreshed += 1

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
        "available": sum(1 for prediction in predictions.values() if prediction.get("status") == "available"),
        "unavailable": sum(1 for prediction in predictions.values() if prediction.get("status") != "available"),
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


def disabled_mini_program_status(reason: str, *, fetched_at: datetime) -> dict[str, Any]:
    return {
        "sourceStatus": "disabled",
        "enabled": False,
        "generatedAt": fetched_at.astimezone(UTC).isoformat(),
        "reason": reason,
        "candidateMatchIds": 0,
        "reused": 0,
        "refreshed": 0,
        "available": 0,
        "unavailable": 0,
        "errorCount": 0,
        "errors": {},
    }


def build_sync_manifest(
    normalized: dict[str, Any],
    *,
    mini_program_status: dict[str, Any],
    fetched_at: datetime,
) -> dict[str, Any]:
    matches = list(_iter_normalized_matches(normalized) or [])
    regions = normalized.get("regions", {})
    return {
        "generatedAt": fetched_at.astimezone(UTC).isoformat(),
        "officialSchedule": {
            "sourceStatus": normalized.get("sourceStatus"),
            "sourceReason": normalized.get("reason"),
            "eventTitle": normalized.get("eventTitle"),
            "season": normalized.get("season"),
            "fetchedAt": normalized.get("fetchedAt"),
            "sourceUpdatedAt": normalized.get("sourceUpdatedAt"),
            "etag": normalized.get("etag"),
            "regionCount": len(regions) if isinstance(regions, dict) else 0,
            "matchCount": len(matches),
            "completedOfficialMatches": sum(1 for match in matches if match.get("isCompleted")),
            "confirmedOfficialMatches": sum(1 for match in matches if match.get("isConfirmedMatchup")),
        },
        "miniProgramPrediction": mini_program_status,
    }


def load_manifest(base_published_dir: Path) -> dict[str, Any]:
    path = base_published_dir / "published_manifest.json"
    if path.exists():
        return load_json(path)
    return {"season": 2026, "rating_scale": 135.0, "beta_perf": 1.8865294456481934, "online_live_update_scale": 0.33}


def build_preseason_snapshot(preseason_ratings: Path, *, season: int, snapshot_date: str, rating_scale: float):
    import pandas as pd

    rows = pd.read_csv(preseason_ratings)
    frame = rows[
        [
            "school_key",
            "college_name",
            "program_base_theta",
            "prior_delta_theta",
        ]
    ].copy()
    frame = frame.rename(
        columns={
            "college_name": "school_name",
            "program_base_theta": "rmuc_program_base_theta",
            "prior_delta_theta": "regional_prior_theta",
        }
    )
    frame["season"] = int(season)
    frame["freeze_date"] = snapshot_date
    frame["regional_prior_decay_version"] = "regional_group_linear_3_match_v1"
    frame["rating_scale"] = float(rating_scale)
    frame["published_regional_pre_rating"] = 1500.0 + (
        float(rating_scale) * (frame["rmuc_program_base_theta"] + frame["regional_prior_theta"])
    )
    return frame


def existing_live_updates(runtime_published_dir: Path):
    import pandas as pd

    path = runtime_published_dir / "live_state_updates.json"
    if not path.exists():
        return pd.DataFrame()
    return pd.DataFrame(load_json(path))


def save_frame_json(path: Path, frame) -> None:
    payload = json.loads(frame.to_json(orient="records", force_ascii=False))
    write_json_atomic(path, payload)


def publish_runtime_artifacts(
    *,
    normalized: dict[str, Any],
    runtime_dir: Path,
    base_published_dir: Path,
    preseason_ratings: Path,
    snapshot_date: str,
) -> None:
    import pandas as pd

    runtime_published_dir = runtime_dir / "published_2026"
    manifest = load_manifest(base_published_dir)
    season = int(normalized.get("season") or manifest.get("season") or snapshot_date[:4])
    rating_scale = float(manifest.get("rating_scale", 135.0))
    preseason = build_preseason_snapshot(
        preseason_ratings,
        season=season,
        snapshot_date=snapshot_date,
        rating_scale=rating_scale,
    )
    existing = existing_live_updates(runtime_published_dir)
    existing_pairs = {
        (str(row["match_id"]), str(row["school_key"]))
        for row in existing[["match_id", "school_key"]].to_dict(orient="records")
    } if not existing.empty else set()
    match_records = rmuc_live.build_runtime_match_records(
        normalized,
        existing_match_school_pairs=existing_pairs,
    )
    new_matches = pd.DataFrame(match_records)
    live_updates = build_published_live_state_updates(
        preseason_snapshot=preseason,
        live_state_store=existing,
        new_matches=new_matches,
        rating_scale=rating_scale,
        pre_decay_matches=3,
        beta_perf=float(manifest.get("beta_perf", 1.8865294456481934)),
        online_update_scale=float(manifest.get("online_live_update_scale", 0.33)),
    )
    if not existing.empty:
        live_updates = pd.concat([existing, live_updates], ignore_index=True)
    current_snapshot = _build_published_current_snapshot(
        preseason_snapshot=preseason,
        live_state_store=live_updates,
        rating_scale=rating_scale,
        season=season,
    )
    save_frame_json(runtime_published_dir / "live_state_updates.json", live_updates)
    save_frame_json(runtime_published_dir / "live_match_ledger.json", live_updates)
    save_frame_json(runtime_published_dir / "current_snapshot.json", current_snapshot)
    write_json_atomic(
        runtime_published_dir / "published_manifest.json",
        {
            "season": season,
            "snapshot_date": snapshot_date,
            "rating_scale": rating_scale,
            "beta_perf": float(manifest.get("beta_perf", 1.8865294456481934)),
            "online_live_update_scale": float(manifest.get("online_live_update_scale", 0.33)),
            "generated_at": datetime.now(tz=UTC).isoformat(),
            "source_status": normalized.get("sourceStatus"),
            "source_updated_at": normalized.get("sourceUpdatedAt"),
            "completed_official_matches": sum(
                1
                for region in normalized.get("regions", {}).values()
                for match in region.get("matches", [])
                if match.get("isCompleted")
            ),
        },
    )


def completed_official_match_count(normalized: dict[str, Any]) -> int:
    return sum(
        1
        for region in normalized.get("regions", {}).values()
        for match in region.get("matches", [])
        if match.get("isCompleted")
    )


def main() -> None:
    args = parse_args()
    raw_dir = args.runtime_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(tz=UTC)
    headers_path = raw_dir / "upstream_headers.json"
    upstream_headers = load_json_if_exists(headers_path)
    if not isinstance(upstream_headers, dict):
        upstream_headers = {}

    if args.skip_fetch:
        schedule_payload = load_json(raw_dir / "schedule.json")
        group_rank_payload = load_json_if_exists(raw_dir / "group_rank_info.json")
        headers = upstream_headers.get("schedule", {}) if isinstance(upstream_headers.get("schedule"), dict) else {}
    else:
        schedule_payload, headers, changed = fetch_json(
            rmuc_live.UPSTREAM_LIVE_URLS["schedule"],
            upstream_headers.get("schedule") if isinstance(upstream_headers.get("schedule"), dict) else None,
        )
        if schedule_payload is None:
            schedule_payload = load_json(raw_dir / "schedule.json")
        elif changed:
            write_raw_snapshot(raw_dir, "schedule", schedule_payload, fetched_at)
        upstream_headers["schedule"] = {**headers, "fetched-at": fetched_at.isoformat()}
        group_rank_payload = load_json_if_exists(raw_dir / "group_rank_info.json")
        for name, url in rmuc_live.UPSTREAM_LIVE_URLS.items():
            if name == "schedule":
                continue
            try:
                payload, aux_headers, aux_changed = fetch_json(
                    url,
                    upstream_headers.get(name) if isinstance(upstream_headers.get(name), dict) else None,
                )
                if payload is not None and aux_changed:
                    write_raw_snapshot(raw_dir, name, payload, fetched_at)
                if name == "group_rank_info" and payload is not None:
                    group_rank_payload = payload
                upstream_headers[name] = {**aux_headers, "fetched-at": fetched_at.isoformat()}
            except Exception as exc:  # noqa: BLE001 - auxiliary sources must not block schedule sync.
                write_json_atomic(raw_dir / f"{name}.error.json", {"error": str(exc), "fetchedAt": fetched_at.isoformat()})
        write_json_atomic(headers_path, upstream_headers)

    normalized = rmuc_live.normalize_schedule_payload(
        schedule_payload,
        fetched_at=fetched_at,
        source_headers=headers,
        group_rank_payload=group_rank_payload if isinstance(group_rank_payload, dict) else None,
    )
    write_json_atomic(args.runtime_dir / "normalized_schedule.json", normalized)
    mini_program_disabled = args.skip_mini_program or mini_program_sync_disabled_from_env()
    if mini_program_disabled:
        mini_program_status = disabled_mini_program_status("mini-program sync disabled", fetched_at=fetched_at)
    else:
        mini_program_status = sync_mini_program_predictions(
            normalized,
            runtime_dir=args.runtime_dir,
            fetched_at=fetched_at,
            ttl_seconds=args.mini_program_ttl_seconds,
            refresh_window_seconds=args.mini_program_refresh_window_seconds,
            lookback_hours=args.mini_program_lookback_hours,
            lookahead_hours=args.mini_program_lookahead_hours,
            max_matches=args.mini_program_max_matches,
        )
    completed_matches = completed_official_match_count(normalized)
    if normalized.get("sourceStatus") == "active" and completed_matches > 0:
        publish_runtime_artifacts(
            normalized=normalized,
            runtime_dir=args.runtime_dir,
            base_published_dir=args.base_published_dir,
            preseason_ratings=args.preseason_ratings,
            snapshot_date=args.snapshot_date,
        )
    else:
        write_json_atomic(
            args.runtime_dir / "published_2026" / "published_manifest.json",
            {
                "season": normalized.get("season"),
                "snapshot_date": args.snapshot_date,
                "generated_at": datetime.now(tz=UTC).isoformat(),
                "source_status": normalized.get("sourceStatus"),
                "source_reason": normalized.get("reason"),
                "source_updated_at": normalized.get("sourceUpdatedAt"),
                "completed_official_matches": completed_matches,
            },
        )
    write_json_atomic(
        args.runtime_dir / SYNC_MANIFEST_FILENAME,
        build_sync_manifest(normalized, mini_program_status=mini_program_status, fetched_at=fetched_at),
    )
    print(
        json.dumps(
            {
                "sourceStatus": normalized.get("sourceStatus"),
                "reason": normalized.get("reason"),
                "miniProgramPrediction": mini_program_status.get("sourceStatus"),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
