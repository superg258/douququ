#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import UTC, datetime, timedelta, timezone
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
    _regional_pre_config,
    _season_delta_config,
    build_published_live_state_updates,
)
from research.trueskill2.history_sources import RegionalPreModelConfig  # noqa: E402
from research.trueskill2.live_archive import build_form_observations_from_group_rank_payload  # noqa: E402
from research.trueskill2.season_delta import compute_effective_sigma_theta  # noqa: E402
from research.trueskill2.season_delta import (  # noqa: E402
    adjust_form_observation_for_freshness,
    compute_event_form_freshness,
)


DEFAULT_RUNTIME_DIR = ROOT / "data" / "runtime" / "rmuc_live"
DEFAULT_BASE_PUBLISHED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "published_2026"
DEFAULT_PRESEASON_RATINGS = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "preseason_ratings.csv"
DEFAULT_TS2_CONFIG = ROOT / "configs" / "trueskill2_full.yaml"
MINI_PROGRAM_PREDICTIONS_FILENAME = "mini_program_predictions.json"
PREDICTION_FORM_OBSERVATIONS_FILENAME = "prediction_form_observations.json"
SYNC_MANIFEST_FILENAME = "sync_manifest.json"
DEFAULT_MINI_PROGRAM_TTL_SECONDS = 300
DEFAULT_MINI_PROGRAM_REFRESH_WINDOW_SECONDS = 60
DEFAULT_MINI_PROGRAM_LOOKBACK_HOURS = 24
DEFAULT_MINI_PROGRAM_LOOKAHEAD_HOURS = 48
DEFAULT_MINI_PROGRAM_MAX_MATCHES = 96
BEIJING_TZ = timezone(timedelta(hours=8))
RUNTIME_SNAPSHOT_RE = re.compile(r"^(group_rank_info|robot_data)\.(\d{8}T\d{6}Z)\.json$")
COMPLETED_OFFICIAL_STATUSES = {"DONE", "FINISHED", "ENDED", "COMPLETE", "COMPLETED"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize official RMUC live schedule data into runtime artifacts.")
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--base-published-dir", type=Path, default=DEFAULT_BASE_PUBLISHED_DIR)
    parser.add_argument("--preseason-ratings", type=Path, default=DEFAULT_PRESEASON_RATINGS)
    parser.add_argument("--config", type=Path, default=DEFAULT_TS2_CONFIG)
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
        return parsed.replace(tzinfo=BEIJING_TZ).astimezone(UTC)
    return parsed.astimezone(UTC)


def write_raw_snapshot(raw_dir: Path, name: str, payload: dict[str, Any], fetched_at: datetime) -> None:
    safe_timestamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
    write_json_atomic(raw_dir / f"{name}.json", payload)
    write_json_atomic(raw_dir / f"{name}.{safe_timestamp}.json", payload)


def _runtime_snapshot_index(raw_dir: Path, source_type: str) -> list[tuple[datetime, Path]]:
    snapshots: list[tuple[datetime, Path]] = []
    for path in raw_dir.glob(f"{source_type}.*.json"):
        match = RUNTIME_SNAPSHOT_RE.match(path.name)
        if match is None or match.group(1) != source_type:
            continue
        fetched_at = datetime.strptime(match.group(2), "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        snapshots.append((fetched_at, path))
    return sorted(snapshots, key=lambda item: (item[0], item[1].name))


def _select_runtime_snapshot_before(index: list[tuple[datetime, Path]], cutoff: datetime) -> tuple[datetime, Path, float] | None:
    cutoff_utc = cutoff.astimezone(UTC)
    selected: tuple[datetime, Path] | None = None
    for fetched_at, path in index:
        if fetched_at <= cutoff_utc:
            selected = (fetched_at, path)
        else:
            break
    if selected is None:
        return None
    fetched_at, path = selected
    return fetched_at, path, float((cutoff_utc - fetched_at).total_seconds() / 60.0)


def _same_school_in_match(match: dict[str, Any], school_key_text: str) -> bool:
    return school_key_text in {
        str(match.get("redSchoolKey") or ""),
        str(match.get("blueSchoolKey") or ""),
    }


def _numeric_match_order(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _expected_group_matches_before(
    *,
    match: dict[str, Any],
    school_key_text: str,
    all_matches: list[dict[str, Any]],
) -> float | None:
    planned_start = _parse_datetime(match.get("plannedStartAt")) or _parse_datetime(match.get("matchDate"))
    region_slug = str(match.get("regionSlug") or "")
    if planned_start is None:
        current_order = _numeric_match_order(match.get("orderNumber"))
        if current_order is not None:
            count = 0
            for candidate in all_matches:
                if str(candidate.get("regionSlug") or "") != region_slug:
                    continue
                if str(candidate.get("stageFamily") or "") != "regional_group":
                    continue
                if not candidate.get("isCompleted"):
                    continue
                if not _same_school_in_match(candidate, school_key_text):
                    continue
                candidate_order = _numeric_match_order(candidate.get("orderNumber"))
                if candidate_order is None or candidate_order >= current_order:
                    continue
                count += 1
            return float(count)
        round_number = _numeric_match_order(match.get("roundNumber"))
        if round_number is not None:
            return float(max(round_number - 1.0, 0.0))
        return None
    count = 0
    for candidate in all_matches:
        if str(candidate.get("regionSlug") or "") != region_slug:
            continue
        if str(candidate.get("stageFamily") or "") != "regional_group":
            continue
        if not candidate.get("isCompleted"):
            continue
        if not _same_school_in_match(candidate, school_key_text):
            continue
        candidate_start = _parse_datetime(candidate.get("plannedStartAt")) or _parse_datetime(candidate.get("matchDate"))
        if candidate_start is None or candidate_start >= planned_start:
            continue
        count += 1
    return float(count)


def _is_pending_prediction_form_match(match: dict[str, Any]) -> bool:
    if str(match.get("stageFamily") or "") != "regional_group":
        return False
    if str(match.get("stage") or "") != "swiss":
        return False
    if match.get("isConfirmedMatchup") is not True:
        return False
    if match.get("isCompleted") or match.get("hasLiveScoreline"):
        return False
    status = str(match.get("officialStatus") or "").strip().upper()
    return status not in COMPLETED_OFFICIAL_STATUSES


def build_runtime_live_form_observations(
    *,
    normalized: dict[str, Any],
    raw_dir: Path,
    regional_cfg: RegionalPreModelConfig,
):
    import pandas as pd

    if not bool(regional_cfg.live_form_update_enabled):
        return pd.DataFrame()
    group_index = _runtime_snapshot_index(raw_dir, "group_rank_info")
    if not group_index:
        return pd.DataFrame()
    robot_index = _runtime_snapshot_index(raw_dir, "robot_data")
    season_cfg = _season_delta_config(regional_cfg)
    frame_cache: dict[tuple[str, str], Any] = {}
    all_matches = list(_iter_normalized_matches(normalized) or [])
    rows: list[dict[str, Any]] = []
    for match in all_matches:
        if not match.get("isCompleted"):
            continue
        planned_start = _parse_datetime(match.get("plannedStartAt")) or _parse_datetime(match.get("matchDate"))
        if planned_start is None:
            continue
        group_snapshot = _select_runtime_snapshot_before(group_index, planned_start)
        if group_snapshot is None:
            continue
        _, group_path, group_age = group_snapshot
        robot_snapshot = _select_runtime_snapshot_before(robot_index, planned_start) if robot_index else None
        robot_path = robot_snapshot[1] if robot_snapshot is not None else None
        cache_key = (group_path.name, robot_path.name if robot_path is not None else "")
        if cache_key not in frame_cache:
            group_payload = load_json(group_path)
            robot_payload = load_json(robot_path) if robot_path is not None else None
            frame_cache[cache_key] = build_form_observations_from_group_rank_payload(
                group_payload if isinstance(group_payload, dict) else None,
                robot_payload=robot_payload if isinstance(robot_payload, dict) else None,
                snapshot_name=group_path.name,
                snapshot_age_minutes=group_age,
                robot_snapshot_name=robot_path.name if robot_path is not None else None,
                robot_snapshot_age_minutes=robot_snapshot[2] if robot_snapshot is not None else None,
                config=season_cfg,
                apply_time_freshness=str(regional_cfg.form_freshness_mode) != "event_count_v1",
            )
        observations = frame_cache[cache_key]
        if getattr(observations, "empty", True):
            continue
        by_school = {str(row["school_key"]): row for row in observations.to_dict(orient="records")}
        for school in (str(match.get("redSchoolKey") or ""), str(match.get("blueSchoolKey") or "")):
            row = by_school.get(school)
            if row is None:
                continue
            try:
                if float(row.get("group_matches_played") or 0.0) < 1.0:
                    continue
            except (TypeError, ValueError):
                continue
            out = dict(row)
            expected_played = _expected_group_matches_before(
                match=match,
                school_key_text=school,
                all_matches=all_matches,
            )
            if str(regional_cfg.form_freshness_mode) == "event_count_v1":
                event_freshness = compute_event_form_freshness(
                    snapshot_matches_played=row.get("group_matches_played"),
                    expected_matches_played_before=expected_played,
                    time_freshness_weight=float(row.get("form_freshness_weight") or 1.0),
                )
                if event_freshness.weight <= 0.0:
                    continue
                freshened = adjust_form_observation_for_freshness(
                    obs_mu=float(row.get("obs_mu") or 0.0),
                    obs_sigma=float(row.get("obs_sigma") or 0.0),
                    freshness_weight=event_freshness.weight,
                    config=season_cfg,
                )
                out["obs_mu"] = float(freshened.obs_mu)
                out["obs_sigma"] = float(freshened.obs_sigma)
                out["form_freshness_weight"] = float(event_freshness.weight)
                out["form_event_freshness_weight"] = float(event_freshness.weight)
                out["form_event_freshness_status"] = event_freshness.status
                out["form_expected_group_matches_before"] = expected_played
            else:
                out["form_event_freshness_weight"] = None
                out["form_event_freshness_status"] = "time_decay"
                out["form_expected_group_matches_before"] = expected_played
            out["match_id"] = str(match.get("matchId") or "")
            out["region_slug"] = str(match.get("regionSlug") or "")
            rows.append(out)
    return pd.DataFrame(rows)


def build_runtime_prediction_form_observations(
    *,
    normalized: dict[str, Any],
    raw_dir: Path,
    regional_cfg: RegionalPreModelConfig,
):
    import pandas as pd

    if not bool(regional_cfg.live_form_update_enabled):
        return pd.DataFrame()
    group_payload = load_json_if_exists(raw_dir / "group_rank_info.json")
    if not isinstance(group_payload, dict):
        return pd.DataFrame()
    robot_payload = load_json_if_exists(raw_dir / "robot_data.json")
    season_cfg = _season_delta_config(regional_cfg)
    observations = build_form_observations_from_group_rank_payload(
        group_payload,
        robot_payload=robot_payload if isinstance(robot_payload, dict) else None,
        snapshot_name="group_rank_info.json",
        snapshot_age_minutes=None,
        robot_snapshot_name="robot_data.json" if isinstance(robot_payload, dict) else None,
        robot_snapshot_age_minutes=None,
        config=season_cfg,
        apply_time_freshness=str(regional_cfg.form_freshness_mode) != "event_count_v1",
    )
    if getattr(observations, "empty", True):
        return pd.DataFrame()

    by_school = {str(row["school_key"]): row for row in observations.to_dict(orient="records")}
    all_matches = list(_iter_normalized_matches(normalized) or [])
    rows: list[dict[str, Any]] = []
    for match in all_matches:
        if not _is_pending_prediction_form_match(match):
            continue
        for side in ("red", "blue"):
            school = str(match.get(f"{side}SchoolKey") or "")
            if not school:
                continue
            row = by_school.get(school)
            if row is None:
                continue
            try:
                group_matches_played = float(row.get("group_matches_played") or 0.0)
            except (TypeError, ValueError):
                continue
            if group_matches_played < 1.0:
                continue
            expected_played = _expected_group_matches_before(
                match=match,
                school_key_text=school,
                all_matches=all_matches,
            )
            out = dict(row)
            if str(regional_cfg.form_freshness_mode) == "event_count_v1":
                event_freshness = compute_event_form_freshness(
                    snapshot_matches_played=row.get("group_matches_played"),
                    expected_matches_played_before=expected_played,
                    time_freshness_weight=float(row.get("form_freshness_weight") or 1.0),
                )
                if event_freshness.weight <= 0.0:
                    continue
                freshened = adjust_form_observation_for_freshness(
                    obs_mu=float(row.get("obs_mu") or 0.0),
                    obs_sigma=float(row.get("obs_sigma") or 0.0),
                    freshness_weight=event_freshness.weight,
                    config=season_cfg,
                )
                out["obs_mu"] = float(freshened.obs_mu)
                out["obs_sigma"] = float(freshened.obs_sigma)
                out["form_freshness_weight"] = float(event_freshness.weight)
                out["form_event_freshness_weight"] = float(event_freshness.weight)
                out["form_event_freshness_status"] = event_freshness.status
            else:
                out["form_event_freshness_weight"] = None
                out["form_event_freshness_status"] = "time_decay"

            out["match_id"] = str(match.get("matchId") or "")
            out["official_match_id"] = str(match.get("officialMatchId") or "")
            out["region_slug"] = str(match.get("regionSlug") or "")
            out["stage_family"] = str(match.get("stageFamily") or "")
            out["team_key"] = str(match.get(f"{side}TeamKey") or "")
            out["school_key"] = school
            out["team_side"] = side
            out["form_expected_group_matches_before"] = expected_played
            out["form_obs_mu"] = float(out.get("obs_mu") or 0.0)
            out["form_obs_sigma"] = float(out.get("obs_sigma") or 0.0)
            out["form_obs_gain"] = float(out.get("form_reliability") or 0.0)
            out["form_opponent_adjusted_obs_mu"] = float(out.get("obs_mu") or 0.0)
            out["form_robot_family_signal"] = float(out.get("robot_family_signal") or 0.0)
            out["form_robot_objective_signal"] = float(out.get("robot_objective_signal") or 0.0)
            out["form_robot_base_dart_average"] = float(out.get("robot_base_dart_average") or 0.0)
            out["form_robot_base_capability_signal"] = float(out.get("robot_base_capability_signal") or 0.0)
            out["form_robot_gate_weight"] = float(out.get("robot_gate_weight") or 0.0)
            out["form_robot_form_reliability"] = float(out.get("robot_form_reliability") or 0.0)
            out["form_robot_signal_alignment"] = out.get("robot_signal_alignment")
            out["form_robot_signal_conflict"] = bool(out.get("robot_signal_conflict", False))
            rows.append(out)
    return pd.DataFrame(rows)


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
    predictions: dict[str, dict[str, Any]] = dict(existing)
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
        "available": sum(1 for prediction in window_predictions.values() if prediction.get("status") == "available"),
        "unavailable": sum(1 for prediction in window_predictions.values() if prediction.get("status") != "available"),
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
        "storedPredictions": 0,
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


def load_regional_config(config_path: Path | None) -> RegionalPreModelConfig:
    if config_path is not None and config_path.exists():
        import yaml

        payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        return _regional_pre_config(payload)
    return _regional_pre_config({})


def build_preseason_snapshot(
    preseason_ratings: Path,
    *,
    season: int,
    snapshot_date: str,
    rating_scale: float,
    regional_cfg: RegionalPreModelConfig | None = None,
):
    import pandas as pd

    rows = pd.read_csv(preseason_ratings)
    regional_cfg = regional_cfg or RegionalPreModelConfig()
    season_cfg = _season_delta_config(regional_cfg)
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
    frame["season_delta_mu"] = frame["regional_prior_theta"].astype(float)

    if "pre_signal_sd_theta" in rows.columns:
        pre_signal_sd = pd.to_numeric(rows["pre_signal_sd_theta"], errors="coerce").fillna(0.30)
    else:
        pre_signal_sd = pd.Series(0.30, index=rows.index, dtype=float)
    if "rmuc_history_strength" in rows.columns:
        history_strength = pd.to_numeric(rows["rmuc_history_strength"], errors="coerce").fillna(1.0)
    else:
        history_strength = pd.Series(1.0, index=rows.index, dtype=float)
    frame["season_delta_sigma_theta"] = [
        compute_effective_sigma_theta(
            pre_signal_sd=float(sd),
            regional_prior_delta_theta=float(delta),
            rmuc_history_strength=float(strength),
            config=season_cfg,
        )
        for sd, delta, strength in zip(pre_signal_sd, frame["regional_prior_theta"], history_strength, strict=True)
    ]
    frame["effective_sigma_theta"] = frame["season_delta_sigma_theta"]
    frame["effective_sigma_rating"] = float(rating_scale) * frame["effective_sigma_theta"]
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


def runtime_model_config_signature(regional_cfg: RegionalPreModelConfig) -> dict[str, Any]:
    return {
        "live_update_strategy": str(regional_cfg.live_update_strategy),
        "momentum_update_enabled": bool(regional_cfg.momentum_update_enabled),
        "live_form_update_enabled": bool(regional_cfg.live_form_update_enabled),
        "result_obs_sigma_base": float(regional_cfg.result_obs_sigma_base),
        "expected_loss_sigma_multiplier": float(regional_cfg.expected_loss_sigma_multiplier),
        "expected_loss_probability_threshold": float(regional_cfg.expected_loss_probability_threshold),
        "surprise_residual_threshold": float(regional_cfg.surprise_residual_threshold),
        "sweep_bonus_2_0": float(regional_cfg.sweep_bonus_2_0),
        "max_sigma_inflation": float(regional_cfg.max_sigma_inflation),
        "form_freshness_mode": str(regional_cfg.form_freshness_mode),
        "result_momentum_scale": float(regional_cfg.result_momentum_scale),
        "result_momentum_decay": float(regional_cfg.result_momentum_decay),
        "result_momentum_cap": float(regional_cfg.result_momentum_cap),
        "form_freshness_decay_minutes": float(regional_cfg.form_freshness_decay_minutes),
        "form_freshness_floor": float(regional_cfg.form_freshness_floor),
        "early_group_sigma_floor": float(regional_cfg.early_group_sigma_floor),
        "early_group_sigma_floor_matches": float(regional_cfg.early_group_sigma_floor_matches),
        "form_team_damage_weight": float(regional_cfg.form_team_damage_weight),
        "form_base_hp_weight": float(regional_cfg.form_base_hp_weight),
        "form_opponent_points_weight": float(regional_cfg.form_opponent_points_weight),
        "form_scale": float(regional_cfg.form_scale),
        "form_temperature": float(regional_cfg.form_temperature),
        "form_obs_sigma_base": float(regional_cfg.form_obs_sigma_base),
        "opponent_form_expected_scale": float(regional_cfg.opponent_form_expected_scale),
        "opponent_form_adjustment_weight": float(regional_cfg.opponent_form_adjustment_weight),
        "robot_form_blend_weight": float(regional_cfg.robot_form_blend_weight),
        "robot_form_scale": float(regional_cfg.robot_form_scale),
        "robot_form_temperature": float(regional_cfg.robot_form_temperature),
        "robot_form_obs_sigma_base": float(regional_cfg.robot_form_obs_sigma_base),
        "robot_form_reliability_floor": float(regional_cfg.robot_form_reliability_floor),
        "robot_gate_conflict_weight": float(regional_cfg.robot_gate_conflict_weight),
        "robot_gate_robot_only_weight": float(regional_cfg.robot_gate_robot_only_weight),
        "robot_gate_neutral_weight": float(regional_cfg.robot_gate_neutral_weight),
        "prediction_head_base_weight": float(regional_cfg.prediction_head_base_weight),
        "prediction_head_season_delta_weight": float(regional_cfg.prediction_head_season_delta_weight),
        "prediction_head_momentum_weight": float(regional_cfg.prediction_head_momentum_weight),
        "prediction_head_temperature": float(regional_cfg.prediction_head_temperature),
        "prediction_head_opening_group_temperature": float(regional_cfg.prediction_head_opening_group_temperature),
        "prediction_head_non_opening_temperature": float(regional_cfg.prediction_head_non_opening_temperature),
        "prediction_head_post_group_temperature": float(regional_cfg.prediction_head_post_group_temperature),
        "prediction_head_early_group_min_matches": float(regional_cfg.prediction_head_early_group_min_matches),
        "prediction_head_early_group_max_matches": float(regional_cfg.prediction_head_early_group_max_matches),
        "prediction_head_component_blend_max_weight": float(
            regional_cfg.prediction_head_component_blend_max_weight
        ),
        "prediction_head_component_blend_min_matches": float(
            regional_cfg.prediction_head_component_blend_min_matches
        ),
        "prediction_head_component_blend_max_matches": float(
            regional_cfg.prediction_head_component_blend_max_matches
        ),
        "prediction_head_process_residual_weight": float(regional_cfg.prediction_head_process_residual_weight),
        "prediction_head_process_residual_cap": float(regional_cfg.prediction_head_process_residual_cap),
        "prediction_head_group_form_residual_weight": float(regional_cfg.prediction_head_group_form_residual_weight),
        "prediction_head_group_form_residual_cap": float(regional_cfg.prediction_head_group_form_residual_cap),
        "prediction_head_group_form_residual_min_matches": float(
            regional_cfg.prediction_head_group_form_residual_min_matches
        ),
        "prediction_head_group_form_residual_max_matches": float(
            regional_cfg.prediction_head_group_form_residual_max_matches
        ),
        "prediction_head_robot_form_agreement_weight": float(
            regional_cfg.prediction_head_robot_form_agreement_weight
        ),
        "prediction_head_robot_form_agreement_cap": float(
            regional_cfg.prediction_head_robot_form_agreement_cap
        ),
        "prediction_head_robot_output_residual_weight": float(
            regional_cfg.prediction_head_robot_output_residual_weight
        ),
        "prediction_head_robot_output_residual_cap": float(regional_cfg.prediction_head_robot_output_residual_cap),
        "prediction_head_robot_output_residual_min_matches": float(
            regional_cfg.prediction_head_robot_output_residual_min_matches
        ),
        "prediction_head_robot_output_residual_max_matches": float(
            regional_cfg.prediction_head_robot_output_residual_max_matches
        ),
        "prediction_head_robot_base_capability_residual_weight": float(
            regional_cfg.prediction_head_robot_base_capability_residual_weight
        ),
        "prediction_head_robot_base_capability_residual_cap": float(
            regional_cfg.prediction_head_robot_base_capability_residual_cap
        ),
        "prediction_head_robot_base_capability_residual_min_matches": float(
            regional_cfg.prediction_head_robot_base_capability_residual_min_matches
        ),
        "prediction_head_robot_base_capability_residual_max_matches": float(
            regional_cfg.prediction_head_robot_base_capability_residual_max_matches
        ),
        "prediction_head_robot_conflict_blend_weight": float(
            regional_cfg.prediction_head_robot_conflict_blend_weight
        ),
        "prediction_head_robot_conflict_min_matches": float(regional_cfg.prediction_head_robot_conflict_min_matches),
        "prediction_head_robot_conflict_max_matches": float(regional_cfg.prediction_head_robot_conflict_max_matches),
        "prediction_head_robot_conflict_signal_scale": float(
            regional_cfg.prediction_head_robot_conflict_signal_scale
        ),
        "prediction_head_robot_conflict_model_delta_cap": float(
            regional_cfg.prediction_head_robot_conflict_model_delta_cap
        ),
        "prediction_head_group_objective_conflict_blend_weight": float(
            regional_cfg.prediction_head_group_objective_conflict_blend_weight
        ),
        "prediction_head_group_objective_conflict_min_matches": float(
            regional_cfg.prediction_head_group_objective_conflict_min_matches
        ),
        "prediction_head_group_objective_conflict_max_matches": float(
            regional_cfg.prediction_head_group_objective_conflict_max_matches
        ),
        "prediction_head_group_objective_conflict_signal_scale": float(
            regional_cfg.prediction_head_group_objective_conflict_signal_scale
        ),
        "prediction_head_group_objective_conflict_signal_threshold": float(
            regional_cfg.prediction_head_group_objective_conflict_signal_threshold
        ),
        "prediction_head_group_objective_conflict_model_delta_cap": float(
            regional_cfg.prediction_head_group_objective_conflict_model_delta_cap
        ),
        "prediction_head_post_conflict_temperature_weight": float(
            regional_cfg.prediction_head_post_conflict_temperature_weight
        ),
        "prediction_head_post_conflict_temperature_cap": float(
            regional_cfg.prediction_head_post_conflict_temperature_cap
        ),
        "prediction_head_post_conflict_min_signals": float(regional_cfg.prediction_head_post_conflict_min_signals),
        "prediction_head_post_conflict_model_delta_min": float(
            regional_cfg.prediction_head_post_conflict_model_delta_min
        ),
        "prediction_head_post_conflict_live_signal_threshold": float(
            regional_cfg.prediction_head_post_conflict_live_signal_threshold
        ),
        "prediction_head_post_conflict_robot_signal_threshold": float(
            regional_cfg.prediction_head_post_conflict_robot_signal_threshold
        ),
    }


def existing_manifest_compatible(runtime_published_dir: Path, regional_cfg: RegionalPreModelConfig) -> bool:
    manifest = load_json_if_exists(runtime_published_dir / "published_manifest.json")
    if not isinstance(manifest, dict):
        return False
    expected = runtime_model_config_signature(regional_cfg)
    actual = manifest.get("model_config_signature")
    if isinstance(actual, dict):
        return actual == expected
    for key, value in expected.items():
        if key not in manifest:
            return False
        if manifest.get(key) != value:
            return False
    return True


def existing_updates_compatible(existing, regional_cfg: RegionalPreModelConfig) -> bool:
    if existing.empty:
        return True
    required = {"match_id", "match_date", "school_key", "update_strategy"}
    if not required.issubset(existing.columns):
        return False
    strategy = str(regional_cfg.live_update_strategy)
    if not existing["update_strategy"].fillna("").astype(str).eq(strategy).all():
        return False
    if strategy == "season_delta_fusion":
        fusion_required = {
            "season_delta_mu_after_match",
            "season_delta_sigma_after_match",
            "season_delta_sigma_before_inflation",
            "season_delta_sigma_after_inflation",
            "surprise_residual",
            "sigma_inflation",
            "result_obs_mu",
            "result_obs_sigma",
            "result_obs_gain",
        }
        if not fusion_required.issubset(existing.columns):
            return False
        if bool(regional_cfg.live_form_update_enabled):
            form_required = {
                "form_obs_mu",
                "form_obs_sigma",
                "form_obs_gain",
                "form_update_delta_theta",
                "form_freshness_weight",
                "form_event_freshness_weight",
                "form_event_freshness_status",
                "form_expected_group_matches_before",
                "form_opponent_adjusted_obs_mu",
                "form_evidence_key",
                "form_snapshot_name",
            }
            if not form_required.issubset(existing.columns):
                return False
        if bool(regional_cfg.momentum_update_enabled):
            momentum_required = {
                "momentum_theta_before_match",
                "momentum_theta_after_match",
                "momentum_update_delta_theta",
            }
            if not momentum_required.issubset(existing.columns):
                return False
    return True


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
    config_path: Path | None = DEFAULT_TS2_CONFIG,
) -> None:
    import pandas as pd

    runtime_published_dir = runtime_dir / "published_2026"
    manifest = load_manifest(base_published_dir)
    regional_cfg = load_regional_config(config_path)
    season = int(normalized.get("season") or manifest.get("season") or snapshot_date[:4])
    rating_scale = float(manifest.get("rating_scale", 135.0))
    preseason = build_preseason_snapshot(
        preseason_ratings,
        season=season,
        snapshot_date=snapshot_date,
        rating_scale=rating_scale,
        regional_cfg=regional_cfg,
    )
    existing = existing_live_updates(runtime_published_dir)
    if not existing_manifest_compatible(runtime_published_dir, regional_cfg) or not existing_updates_compatible(existing, regional_cfg):
        existing = pd.DataFrame()
    existing_pairs = {
        (str(row["match_id"]), str(row["school_key"]))
        for row in existing[["match_id", "school_key"]].to_dict(orient="records")
    } if not existing.empty else set()
    match_records = rmuc_live.build_runtime_match_records(
        normalized,
        existing_match_school_pairs=existing_pairs,
    )
    new_matches = pd.DataFrame(match_records)
    form_observations = build_runtime_live_form_observations(
        normalized=normalized,
        raw_dir=runtime_dir / "raw",
        regional_cfg=regional_cfg,
    )
    prediction_form_observations = build_runtime_prediction_form_observations(
        normalized=normalized,
        raw_dir=runtime_dir / "raw",
        regional_cfg=regional_cfg,
    )
    live_updates = build_published_live_state_updates(
        preseason_snapshot=preseason,
        live_state_store=existing,
        new_matches=new_matches,
        rating_scale=rating_scale,
        pre_decay_matches=int(regional_cfg.pre_decay_matches),
        beta_perf=float(manifest.get("beta_perf", 1.8865294456481934)),
        online_update_scale=float(manifest.get("online_live_update_scale", regional_cfg.online_live_update_scale)),
        update_strategy=str(regional_cfg.live_update_strategy),
        season_delta_config=_season_delta_config(regional_cfg),
        form_observations=form_observations,
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
    save_frame_json(runtime_dir / PREDICTION_FORM_OBSERVATIONS_FILENAME, prediction_form_observations)
    write_json_atomic(
        runtime_published_dir / "published_manifest.json",
        {
            "season": season,
            "snapshot_date": snapshot_date,
            "rating_scale": rating_scale,
            "beta_perf": float(manifest.get("beta_perf", 1.8865294456481934)),
            "online_live_update_scale": float(manifest.get("online_live_update_scale", regional_cfg.online_live_update_scale)),
            "live_update_strategy": str(regional_cfg.live_update_strategy),
            "momentum_update_enabled": bool(regional_cfg.momentum_update_enabled),
            "live_form_update_enabled": bool(regional_cfg.live_form_update_enabled),
            "model_config_signature": runtime_model_config_signature(regional_cfg),
            "result_obs_sigma_base": float(regional_cfg.result_obs_sigma_base),
            "expected_loss_sigma_multiplier": float(regional_cfg.expected_loss_sigma_multiplier),
            "expected_loss_probability_threshold": float(regional_cfg.expected_loss_probability_threshold),
            "surprise_residual_threshold": float(regional_cfg.surprise_residual_threshold),
            "sweep_bonus_2_0": float(regional_cfg.sweep_bonus_2_0),
            "max_sigma_inflation": float(regional_cfg.max_sigma_inflation),
            "form_freshness_mode": str(regional_cfg.form_freshness_mode),
            "form_freshness_decay_minutes": float(regional_cfg.form_freshness_decay_minutes),
            "form_freshness_floor": float(regional_cfg.form_freshness_floor),
            "early_group_sigma_floor": float(regional_cfg.early_group_sigma_floor),
            "early_group_sigma_floor_matches": float(regional_cfg.early_group_sigma_floor_matches),
            "form_opponent_points_weight": float(regional_cfg.form_opponent_points_weight),
            "opponent_form_adjustment_weight": float(regional_cfg.opponent_form_adjustment_weight),
            "robot_gate_conflict_weight": float(regional_cfg.robot_gate_conflict_weight),
            "prediction_head_base_weight": float(regional_cfg.prediction_head_base_weight),
            "prediction_head_season_delta_weight": float(regional_cfg.prediction_head_season_delta_weight),
            "prediction_head_momentum_weight": float(regional_cfg.prediction_head_momentum_weight),
            "prediction_head_temperature": float(regional_cfg.prediction_head_temperature),
            "prediction_head_opening_group_temperature": float(regional_cfg.prediction_head_opening_group_temperature),
            "prediction_head_non_opening_temperature": float(regional_cfg.prediction_head_non_opening_temperature),
            "prediction_head_post_group_temperature": float(regional_cfg.prediction_head_post_group_temperature),
            "prediction_head_early_group_min_matches": float(regional_cfg.prediction_head_early_group_min_matches),
            "prediction_head_early_group_max_matches": float(regional_cfg.prediction_head_early_group_max_matches),
            "prediction_head_component_blend_max_weight": float(
                regional_cfg.prediction_head_component_blend_max_weight
            ),
            "prediction_head_component_blend_min_matches": float(
                regional_cfg.prediction_head_component_blend_min_matches
            ),
            "prediction_head_component_blend_max_matches": float(
                regional_cfg.prediction_head_component_blend_max_matches
            ),
            "prediction_head_process_residual_weight": float(regional_cfg.prediction_head_process_residual_weight),
            "prediction_head_process_residual_cap": float(regional_cfg.prediction_head_process_residual_cap),
            "prediction_head_group_form_residual_weight": float(
                regional_cfg.prediction_head_group_form_residual_weight
            ),
            "prediction_head_group_form_residual_cap": float(regional_cfg.prediction_head_group_form_residual_cap),
            "prediction_head_group_form_residual_min_matches": float(
                regional_cfg.prediction_head_group_form_residual_min_matches
            ),
            "prediction_head_group_form_residual_max_matches": float(
                regional_cfg.prediction_head_group_form_residual_max_matches
            ),
            "prediction_head_robot_form_agreement_weight": float(
                regional_cfg.prediction_head_robot_form_agreement_weight
            ),
            "prediction_head_robot_form_agreement_cap": float(
                regional_cfg.prediction_head_robot_form_agreement_cap
            ),
            "prediction_head_robot_output_residual_weight": float(
                regional_cfg.prediction_head_robot_output_residual_weight
            ),
            "prediction_head_robot_output_residual_cap": float(
                regional_cfg.prediction_head_robot_output_residual_cap
            ),
            "prediction_head_robot_output_residual_min_matches": float(
                regional_cfg.prediction_head_robot_output_residual_min_matches
            ),
            "prediction_head_robot_output_residual_max_matches": float(
                regional_cfg.prediction_head_robot_output_residual_max_matches
            ),
            "prediction_head_robot_base_capability_residual_weight": float(
                regional_cfg.prediction_head_robot_base_capability_residual_weight
            ),
            "prediction_head_robot_base_capability_residual_cap": float(
                regional_cfg.prediction_head_robot_base_capability_residual_cap
            ),
            "prediction_head_robot_base_capability_residual_min_matches": float(
                regional_cfg.prediction_head_robot_base_capability_residual_min_matches
            ),
            "prediction_head_robot_base_capability_residual_max_matches": float(
                regional_cfg.prediction_head_robot_base_capability_residual_max_matches
            ),
            "prediction_head_robot_conflict_blend_weight": float(
                regional_cfg.prediction_head_robot_conflict_blend_weight
            ),
            "prediction_head_robot_conflict_min_matches": float(
                regional_cfg.prediction_head_robot_conflict_min_matches
            ),
            "prediction_head_robot_conflict_max_matches": float(
                regional_cfg.prediction_head_robot_conflict_max_matches
            ),
            "prediction_head_robot_conflict_signal_scale": float(
                regional_cfg.prediction_head_robot_conflict_signal_scale
            ),
            "prediction_head_robot_conflict_model_delta_cap": float(
                regional_cfg.prediction_head_robot_conflict_model_delta_cap
            ),
            "prediction_head_group_objective_conflict_blend_weight": float(
                regional_cfg.prediction_head_group_objective_conflict_blend_weight
            ),
            "prediction_head_group_objective_conflict_min_matches": float(
                regional_cfg.prediction_head_group_objective_conflict_min_matches
            ),
            "prediction_head_group_objective_conflict_max_matches": float(
                regional_cfg.prediction_head_group_objective_conflict_max_matches
            ),
            "prediction_head_group_objective_conflict_signal_scale": float(
                regional_cfg.prediction_head_group_objective_conflict_signal_scale
            ),
            "prediction_head_group_objective_conflict_signal_threshold": float(
                regional_cfg.prediction_head_group_objective_conflict_signal_threshold
            ),
            "prediction_head_group_objective_conflict_model_delta_cap": float(
                regional_cfg.prediction_head_group_objective_conflict_model_delta_cap
            ),
            "prediction_head_post_conflict_temperature_weight": float(
                regional_cfg.prediction_head_post_conflict_temperature_weight
            ),
            "prediction_head_post_conflict_temperature_cap": float(
                regional_cfg.prediction_head_post_conflict_temperature_cap
            ),
            "prediction_head_post_conflict_min_signals": float(
                regional_cfg.prediction_head_post_conflict_min_signals
            ),
            "prediction_head_post_conflict_model_delta_min": float(
                regional_cfg.prediction_head_post_conflict_model_delta_min
            ),
            "prediction_head_post_conflict_live_signal_threshold": float(
                regional_cfg.prediction_head_post_conflict_live_signal_threshold
            ),
            "prediction_head_post_conflict_robot_signal_threshold": float(
                regional_cfg.prediction_head_post_conflict_robot_signal_threshold
            ),
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


def clear_stale_runtime_published_artifacts(runtime_dir: Path) -> None:
    runtime_published_dir = runtime_dir / "published_2026"
    for filename in ("live_state_updates.json", "live_match_ledger.json", "current_snapshot.json"):
        path = runtime_published_dir / filename
        if path.exists():
            path.unlink()
    prediction_form_path = runtime_dir / PREDICTION_FORM_OBSERVATIONS_FILENAME
    if prediction_form_path.exists():
        prediction_form_path.unlink()


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
            config_path=args.config,
        )
    else:
        clear_stale_runtime_published_artifacts(args.runtime_dir)
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
