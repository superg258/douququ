from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .backtest import run_backtest
from .features import build_static_features
from .fit import run_fit
from .history_sources import build_rmul_3v3_ranking_history_frame, build_shape_history_frame
from .ingest import build_canonical_matches_dataframe, build_season_team_index, write_dataset_artifacts
from .predict import run_export_ratings, run_predict, run_published_stage_predict, run_stage_predict
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
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
