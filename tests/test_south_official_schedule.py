from __future__ import annotations

import random
import sys
import types
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_rmuc_elo as legacy_elo  # noqa: E402

if "build_rmuc_ts2_backend" not in sys.modules:
    ts2_stub = types.ModuleType("build_rmuc_ts2_backend")
    ts2_stub.ROOT = ROOT
    ts2_stub.DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"
    ts2_stub.make_team_key = legacy_elo.make_team_key
    sys.modules["build_rmuc_ts2_backend"] = ts2_stub

import simulate_region  # noqa: E402


region_core = simulate_region.region_core

OFFICIAL_TIER1_SLOTS = {"A1", "A3", "A5", "A7", "B1", "B3", "B5", "B7"}
OFFICIAL_TIER2_SLOTS = {"A2", "A4", "A6", "A8", "B2", "B4", "B6", "B8"}
OFFICIAL_UNSEEDED_SLOTS = {
    *{f"A{index}" for index in range(9, 17)},
    *{f"B{index}" for index in range(9, 17)},
}


def _team(index: int) -> region_core.RegionTeam:
    return region_core.RegionTeam(
        team_key=f"team-{index}",
        college_name=f"Team {index}",
        team_name=f"T{index}",
        admitted_region="南部赛区",
        seed_tier="unseeded",
        seed_rank_in_region=index,
        ranking_global_rank=index,
        shape_rank=index,
        mu0=1500.0 + index,
        sigma0=30.0,
        z_25game=0.0,
        z_robot25_raw=0.0,
        z_26rmul=0.0,
        z_form=0.0,
        tilde_z_hist=0.0,
        n_matches_2025_rmuc=0,
        n_matches_2026_rmul=0,
        robot_stage_reliability=0.0,
        simulation_mu=1500.0 + index,
        match_sigma=10.0,
    )


def _capture_qualification_pairs(region: str) -> list[tuple[str, list[tuple[str, str]]]]:
    losers = [_team(index) for index in range(1, 9)]
    captured: list[tuple[str, list[tuple[str, str]]]] = []
    original = region_core.simulate_named_round

    def fake_simulate_named_round(
        stage: str,
        match_names: list[str],
        pairs: list[tuple[region_core.RegionTeam, region_core.RegionTeam]],
        **_: Any,
    ) -> tuple[list[region_core.RegionTeam], list[region_core.RegionTeam], list[dict[str, str]]]:
        captured.append((stage, [(left.college_name, right.college_name) for left, right in pairs]))
        rows = [{"winner_next": "tbd", "loser_next": "tbd"} for _pair in pairs]
        return [left for left, _right in pairs], [right for _left, right in pairs], rows

    region_core.simulate_named_round = fake_simulate_named_round
    try:
        region_core.simulate_qualification_path(
            region,
            losers,
            rng=random.Random(20260414),
            head_to_head_index={},
            samples=0,
        )
    finally:
        region_core.simulate_named_round = original

    return captured


