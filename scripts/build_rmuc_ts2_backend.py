#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"
DEFAULT_MODEL_DIR = ROOT / "runs" / "ts2" / "fit_20260417_full"
DEFAULT_SNAPSHOT_DATE = "2026-04-05"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from research.trueskill2.fit import export_ratings_snapshot, load_model_artifact  # noqa: E402
from research.trueskill2.ingest import school_key  # noqa: E402

SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_elo as legacy_elo  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export stable TS2 backend artifacts.")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--snapshot-date", default=DEFAULT_SNAPSHOT_DATE)
    parser.add_argument("--out-dir", type=Path, default=DERIVED_DIR)
    parser.add_argument("--snapshot-kind", choices=["preseason"], default="preseason")
    return parser.parse_args()


def _load_participants() -> list[dict[str, str]]:
    path = ROOT / "data" / "reference" / "2026_regionals" / "participants_1912.csv"
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def make_team_key(college_name: str, team_name: str) -> str:
    return legacy_elo.make_team_key(college_name, team_name)


def build_backend_export(
    *,
    model_dir: Path,
    snapshot_date: str,
    out_dir: Path,
    snapshot_kind: str,
) -> dict[str, Path]:
    if snapshot_kind != "preseason":
        raise ValueError(f"Unsupported snapshot_kind: {snapshot_kind}")

    artifact = load_model_artifact(model_dir)
    report = artifact["report"]
    rating_scale = float(report.get("rating_scale", 120.0))
    beta_perf = float(artifact["posterior"]["beta_perf"].mean())

    with tempfile.TemporaryDirectory(prefix="ts2_backend_export_") as tmp_dir:
        snapshot_path = Path(tmp_dir) / "snapshot.parquet"
        export_ratings_snapshot(model_dir, snapshot_date, snapshot_path, mode="research")
        pd = __import__("pandas")
        snapshot = pd.read_parquet(snapshot_path)

    snapshot_rows = {
        str(row["school_key"]): row
        for row in snapshot.to_dict(orient="records")
        if bool(row.get("is_rmuc_2026_team"))
    }

    export_rows: list[dict[str, Any]] = []
    for participant in _load_participants():
        key = school_key(participant["college_name"])
        snapshot_row = snapshot_rows.get(key)
        if snapshot_row is None:
            raise ValueError(f"Missing TS2 snapshot row for school_key={key}")
        college_name = legacy_elo.normalize_school(participant["college_name"])
        team_name = legacy_elo.normalize_team(participant["team_name_2026"])
        export_rows.append(
            {
                "team_key": make_team_key(college_name, team_name),
                "school_key": key,
                "college_name": college_name,
                "team_name": team_name,
                "preferred_region": participant["preferred_region"],
                "admitted_region": participant["admitted_region"],
                "seed_rank_in_region": int(participant["seed_rank_in_region"]),
                "seed_tier": participant["seed_tier"],
                "ranking_source": participant["ranking_source"],
                "ranking_global_rank": int(participant["ranking_global_rank"]),
                "ranking_score": float(participant["ranking_score"]),
                "shape_rank": int(snapshot_row["shape_rank"]) if snapshot_row["shape_rank"] == snapshot_row["shape_rank"] else "",
                "program_base_theta": float(snapshot_row["rmuc_long_term_base_theta_mean"]),
                "prior_delta_theta": float(snapshot_row["regional_prior_delta_theta"]),
                "regional_pre_theta": float(snapshot_row["rmuc_regional_pre_theta"]),
                "regional_pre_rating": float(snapshot_row["rmuc_regional_pre_rating"]),
                "pre_signal_sd_theta": float(snapshot_row["pre_signal_sd"]),
                "pre_signal_sd_rating": float(rating_scale * float(snapshot_row["pre_signal_sd"])),
                "rmuc_history_strength": float(snapshot_row["rmuc_history_strength"]),
                "beta_perf": float(beta_perf),
                "mu0": float(snapshot_row["rmuc_regional_pre_rating"]),
                "sigma0": float(rating_scale * float(snapshot_row["pre_signal_sd"])),
            }
        )

    export_rows.sort(
        key=lambda row: (
            row["admitted_region"],
            int(row["seed_rank_in_region"]),
            row["college_name"],
            row["team_name"],
        )
    )

    csv_path = out_dir / "preseason_ratings.csv"
    manifest_path = out_dir / "model_manifest.json"
    fieldnames = [
        "team_key",
        "school_key",
        "college_name",
        "team_name",
        "preferred_region",
        "admitted_region",
        "seed_rank_in_region",
        "seed_tier",
        "ranking_source",
        "ranking_global_rank",
        "ranking_score",
        "shape_rank",
        "program_base_theta",
        "prior_delta_theta",
        "regional_pre_theta",
        "regional_pre_rating",
        "pre_signal_sd_theta",
        "pre_signal_sd_rating",
        "rmuc_history_strength",
        "beta_perf",
        "mu0",
        "sigma0",
    ]
    _write_csv(csv_path, export_rows, fieldnames)
    _write_json(
        manifest_path,
        {
            "snapshot_kind": snapshot_kind,
            "snapshot_date": snapshot_date,
            "source_model_dir": str(model_dir),
            "rating_scale": rating_scale,
            "beta_perf": beta_perf,
            "team_count": len(export_rows),
            "generated_at": datetime.now(tz=UTC).isoformat(),
            "ratings_csv_path": str(csv_path),
        },
    )
    return {"ratings_csv_path": csv_path, "manifest_path": manifest_path}


def main() -> None:
    args = parse_args()
    outputs = build_backend_export(
        model_dir=args.model_dir,
        snapshot_date=args.snapshot_date,
        out_dir=args.out_dir,
        snapshot_kind=args.snapshot_kind,
    )
    print(outputs["ratings_csv_path"])
    print(outputs["manifest_path"])


if __name__ == "__main__":
    main()
