from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import numpy as np
import yaml

from research.trueskill2 import cli as trueskill2_cli
from research.trueskill2.history_sources import RegionalPreModelConfig
from research.trueskill2.regional_pre import (
    _augment_same_year_rank_targets,
    _load_lagged_station_score_map_for_season,
    _build_rmul_station_strength_summary,
    _compute_regional_outcome_strength_theta,
    _regional_group_decay_factor,
    _shape_bucket_widths,
    _shape_construct_score,
    apply_station_calibration,
    build_regional_prior_feature_matrix,
    build_evidence_score,
    build_rmul_finish_evidence,
    build_shape_evidence,
    compute_regional_prior_runtime_components,
    _shrunk_residual_delta_theta,
    build_regional_prior_training_samples,
    compute_regional_pre_blend_lambda,
    compute_regional_same_year_signal,
    interpolate_regional_pre_theta,
    map_evidence_to_prior_delta,
    compute_history_context,
)
from research.trueskill2.fit import (
    _split_recent_season_values,
    _build_rmuc_long_term_base_snapshot,
    build_published_preseason_snapshot,
    compute_published_rating,
    build_published_live_state_updates,
    calibrate_online_live_update_scale,
    build_carryover_seed_snapshot,
)


ROOT = Path(__file__).resolve().parents[1]


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "research.trueskill2.cli", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )


