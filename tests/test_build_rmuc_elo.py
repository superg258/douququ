from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_rmuc_elo as model  # noqa: E402


class BuildRmucEloTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.outputs = model.build_outputs()
        cls.feature_diagnostics = cls.outputs["evaluation_summary"]["feature_diagnostics"]
        cls.model_diagnostics = cls.outputs["evaluation_summary"][model.RATING_MODEL_VERSION]
        cls.leakage_checks = cls.outputs["evaluation_summary"]["leakage_checks"]

    def test_team_master_row_count(self) -> None:
        self.assertEqual(len(self.outputs["team_master_rows"]), 96)

    def test_global_school_pool_count(self) -> None:
        self.assertEqual(len(self.outputs["global_school_rows"]), 276)
        self.assertEqual(self.model_diagnostics["global_school_pool_size"], 276)

    def test_participants_column_removed(self) -> None:
        rows = model.read_csv(ROOT / "data" / "reference" / "2026_regionals" / "participants_1912.csv")
        self.assertEqual(list(rows[0].keys()), model.PARTICIPANTS_FIELDS)
        self.assertNotIn("rating_pre_2026_rmuc", rows[0])

    def test_robot_feature_coverage(self) -> None:
        coverage = self.model_diagnostics["feature_coverage"]
        self.assertEqual(coverage["robot_summary_2025"], 100)
        self.assertEqual(coverage["shape_rank_current_96"], 96)

    def test_robot_feature_diagnostics_rows(self) -> None:
        rows = self.outputs["robot_feature_rows"]
        self.assertEqual(len(rows), 77)
        self.assertTrue(all("z_robot25_raw" in row for row in rows))
        self.assertTrue(all("robot_stage_count" in row for row in rows))
        self.assertTrue(all("robot_stage_reliability" in row for row in rows))

    def test_robot_stage_reliability_is_increasing(self) -> None:
        reliabilities = [model.compute_robot_stage_reliability(count) for count in (1, 2, 3, 4)]
        self.assertEqual(reliabilities, sorted(reliabilities))
        self.assertTrue(all(left < right for left, right in zip(reliabilities, reliabilities[1:])))

    def test_rmuc_stage_mapping_supports_2024_and_2025_variants(self) -> None:
        self.assertEqual(model.classify_rmuc_stage("2024RMUC", "港澳台及海外赛区&复活赛第一赛段", "group"), "repechage_stage1")
        self.assertEqual(model.classify_rmuc_stage("2024RMUC", "全国赛", "knockout"), "national_knockout")
        self.assertEqual(model.classify_rmuc_stage("2025RMUC", "2025赛季全国赛", "group"), "national_group")

    def test_preseason_sigma_bounds(self) -> None:
        sigma_values = [float(row["sigma0"]) for row in self.outputs["preseason_rows"]]
        self.assertTrue(
            all(model.PRESEASON_SIGMA_FLOOR <= sigma <= model.PRESEASON_SIGMA_CEILING for sigma in sigma_values)
        )

    def test_preseason_rows_include_school_history_columns(self) -> None:
        row = self.outputs["preseason_rows"][0]
        for key in [
            "school_key",
            "prior_score",
            "prior_mu",
            "long_term_mu",
            "history_mu",
            "history_weight",
            "recent_form_mu",
            "recent_form_mu_calibrated",
            "recent_anchor_mu",
            "recent_momentum",
            "recent_level_gap",
            "level_adjustment",
            "momentum_adjustment",
            "shape_adjustment",
            "level_weight",
            "momentum_weight",
            "recent_weight",
            "recent_reliability",
            "recent_adjustment",
            "peer_match_count",
            "peer_consistency_adjustment",
            "new_school_compensation",
            "old_history_decay",
            "recent_gap",
            "level_gap",
            "coverage_2025",
            "effective_scale_2024",
            "effective_rho_2024_to_2025",
            "effective_rho_2025_to_2026",
            "group_summary_2024_damped_component",
            "history_mu_start_2024",
            "history_mu_end_2024",
            "history_mu_start_2025",
            "history_mu_end_2025",
            "history_mu_start_2026_rmul",
            "history_mu_end_2026_rmul",
            "recent_form_mu_start_2025",
            "recent_form_mu_end_2025",
            "recent_form_mu_start_2026_rmul",
            "recent_form_mu_end_2026_rmul",
            "n_matches_2024_rmuc",
            "n_eff_history",
            "evidence_mu",
            "evidence_weight",
            "disagreement_mu",
            "rating_model_version",
            "rank_score_2024_damped_component",
            "rank_score_2025_damped_component",
        ]:
            self.assertIn(key, row)
        self.assertTrue(all(row["rating_model_version"] == model.RATING_MODEL_VERSION for row in self.outputs["preseason_rows"]))

    def test_global_school_rows_include_expected_columns(self) -> None:
        row = self.outputs["global_school_rows"][0]
        for key in [
            "rank",
            "school_key",
            "college_name",
            "mu0",
            "long_term_mu",
            "history_mu",
            "recent_form_mu",
            "recent_form_mu_calibrated",
            "recent_anchor_mu",
            "recent_momentum",
            "recent_level_gap",
            "level_adjustment",
            "momentum_adjustment",
            "level_weight",
            "momentum_weight",
            "recent_adjustment",
            "recent_weight",
            "recent_reliability",
            "peer_match_count",
            "peer_consistency_adjustment",
            "new_school_compensation",
            "old_history_decay",
            "recent_gap",
            "level_gap",
            "history_mu_end_2024",
            "history_mu_end_2025",
            "history_mu_end_2026_rmul",
            "recent_form_mu_end_2025",
            "recent_form_mu_end_2026_rmul",
            "coverage_2025",
            "effective_scale_2024",
            "effective_rho_2024_to_2025",
            "effective_rho_2025_to_2026",
            "group_summary_2024_damped_component",
            "n_matches_2024_rmuc",
            "n_matches_2025_rmuc",
            "n_matches_2026_rmul",
            "n_eff_history",
            "history_weight",
            "rating_model_version",
        ]:
            self.assertIn(key, row)
        self.assertEqual(row["rating_model_version"], model.RATING_MODEL_VERSION)

    def test_preseason_rows_join_uniquely_to_school_history(self) -> None:
        global_by_school = {row["school_key"]: row for row in self.outputs["global_school_rows"]}
        self.assertEqual(len(global_by_school), 276)
        self.assertTrue(all(row["school_key"] in global_by_school for row in self.outputs["preseason_rows"]))

    def test_extracted_history_coverage_counts_match_full_source(self) -> None:
        coverage = self.outputs["evaluation_summary"]["data_coverage"]
        self.assertEqual(coverage["extracted_rmuc_2024_matches"], 350)
        self.assertEqual(coverage["extracted_rmuc_2025_matches"], 400)
        self.assertEqual(coverage["extracted_rmul_2026_matches"], 510)
        self.assertEqual(coverage["extracted_history_matches_total"], 1260)
        self.assertEqual(self.model_diagnostics["history_school_counts_by_event"]["2024RMUC"], 112)
        self.assertEqual(self.model_diagnostics["history_school_counts_by_event"]["2025RMUC"], 100)
        self.assertEqual(self.model_diagnostics["history_school_counts_by_event"]["2026RMUL"], 266)

    def test_alias_merges_are_captured(self) -> None:
        alias_rows = self.model_diagnostics["alias_merged_schools"]
        self.assertEqual(set(alias_rows["北京理工大学珠海学院"]), {"北京理工大学（珠海）", "北京理工大学珠海学院"})
        self.assertEqual(set(alias_rows["合肥工业大学(宣城校区)"]), {"合肥工业大学（宣城校区）", "合肥工业大学(宣城校区)"})
        self.assertGreaterEqual(self.model_diagnostics["alias_merge_count"], 2)

    def test_multi_team_school_is_collapsed_at_school_level(self) -> None:
        multi_team = self.model_diagnostics["multi_team_name_schools"]
        self.assertIn("福建师范大学", multi_team)
        self.assertEqual(set(multi_team["福建师范大学"]), {"PKA", "Pikachu"})

    def test_rmul_recent_reference_is_shrunk(self) -> None:
        rows = [row for row in self.outputs["preseason_rows"] if int(row["n_matches_2026_rmul"]) > 0]
        self.assertTrue(rows)
        self.assertTrue(
            all(abs(float(row["z_26rmul"])) <= abs(float(row["z_26rmul_raw"])) + 1e-9 for row in rows)
        )
        self.assertTrue(any(abs(float(row["z_26rmul"])) < abs(float(row["z_26rmul_raw"])) for row in rows))
        self.assertTrue(
            all(0.0 <= float(row["rmul_reliability"]) <= model.RMUL_3V3_RELIABILITY_CAP + 1e-9 for row in rows)
        )

    def test_rank_score_features_removed(self) -> None:
        row = self.outputs["preseason_rows"][0]
        self.assertNotIn("z_25perf", row)
        self.assertNotIn("tilde_z_25perf", row)
        self.assertNotIn("z_24", row)
        self.assertNotIn("tilde_z_form", row)
        self.assertNotIn("tilde_z_robot25", row)
        self.assertIn("z_form", row)
        excluded = self.feature_diagnostics["excluded_sources"]
        self.assertEqual(excluded, ["2026RMUL robot_data.csv"])
        removed = self.feature_diagnostics["removed_features"]
        self.assertEqual(removed, ["seed_rank_in_region", "seed_tier"])
        self.assertTrue(self.leakage_checks["ranking_1884_only_in_2026_rmul_start_prior"])
        self.assertTrue(self.leakage_checks["shape_rank_only_in_final_output_prior"])
        self.assertFalse(self.leakage_checks["seed_rank_in_region_used_in_model"])
        self.assertFalse(self.leakage_checks["seed_tier_used_in_model"])
        self.assertEqual(self.model_diagnostics["prior_component_weights"]["2026RMUL"]["ranking_1884"], 0.03)
        self.assertEqual(self.model_diagnostics["prior_component_weights"]["2026RMUL"]["recent_2025_form_prior"], 0.45)

    def test_walk_forward_prediction_rows_exist(self) -> None:
        self.assertGreater(len(self.outputs["predictions"]), 0)

    def test_mid_table_distribution_is_no_longer_tightly_packed(self) -> None:
        rows = sorted(self.outputs["preseason_rows"], key=lambda row: float(row["mu0"]), reverse=True)
        middle = rows[31:64]
        spread = float(middle[0]["mu0"]) - float(middle[-1]["mu0"])
        gaps = [float(middle[idx]["mu0"]) - float(middle[idx + 1]["mu0"]) for idx in range(len(middle) - 1)]
        self.assertGreaterEqual(spread, 40.0)
        self.assertGreaterEqual(sorted(gaps)[len(gaps) // 2], 0.5)

    def test_history_weight_matches_formula(self) -> None:
        rows = self.outputs["preseason_rows"]
        for row in rows[:20]:
            n_eff = float(row["n_eff_history"])
            expected = n_eff / (n_eff + model.HISTORY_WEIGHT_OFFSET) if n_eff > 0 else 0.0
            self.assertAlmostEqual(float(row["history_weight"]), expected, places=6)

    def test_strong_history_teams_get_higher_history_weight(self) -> None:
        rows = self.outputs["preseason_rows"]
        strong = [float(row["history_weight"]) for row in rows if float(row["n_eff_history"]) >= 15.0]
        weak = [float(row["history_weight"]) for row in rows if float(row["n_eff_history"]) <= 3.0]
        self.assertTrue(strong)
        self.assertTrue(weak)
        self.assertGreater(sum(strong) / len(strong), sum(weak) / len(weak))

    def test_recent_form_adjustment_is_present(self) -> None:
        evaluations = self.outputs["evaluation_summary"]["evaluations"]
        current = evaluations[f"rmul_2026_{model.RATING_MODEL_VERSION}"]
        self.assertEqual(current["matches"], 510)
        self.assertIn(f"rmul_2026_{model.PREVIOUS_DYNAMIC_SCHOOL_VERSION}_reference", evaluations)
        adjusted_rows = [
            row for row in self.outputs["preseason_rows"] if abs(float(row["recent_adjustment"])) > 1e-6
        ]
        self.assertTrue(adjusted_rows)
        self.assertTrue(any(float(row["mu0"]) != float(row["long_term_mu"]) for row in adjusted_rows))
        self.assertTrue(any(abs(float(row["recent_momentum"])) > 1e-6 for row in adjusted_rows))

    def test_rmul_series_updates_use_microgames(self) -> None:
        update_20 = model.average_ordered_series_update(1600.0, 1500.0, 2, 0, 18.0)
        update_21 = model.average_ordered_series_update(1600.0, 1500.0, 2, 1, 18.0)
        update_11 = model.average_ordered_series_update(1600.0, 1500.0, 1, 1, 18.0)
        single_share_delta = 18.0 * (0.5 - model.logistic_expectation(100.0))

        self.assertEqual(update_20["microgame_count"], 2.0)
        self.assertEqual(update_20["sequence_count"], 1.0)
        self.assertEqual(update_21["microgame_count"], 3.0)
        self.assertEqual(update_21["sequence_count"], 3.0)
        self.assertEqual(update_11["microgame_count"], 2.0)
        self.assertEqual(update_11["sequence_count"], 2.0)
        self.assertNotAlmostEqual(update_11["red_delta"], single_share_delta, places=6)

    def test_rmul_per_game_diagnostics_are_recorded(self) -> None:
        recent_config = self.model_diagnostics["recent_form_config"]
        self.assertEqual(self.model_diagnostics["score_model"], "rmuc_match_share_rmul_per_game")
        self.assertEqual(recent_config["rmul_update_granularity"], "per_game")
        self.assertEqual(recent_config["rmul_k_budget_policy"], "match_budget_preserved")
        self.assertEqual(recent_config["rmul_order_policy"], "average_all_legal_sequences")
        self.assertGreater(recent_config["rmul_microgame_count"], recent_config["rmul_series_count"])
        self.assertGreater(recent_config["rmul_avg_games_per_match"], 1.0)

    def test_recent_weight_floor_applies_to_new_school_breakouts(self) -> None:
        rows = [
            row
            for row in self.outputs["preseason_rows"]
            if int(row["n_matches_2024_rmuc"]) == 0
            and int(row["n_matches_2025_rmuc"]) <= 2
            and int(row["n_matches_2026_rmul"]) > 0
        ]
        self.assertTrue(rows)
        self.assertTrue(
            all(float(row["momentum_weight"]) >= model.MOMENTUM_WEIGHT_NEW_SCHOOL_FLOOR - 1e-9 for row in rows)
        )

    def test_recent_momentum_uses_recent_2025_anchor(self) -> None:
        row = next(row for row in self.outputs["preseason_rows"] if row["college_name"] == "哈尔滨工业大学")
        expected = float(row["recent_form_mu_end_2026_rmul"]) - float(row["recent_form_mu_end_2025"])
        clipped = max(model.RECENT_MOMENTUM_MIN, min(model.RECENT_MOMENTUM_MAX, expected))
        self.assertAlmostEqual(float(row["recent_anchor_mu"]), float(row["recent_form_mu_end_2025"]), places=6)
        self.assertAlmostEqual(float(row["recent_momentum"]), clipped, delta=1e-5)

    def test_recent_level_gap_uses_calibrated_recent_scale(self) -> None:
        row = next(row for row in self.outputs["preseason_rows"] if row["college_name"] == "中国科学技术大学")
        expected = float(row["recent_form_mu_end_2026_rmul"]) - float(row["long_term_mu"])
        clipped = max(model.RECENT_LEVEL_GAP_MIN, min(model.RECENT_LEVEL_GAP_MAX, expected))
        self.assertAlmostEqual(float(row["recent_form_mu_calibrated"]), float(row["recent_form_mu"]), places=6)
        self.assertAlmostEqual(float(row["recent_level_gap"]), clipped, delta=1e-5)

    def test_recent_calibration_config_is_recorded(self) -> None:
        calibration = self.model_diagnostics["recent_form_config"]["calibration"]
        self.assertGreater(calibration["anchor_count"], 0)
        self.assertGreaterEqual(calibration["scale"], model.RECENT_CALIBRATION_SCALE_MIN)
        self.assertLessEqual(calibration["scale"], model.RECENT_CALIBRATION_SCALE_MAX)

    def test_recent_2025_prior_is_zero_without_coverage(self) -> None:
        row = next(row for row in self.outputs["source_feature_rows"] if row["college_name"] == "西交利物浦大学")
        self.assertEqual(float(row["recent_2025_form_prior_component"]), 0.0)
        self.assertEqual(float(row["coverage_2025"]), 0.0)
        self.assertEqual(float(row["effective_rho_2025_to_2026"]), 0.0)

    def test_2024_to_2025_retention_is_damped(self) -> None:
        selected = self.model_diagnostics["selected_config"]
        self.assertIn("effective_rho_2024_to_2025", selected)
        self.assertLess(float(selected["effective_rho_2024_to_2025"]), float(selected["rho_2024_to_2025"]))
        self.assertAlmostEqual(
            float(selected["effective_rho_2024_to_2025"]),
            float(selected["rho_2024_to_2025"]) * model.SEASON_2024_TO_2025_RETENTION_DAMPING,
            places=6,
        )

    def test_2024_prior_scale_is_damped(self) -> None:
        selected = self.model_diagnostics["selected_config"]
        self.assertIn("effective_scale_2024", selected)
        self.assertAlmostEqual(
            float(selected["effective_scale_2024"]),
            float(selected["prior_scales"]["scale_2024"]) * model.SEASON_2024_PRIOR_SCALE_DAMPING,
            places=6,
        )

    def test_group_summary_2024_component_is_damped(self) -> None:
        row = next(row for row in self.outputs["source_feature_rows"] if row["college_name"] == "中国科学技术大学")
        self.assertAlmostEqual(
            float(row["group_summary_2024_damped_component"]),
            float(row["group_summary_2024_component"]) * model.GROUP_SUMMARY_2024_DAMPING,
            places=6,
        )

    def test_rank_score_components_are_damped(self) -> None:
        row = next(row for row in self.outputs["source_feature_rows"] if row["college_name"] == "西安电子科技大学")
        self.assertAlmostEqual(
            float(row["rank_score_2024_damped_component"]),
            float(row["rank_score_2024_component"]) * model.RANK_SCORE_2024_DAMPING,
            places=6,
        )
        self.assertAlmostEqual(
            float(row["rank_score_2025_damped_component"]),
            float(row["rank_score_2025_component"]) * model.RANK_SCORE_2025_DAMPING,
            places=6,
        )

    def test_new_school_compensation_is_positive_for_rmul_only_breakouts(self) -> None:
        for college_name in ["江南大学霞客湾校区", "复旦大学"]:
            row = next(row for row in self.outputs["preseason_rows"] if row["college_name"] == college_name)
            self.assertGreater(float(row["new_school_compensation"]), 0.0)

    def test_old_history_decay_penalizes_stale_legacy_profile(self) -> None:
        row = next(row for row in self.outputs["preseason_rows"] if row["college_name"] == "南方科技大学")
        self.assertGreater(float(row["old_history_decay"]), 0.0)

    def test_balance_adjustment_config_is_recorded(self) -> None:
        balance = self.model_diagnostics["balance_adjustments"]
        self.assertEqual(balance["new_school_compensation_base"], model.NEW_SCHOOL_COMPENSATION_BASE)
        self.assertEqual(balance["old_history_decay_cap"], model.OLD_HISTORY_DECAY_CAP)
        self.assertEqual(balance["old_history_decay_min_current_matches"], model.OLD_HISTORY_DECAY_MIN_CURRENT_MATCHES)

    def test_shape_curve_steepens_after_rank_80_and_88(self) -> None:
        rows_by_rank = {
            int(row["shape_rank"]): row
            for row in self.outputs["source_feature_rows"]
        }
        shape_80 = float(rows_by_rank[80]["shape_prior_component"])
        shape_88 = float(rows_by_rank[88]["shape_prior_component"])
        shape_89 = float(rows_by_rank[89]["shape_prior_component"])
        shape_96 = float(rows_by_rank[96]["shape_prior_component"])
        self.assertLess(shape_88, shape_80 - 0.30)
        self.assertLess(shape_89, shape_88 - 0.05)
        self.assertLess(shape_96, shape_88 - 1.50)

    def test_shape_adjustment_penalizes_failed_initial_review_tail_more_harshly(self) -> None:
        failed_tail_rows = [
            row
            for row in self.outputs["preseason_rows"]
            if int(row["shape_rank"]) >= 89
        ]
        self.assertTrue(failed_tail_rows)
        self.assertTrue(any(float(row["shape_adjustment"]) <= -12.0 for row in failed_tail_rows))

    def test_targeted_ranks_are_no_longer_below_xjtlu(self) -> None:
        ranking = {row["college_name"]: int(row["rank"]) for row in self.outputs["ranking_current_rows"]}
        self.assertGreaterEqual(ranking["西交利物浦大学"], 31)
        self.assertLess(ranking["东南大学"], ranking["西交利物浦大学"])
        self.assertLess(ranking["南京航空航天大学金城学院"], ranking["西交利物浦大学"])
        self.assertLess(ranking["哈尔滨工业大学（深圳）"], ranking["西交利物浦大学"])

    def test_hit_and_heu_have_positive_momentum_when_recent_channel_improves(self) -> None:
        for college_name in ["哈尔滨工业大学", "哈尔滨工程大学"]:
            row = next(row for row in self.outputs["preseason_rows"] if row["college_name"] == college_name)
            if float(row["recent_form_mu_end_2026_rmul"]) > float(row["recent_form_mu_end_2025"]):
                self.assertGreater(float(row["recent_momentum"]), 0.0)
                self.assertGreater(float(row["momentum_adjustment"]), 0.0)

    def test_peer_consistency_adjustment_is_present_for_current_96(self) -> None:
        rows = [row for row in self.outputs["preseason_rows"] if int(row["peer_match_count"]) > 0]
        self.assertTrue(rows)
        self.assertTrue(any(abs(float(row["peer_consistency_adjustment"])) > 1e-6 for row in rows))

    def test_ustc_reaches_top_six(self) -> None:
        row = next(row for row in self.outputs["ranking_current_rows"] if row["college_name"] == "中国科学技术大学")
        self.assertLessEqual(int(row["rank"]), 6)

    def test_ranking_current_rows_follow_preseason_mu_order(self) -> None:
        ranking_rows = self.outputs["ranking_current_rows"]
        preseason_rows = self.outputs["preseason_rows"]
        expected = sorted(
            preseason_rows,
            key=lambda row: (-float(row["mu0"]), row["college_name"], row["team_name"]),
        )
        self.assertEqual(len(ranking_rows), len(preseason_rows))
        self.assertEqual(int(ranking_rows[0]["rank"]), 1)
        self.assertEqual(int(ranking_rows[-1]["rank"]), len(ranking_rows))
        self.assertEqual(
            [(row["college_name"], row["team_name"]) for row in ranking_rows[:10]],
            [(row["college_name"], row["team_name"]) for row in expected[:10]],
        )
        self.assertTrue(all("rating_model_version" in row for row in ranking_rows))

    def test_top_of_table_is_not_flattened(self) -> None:
        top_rows = self.outputs["ranking_current_rows"][:10]
        mu_values = [float(row["mu0"]) for row in top_rows]
        self.assertGreater(max(mu_values) - min(mu_values), 60.0)
        self.assertGreaterEqual(len({round(value, 6) for value in mu_values}), 7)


if __name__ == "__main__":
    unittest.main()
