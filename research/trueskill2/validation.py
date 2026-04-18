from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from .fit import export_published_rating_artifacts, export_ratings_snapshot
from .ingest import RMUL_FINAL_DATE, require_dataframe_deps


ROOT = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def load_legacy_outputs() -> dict[str, Any]:
    import sys

    scripts_dir = ROOT / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import build_rmuc_elo as legacy_elo  # noqa: E402

    return legacy_elo.build_outputs()


def legacy_baseline_metrics(split_name: str) -> dict[str, Any]:
    evaluations = load_legacy_outputs()["evaluation_summary"]["evaluations"]
    if split_name == "2024_to_2025":
        key = "rmuc_2025_dynamic_school_elo_v4_balance_adjusted"
    else:
        key = "rmul_2026_dynamic_school_elo_v4_balance_adjusted"
    baseline = dict(evaluations[key])
    baseline["source_key"] = key
    baseline["note"] = "legacy summary baseline from build_rmuc_elo evaluation_summary"
    return baseline


def build_baseline_intersection_compare(snapshot_path: Path, out_path: Path) -> Path:
    pd, _ = require_dataframe_deps()
    new_snapshot = pd.read_parquet(snapshot_path).copy()
    new_snapshot = new_snapshot[new_snapshot["is_rmuc_2026_team"].fillna(False)].copy()
    legacy = pd.read_csv(ROOT / "data" / "derived" / "2026_rmuc_elo" / "preseason_ratings.csv")
    compare = new_snapshot.merge(
        legacy[["school_key", "college_name", "mu0", "sigma0"]],
        on="school_key",
        how="inner",
    ).rename(
        columns={
            "college_name": "old_college_name",
            "mu0": "old_mu",
            "sigma0": "old_sigma",
            "rmuc_regional_pre_theta": "new_theta",
            "rmuc_regional_pre_rating": "new_rating_1500",
            "rmuc_regional_pre_rank_96": "new_rank",
        }
    )
    old_rank_map = {
        row["school_key"]: index
        for index, row in enumerate(
            legacy.sort_values(["mu0", "school_key"], ascending=[False, True], kind="stable").to_dict(orient="records"),
            start=1,
        )
    }
    compare = compare.sort_values(["new_rating_1500", "school_key"], ascending=[False, True], kind="stable").reset_index(drop=True)
    compare["old_rating_1500"] = 1500.0 + (120.0 * compare["old_mu"])
    compare["old_rank"] = compare["school_key"].map(old_rank_map).astype(int)
    compare["new_rank"] = compare["new_rank"].astype(int)
    compare["rank_diff"] = compare["new_rank"] - compare["old_rank"]
    compare["score_diff"] = compare["new_rating_1500"] - compare["old_rating_1500"]
    rank_shift_threshold = int(max(10, np.quantile(np.abs(compare["rank_diff"]), 0.9))) if len(compare) else 10
    compare["large_rank_shift_flag"] = np.abs(compare["rank_diff"]) >= rank_shift_threshold
    compare["coverage_label"] = "intersection_compare_set"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    compare.to_parquet(out_path, index=False)
    compare.to_csv(out_path.with_suffix(".csv"), index=False)
    out_path.with_suffix(".json").write_text(compare.to_json(orient="records", force_ascii=False, indent=2), encoding="utf-8")
    return out_path