class SouthOfficialScheduleTests(unittest.TestCase):
    def test_school_rename_aliases_share_one_canonical_team_key(self) -> None:
        self.assertEqual(legacy_elo.normalize_school("华北科技学院"), "应急管理大学")
        self.assertEqual(legacy_elo.normalize_school("应急管理学院"), "应急管理大学")
        self.assertEqual(legacy_elo.normalize_school("应急管理大学"), "应急管理大学")
        self.assertEqual(legacy_elo.make_team_key("华北科技学院", "风暴"), "应急管理大学::风暴")
        self.assertEqual(legacy_elo.make_team_key("应急管理学院", "风暴"), "应急管理大学::风暴")

    def test_official_seed_lists_match_2026_manual_corrections(self) -> None:
        east = simulate_region.parse_team_rows("东部赛区", simulate_region.DEFAULT_RATINGS_CSV)
        north = simulate_region.parse_team_rows("北部赛区", simulate_region.DEFAULT_RATINGS_CSV)

        east_by_name = {(team.college_name, team.team_name): team for team in east}
        north_by_name = {(team.college_name, team.team_name): team for team in north}

        hefei = east_by_name[("合肥工业大学", "苍穹")]
        zhongbei = east_by_name[("中北大学", "606")]
        emergency = north_by_name[("应急管理大学", "风暴")]

        self.assertEqual((hefei.seed_rank_in_region, hefei.seed_tier), (16, "tier2"))
        self.assertEqual((zhongbei.seed_rank_in_region, zhongbei.seed_tier), (17, "unseeded"))
        self.assertEqual(emergency.team_key, "应急管理大学::风暴")
        self.assertEqual((emergency.seed_rank_in_region, emergency.seed_tier), (13, "tier2"))

    def test_south_draw_slots_keep_second_tier_out_of_unseeded_positions(self) -> None:
        for seed in (20260414, 20261111, 20260512):
            with self.subTest(seed=seed):
                teams = simulate_region.parse_team_rows("南部赛区", simulate_region.DEFAULT_RATINGS_CSV)
                slot_rows = region_core.assign_region_slots(teams, random.Random(seed))

                tier_by_slot = {row["slot"]: row["seed_tier"] for row in slot_rows}
                self.assertEqual({tier_by_slot[slot] for slot in OFFICIAL_TIER1_SLOTS}, {"tier1"})
                self.assertEqual({tier_by_slot[slot] for slot in OFFICIAL_TIER2_SLOTS}, {"tier2"})
                self.assertEqual({tier_by_slot[slot] for slot in OFFICIAL_UNSEEDED_SLOTS}, {"unseeded"})

    def test_south_semifinals_follow_official_qf_cross_paths(self) -> None:
        self.assertEqual(
            region_core.SEMIFINAL_MAPPING,
            [
                ("QF-1", "QF-3"),
                ("QF-2", "QF-4"),
            ],
        )

    def test_south_qualification_pairs_follow_official_winner_paths(self) -> None:
        self.assertEqual(
            _capture_qualification_pairs("南部赛区"),
            [
                (
                    "qualification_round1",
                    [
                        ("Team 1", "Team 2"),
                        ("Team 4", "Team 3"),
                        ("Team 5", "Team 6"),
                        ("Team 8", "Team 7"),
                    ],
                ),
                (
                    "qualification_round2",
                    [
                        ("Team 1", "Team 5"),
                        ("Team 4", "Team 8"),
                    ],
                ),
            ],
        )

    def test_east_qualification_repechage_pairs_follow_csv_loser_paths(self) -> None:
        self.assertEqual(
            _capture_qualification_pairs("东部赛区"),
            [
                (
                    "qualification_round1",
                    [
                        ("Team 1", "Team 2"),
                        ("Team 4", "Team 3"),
                        ("Team 5", "Team 6"),
                        ("Team 8", "Team 7"),
                    ],
                ),
                (
                    "qualification_round2",
                    [
                        ("Team 2", "Team 6"),
                        ("Team 3", "Team 7"),
                    ],
                ),
            ],
        )

    def test_north_qualification_paths_follow_csv_winner_and_loser_paths(self) -> None:
        self.assertEqual(
            _capture_qualification_pairs("北部赛区"),
            [
                (
                    "qualification_round1",
                    [
                        ("Team 1", "Team 2"),
                        ("Team 4", "Team 3"),
                        ("Team 5", "Team 6"),
                        ("Team 8", "Team 7"),
                    ],
                ),
                (
                    "qualification_round2",
                    [
                        ("Team 1", "Team 5"),
                        ("Team 4", "Team 8"),
                    ],
                ),
                (
                    "qualification_round2",
                    [
                        ("Team 2", "Team 6"),
                        ("Team 3", "Team 7"),
                    ],
                ),
            ],
        )

    def test_swiss_round1_b_group_red_blue_orientation_follows_csv(self) -> None:
        self.assertEqual(
            region_core.SWISS_ROUND1_PAIRINGS["B"],
            [
                ("B9", "B1"),
                ("B10", "B2"),
                ("B3", "B11"),
                ("B4", "B12"),
                ("B13", "B5"),
                ("B14", "B6"),
                ("B7", "B15"),
                ("B8", "B16"),
            ],
        )

    def test_round5_pairings_follow_csv_rank_positions_for_all_regions(self) -> None:
        teams = [_team(index) for index in range(1, 17)]
        for index, team in enumerate(teams, start=1):
            team.group_name = "A"
            team.slot = f"A{index}"
            team.mu0 = 1500.0
            if index <= 5:
                team.swiss_wins = 3
                team.swiss_losses = 1
                team.swiss_qualified_round = 4
            elif index <= 11:
                team.swiss_wins = 2
                team.swiss_losses = 2
            else:
                team.swiss_wins = 1
                team.swiss_losses = 3
                team.swiss_eliminated_round = 4

        teams_by_key = {team.team_key: team for team in teams}

        self.assertEqual(
            [(left.college_name, right.college_name) for left, right in region_core.round5_csv_pairings("A", teams, teams_by_key)],
            [
                ("Team 6", "Team 11"),
                ("Team 10", "Team 7"),
                ("Team 8", "Team 9"),
            ],
        )

        self.assertEqual(
            [(left.college_name, right.college_name) for left, right in region_core.round5_csv_pairings("B", teams, teams_by_key)],
            [
                ("Team 11", "Team 6"),
                ("Team 7", "Team 10"),
                ("Team 9", "Team 8"),
            ],
        )

    def test_mock_south_rules_schedule_maps_today_to_day2_and_keeps_day5_label_times(self) -> None:
        import seed_rmuc_live_mock

        schedule = seed_rmuc_live_mock.load_rules_schedule(
            seed_rmuc_live_mock.DEFAULT_RULES_SCHEDULE,
            today_date_text="2026-05-06",
            today_day=2,
            timezone_name="Asia/Shanghai",
        )

        self.assertEqual(len(schedule), 88)
        self.assertEqual(schedule["A-SWISS-2-1"].planned_start_at, "2026-05-05T20:00:00+08:00")
        self.assertEqual(schedule["A-SWISS-2-5"].planned_start_at, "2026-05-06T08:30:00+08:00")
        self.assertEqual(schedule["A-SWISS-3-8"].planned_start_at, "2026-05-06T21:35:00+08:00")
        self.assertEqual(schedule["SF-1"].planned_start_at, "2026-05-09T10:50:00+08:00")
        self.assertEqual(schedule["SF-2"].planned_start_at, "2026-05-09T11:25:00+08:00")
        self.assertEqual(schedule["QUAL-2-1"].planned_start_at, "2026-05-09T13:00:00+08:00")
        self.assertEqual(schedule["QUAL-2-2"].planned_start_at, "2026-05-09T13:35:00+08:00")
        self.assertEqual(schedule["FINAL-1"].planned_start_at, "2026-05-09T15:10:00+08:00")

    def test_mock_south_rules_schedule_selects_post_group_matches_by_rule_order(self) -> None:
        import seed_rmuc_live_mock

        normalized = seed_rmuc_live_mock.build_mock_normalized(
            region_slug="south_region",
            seed=20260414,
            samples=32,
            match_count=84,
            upcoming_count=0,
            start_at=seed_rmuc_live_mock.DEFAULT_START_AT,
            interval_minutes=25,
            use_rules_schedule=True,
            rules_schedule=seed_rmuc_live_mock.DEFAULT_RULES_SCHEDULE,
            today_date="2026-05-06",
            today_day=2,
            timezone_name="Asia/Shanghai",
        )

        tail = normalized["regions"]["south_region"]["matches"][-4:]
        self.assertEqual(
            [(match["orderNumber"], match["ruleOrderNumber"], match["matchLabel"]) for match in tail],
            [
                (81, 81, "QUAL-1-3"),
                (82, 82, "QUAL-1-4"),
                (83, 83, "SF-1"),
                (84, 84, "SF-2"),
            ],
        )
        self.assertNotIn("QUAL-2-1", {match["matchLabel"] for match in normalized["regions"]["south_region"]["matches"]})

    def test_mock_south_rules_schedule_keeps_semifinal_before_qualification_round2(self) -> None:
        import seed_rmuc_live_mock

        normalized = seed_rmuc_live_mock.build_mock_normalized(
            region_slug="south_region",
            seed=20260414,
            samples=32,
            match_count=88,
            upcoming_count=0,
            start_at=seed_rmuc_live_mock.DEFAULT_START_AT,
            interval_minutes=25,
            use_rules_schedule=True,
            rules_schedule=seed_rmuc_live_mock.DEFAULT_RULES_SCHEDULE,
            today_date="2026-05-06",
            today_day=2,
            timezone_name="Asia/Shanghai",
        )
        by_order = {
            int(match["orderNumber"]): (match["officialMatchId"], match["matchLabel"], match["stage"])
            for match in normalized["regions"]["south_region"]["matches"]
        }

        self.assertEqual(by_order[83], ("MOCK-SOUTH-083", "SF-1", "semifinal"))
        self.assertEqual(by_order[84], ("MOCK-SOUTH-084", "SF-2", "semifinal"))
        self.assertEqual(by_order[85], ("MOCK-SOUTH-085", "QUAL-2-1", "qualification_round2"))
        self.assertEqual(by_order[86], ("MOCK-SOUTH-086", "QUAL-2-2", "qualification_round2"))

    def test_swiss_round2_to_round4_red_blue_orientation_follows_csv_rank_positions(self) -> None:
        teams = [_team(index) for index in range(1, 17)]
        for index, team in enumerate(teams, start=1):
            team.group_name = "A"
            team.slot = f"A{index}"
            team.mu0 = 1500.0

        teams_by_key = {team.team_key: team for team in teams}

        for round_number in (2, 3):
            with self.subTest(round=round_number, group="A"):
                self.assertEqual(
                    [
                        (left.college_name, right.college_name)
                        for left, right in region_core.swiss_csv_rank_pairings(round_number, "A", teams, teams_by_key)
                    ],
                    [
                        ("Team 1", "Team 2"),
                        ("Team 3", "Team 4"),
                        ("Team 6", "Team 5"),
                        ("Team 8", "Team 7"),
                        ("Team 9", "Team 10"),
                        ("Team 11", "Team 12"),
                        ("Team 14", "Team 13"),
                        ("Team 16", "Team 15"),
                    ],
                )

            with self.subTest(round=round_number, group="B"):
                self.assertEqual(
                    [
                        (left.college_name, right.college_name)
                        for left, right in region_core.swiss_csv_rank_pairings(round_number, "B", teams, teams_by_key)
                    ],
                    [
                        ("Team 2", "Team 1"),
                        ("Team 4", "Team 3"),
                        ("Team 5", "Team 6"),
                        ("Team 7", "Team 8"),
                        ("Team 10", "Team 9"),
                        ("Team 12", "Team 11"),
                        ("Team 13", "Team 14"),
                        ("Team 15", "Team 16"),
                    ],
                )

        for team in teams[:2]:
            team.swiss_wins = 3
            team.swiss_losses = 0
            team.swiss_qualified_round = 3
        for team in teams[-2:]:
            team.swiss_wins = 0
            team.swiss_losses = 3
            team.swiss_eliminated_round = 3

        self.assertEqual(
            [
                (left.college_name, right.college_name)
                for left, right in region_core.swiss_csv_rank_pairings(4, "A", teams, teams_by_key)
            ],
            [
                ("Team 3", "Team 4"),
                ("Team 6", "Team 5"),
                ("Team 8", "Team 7"),
                ("Team 9", "Team 10"),
                ("Team 11", "Team 12"),
                ("Team 14", "Team 13"),
            ],
        )
        self.assertEqual(
            [
                (left.college_name, right.college_name)
                for left, right in region_core.swiss_csv_rank_pairings(4, "B", teams, teams_by_key)
            ],
            [
                ("Team 4", "Team 3"),
                ("Team 5", "Team 6"),
                ("Team 7", "Team 8"),
                ("Team 10", "Team 9"),
                ("Team 12", "Team 11"),
                ("Team 13", "Team 14"),
            ],
        )

    def test_swiss_ranking_metrics_expose_official_fields_without_simulating_hp_damage(self) -> None:
        teams = [_team(index) for index in range(1, 4)]
        teams[0].swiss_opponents = [teams[1].team_key, teams[2].team_key]
        teams[1].swiss_game_wins = 4
        teams[1].swiss_game_losses = 2
        teams[2].swiss_game_wins = 1
        teams[2].swiss_game_losses = 3
        teams_by_key = {team.team_key: team for team in teams}

        metrics = region_core.swiss_ranking_metrics(teams[0], teams_by_key)

        self.assertEqual(metrics["opponent_score"], 0)
        self.assertIsNone(metrics["official_opponent_points"])
        self.assertIsNone(metrics["official_avg_base_hp_diff"])
        self.assertIsNone(metrics["official_avg_team_damage"])
        self.assertEqual(metrics["ranking_metric_source"], "simulation_proxy")


if __name__ == "__main__":
    unittest.main()
