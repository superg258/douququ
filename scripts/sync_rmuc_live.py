#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize official RMUC live schedule data into runtime artifacts.")
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--base-published-dir", type=Path, default=DEFAULT_BASE_PUBLISHED_DIR)
    parser.add_argument("--preseason-ratings", type=Path, default=DEFAULT_PRESEASON_RATINGS)
    parser.add_argument("--snapshot-date", default=datetime.now(tz=UTC).date().isoformat())
    parser.add_argument("--skip-fetch", action="store_true", help="Use existing raw schedule.json instead of fetching upstream.")
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


def write_raw_snapshot(raw_dir: Path, name: str, payload: dict[str, Any], fetched_at: datetime) -> None:
    safe_timestamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
    write_json_atomic(raw_dir / f"{name}.json", payload)
    write_json_atomic(raw_dir / f"{name}.{safe_timestamp}.json", payload)


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
    print(json.dumps({"sourceStatus": normalized.get("sourceStatus"), "reason": normalized.get("reason")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
