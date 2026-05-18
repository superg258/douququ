from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

MINIMUM_PYTHON = (3, 11)
REPO_ROOT = Path(__file__).resolve().parents[2]


def _preferred_runtime_command(root: Path = REPO_ROOT) -> str:
    preferred = root / ".venv312" / "bin" / "python"
    if preferred.exists():
        return f"{preferred} -m research.trueskill2.cli"
    return "python3.12 -m research.trueskill2.cli"


def ensure_supported_runtime(
    version_info: tuple[int, int, int] | None = None,
    executable: str | None = None,
    root: Path = REPO_ROOT,
) -> None:
    current = version_info or sys.version_info[:3]
    if current >= MINIMUM_PYTHON:
        return

    python_version = ".".join(str(part) for part in current)
    command = _preferred_runtime_command(root)
    raise RuntimeError(
        "research.trueskill2.cli requires Python 3.11+ "
        f"(current: {python_version} from {executable or sys.executable}). "
        "Use the repo virtualenv instead, for example: "
        f"`{command}`."
    )


def _has_visible_nvidia_gpu() -> bool:
    try:
        result = subprocess.run(
            ["nvidia-smi", "-L"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return False
    return result.returncode == 0 and "GPU " in result.stdout


def normalize_accelerator_runtime_env(
    environ: dict[str, str] | None = None,
    *,
    has_nvidia_gpu: bool | None = None,
) -> dict[str, str]:
    env = os.environ if environ is None else environ
    nvidia_gpu_present = _has_visible_nvidia_gpu() if has_nvidia_gpu is None else has_nvidia_gpu
    if not nvidia_gpu_present:
        return {}

    changes: dict[str, str] = {}
    raw_platforms = env.get("JAX_PLATFORMS")
    if raw_platforms:
        platforms = [value.strip() for value in raw_platforms.split(",") if value.strip()]
        if "rocm" in platforms:
            filtered_platforms = [value for value in platforms if value != "rocm"]
            if not filtered_platforms:
                filtered_platforms = ["cuda"]
            env["JAX_PLATFORMS"] = ",".join(filtered_platforms)
            changes["JAX_PLATFORMS"] = env["JAX_PLATFORMS"]

    if env.get("JAX_PLATFORM_NAME") == "rocm":
        env["JAX_PLATFORM_NAME"] = "cuda"
        changes["JAX_PLATFORM_NAME"] = "cuda"

    return changes


try:
    ensure_supported_runtime()
except RuntimeError as exc:
    if __name__ == "__main__":
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc
    raise

_runtime_env_changes = normalize_accelerator_runtime_env()
if _runtime_env_changes and __name__ == "__main__":
    change_pairs = ", ".join(f"{key}={value}" for key, value in sorted(_runtime_env_changes.items()))
    print(f"Adjusted JAX runtime env for NVIDIA GPU: {change_pairs}", file=sys.stderr)

from .backtest import run_backtest
from .features import build_static_features
from .fit import run_fit
from .history_sources import build_rmul_3v3_ranking_history_frame, build_shape_history_frame
from .ingest import build_canonical_matches_dataframe, build_season_team_index, write_dataset_artifacts
from .live_archive import (
    build_archive_manifest,
    build_form_observations_from_group_rank_payload,
    load_archive_snapshot_payload,
    select_snapshot_before,
)
from .predict import run_export_ratings, run_predict, run_published_stage_predict, run_stage_predict
from .strategy_backtest import run_strategy_backtest
from .validation import run_validate_model


def _build_dataset(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    event_codes = list(args.from_events)
    canonical = build_canonical_matches_dataframe(event_codes, limit_matches=args.limit_matches)
    static_features, feature_manifest = build_static_features(canonical)
    season_team_index = build_season_team_index(canonical)
    shape_history = build_shape_history_frame()
    rmul_3v3_ranking_history = build_rmul_3v3_ranking_history_frame()
    write_dataset_artifacts(
        out_dir=out_dir,
        canonical_matches=canonical,
        school_static_features=static_features,
        season_team_index=season_team_index,
        shape_history=shape_history,
        rmul_3v3_ranking_history=rmul_3v3_ranking_history,
        feature_manifest=feature_manifest,
        limit_matches=args.limit_matches,
    )
    return 0


def _fit(args: argparse.Namespace) -> int:
    run_fit(Path(args.dataset), Path(args.config), Path(args.out))
    return 0


def _predict(args: argparse.Namespace) -> int:
    run_predict(
        model_dir=Path(args.model),
        team_a=args.team_a,
        team_b=args.team_b,
        match_date=args.match_date,
        stage=args.stage,
        best_of=int(args.best_of),
        ruleset=args.ruleset,
        out_path=Path(args.out),
    )
    return 0


def _export_ratings(args: argparse.Namespace) -> int:
    run_export_ratings(Path(args.model), args.date, Path(args.out), mode=args.mode)
    return 0


def _predict_stage(args: argparse.Namespace) -> int:
    run_stage_predict(
        model_dir=Path(args.model),
        team_a=args.team_a,
        team_b=args.team_b,
        match_date=args.match_date,
        mode=args.mode,
        out_path=Path(args.out),
    )
    return 0


def _predict_published_stage(args: argparse.Namespace) -> int:
    run_published_stage_predict(
        published_dir=Path(args.published_dir),
        team_a=args.team_a,
        team_b=args.team_b,
        match_date=args.match_date,
        mode=args.mode,
        out_path=Path(args.out),
    )
    return 0


def _backtest(args: argparse.Namespace) -> int:
    run_backtest(
        dataset_dir=Path(args.dataset),
        config_path=Path(args.config),
        scheme=args.scheme,
        out_dir=Path(args.out),
    )
    return 0


def _validate_model(args: argparse.Namespace) -> int:
    run_validate_model(
        model_dir=Path(args.model),
        dataset_dir=Path(args.dataset),
        snapshot_date=args.date,
        backtest_dir=Path(args.backtest_dir) if args.backtest_dir else None,
        out_dir=Path(args.out),
    )
    return 0


def _strategy_backtest(args: argparse.Namespace) -> int:
    run_strategy_backtest(
        preseason_path=Path(args.preseason),
        matches_path=Path(args.matches),
        form_observations_path=Path(args.form_observations) if args.form_observations else None,
        beta_perf=float(args.beta_perf),
        online_update_scale=float(args.online_update_scale),
        out_dir=Path(args.out),
    )
    return 0


def _parse_utc_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _write_table(frame: object, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = out_path.suffix.lower()
    if suffix == ".parquet":
        frame.to_parquet(out_path, index=False)
    elif suffix == ".json":
        out_path.write_text(frame.to_json(orient="records", force_ascii=False, indent=2), encoding="utf-8")
    else:
        frame.to_csv(out_path, index=False)


def _build_form_observations(args: argparse.Namespace) -> int:
    snapshot_name: str | None = None
    snapshot_age_minutes: float | None = None
    if args.group_rank:
        group_rank_path = Path(args.group_rank)
        payload = json.loads(group_rank_path.read_text(encoding="utf-8"))
        snapshot_name = group_rank_path.name
    else:
        if not args.cutoff:
            raise RuntimeError("--cutoff is required when --archive is used")
        manifest = build_archive_manifest(Path(args.archive))
        selected = select_snapshot_before(
            manifest,
            source_type="group_rank_info",
            cutoff=_parse_utc_datetime(args.cutoff),
            max_age_minutes=float(args.max_age_minutes) if args.max_age_minutes is not None else None,
        )
        if selected is None:
            raise RuntimeError("No group_rank_info snapshot satisfies the cutoff/max-age constraint")
        payload = load_archive_snapshot_payload(Path(args.archive), selected)
        snapshot_name = selected.member_name
        snapshot_age_minutes = selected.age_minutes

    observations = build_form_observations_from_group_rank_payload(
        payload,
        snapshot_name=snapshot_name,
        snapshot_age_minutes=snapshot_age_minutes,
    )
    _write_table(observations, Path(args.out))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RMUC/RMUL hierarchical Bayesian TrueSkill2-style research CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_dataset = subparsers.add_parser("build-dataset", help="Build canonical research dataset artifacts")
    build_dataset.add_argument("--from", dest="from_events", nargs="+", required=True)
    build_dataset.add_argument("--out", required=True)
    build_dataset.add_argument("--limit-matches", type=int, default=None)
    build_dataset.set_defaults(func=_build_dataset)

    fit = subparsers.add_parser("fit", help="Fit Bayesian model and materialize posterior artifacts")
    fit.add_argument("--dataset", required=True)
    fit.add_argument("--config", required=True)
    fit.add_argument("--out", required=True)
    fit.set_defaults(func=_fit)

    predict = subparsers.add_parser("predict", help="Predict a future match probability from a fitted model")
    predict.add_argument("--model", required=True)
    predict.add_argument("--team-a", required=True)
    predict.add_argument("--team-b", required=True)
    predict.add_argument("--match-date", required=True)
    predict.add_argument("--stage", required=True)
    predict.add_argument("--best-of", required=True, type=int)
    predict.add_argument("--ruleset", required=True)
    predict.add_argument("--out", required=True)
    predict.set_defaults(func=_predict)

    predict_regional_pre = subparsers.add_parser("predict-rmuc-regional-pre", help="Predict RMUC regional pre-match probability")
    predict_regional_pre.add_argument("--model", required=True)
    predict_regional_pre.add_argument("--team-a", required=True)
    predict_regional_pre.add_argument("--team-b", required=True)
    predict_regional_pre.add_argument("--match-date", required=True)
    predict_regional_pre.add_argument("--out", required=True)
    predict_regional_pre.set_defaults(func=_predict_stage, mode="rmuc_regional_pre")

    predict_regional_live = subparsers.add_parser("predict-rmuc-regional-live", help="Predict RMUC regional live-stage probability")
    predict_regional_live.add_argument("--model", required=True)
    predict_regional_live.add_argument("--team-a", required=True)
    predict_regional_live.add_argument("--team-b", required=True)
    predict_regional_live.add_argument("--match-date", required=True)
    predict_regional_live.add_argument("--out", required=True)
    predict_regional_live.set_defaults(func=_predict_stage, mode="rmuc_regional_live")

    predict_repechage = subparsers.add_parser("predict-rmuc-repechage", help="Predict RMUC repechage-stage probability")
    predict_repechage.add_argument("--model", required=True)
    predict_repechage.add_argument("--team-a", required=True)
    predict_repechage.add_argument("--team-b", required=True)
    predict_repechage.add_argument("--match-date", required=True)
    predict_repechage.add_argument("--out", required=True)
    predict_repechage.set_defaults(func=_predict_stage, mode="rmuc_repechage")

    predict_nationals = subparsers.add_parser("predict-rmuc-nationals", help="Predict RMUC nationals-stage probability")
    predict_nationals.add_argument("--model", required=True)
    predict_nationals.add_argument("--team-a", required=True)
    predict_nationals.add_argument("--team-b", required=True)
    predict_nationals.add_argument("--match-date", required=True)
    predict_nationals.add_argument("--out", required=True)
    predict_nationals.set_defaults(func=_predict_stage, mode="rmuc_nationals")

    predict_published = subparsers.add_parser("predict-from-published", help="Predict from published formal Elo artifacts")
    predict_published.add_argument("--published-dir", required=True)
    predict_published.add_argument("--team-a", required=True)
    predict_published.add_argument("--team-b", required=True)
    predict_published.add_argument("--match-date", required=True)
    predict_published.add_argument(
        "--mode",
        required=True,
        choices=["rmuc_regional_pre", "rmuc_regional_live", "rmuc_repechage", "rmuc_nationals"],
    )
    predict_published.add_argument("--out", required=True)
    predict_published.set_defaults(func=_predict_published_stage)

    export = subparsers.add_parser("export-ratings", help="Export a rating snapshot at a specific date")
    export.add_argument("--model", required=True)
    export.add_argument("--date", required=True)
    export.add_argument("--out", required=True)
    export.add_argument("--mode", choices=["research", "published"], default="research")
    export.set_defaults(func=_export_ratings)

    backtest = subparsers.add_parser("backtest", help="Run rolling-origin backtests")
    backtest.add_argument("--dataset", required=True)
    backtest.add_argument("--config", required=True)
    backtest.add_argument("--scheme", required=True)
    backtest.add_argument("--out", required=True)
    backtest.set_defaults(func=_backtest)

    validate = subparsers.add_parser("validate-model", help="Generate final rating snapshot, baseline compare, and validation report")
    validate.add_argument("--model", required=True)
    validate.add_argument("--dataset", required=True)
    validate.add_argument("--date", required=True)
    validate.add_argument("--backtest-dir", required=False)
    validate.add_argument("--out", required=True)
    validate.set_defaults(func=_validate_model)

    strategy = subparsers.add_parser("strategy-backtest", help="Compare TS2 season-delta update strategy variants")
    strategy.add_argument("--preseason", required=True)
    strategy.add_argument("--matches", required=True)
    strategy.add_argument("--form-observations", required=False)
    strategy.add_argument("--beta-perf", required=True, type=float)
    strategy.add_argument("--online-update-scale", type=float, default=0.50)
    strategy.add_argument("--out", required=True)
    strategy.set_defaults(func=_strategy_backtest)

    form = subparsers.add_parser("build-form-observations", help="Build season-delta form observations from live group-rank snapshots")
    form_source = form.add_mutually_exclusive_group(required=True)
    form_source.add_argument("--group-rank", required=False, help="Path to a group_rank_info JSON payload")
    form_source.add_argument("--archive", required=False, help="Path to raw_data.tar.gz with timestamped live snapshots")
    form.add_argument("--cutoff", required=False, help="UTC cutoff for archive snapshot selection, e.g. 2026-05-13T01:45:00Z")
    form.add_argument("--max-age-minutes", type=float, default=None)
    form.add_argument("--out", required=True)
    form.set_defaults(func=_build_form_observations)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
