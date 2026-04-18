from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .fit import predict_from_artifact, run_fit
from .ingest import read_dataset, require_dataframe_deps
from .validation import legacy_baseline_metrics


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def rolling_origin_splits(matches: Any) -> list[dict[str, Any]]:
    splits: list[dict[str, Any]] = []
    season_2025_test = matches[matches["season"] == 2025]
    season_2025_train = matches[matches["season"] < 2025]
    if not season_2025_train.empty and not season_2025_test.empty:
        splits.append({"name": "2024_to_2025", "train": season_2025_train, "test": season_2025_test})

    season_2026_test = matches[matches["season"] == 2026]
    season_2026_train = matches[matches["season"] <= 2025]
    if not season_2026_train.empty and not season_2026_test.empty:
        splits.append({"name": "2024_2025_to_2026", "train": season_2026_train, "test": season_2026_test})

    season_2026_all = matches[matches["season"] == 2026].sort_values(["match_date", "match_id"], kind="stable")
    if len(season_2026_all) >= 4:
        midpoint = len(season_2026_all) // 2
        train = matches[matches["season"] < 2026]
        train = pd_concat(train, season_2026_all.iloc[:midpoint])
        test = season_2026_all.iloc[midpoint:]
        if not train.empty and not test.empty:
            splits.append({"name": "2026_rolling_half", "train": train, "test": test})
    return splits


def pd_concat(left: Any, right: Any) -> Any:
    pd, _ = require_dataframe_deps()
    return pd.concat([left, right], ignore_index=True)


def _auc(probabilities: list[float], outcomes: list[int]) -> float:
    positives = sum(outcomes)
    negatives = len(outcomes) - positives
    if positives == 0 or negatives == 0:
        return 0.5
    ranked = sorted(zip(probabilities, outcomes), key=lambda item: item[0])
    rank_sum = 0.0
    for idx, (_, outcome) in enumerate(ranked, start=1):
        if outcome == 1:
            rank_sum += idx
    return (rank_sum - (positives * (positives + 1) / 2.0)) / (positives * negatives)


def _ece(probabilities: list[float], outcomes: list[int], bins: int = 10) -> tuple[float, list[dict[str, Any]]]:
    bucket_rows = []
    total = len(probabilities)
    ece = 0.0
    for idx in range(bins):
        low = idx / bins
        high = (idx + 1) / bins
        items = [
            (prob, outcome)
            for prob, outcome in zip(probabilities, outcomes, strict=True)
            if (low <= prob < high) or (idx == bins - 1 and prob == 1.0)
        ]
        if not items:
            bucket_rows.append({"bin": idx, "count": 0, "pred_mean": None, "obs_mean": None})
            continue
        pred_mean = float(sum(item[0] for item in items) / len(items))
        obs_mean = float(sum(item[1] for item in items) / len(items))
        ece += (len(items) / total) * abs(pred_mean - obs_mean)
        bucket_rows.append({"bin": idx, "count": len(items), "pred_mean": pred_mean, "obs_mean": obs_mean})
    return ece, bucket_rows


def run_backtest(dataset_dir: Path, config_path: Path, scheme: str, out_dir: Path) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    dataset = read_dataset(dataset_dir)
    if scheme != "rolling_origin":
        raise ValueError(f"Unsupported scheme: {scheme}")
    splits = rolling_origin_splits(dataset["canonical_matches"])

    config = dataset["feature_manifest"]  # placeholder to ensure dataset loaded before temp writes
    del config

    split_reports = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for split in splits:
        split_name = split["name"]
        split_dir = out_dir / split_name
        train_dataset_dir = split_dir / "dataset"
        model_dir = split_dir / "model"
        train_dataset_dir.mkdir(parents=True, exist_ok=True)

        split["train"].to_parquet(train_dataset_dir / "canonical_matches.parquet", index=False)
        dataset["school_static_features"].to_parquet(train_dataset_dir / "school_static_features.parquet", index=False)
        dataset["season_team_index"].to_parquet(train_dataset_dir / "season_team_index.parquet", index=False)
        dataset["shape_history"].to_parquet(train_dataset_dir / "shape_history.parquet", index=False)
        dataset["rmul_3v3_ranking_history"].to_parquet(train_dataset_dir / "rmul_3v3_ranking_history.parquet", index=False)
        (train_dataset_dir / "feature_manifest.json").write_text(
            json.dumps(dataset["feature_manifest"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (train_dataset_dir / "dataset_manifest.json").write_text(
            json.dumps(
                {
                    **dataset["manifest"],
                    "match_count": int(len(split["train"])),
                    "canonical_matches_path": str(train_dataset_dir / "canonical_matches.parquet"),
                    "school_static_features_path": str(train_dataset_dir / "school_static_features.parquet"),
                    "season_team_index_path": str(train_dataset_dir / "season_team_index.parquet"),
                    "shape_history_path": str(train_dataset_dir / "shape_history.parquet"),
                    "rmul_3v3_ranking_history_path": str(train_dataset_dir / "rmul_3v3_ranking_history.parquet"),
                    "feature_manifest_path": str(train_dataset_dir / "feature_manifest.json"),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        run_fit(train_dataset_dir, config_path, model_dir)

        probabilities: list[float] = []
        outcomes: list[int] = []
        prediction_rows = []
        for row in split["test"].to_dict(orient="records"):
            payload = predict_from_artifact(
                model_dir=model_dir,
                school_a=row["red_school_key"],
                school_b=row["blue_school_key"],
                match_date=row["match_date"],
                stage=row["stage_id"],
                best_of=int(row["best_of"]),
                ruleset=row["ruleset_id"],
            )
            p_red = float(payload["p_red_win"])
            outcome = 1 if row["winner_side"] == "red" else 0
            probabilities.append(p_red)
            outcomes.append(outcome)
            prediction_rows.append(
                {
                    "match_id": row["match_id"],
                    "p_red_win": p_red,
                    "p_blue_win": 1.0 - p_red,
                    "outcome": outcome,
                    "split_name": split_name,
                }
            )
        prediction_frame = pd.DataFrame.from_records(prediction_rows)
        prediction_frame.to_parquet(split_dir / "match_predictions.parquet", index=False)
        log_losses = [
            -(outcome * math.log(max(prob, 1e-9)) + ((1 - outcome) * math.log(max(1.0 - prob, 1e-9))))
            for prob, outcome in zip(probabilities, outcomes, strict=True)
        ]
        briers = [(prob - outcome) ** 2 for prob, outcome in zip(probabilities, outcomes, strict=True)]
        ece, calibration_bins = _ece(probabilities, outcomes)
        split_reports.append(
            {
                "name": split_name,
                "train_matches": int(len(split["train"])),
                "test_matches": int(len(split["test"])),
                "log_loss": float(sum(log_losses) / len(log_losses)),
                "brier": float(sum(briers) / len(briers)),
                "auc": float(_auc(probabilities, outcomes)),
                "ece": float(ece),
                "baseline": legacy_baseline_metrics(split_name),
                "calibration_bins": calibration_bins,
            }
        )

    report = {
        "created_at": datetime.now(tz=UTC).isoformat(),
        "scheme": scheme,
        "splits": split_reports,
    }
    _save_json(out_dir / "backtest_report.json", report)
    return report