class TrueSkill2ResearchTests(unittest.TestCase):
    def test_cli_exposes_runtime_guard(self) -> None:
        self.assertTrue(callable(getattr(trueskill2_cli, "ensure_supported_runtime", None)))

    def test_cli_runtime_guard_recommends_repo_venv_for_old_python(self) -> None:
        guard = getattr(trueskill2_cli, "ensure_supported_runtime", None)
        self.assertTrue(callable(guard))
        with self.assertRaises(RuntimeError) as ctx:
            guard(version_info=(3, 10, 12), executable="/usr/bin/python3")

        message = str(ctx.exception)
        self.assertIn("Python 3.11+", message)
        self.assertIn(".venv312/bin/python", message)
        self.assertIn("research.trueskill2.cli", message)

    def test_cli_normalizes_rocm_platforms_for_nvidia_gpu(self) -> None:
        normalize = getattr(trueskill2_cli, "normalize_accelerator_runtime_env", None)
        self.assertTrue(callable(normalize))
        env = {"JAX_PLATFORMS": "rocm,cuda,cpu", "JAX_PLATFORM_NAME": "rocm"}

        changes = normalize(env, has_nvidia_gpu=True)

        self.assertEqual(env["JAX_PLATFORMS"], "cuda,cpu")
        self.assertEqual(env["JAX_PLATFORM_NAME"], "cuda")
        self.assertEqual(changes["JAX_PLATFORMS"], "cuda,cpu")
        self.assertEqual(changes["JAX_PLATFORM_NAME"], "cuda")

    def test_cli_keeps_non_rocm_platforms_unchanged(self) -> None:
        normalize = getattr(trueskill2_cli, "normalize_accelerator_runtime_env", None)
        self.assertTrue(callable(normalize))
        env = {"JAX_PLATFORMS": "cuda,cpu", "JAX_PLATFORM_NAME": "cuda"}

        changes = normalize(env, has_nvidia_gpu=True)

        self.assertEqual(changes, {})
        self.assertEqual(env["JAX_PLATFORMS"], "cuda,cpu")
        self.assertEqual(env["JAX_PLATFORM_NAME"], "cuda")

    def test_shape_bucket_widths_are_front_wide_back_narrow(self) -> None:
        widths = _shape_bucket_widths(96)
        self.assertEqual(sum(widths), 96)
        self.assertGreater(widths[0], widths[-1])
        self.assertTrue(all(left >= right for left, right in zip(widths, widths[1:])))

    def test_shape_construct_score_is_monotonic_and_tail_penalty_steepens(self) -> None:
        top_4 = _shape_construct_score(4, 96)
        top_10 = _shape_construct_score(10, 96)
        mid_16 = _shape_construct_score(16, 96)
        tail_78 = _shape_construct_score(78, 96)
        tail_90 = _shape_construct_score(90, 96)
        tail_96 = _shape_construct_score(96, 96)
        self.assertGreater(top_4, top_10)
        self.assertGreater(top_10, mid_16)
        self.assertGreater(mid_16, tail_78)
        self.assertGreater(tail_78, tail_90)
        self.assertGreater(tail_90, tail_96)
        self.assertGreater((top_4 - top_10) / 6.0, 0.0)
        self.assertGreater((tail_90 - tail_96) / 6.0, (top_4 - top_10) / 6.0)

    def test_same_year_strength_target_does_not_depend_on_expected_wins(self) -> None:
        from research.trueskill2.regional_pre import _shrunk_strength_theta

        target_a = _shrunk_strength_theta(
            actual_wins=2.0,
            match_count=3,
            beta_perf=1.0,
            prior_weight=6.0,
            prior_rate=0.5,
        )
        target_b = _shrunk_strength_theta(
            actual_wins=2.0,
            match_count=3,
            beta_perf=1.0,
            prior_weight=6.0,
            prior_rate=0.5,
        )
        self.assertAlmostEqual(target_a, target_b)

    def test_station_strength_summary_uses_rank_score_and_missing_defaults_to_zero(self) -> None:
        station_members = {
            "强站": ["上海交通大学", "东北大学", "缺失学校", "浙江大学"],
            "弱站": ["无名学校甲", "无名学校乙"],
        }
        rank_score_map = {
            "上海交通大学": 25.0,
            "东北大学": 22.7,
            "浙江大学": 21.1,
        }
        summary = _build_rmul_station_strength_summary(station_members, rank_score_map)
        strong = summary["强站"]
        weak = summary["弱站"]
        self.assertAlmostEqual(float(strong["rmul_station_score_mean_raw"]), (25.0 + 22.7 + 0.0 + 21.1) / 4.0)
        self.assertAlmostEqual(float(strong["rmul_station_score_top4_mean_raw"]), (25.0 + 22.7 + 21.1 + 0.0) / 4.0)
        self.assertEqual(int(strong["rmul_station_score_depth"]), 4)
        self.assertAlmostEqual(float(weak["rmul_station_score_mean_raw"]), 0.0)
        self.assertAlmostEqual(float(weak["rmul_station_score_top4_mean_raw"]), 0.0)

    def test_lagged_station_score_map_uses_program_base_for_2026(self) -> None:
        base_snapshot = pd.DataFrame(
            [
                {"school_key": "a", "rmuc_long_term_base_theta_mean": 1.2},
                {"school_key": "b", "rmuc_long_term_base_theta_mean": 0.6},
            ]
        )
        score_map, source = _load_lagged_station_score_map_for_season(2026, base_snapshot)
        self.assertEqual(source, "lagged_rmuc_program_base")
        self.assertAlmostEqual(score_map["a"], 1.2)
        self.assertAlmostEqual(score_map["b"], 0.6)

    def test_lagged_station_score_map_marks_2024_missing(self) -> None:
        score_map, source = _load_lagged_station_score_map_for_season(2024)
        self.assertEqual(source, "missing_lagged_prior")
        self.assertEqual(score_map, {})

    def test_outcome_strength_theta_blends_rank_and_observed_strength(self) -> None:
        value = _compute_regional_outcome_strength_theta(
            regional_outcome_rank_z=1.2,
            regional_observed_strength_theta=0.4,
            rank_to_theta_scale=0.8,
        )
        self.assertAlmostEqual(value, (0.70 * (0.8 * 1.2)) + (0.30 * 0.4))

    def test_regional_prior_feature_matrix_uses_curated_stable_features(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    "shape_prior_signal": 1.0,
                    "rmul_ranking_signal": 0.8,
                    "regional_prior_consistency_feature": 0.6,
                    "rmul_station_strength_mean": 0.5,
                    "rmul_station_strength_top4": 0.7,
                    "rmul_relative_finish": 1.1,
                    "rmul_strength_adjusted_signal": 1.36,
                    "shape_missing_flag": 0.0,
                    "rmul_missing_flag": 0.0,
                }
            ]
        )
        matrix = build_regional_prior_feature_matrix(frame)
        self.assertIn("rmul_station_strength_mean", matrix.columns)
        self.assertIn("rmul_station_strength_top4", matrix.columns)
        self.assertIn("rmul_relative_finish", matrix.columns)
        self.assertIn("shape_pos", matrix.columns)
        self.assertIn("rmul_pos", matrix.columns)
        self.assertNotIn("rmul_strength_adjusted_signal", matrix.columns)
        self.assertNotIn("regional_prior_consistency_feature", matrix.columns)
        self.assertNotIn("shape_rmul_interaction", matrix.columns)
        self.assertNotIn("rmul_sq", matrix.columns)
        self.assertNotIn("elite_joint_flag", matrix.columns)
        self.assertNotIn("weak_joint_flag", matrix.columns)

    def test_shape_evidence_is_monotonic(self) -> None:
        frame = pd.DataFrame(
            [
                {"shape_prior_signal": 1.4, "shape_missing_flag": 0.0},
                {"shape_prior_signal": 0.5, "shape_missing_flag": 0.0},
                {"shape_prior_signal": -0.8, "shape_missing_flag": 0.0},
            ]
        )
        evidence = build_shape_evidence(frame, RegionalPreModelConfig(shape_evidence_scale=0.9))
        self.assertGreater(float(evidence.iloc[0]), float(evidence.iloc[1]))
        self.assertGreater(float(evidence.iloc[1]), float(evidence.iloc[2]))

    def test_rmul_finish_evidence_is_monotonic(self) -> None:
        frame = pd.DataFrame(
            [
                {"rmul_ranking_signal": 2.2, "rmul_missing_flag": 0.0},
                {"rmul_ranking_signal": 1.0, "rmul_missing_flag": 0.0},
                {"rmul_ranking_signal": -0.5, "rmul_missing_flag": 0.0},
            ]
        )
        evidence = build_rmul_finish_evidence(frame, RegionalPreModelConfig(rmul_finish_scale=1.1))
        self.assertGreater(float(evidence.iloc[0]), float(evidence.iloc[1]))
        self.assertGreater(float(evidence.iloc[1]), float(evidence.iloc[2]))

    def test_station_calibration_is_weak_and_cannot_flip_empty_rmul(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    "rmul_ranking_signal": 1.5,
                    "rmul_station_strength_mean": 1.0,
                    "rmul_station_strength_top4": 0.8,
                    "rmul_missing_flag": 0.0,
                },
                {
                    "rmul_ranking_signal": 0.0,
                    "rmul_station_strength_mean": 1.2,
                    "rmul_station_strength_top4": 1.1,
                    "rmul_missing_flag": 0.0,
                },
            ]
        )
        rmul_finish = build_rmul_finish_evidence(frame, RegionalPreModelConfig(rmul_finish_scale=1.0))
        calibration = apply_station_calibration(
            frame,
            rmul_finish,
            RegionalPreModelConfig(station_calibration_scale=0.15),
        )
        self.assertGreater(float(calibration.iloc[0]), 0.0)
        self.assertAlmostEqual(float(calibration.iloc[1]), 0.0, places=6)
        self.assertLess(abs(float(calibration.iloc[0])), abs(float(rmul_finish.iloc[0])))

    def test_prior_delta_cap_is_smaller_for_strong_history(self) -> None:
        centered = pd.Series([1.0, 1.0], dtype=float)
        deltas = map_evidence_to_prior_delta(
            centered,
            pd.Series([0.9, 0.1], dtype=float),
            pd.Series([1.0, 1.0], dtype=float),
            RegionalPreModelConfig(
                prior_delta_cap_min=0.12,
                prior_delta_cap_max=0.60,
                history_cap_curve=1.0,
            ),
        )
        self.assertGreater(float(deltas.iloc[1]), float(deltas.iloc[0]))
        self.assertLessEqual(float(deltas.iloc[0]), 0.60)
        self.assertLessEqual(float(deltas.iloc[1]), 0.60)

    def test_build_evidence_score_centers_training_distribution(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    "shape_prior_signal": 1.0,
                    "shape_missing_flag": 0.0,
                    "rmul_ranking_signal": 1.2,
                    "rmul_missing_flag": 0.0,
                    "rmul_station_strength_mean": 0.4,
                    "rmul_station_strength_top4": 0.5,
                },
                {
                    "shape_prior_signal": 0.0,
                    "shape_missing_flag": 0.0,
                    "rmul_ranking_signal": 0.0,
                    "rmul_missing_flag": 0.0,
                    "rmul_station_strength_mean": 0.0,
                    "rmul_station_strength_top4": 0.0,
                },
                {
                    "shape_prior_signal": -1.0,
                    "shape_missing_flag": 0.0,
                    "rmul_ranking_signal": -1.2,
                    "rmul_missing_flag": 0.0,
                    "rmul_station_strength_mean": -0.4,
                    "rmul_station_strength_top4": -0.5,
                },
            ]
        )
        evidence = build_evidence_score(frame, RegionalPreModelConfig())
        self.assertAlmostEqual(float(evidence["evidence_score_centered"].mean()), 0.0, places=6)

    def test_program_base_compresses_recent_season_component(self) -> None:
        posterior = {
            "u_school": np.array([[1.0], [1.0]], dtype=float),
            "u_season": np.array([[2.0, 2.5], [2.0, 2.5]], dtype=float),
            "rho": np.array([0.5, 0.5], dtype=float),
        }
        report = {
            "school_keys": ["a"],
            "season_team_keys": ["2024:a", "2025:a"],
        }
        canonical_matches = pd.DataFrame(
            [
                {"ruleset_id": "RMUC", "season": 2025, "red_school_key": "a", "blue_school_key": "b"},
                {"ruleset_id": "RMUC", "season": 2025, "red_school_key": "a", "blue_school_key": "c"},
            ]
        )
        cfg = RegionalPreModelConfig(
            alpha=0.5,
            kappa=2.4,
            rho_terminal=0.15,
            recent_match_cap=12.0,
            recent_season_retention=0.80,
            recent_season_carry_retention=0.20,
            terminal_season_retention=0.10,
        )
        base = _build_rmuc_long_term_base_snapshot(
            posterior=posterior,
            report=report,
            config=cfg,
            canonical_matches=canonical_matches,
            target_year=2026,
        )
        row = base.iloc[0]
        self.assertAlmostEqual(float(row["rmuc_long_term_recent_innovation_component_mean"]), 1.2)
        self.assertAlmostEqual(float(row["rmuc_long_term_recent_carry_component_mean"]), 0.2)
        self.assertAlmostEqual(float(row["rmuc_long_term_recent_season_component_mean"]), 1.4)
        self.assertAlmostEqual(float(row["rmuc_long_term_season_component_mean"]), 1.4027215386, places=6)

    def test_recent_season_values_split_innovation_and_carry(self) -> None:
        innovation, carry = _split_recent_season_values(
            season_values=np.array([2.5, 2.5], dtype=float),
            previous_season_values=np.array([2.0, 2.0], dtype=float),
            rho_values=np.array([0.5, 0.5], dtype=float),
        )
        np.testing.assert_allclose(innovation, np.array([1.5, 1.5], dtype=float))
        np.testing.assert_allclose(carry, np.array([1.0, 1.0], dtype=float))

    def test_rank_shift_target_lifts_and_drops_by_same_year_displacement(self) -> None:
        training = pd.DataFrame(
            [
                {
                    "school_key": "legacy_drop",
                    "base_anchor_theta": 1.2,
                    "regional_match_count": 3,
                    "regional_series_wins": 1.0,
                    "regional_observed_strength_theta": -0.4,
                },
                {
                    "school_key": "novel_rise",
                    "base_anchor_theta": 0.1,
                    "regional_match_count": 3,
                    "regional_series_wins": 3.0,
                    "regional_observed_strength_theta": 0.6,
                },
                {
                    "school_key": "steady_mid",
                    "base_anchor_theta": 0.6,
                    "regional_match_count": 3,
                    "regional_series_wins": 2.0,
                    "regional_observed_strength_theta": 0.1,
                },
            ]
        )
        augmented = _augment_same_year_rank_targets(
            training,
            rank_shift_scale=1.0,
            strength_scale=0.0,
        )
        row_map = {row["school_key"]: row for row in augmented.to_dict(orient="records")}
        self.assertGreater(
            float(row_map["novel_rise"]["regional_prior_target_theta"]),
            0.0,
        )
        self.assertLess(
            float(row_map["legacy_drop"]["regional_prior_target_theta"]),
            0.0,
        )
        self.assertGreater(
            float(row_map["steady_mid"]["regional_prior_target_theta"]),
            float(row_map["legacy_drop"]["regional_prior_target_theta"]),
        )
        self.assertLess(
            float(row_map["steady_mid"]["regional_prior_target_theta"]),
            float(row_map["novel_rise"]["regional_prior_target_theta"]),
        )
        self.assertAlmostEqual(
            float(row_map["steady_mid"]["regional_prior_target_theta"]),
            float(row_map["steady_mid"]["regional_prior_shift_theta"]),
        )

    def test_regional_same_year_signal_combines_shape_rmul_and_consistency(self) -> None:
        cfg = RegionalPreModelConfig(
            same_year_shape_weight=0.4,
            same_year_rmul_weight=0.95,
            same_year_consistency_weight=0.55,
        )
        same_year_signal = compute_regional_same_year_signal(
            shape_prior_signal=1.2,
            rmul_ranking_signal=1.0,
            consistency_signal=0.8,
            config=cfg,
        )
        self.assertAlmostEqual(same_year_signal, (0.4 * 1.2) + (0.95 * 1.0) + (0.55 * 0.8))
        same_year_signal_2 = compute_regional_same_year_signal(
            shape_prior_signal=-1.1,
            rmul_ranking_signal=-0.9,
            consistency_signal=-0.7,
            config=cfg,
        )
        self.assertLess(same_year_signal_2, 0.0)

    def test_blend_lambda_grows_with_signal_strength_but_not_direction(self) -> None:
        cfg = RegionalPreModelConfig()
        small_positive = compute_regional_pre_blend_lambda(
            history_strength=0.5,
            recent_evidence_support=1.0,
            posterior_uncertainty=0.6,
            prior_gap_theta=0.2,
            config=cfg,
        )
        small_negative = compute_regional_pre_blend_lambda(
            history_strength=0.5,
            recent_evidence_support=1.0,
            posterior_uncertainty=0.6,
            prior_gap_theta=-0.2,
            config=cfg,
        )
        large_positive = compute_regional_pre_blend_lambda(
            history_strength=0.5,
            recent_evidence_support=1.0,
            posterior_uncertainty=0.6,
            prior_gap_theta=1.0,
            config=cfg,
        )
        self.assertAlmostEqual(small_positive, small_negative)
        self.assertGreater(large_positive, small_positive)

    def test_prior_confirmation_transfers_released_signal_when_live_aligns(self) -> None:
        confirmed, residual = compute_regional_prior_runtime_components(
            prior_theta=0.9,
            live_state_theta=0.2,
            decay_factor=0.5,
        )
        self.assertAlmostEqual(confirmed, 0.45)
        self.assertAlmostEqual(residual, 0.45)

    def test_prior_confirmation_does_not_transfer_when_live_conflicts(self) -> None:
        confirmed, residual = compute_regional_prior_runtime_components(
            prior_theta=0.9,
            live_state_theta=-0.2,
            decay_factor=0.5,
        )
        self.assertAlmostEqual(confirmed, 0.0)
        self.assertAlmostEqual(residual, 0.45)

    def test_compute_published_rating_uses_base_prior_decay_and_live(self) -> None:
        rating = compute_published_rating(
            program_base_theta=1.0,
            prior_theta=0.3,
            confirmed_prior_theta=0.2,
            decay_factor=2.0 / 3.0,
            live_state_theta=0.2,
            rating_scale=120.0,
        )
        self.assertAlmostEqual(rating, 1500.0 + (120.0 * (1.0 + 0.2 + (0.3 * (2.0 / 3.0)) + 0.2)))

    def test_build_published_preseason_snapshot_freezes_base_and_prior(self) -> None:
        snapshot = pd.DataFrame(
            [
                {
                    "school_key": "a",
                    "school_name": "Alpha",
                    "rmuc_long_term_base_theta_mean": 1.2,
                    "regional_pre_offset_theta": 0.4,
                    "regional_pre_decay_factor": 1.0,
                }
            ]
        )
        preseason = build_published_preseason_snapshot(
            snapshot=snapshot,
            season=2026,
            freeze_date="2026-04-05",
            rating_scale=120.0,
        )
        row = preseason.iloc[0]
        self.assertEqual(int(row["season"]), 2026)
        self.assertEqual(str(row["freeze_date"]), "2026-04-05")
        self.assertAlmostEqual(float(row["rmuc_program_base_theta"]), 1.2)
        self.assertAlmostEqual(float(row["regional_prior_theta"]), 0.4)
        self.assertAlmostEqual(float(row["published_regional_pre_rating"]), 1500.0 + (120.0 * 1.6))

    def test_build_published_live_state_updates_is_append_only_and_deduplicated(self) -> None:
        canonical_matches = pd.DataFrame(
            [
                {
                    "match_id": "m1",
                    "season": 2026,
                    "match_date": "2026-05-01",
                    "ruleset_id": "RMUC",
                    "stage_id": "rmuc_regional_group",
                    "stage_family": "regional_group",
                    "red_school_key": "a",
                    "blue_school_key": "b",
                    "red_wins": 1,
                    "blue_wins": 0,
                    "winner_side": "red",
                },
                {
                    "match_id": "m2",
                    "season": 2026,
                    "match_date": "2026-05-01",
                    "ruleset_id": "RMUC",
                    "stage_id": "rmuc_regional_group",
                    "stage_family": "regional_group",
                    "red_school_key": "a",
                    "blue_school_key": "c",
                    "red_wins": 0,
                    "blue_wins": 1,
                    "winner_side": "blue",
                },
            ]
        )
        preseason = pd.DataFrame(
            [
                {"school_key": "a", "school_name": "Alpha", "season": 2026, "rmuc_program_base_theta": 0.0, "regional_prior_theta": 0.3},
                {"school_key": "b", "school_name": "Beta", "season": 2026, "rmuc_program_base_theta": 0.0, "regional_prior_theta": -0.1},
                {"school_key": "c", "school_name": "Gamma", "season": 2026, "rmuc_program_base_theta": 0.0, "regional_prior_theta": 0.0},
            ]
        )
        state_store = pd.DataFrame(columns=["match_id", "school_key", "live_state_theta_after_match", "regional_group_matches_played", "pre_decay_factor_after_match", "published_rating_after_match"])

        updates = build_published_live_state_updates(
            preseason_snapshot=preseason,
            live_state_store=state_store,
            new_matches=canonical_matches,
            rating_scale=120.0,
            pre_decay_matches=3,
            beta_perf=1.0,
            online_update_scale=0.5,
        )
        self.assertEqual(len(updates), 4)
        first_alpha = updates[(updates["match_id"] == "m1") & (updates["school_key"] == "a")].iloc[0]
        self.assertGreater(float(first_alpha["confirmed_prior_theta_after_match"]), 0.0)
        second_alpha = updates[(updates["match_id"] == "m2") & (updates["school_key"] == "a")].iloc[0]
        expected_after_first = 0.5 * (1.0 - (1.0 / (1.0 + np.exp(-0.3 - 0.1))))
        expected_second_probability = 1.0 / (1.0 + np.exp(-(0.1 + (0.3 * (2.0 / 3.0)) + expected_after_first)))
        expected_after_second = expected_after_first - (0.5 * expected_second_probability)
        self.assertAlmostEqual(float(first_alpha["live_state_theta_after_match"]), expected_after_first, places=6)
        self.assertAlmostEqual(float(second_alpha["live_state_theta_after_match"]), expected_after_second, places=6)
        repeated = build_published_live_state_updates(
            preseason_snapshot=preseason,
            live_state_store=updates,
            new_matches=canonical_matches,
            rating_scale=120.0,
            pre_decay_matches=3,
            beta_perf=1.0,
            online_update_scale=0.5,
        )
        self.assertEqual(len(repeated), 0)

    def test_build_published_live_state_updates_records_match_ledger_deltas_and_win_drop_case(self) -> None:
        canonical_matches = pd.DataFrame(
            [
                {
                    "match_id": "m_live",
                    "season": 2026,
                    "match_date": "2026-05-02",
                    "ruleset_id": "RMUC",
                    "event_code": "2026RMUC_SOUTH",
                    "stage_id": "rmuc_regional_group",
                    "stage_family": "regional_group",
                    "red_school_key": "a",
                    "blue_school_key": "b",
                    "red_school_name": "Alpha",
                    "blue_school_name": "Beta",
                    "red_wins": 2,
                    "blue_wins": 0,
                    "winner_side": "red",
                }
            ]
        )
        preseason = pd.DataFrame(
            [
                {"school_key": "a", "school_name": "Alpha", "season": 2026, "rmuc_program_base_theta": 0.0, "regional_prior_theta": 0.9},
                {"school_key": "b", "school_name": "Beta", "season": 2026, "rmuc_program_base_theta": 0.0, "regional_prior_theta": 0.0},
            ]
        )
        existing = pd.DataFrame(
            [
                {
                    "match_id": "m_prev",
                    "match_date": "2026-05-01",
                    "season": 2026,
                    "school_key": "a",
                    "school_name": "Alpha",
                    "stage_family": "regional_group",
                    "opponent_school_key": "z",
                    "opponent_school_name": "Zeta",
                    "scoreline": "0:2",
                    "match_result": "loss",
                    "live_state_theta_before_match": 0.0,
                    "live_state_theta_after_match": -0.5,
                    "live_update_delta_theta": -0.5,
                    "confirmed_prior_theta_before_match": 0.0,
                    "confirmed_prior_theta_after_match": 0.0,
                    "residual_prior_theta_before_match": 0.9,
                    "residual_prior_theta_after_match": 0.6,
                    "published_rating_before_match": 1608.0,
                    "published_rating_after_match": 1512.0,
                    "published_delta_rating": -96.0,
                    "live_update_delta_rating": -60.0,
                    "prior_component_delta_rating": -36.0,
                    "regional_group_matches_played": 1,
                    "pre_decay_factor_before_match": 1.0,
                    "pre_decay_factor_after_match": 2.0 / 3.0,
                }
            ]
        )

        updates = build_published_live_state_updates(
            preseason_snapshot=preseason,
            live_state_store=existing,
            new_matches=canonical_matches,
            rating_scale=120.0,
            pre_decay_matches=3,
            beta_perf=1.0,
            online_update_scale=0.5,
        )

        alpha = updates[(updates["match_id"] == "m_live") & (updates["school_key"] == "a")].iloc[0]
        self.assertEqual(str(alpha["scoreline"]), "2:0")
        self.assertEqual(str(alpha["match_result"]), "win")
        self.assertGreater(float(alpha["live_update_delta_rating"]), 0.0)
        self.assertLess(float(alpha["prior_component_delta_rating"]), 0.0)
        self.assertLess(float(alpha["published_delta_rating"]), 0.0)
        self.assertAlmostEqual(
            float(alpha["published_rating_after_match"]) - float(alpha["published_rating_before_match"]),
            float(alpha["published_delta_rating"]),
        )
        self.assertAlmostEqual(
            float(alpha["published_delta_rating"]),
            float(alpha["live_update_delta_rating"]) + float(alpha["prior_component_delta_rating"]),
        )
        self.assertEqual(str(alpha["opponent_school_key"]), "b")
        self.assertIn("region_slug", updates.columns)

    def test_calibrate_online_live_update_scale_matches_historical_tempo_target(self) -> None:
        preseason = pd.DataFrame(
            [
                {"school_key": "a", "school_name": "Alpha", "season": 2024, "rmuc_program_base_theta": 0.0, "regional_prior_theta": 0.0},
                {"school_key": "b", "school_name": "Beta", "season": 2024, "rmuc_program_base_theta": 0.0, "regional_prior_theta": 0.0},
            ]
        )
        matches = pd.DataFrame(
            [
                {
                    "match_id": "m1",
                    "season": 2024,
                    "match_date": "2024-05-01",
                    "ruleset_id": "RMUC",
                    "stage_id": "rmuc_regional_group",
                    "stage_family": "regional_group",
                    "red_school_key": "a",
                    "blue_school_key": "b",
                    "red_wins": 1,
                    "blue_wins": 0,
                    "winner_side": "red",
                }
            ]
        )
        targets = pd.DataFrame(
            [
                {"school_key": "a", "target_live_state_theta": 0.4, "target_weight": 1.0},
                {"school_key": "b", "target_live_state_theta": -0.4, "target_weight": 1.0},
            ]
        )
        calibration = calibrate_online_live_update_scale(
            calibration_bundles=[
                {
                    "season": 2024,
                    "preseason_snapshot": preseason,
                    "matches": matches,
                    "targets": targets,
                }
            ],
            beta_perf=1.0,
            pre_decay_matches=3,
            default_scale=0.5,
            candidate_scales=[0.2, 0.5, 0.8],
        )
        self.assertAlmostEqual(float(calibration["online_live_update_scale"]), 0.8)

    def test_build_carryover_seed_snapshot_uses_only_compressed_live_state(self) -> None:
        final_snapshot = pd.DataFrame(
            [
                {
                    "school_key": "a",
                    "school_name": "Alpha",
                    "season": 2026,
                    "rmuc_program_base_theta": 1.0,
                    "rmuc_live_state_theta_final": 0.6,
                    "regional_prior_theta": 0.4,
                    "rmuc_official_match_count": 10,
                    "rmuc_live_state_theta_sd": 0.2,
                }
            ]
        )
        carry = build_carryover_seed_snapshot(
            final_snapshot=final_snapshot,
            target_season=2027,
            match_cap=12.0,
            uncertainty_scale=1.0,
        )
        row = carry.iloc[0]
        self.assertEqual(int(row["season"]), 2027)
        self.assertAlmostEqual(float(row["carryover_live_state_theta"]), float(row["carryover_factor"]) * 0.6)
        self.assertNotIn("regional_prior_theta", carry.columns)

    def test_history_context_is_lower_for_terminal_only_support(self) -> None:
        cfg = RegionalPreModelConfig()
        supported = compute_history_context(
            effective_recent_match_count=12.0,
            latest_season_match_share=0.8,
            posterior_uncertainty=0.4,
            terminal_only_support=False,
            shape_signal_available=True,
            rmul_signal_available=True,
            config=cfg,
        )
        terminal_only = compute_history_context(
            effective_recent_match_count=2.0,
            latest_season_match_share=0.0,
            posterior_uncertainty=1.2,
            terminal_only_support=True,
            shape_signal_available=True,
            rmul_signal_available=False,
            config=cfg,
        )
        self.assertGreater(supported["rmuc_history_strength"], terminal_only["rmuc_history_strength"])
        self.assertGreater(supported["recent_evidence_support"], terminal_only["recent_evidence_support"])

    def test_decay_factor_reaches_zero_after_three_regional_group_matches(self) -> None:
        self.assertAlmostEqual(_regional_group_decay_factor(0, 3), 1.0)
        self.assertAlmostEqual(_regional_group_decay_factor(1, 3), 2.0 / 3.0)
        self.assertAlmostEqual(_regional_group_decay_factor(2, 3), 1.0 / 3.0)
        self.assertAlmostEqual(_regional_group_decay_factor(3, 3), 0.0)
        self.assertAlmostEqual(_regional_group_decay_factor(5, 3), 0.0)

    def test_history_context_uses_shape_and_rmul_availability(self) -> None:
        cfg = RegionalPreModelConfig()
        dual = compute_history_context(
            effective_recent_match_count=0.0,
            latest_season_match_share=0.0,
            posterior_uncertainty=1.0,
            terminal_only_support=False,
            shape_signal_available=True,
            rmul_signal_available=True,
            config=cfg,
        )
        single = compute_history_context(
            effective_recent_match_count=14.5,
            latest_season_match_share=0.90,
            posterior_uncertainty=0.8,
            terminal_only_support=False,
            shape_signal_available=True,
            rmul_signal_available=False,
            config=cfg,
        )
        self.assertAlmostEqual(dual["recent_evidence_support"], 1.0)
        self.assertAlmostEqual(single["recent_evidence_support"], 0.5)

    def test_shrunk_residual_delta_theta_is_smaller_than_raw_small_sample_delta(self) -> None:
        import math

        beta_perf = 1.0
        expected_rate = 0.75
        # One upset win in a single match should not be converted into the full raw residual.
        actual_rate = 1.0 - 1e-4
        raw = beta_perf * (math.log(actual_rate / (1.0 - actual_rate)) - math.log(expected_rate / (1.0 - expected_rate)))
        shrunk = _shrunk_residual_delta_theta(
            actual_wins=1.0,
            expected_wins=0.75,
            match_count=1,
            beta_perf=beta_perf,
            prior_weight=6.0,
        )
        self.assertLess(abs(shrunk), abs(raw))
        self.assertGreater(shrunk, 0.0)

    def test_regional_prior_training_samples_count_full_regional_group_matches(self) -> None:
        canonical_matches = pd.DataFrame(
            [
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B1",
                    "blue_school_name": "Beta1",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B2",
                    "blue_school_name": "Beta2",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B3",
                    "blue_school_name": "Beta3",
                    "winner_side": "blue",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B4",
                    "blue_school_name": "Beta4",
                    "winner_side": "blue",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B5",
                    "blue_school_name": "Beta5",
                    "winner_side": "blue",
                },
            ]
        )
        feature_frame = pd.DataFrame(
            [
                {
                    "school_key": "A",
                    "school_name": "Alpha",
                    "shape_prior_signal": 0.0,
                    "rmul_ranking_signal": 0.0,
                    "regional_prior_consistency_feature": 0.0,
                    "shape_missing_flag": 0.0,
                    "rmul_missing_flag": 0.0,
                },
                *[
                    {
                        "school_key": f"B{i}",
                        "school_name": f"Beta{i}",
                        "shape_prior_signal": 0.0,
                        "rmul_ranking_signal": 0.0,
                        "regional_prior_consistency_feature": 0.0,
                        "shape_missing_flag": 0.0,
                        "rmul_missing_flag": 0.0,
                    }
                    for i in range(1, 6)
                ],
            ]
        )
        base_snapshot = pd.DataFrame(
            [
                {"school_key": "A", "rmuc_long_term_base_theta_mean": 1.0},
                *[
                    {"school_key": f"B{i}", "rmuc_long_term_base_theta_mean": 0.0}
                    for i in range(1, 6)
                ],
            ]
        )
        fake_dataset = {"canonical_matches": canonical_matches}

        with (
            patch("research.trueskill2.regional_pre.read_dataset", return_value=fake_dataset),
            patch("research.trueskill2.regional_pre.build_same_year_feature_frame", return_value=feature_frame),
        ):
            training = build_regional_prior_training_samples(
                dataset_dir=ROOT,
                season=2025,
                base_snapshot=base_snapshot,
                beta_perf=1.0,
                config=RegionalPreModelConfig(regional_prior_target_pseudocount=6.0),
            )

        alpha_row = training.loc[training["school_key"] == "A"].iloc[0]
        self.assertEqual(int(alpha_row["regional_group_match_count"]), 5)
        self.assertEqual(int(alpha_row["regional_match_count"]), 5)
        self.assertAlmostEqual(float(alpha_row["regional_series_wins"]), 2.0)
        self.assertLessEqual(float(alpha_row["expected_series_wins"]), 5.0)

    def test_regional_prior_training_samples_use_full_regional_stages(self) -> None:
        canonical_matches = pd.DataFrame(
            [
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B1",
                    "blue_school_name": "Beta1",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B2",
                    "blue_school_name": "Beta2",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "C",
                    "red_school_name": "Gamma",
                    "blue_school_key": "D1",
                    "blue_school_name": "Delta1",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "C",
                    "red_school_name": "Gamma",
                    "blue_school_key": "D2",
                    "blue_school_name": "Delta2",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_knockout",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "E",
                    "blue_school_name": "Echo",
                    "winner_side": "blue",
                },
            ]
        )
        feature_frame = pd.DataFrame(
            [
                {
                    "school_key": school_key,
                    "school_name": school_name,
                    "shape_prior_signal": 0.0,
                    "rmul_ranking_signal": 0.0,
                    "regional_prior_consistency_feature": 0.0,
                    "shape_missing_flag": 0.0,
                    "rmul_missing_flag": 0.0,
                }
                for school_key, school_name in [
                    ("A", "Alpha"),
                    ("B1", "Beta1"),
                    ("B2", "Beta2"),
                    ("C", "Gamma"),
                    ("D1", "Delta1"),
                    ("D2", "Delta2"),
                    ("E", "Echo"),
                ]
            ]
        )
        base_snapshot = pd.DataFrame(
            [
                {"school_key": school_key, "rmuc_long_term_base_theta_mean": 0.0}
                for school_key in ["A", "B1", "B2", "C", "D1", "D2", "E"]
            ]
        )
        fake_dataset = {"canonical_matches": canonical_matches}

        with (
            patch("research.trueskill2.regional_pre.read_dataset", return_value=fake_dataset),
            patch("research.trueskill2.regional_pre.build_same_year_feature_frame", return_value=feature_frame),
        ):
            training = build_regional_prior_training_samples(
                dataset_dir=ROOT,
                season=2025,
                base_snapshot=base_snapshot,
                beta_perf=1.0,
                config=RegionalPreModelConfig(regional_prior_target_pseudocount=6.0),
            )

        alpha_row = training.loc[training["school_key"] == "A"].iloc[0]
        gamma_row = training.loc[training["school_key"] == "C"].iloc[0]
        self.assertEqual(int(alpha_row["regional_group_match_count"]), 2)
        self.assertEqual(int(alpha_row["regional_knockout_match_count"]), 1)
        self.assertEqual(int(gamma_row["regional_group_match_count"]), 2)
        self.assertEqual(int(gamma_row["regional_knockout_match_count"]), 0)
        self.assertGreater(float(alpha_row["regional_outcome_score"]), float(gamma_row["regional_outcome_score"]))
        self.assertGreater(float(alpha_row["regional_prior_target_theta"]), float(gamma_row["regional_prior_target_theta"]))

    def test_regional_prior_training_samples_exclude_repechage_and_nationals(self) -> None:
        canonical_matches = pd.DataFrame(
            [
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_regional_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "B",
                    "blue_school_name": "Beta",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_repechage_stage1",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "C",
                    "blue_school_name": "Gamma",
                    "winner_side": "red",
                },
                {
                    "ruleset_id": "RMUC",
                    "season": 2025,
                    "stage_id": "rmuc_national_group",
                    "red_school_key": "A",
                    "red_school_name": "Alpha",
                    "blue_school_key": "D",
                    "blue_school_name": "Delta",
                    "winner_side": "red",
                },
            ]
        )
        feature_frame = pd.DataFrame(
            [
                {
                    "school_key": school_key,
                    "school_name": school_name,
                    "shape_prior_signal": 0.0,
                    "rmul_ranking_signal": 0.0,
                    "regional_prior_consistency_feature": 0.0,
                    "shape_missing_flag": 0.0,
                    "rmul_missing_flag": 0.0,
                }
                for school_key, school_name in [
                    ("A", "Alpha"),
                    ("B", "Beta"),
                    ("C", "Gamma"),
                    ("D", "Delta"),
                ]
            ]
        )
        base_snapshot = pd.DataFrame(
            [
                {"school_key": school_key, "rmuc_long_term_base_theta_mean": 0.0}
                for school_key in ["A", "B", "C", "D"]
            ]
        )
        fake_dataset = {"canonical_matches": canonical_matches}

        with (
            patch("research.trueskill2.regional_pre.read_dataset", return_value=fake_dataset),
            patch("research.trueskill2.regional_pre.build_same_year_feature_frame", return_value=feature_frame),
        ):
            training = build_regional_prior_training_samples(
                dataset_dir=ROOT,
                season=2025,
                base_snapshot=base_snapshot,
                beta_perf=1.0,
                config=RegionalPreModelConfig(regional_prior_target_pseudocount=6.0),
            )

        alpha_row = training.loc[training["school_key"] == "A"].iloc[0]
        self.assertEqual(int(alpha_row["regional_group_match_count"]), 1)
        self.assertEqual(int(alpha_row["regional_knockout_match_count"]), 0)
        self.assertEqual(int(alpha_row["regional_match_count"]), 1)

    def test_regional_pre_blend_lambda_is_higher_for_novel_teams(self) -> None:
        cfg = RegionalPreModelConfig()
        veteran = compute_regional_pre_blend_lambda(
            history_strength=0.90,
            recent_evidence_support=1.0,
            posterior_uncertainty=0.3,
            prior_gap_theta=-0.5,
            config=cfg,
        )
        novel = compute_regional_pre_blend_lambda(
            history_strength=0.15,
            recent_evidence_support=1.0,
            posterior_uncertainty=1.2,
            prior_gap_theta=0.5,
            config=cfg,
        )
        self.assertGreater(novel, veteran)

    def test_interpolate_regional_pre_theta_returns_between_base_and_prior_score(self) -> None:
        blended = interpolate_regional_pre_theta(
            base_theta=1.0,
            prior_score_theta=2.0,
            blend_lambda=0.25,
        )
        self.assertAlmostEqual(blended, 1.25)

    def test_build_dataset_cli_creates_expected_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir) / "dataset_v1"
            result = run_cli(
                "build-dataset",
                "--from",
                "2024RMUC",
                "2025RMUC",
                "2026RMUL",
                "--limit-matches",
                "40",
                "--out",
                str(out_dir),
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)

            expected = [
                out_dir / "canonical_matches.parquet",
                out_dir / "school_static_features.parquet",
                out_dir / "season_team_index.parquet",
                out_dir / "shape_history.parquet",
                out_dir / "rmul_3v3_ranking_history.parquet",
                out_dir / "dataset_manifest.json",
                out_dir / "feature_manifest.json",
            ]
            for path in expected:
                self.assertTrue(path.exists(), msg=str(path))

            manifest = json.loads((out_dir / "dataset_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["dataset_version"], 2)
            self.assertEqual(manifest["match_count"], 40)
            self.assertEqual(set(manifest["event_codes"]), {"2024RMUC", "2025RMUC", "2026RMUL"})
            self.assertEqual(manifest["school_universe_count"], 308)
            self.assertEqual(manifest["school_universe_policy"], "historical_matches_union_reference_2026")
            self.assertEqual(manifest["cutoff_date"], "2026-04-05")
            self.assertIn("shape_history_path", manifest)
            self.assertIn("rmul_3v3_ranking_history_path", manifest)

            feature_manifest = json.loads((out_dir / "feature_manifest.json").read_text(encoding="utf-8"))
            self.assertIn("source_columns", feature_manifest)
            self.assertIn("ranking_1884", feature_manifest["source_columns"])

    def test_partial_2026_rmuc_south_pipeline_exports_nonempty_published_live_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_dir = root / "dataset_v1"
            fit_dir = root / "fit_v1"
            published_export_path = root / "published_ratings.parquet"
            config_path = root / "config.yaml"

            build_result = run_cli(
                "build-dataset",
                "--from",
                "2024RMUC",
                "2025RMUC",
                "2026RMUL",
                "2026RMUC",
                "--out",
                str(dataset_dir),
            )
            self.assertEqual(build_result.returncode, 0, msg=build_result.stderr)

            manifest = json.loads((dataset_dir / "dataset_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(set(manifest["event_codes"]), {"2024RMUC", "2025RMUC", "2026RMUL", "2026RMUC"})

            canonical = pd.read_parquet(dataset_dir / "canonical_matches.parquet")
            south_partial = canonical[canonical["event_code"] == "2026RMUC"].copy()
            self.assertEqual(len(south_partial), 32)
            self.assertEqual(set(south_partial["stage_id"].tolist()), {"rmuc_regional_group"})
            self.assertEqual(set(south_partial["ruleset_id"].tolist()), {"RMUC"})
            self.assertEqual(set(south_partial["season"].tolist()), {2026})
            self.assertEqual(len(set(south_partial["red_school_key"]).union(set(south_partial["blue_school_key"]))), 32)

            config = {
                "model": {
                    "enable_stage_effect": True,
                    "enable_format_effect": True,
                    "enable_ruleset_effect": True,
                    "enable_side_effect": True,
                    "time_bucket": "day",
                },
                "priors": {
                    "school_sd": 0.8,
                    "team_sd": 0.5,
                    "stage_sd": 0.3,
                    "format_sd": 0.3,
                    "ruleset_sd": 0.3,
                    "side_sd": 0.3,
                    "season_sd": 0.35,
                    "drift_sd": 0.15,
                    "perf_sd": 1.0,
                    "rho_alpha": 8.0,
                    "rho_beta": 2.0,
                },
                "training": {
                    "inference_mode": "svi",
                    "seed": 7,
                    "num_steps": 8,
                    "learning_rate": 0.03,
                    "num_samples": 8,
                    "max_train_matches": 96,
                },
            }
            config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

            fit_result = run_cli(
                "fit",
                "--dataset",
                str(dataset_dir),
                "--config",
                str(config_path),
                "--out",
                str(fit_dir),
            )
            self.assertEqual(fit_result.returncode, 0, msg=fit_result.stderr)
            self.assertTrue((fit_dir / "model_report.json").exists())

            published_export_result = run_cli(
                "export-ratings",
                "--model",
                str(fit_dir),
                "--date",
                "2026-11-12",
                "--mode",
                "published",
                "--out",
                str(published_export_path),
            )
            self.assertEqual(published_export_result.returncode, 0, msg=published_export_result.stderr)

            published_dir = published_export_path.parent / "published_2026"
            ledger = pd.read_parquet(published_dir / "live_match_ledger.parquet")
            south_ledger = ledger[
                (ledger["region_slug"] == "south_region")
                & (ledger["stage_family"] == "regional_group")
                & (ledger["match_date"] <= "2026-11-12")
            ].copy()
            self.assertEqual(len(south_ledger), 64)
            self.assertEqual(set(south_ledger["region_slug"].tolist()), {"south_region"})
            self.assertEqual(set(south_ledger["stage_family"].tolist()), {"regional_group"})
            self.assertEqual(len(set(south_ledger["school_key"].tolist())), 32)
            self.assertLess(
                float(
                    (
                        south_ledger["published_rating_after_match"]
                        - south_ledger["published_rating_before_match"]
                        - south_ledger["live_update_delta_rating"]
                        - south_ledger["prior_component_delta_rating"]
                    ).abs().max()
                ),
                1e-6,
            )

            current_snapshot = pd.read_parquet(published_dir / "current_snapshot.parquet")
            self.assertEqual(len(current_snapshot), 308)
            south_keys = set(south_ledger["school_key"].tolist())
            south_live = current_snapshot[
                (current_snapshot["school_key"].isin(south_keys))
                & (current_snapshot["regional_group_matches_played"] > 0)
            ]
            self.assertEqual(len(south_live), 32)
            self.assertLessEqual(int(south_live["regional_group_matches_played"].max()), 2)

    def test_fit_predict_export_and_backtest_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_dir = root / "dataset_v1"
            fit_dir = root / "fit_v1"
            backtest_dir = root / "backtest_v1"
            predict_path = root / "predict.json"
            export_path = root / "ratings.parquet"
            config_path = root / "config.yaml"

            build_result = run_cli(
                "build-dataset",
                "--from",
                "2024RMUC",
                "2025RMUC",
                "2026RMUL",
                "--limit-matches",
                "60",
                "--out",
                str(dataset_dir),
            )
            self.assertEqual(build_result.returncode, 0, msg=build_result.stderr)

            config = {
                "model": {
                    "enable_stage_effect": True,
                    "enable_format_effect": True,
                    "enable_ruleset_effect": True,
                    "enable_side_effect": True,
                    "time_bucket": "day",
                },
                "priors": {
                    "school_sd": 0.8,
                    "team_sd": 0.5,
                    "stage_sd": 0.3,
                    "format_sd": 0.3,
                    "ruleset_sd": 0.3,
                    "side_sd": 0.3,
                    "season_sd": 0.35,
                    "drift_sd": 0.15,
                    "perf_sd": 1.0,
                    "rho_alpha": 8.0,
                    "rho_beta": 2.0,
                },
                "training": {
                    "inference_mode": "svi",
                    "seed": 7,
                    "num_steps": 15,
                    "learning_rate": 0.03,
                    "num_samples": 24,
                    "max_train_matches": 48,
                },
                "backtest": {
                    "scheme": "rolling_origin",
                    "seed": 11,
                    "num_steps": 10,
                    "num_samples": 16,
                    "max_train_matches": 32,
                    "max_test_matches": 16,
                },
            }
            config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

            fit_result = run_cli(
                "fit",
                "--dataset",
                str(dataset_dir),
                "--config",
                str(config_path),
                "--out",
                str(fit_dir),
            )
            self.assertEqual(fit_result.returncode, 0, msg=fit_result.stderr)

            for path in [
                fit_dir / "posterior_summary.parquet",
                fit_dir / "ratings_timeline.parquet",
                fit_dir / "match_predictions.parquet",
                fit_dir / "model_report.json",
                fit_dir / "model_selection_report.json",
            ]:
                self.assertTrue(path.exists(), msg=str(path))

            predict_result = run_cli(
                "predict",
                "--model",
                str(fit_dir),
                "--team-a",
                "上海交通大学",
                "--team-b",
                "东北大学",
                "--match-date",
                "2026-04-01",
                "--stage",
                "rmul_group",
                "--best-of",
                "3",
                "--ruleset",
                "RMUL",
                "--out",
                str(predict_path),
            )
            self.assertEqual(predict_result.returncode, 0, msg=predict_result.stderr)
            prediction = json.loads(predict_path.read_text(encoding="utf-8"))
            self.assertIn("p_red_win", prediction)
            self.assertIn("p_blue_win", prediction)
            self.assertAlmostEqual(prediction["p_red_win"] + prediction["p_blue_win"], 1.0, places=6)

            swap_path = root / "predict_swap.json"
            swap_result = run_cli(
                "predict",
                "--model",
                str(fit_dir),
                "--team-a",
                "东北大学",
                "--team-b",
                "上海交通大学",
                "--match-date",
                "2026-04-01",
                "--stage",
                "rmul_group",
                "--best-of",
                "3",
                "--ruleset",
                "RMUL",
                "--out",
                str(swap_path),
            )
            self.assertEqual(swap_result.returncode, 0, msg=swap_result.stderr)
            swapped = json.loads(swap_path.read_text(encoding="utf-8"))
            self.assertAlmostEqual(prediction["p_red_win"], swapped["p_blue_win"], places=5)

            export_result = run_cli(
                "export-ratings",
                "--model",
                str(fit_dir),
                "--date",
                "2026-04-05",
                "--out",
                str(export_path),
            )
            self.assertEqual(export_result.returncode, 0, msg=export_result.stderr)
            self.assertTrue(export_path.exists())
            self.assertTrue(export_path.with_suffix(".csv").exists())
            self.assertTrue(export_path.with_suffix(".json").exists())

            published_export_path = root / "published_ratings.parquet"
            published_export_result = run_cli(
                "export-ratings",
                "--model",
                str(fit_dir),
                "--date",
                "2026-04-05",
                "--mode",
                "published",
                "--out",
                str(published_export_path),
            )
            self.assertEqual(published_export_result.returncode, 0, msg=published_export_result.stderr)
            self.assertTrue(published_export_path.exists())
            self.assertTrue((published_export_path.parent / "published_2026" / "preseason_snapshot.parquet").exists())
            self.assertTrue((published_export_path.parent / "published_2026" / "published_manifest.json").exists())
            self.assertTrue((published_export_path.parent / "published_2026" / "live_match_ledger.parquet").exists())
            self.assertTrue((published_export_path.parent / "published_2027" / "carryover_seed.parquet").exists())

            import pandas as pd

            snapshot = pd.read_parquet(export_path)
            self.assertEqual(len(snapshot), 308)
            self.assertIn("rating_1500_mean", snapshot.columns)
            self.assertIn("rating_source_level", snapshot.columns)
            self.assertIn("has_reference_only", snapshot.columns)
            self.assertIn("rmuc_long_term_base_theta_mean", snapshot.columns)
            self.assertIn("rmuc_long_term_base_rating", snapshot.columns)
            self.assertIn("rmuc_long_term_school_alpha", snapshot.columns)
            self.assertIn("rmuc_long_term_school_component_mean", snapshot.columns)
            self.assertIn("rmuc_long_term_season_component_mean", snapshot.columns)
            self.assertIn("rmuc_long_term_recent_season_component_mean", snapshot.columns)
            self.assertIn("rmuc_long_term_terminal_season_component_mean", snapshot.columns)
            self.assertIn("rmuc_terminal_season_weight", snapshot.columns)
            self.assertIn("rmuc_long_term_base_source_seasons", snapshot.columns)
            self.assertIn("rmuc_long_term_base_latest_season", snapshot.columns)
            self.assertIn("shape_prior_signal", snapshot.columns)
            self.assertIn("rmul_ranking_signal", snapshot.columns)
            self.assertIn("regional_prior_delta_theta", snapshot.columns)
            self.assertIn("regional_prior_delta_rating", snapshot.columns)
            self.assertIn("regional_group_matches_played", snapshot.columns)
            self.assertIn("regional_pre_decay_factor", snapshot.columns)
            self.assertIn("regional_live_pre_residual_signal", snapshot.columns)
            self.assertIn("regional_live_pre_residual_rating", snapshot.columns)
            self.assertIn("rmuc_history_strength", snapshot.columns)
            self.assertIn("recent_evidence_support", snapshot.columns)
            self.assertIn("rmuc_regional_pre_rating", snapshot.columns)
            self.assertIn("rmuc_regional_pre_rank_96", snapshot.columns)
            self.assertIn("rmuc_live_state_theta_mean", snapshot.columns)
            self.assertIn("rmuc_live_state_rating", snapshot.columns)
            self.assertIn("rmuc_regional_live_rating", snapshot.columns)
            self.assertIn("rmuc_regional_live_rank_96", snapshot.columns)
            self.assertIn("pre_signal_sd", snapshot.columns)
            self.assertIn("pre_signal_conflict_flag", snapshot.columns)
            self.assertIn("is_rmuc_2026_team", snapshot.columns)
            self.assertTrue({"state_posterior", "school_prior_posterior"}.issuperset(set(snapshot["rating_source_level"].unique())))
            self.assertEqual(int(snapshot["is_rmuc_2026_team"].sum()), 96)
            self.assertTrue((snapshot["regional_pre_decay_factor"] <= 1.0).all())

            whut = snapshot[snapshot["school_name"] == "武汉工程大学"].iloc[0]
            self.assertTrue(bool(whut["is_rmuc_2026_team"]))
            self.assertIsNotNone(whut["shape_prior_signal"])
            self.assertIsNotNone(whut["rmul_ranking_signal"])
            self.assertGreater(float(whut["pre_signal_sd"]), 0.0)
            self.assertGreater(float(whut["rmuc_long_term_base_theta_mean"]), 0.0)

            regional_pre_path = root / "predict_rmuc_regional_pre.json"
            regional_pre_result = run_cli(
                "predict-rmuc-regional-pre",
                "--model",
                str(fit_dir),
                "--team-a",
                "上海交通大学",
                "--team-b",
                "东北大学",
                "--match-date",
                "2026-04-05",
                "--out",
                str(regional_pre_path),
            )
            self.assertEqual(regional_pre_result.returncode, 0, msg=regional_pre_result.stderr)
            regional_pre = json.loads(regional_pre_path.read_text(encoding="utf-8"))
            self.assertIn("base_component", regional_pre)
            self.assertIn("regional_prior_component", regional_pre)
            self.assertIn("total_probability", regional_pre)
            self.assertGreaterEqual(float(regional_pre["total_probability"]), 0.0)
            self.assertLessEqual(float(regional_pre["total_probability"]), 1.0)
            self.assertIn("rmuc_long_term_base", regional_pre["base_component"])

            regional_live_path = root / "predict_rmuc_regional_live.json"
            regional_live_result = run_cli(
                "predict-rmuc-regional-live",
                "--model",
                str(fit_dir),
                "--team-a",
                "上海交通大学",
                "--team-b",
                "东北大学",
                "--match-date",
                "2026-04-05",
                "--out",
                str(regional_live_path),
            )
            self.assertEqual(regional_live_result.returncode, 0, msg=regional_live_result.stderr)
            regional_live = json.loads(regional_live_path.read_text(encoding="utf-8"))
            self.assertIn("live_state_component", regional_live)
            self.assertIn("pre_residual_component", regional_live)
            self.assertIn("regional_prior_component", regional_live)
            self.assertIn("total_probability", regional_live)

            published_predict_path = root / "predict_published_regional_pre.json"
            published_predict_result = run_cli(
                "predict-from-published",
                "--published-dir",
                str(published_export_path.parent / "published_2026"),
                "--team-a",
                "上海交通大学",
                "--team-b",
                "东北大学",
                "--match-date",
                "2026-04-05",
                "--mode",
                "rmuc_regional_pre",
                "--out",
                str(published_predict_path),
            )
            self.assertEqual(published_predict_result.returncode, 0, msg=published_predict_result.stderr)
            published_prediction = json.loads(published_predict_path.read_text(encoding="utf-8"))
            self.assertIn("base_component", published_prediction)
            self.assertIn("regional_prior_component", published_prediction)
            self.assertIn("total_probability", published_prediction)

            repechage_path = root / "predict_rmuc_repechage.json"
            repechage_result = run_cli(
                "predict-rmuc-repechage",
                "--model",
                str(fit_dir),
                "--team-a",
                "上海交通大学",
                "--team-b",
                "东北大学",
                "--match-date",
                "2026-04-05",
                "--out",
                str(repechage_path),
            )
            self.assertEqual(repechage_result.returncode, 0, msg=repechage_result.stderr)
            repechage = json.loads(repechage_path.read_text(encoding="utf-8"))
            self.assertIn("live_state_component", repechage)
            self.assertNotIn("pre_residual_component", repechage)

            backtest_result = run_cli(
                "backtest",
                "--dataset",
                str(dataset_dir),
                "--config",
                str(config_path),
                "--scheme",
                "rolling_origin",
                "--out",
                str(backtest_dir),
            )
            self.assertEqual(backtest_result.returncode, 0, msg=backtest_result.stderr)
            self.assertTrue((backtest_dir / "backtest_report.json").exists())
            report = json.loads((backtest_dir / "backtest_report.json").read_text(encoding="utf-8"))
            self.assertIn("splits", report)
            self.assertGreaterEqual(len(report["splits"]), 2)
            self.assertIn("baseline", report["splits"][0])

            validation_dir = root / "validation_v1"
            validate_result = run_cli(
                "validate-model",
                "--model",
                str(fit_dir),
                "--dataset",
                str(dataset_dir),
                "--date",
                "2026-04-05",
                "--backtest-dir",
                str(backtest_dir),
                "--out",
                str(validation_dir),
            )
            self.assertEqual(validate_result.returncode, 0, msg=validate_result.stderr)
            self.assertTrue((validation_dir / "ratings_snapshot_2026rmul_final.parquet").exists())
            self.assertTrue((validation_dir / "baseline_intersection_compare.parquet").exists())
            self.assertTrue((validation_dir / "model_validation_2026rmul_final.md").exists())
            self.assertTrue((validation_dir / "rmuc_regional_pre_ranking_96.csv").exists())
            self.assertTrue((validation_dir / "rmuc_regional_live_ranking_96.csv").exists())
            self.assertTrue((validation_dir / "rmuc_regional_pre_ranking_96_human_review.csv").exists())
            validation_text = (validation_dir / "model_validation_2026rmul_final.md").read_text(encoding="utf-8")
            self.assertIn("RMUC program base", validation_text)
            self.assertIn("RMUC live-state", validation_text)
            self.assertIn("Top 20", validation_text)
            self.assertIn("交集学校对照", validation_text)


if __name__ == "__main__":
    unittest.main()
