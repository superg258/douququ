from __future__ import annotations

import json
from pathlib import Path

from .fit import (
    export_ratings_snapshot,
    predict_from_artifact,
    predict_stage_from_artifact,
    predict_stage_from_published,
)


def run_predict(
    model_dir: Path,
    team_a: str,
    team_b: str,
    match_date: str,
    stage: str,
    best_of: int,
    ruleset: str,
    out_path: Path,
) -> Path:
    payload = predict_from_artifact(
        model_dir=model_dir,
        school_a=team_a,
        school_b=team_b,
        match_date=match_date,
        stage=stage,
        best_of=best_of,
        ruleset=ruleset,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def run_export_ratings(model_dir: Path, snapshot_date: str, out_path: Path, mode: str = "research") -> Path:
    return export_ratings_snapshot(model_dir, snapshot_date, out_path, mode=mode)


def run_stage_predict(
    model_dir: Path,
    team_a: str,
    team_b: str,
    match_date: str,
    mode: str,
    out_path: Path,
) -> Path:
    payload = predict_stage_from_artifact(
        model_dir=model_dir,
        school_a=team_a,
        school_b=team_b,
        match_date=match_date,
        mode=mode,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def run_published_stage_predict(
    published_dir: Path,
    team_a: str,
    team_b: str,
    match_date: str,
    mode: str,
    out_path: Path,
) -> Path:
    payload = predict_stage_from_published(
        published_dir=published_dir,
        school_a=team_a,
        school_b=team_b,
        match_date=match_date,
        mode=mode,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path