def _render_table(frame: Any, columns: list[str], limit: int) -> str:
    subset = frame.head(limit)
    if subset.empty:
        return "_None_"
    lines = ["| " + " | ".join(columns) + " |", "| " + " | ".join(["---"] * len(columns)) + " |"]
    for row in subset[columns].to_dict(orient="records"):
        values = []
        for column in columns:
            value = row[column]
            if isinstance(value, float):
                values.append(f"{value:.3f}")
            else:
                values.append(str(value))
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def write_validation_report(
    snapshot_path: Path,
    compare_path: Path,
    backtest_dir: Path | None,
    out_path: Path,
) -> Path:
    pd, _ = require_dataframe_deps()
    snapshot = pd.read_parquet(snapshot_path)
    compare = pd.read_parquet(compare_path)
    backtest_report = None
    if backtest_dir is not None and (backtest_dir / "backtest_report.json").exists():
        backtest_report = json.loads((backtest_dir / "backtest_report.json").read_text(encoding="utf-8"))

    middle_start = max(0, (len(snapshot) // 2) - 10)
    mid_table = snapshot.iloc[middle_start : middle_start + 20].copy()
    tail = snapshot.sort_values(["rating_rank"], ascending=False, kind="stable").head(20)
    regional_pre = (
        snapshot[snapshot["is_rmuc_2026_team"].fillna(False)]
        .sort_values(["rmuc_regional_pre_rank_96", "school_key"], kind="stable")
        .reset_index(drop=True)
    )
    regional_live = (
        snapshot[snapshot["is_rmuc_2026_team"].fillna(False)]
        .sort_values(["rmuc_regional_live_rank_96", "school_key"], kind="stable")
        .reset_index(drop=True)
    )
    high_uncertainty = snapshot.sort_values(["theta_interval_width", "rating_rank"], ascending=[False, True], kind="stable").head(20)
    reference_only = snapshot[snapshot["has_reference_only"]].sort_values(["rating_rank"], kind="stable")
    large_shift = compare.sort_values(["rank_diff"], key=lambda s: np.abs(s), ascending=False, kind="stable").head(20)

    split_lines = []
    if backtest_report:
        for split in backtest_report["splits"]:
            baseline = split.get("baseline", {})
            split_lines.append(
                f"- `{split['name']}`: new log_loss={split['log_loss']:.4f}, brier={split['brier']:.4f}, ece={split['ece']:.4f}; "
                f"legacy log_loss={baseline.get('log_loss')}, brier={baseline.get('brier')}, note={baseline.get('note', 'n/a')}"
            )
    else:
        split_lines.append("- 未提供 backtest 结果，本报告未包含滚动回测对照。")

    report = f"""# 2026RMUL 后全学校评分验证报告

## 评分口径
- 截止时间：`{RMUL_FINAL_DATE}`
- 学校全集：`{len(snapshot)}` 校
- 正式评分字段：`theta_mean/theta_sd/q05/q50/q95` + `rating_1500_mean/q05/q95`
- `rating_1500 = 1500 + 120 * theta`
- `RMUC program base`：`rmuc_long_term_base_theta_mean/rating`，由学校层 + 历史 RMUC 赛季聚合构成；`2024` 作为最后一年有效赛季只保留终末弱残余。
- `同年区域赛证据分`：由 `shape_evidence + rmul_finish_evidence + rmul_station_calibration` 组成，并中心化为 `evidence_score_centered`；它只服务于区域赛前排序。
- `区域赛前先验偏移量`：`regional_prior_delta_theta/rating`，由 `evidence_score_centered` 经历史强度限幅后得到；它不进入长期 Elo/base。
- `RMUC live-state`：`rmuc_live_state_theta_mean/rating`，表示相对区域赛前起点，由 `2026RMUC` 正式比赛带来的状态增量。
- 当前阶段预测已拆分：`regional_pre = B + prior_delta`，`regional_live = B + rmuc_live_state + decayed_prior_delta`，`repechage/nationals = B + rmuc_live_state`。
- 正式发布 Elo 工件与研究快照分离：
  - 研究快照：`ratings_snapshot_2026rmul_final.*`
  - 正式发布：`published_2026/*`
  - 跨年结转：`published_2027/carryover_seed.*`

## 全校评分总览
- `state_posterior`: `{int((snapshot['rating_source_level'] == 'state_posterior').sum())}` 校
- `school_prior_posterior`: `{int((snapshot['rating_source_level'] == 'school_prior_posterior').sum())}` 校
- `reference_only`: `{int(snapshot['has_reference_only'].sum())}` 校
- `high_uncertainty_flag`: `{int(snapshot['high_uncertainty_flag'].sum())}` 校

## Top 20
{_render_table(snapshot.sort_values(['rating_rank'], kind='stable'), ['rating_rank', 'school_name', 'rating_1500_mean', 'theta_mean', 'theta_sd', 'rating_source_level'], 20)}

## 区域赛前 96 校 Top 20
{_render_table(regional_pre, ['rmuc_regional_pre_rank_96', 'school_name', 'rmuc_long_term_base_rating', 'regional_prior_delta_rating', 'regional_pre_offset_rating', 'rmuc_regional_pre_rating'], 20)}

## 区域赛进行中 96 校 Top 20
{_render_table(regional_live, ['rmuc_regional_live_rank_96', 'school_name', 'rmuc_long_term_base_rating', 'rmuc_live_state_rating', 'regional_live_pre_residual_rating', 'rmuc_regional_live_rating'], 20)}

## Mid-table
{_render_table(mid_table, ['rating_rank', 'school_name', 'rating_1500_mean', 'theta_mean', 'theta_sd', 'rating_source_level'], 20)}

## Tail 20
{_render_table(tail, ['rating_rank', 'school_name', 'rating_1500_mean', 'theta_mean', 'theta_sd', 'rating_source_level'], 20)}

## 交集学校对照
- `intersection_compare_set`: `{len(compare)}`
- `new_model_only_reference_set`: `{int((~snapshot['school_key'].isin(compare['school_key'])).sum())}`
- `historical_only_set`: `0`
{_render_table(large_shift, ['school_name', 'old_mu', 'old_sigma', 'new_theta', 'new_rating_1500', 'rank_diff'], 20)}

## 长期基础分拆解
{_render_table(regional_pre, ['rmuc_regional_pre_rank_96', 'school_name', 'rmuc_long_term_school_component_mean', 'rmuc_long_term_recent_season_component_mean', 'rmuc_long_term_terminal_season_component_mean', 'rmuc_terminal_season_weight', 'rmuc_history_strength', 'recent_evidence_support', 'rmuc_long_term_base_rating'], 20)}

## 同年区域赛先验拆解
{_render_table(regional_pre, ['rmuc_regional_pre_rank_96', 'school_name', 'shape_evidence_theta', 'rmul_finish_evidence_theta', 'rmul_station_calibration_theta', 'evidence_score_centered', 'prior_delta_cap_theta', 'regional_prior_delta_rating'], 20)}

## 参考学校但无比赛历史
{_render_table(reference_only, ['rating_rank', 'school_name', 'rating_1500_mean', 'theta_mean', 'theta_sd'], 20)}

## 高不确定性学校
{_render_table(high_uncertainty, ['rating_rank', 'school_name', 'theta_interval_width', 'theta_sd', 'rating_source_level'], 20)}

## 心理预期校验位
- 强校是否在合理区间：优先检查 `Top 20` 是否出现明显不符合直觉的学校。
- 中游学校是否拥挤：查看 `Mid-table` 的 `rating_1500_mean` 是否过度压缩。
- 明显违和学校列表：优先审查 `large_rank_shift_flag = true` 的交集学校，以及 `regional_pre` 排名与长期基础分明显背离的学校。

## 回测与旧模型摘要
{chr(10).join(split_lines)}

## 未完成项
- 第二阶段需要把 `predict` 区分为 `predict-neutral` 和 `predict-contextual`。
- 当前 `rmuc_live_state` 仍是导出层语义修复版，底层 NumPyro 主模型尚未拆出 RMUC-only 独立状态轴。
- 当前 `prior` 是“同年证据分 -> 限幅偏移”的导出层语义，不是主模型里的独立潜变量轴；真正进入排名的是 `regional_prior_delta / regional_pre_offset`。
- 当前回测里的旧模型部分是 `build_rmuc_elo` 产出的摘要基线，不是逐场重放版。
"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    return out_path


def run_validate_model(
    model_dir: Path,
    dataset_dir: Path,
    snapshot_date: str,
    out_dir: Path,
    backtest_dir: Path | None = None,
) -> dict[str, Path]:
    del dataset_dir
    pd, _ = require_dataframe_deps()
    out_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = out_dir / "ratings_snapshot_2026rmul_final.parquet"
    compare_path = out_dir / "baseline_intersection_compare.parquet"
    report_path = out_dir / "model_validation_2026rmul_final.md"
    ranking_path = out_dir / "rmuc_regional_pre_ranking_96.csv"
    live_ranking_path = out_dir / "rmuc_regional_live_ranking_96.csv"
    human_review_path = out_dir / "rmuc_regional_pre_ranking_96_human_review.csv"
    export_ratings_snapshot(model_dir, snapshot_date, snapshot_path)
    published_dir = out_dir / f"published_{int(snapshot_date[:4])}"
    published_outputs = export_published_rating_artifacts(model_dir, snapshot_date, published_dir)
    regional_snapshot = pd.read_parquet(snapshot_path)
    regional_pre = (
        regional_snapshot
        .query("is_rmuc_2026_team == True")
        .sort_values(["rmuc_regional_pre_rank_96", "school_key"], kind="stable")
        .reset_index(drop=True)
    )
    regional_pre.to_csv(ranking_path, index=False)
    regional_live = (
        regional_snapshot
        .query("is_rmuc_2026_team == True")
        .sort_values(["rmuc_regional_live_rank_96", "school_key"], kind="stable")
        .reset_index(drop=True)
    )
    regional_live.to_csv(live_ranking_path, index=False)
    regional_pre[
        [
            "rmuc_regional_pre_rank_96",
            "school_name",
            "rmuc_long_term_base_rating",
            "shape_prior_signal",
            "rmul_ranking_signal",
            "regional_prior_score_rating",
            "regional_pre_blend_lambda",
            "regional_pre_offset_rating",
            "regional_pre_decay_factor",
            "rmuc_regional_pre_rating",
        ]
    ].to_csv(human_review_path, index=False)
    build_baseline_intersection_compare(snapshot_path, compare_path)
    write_validation_report(snapshot_path, compare_path, backtest_dir, report_path)
    return {
        "snapshot_path": snapshot_path,
        "ranking_path": ranking_path,
        "live_ranking_path": live_ranking_path,
        "human_review_path": human_review_path,
        "compare_path": compare_path,
        "report_path": report_path,
        **published_outputs,
    }
