from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path

import pandas as pd

from research.trueskill2.live_archive import (
    build_archive_manifest,
    build_form_observation_frame,
    build_live_form_observation_frame,
    extract_group_rank_form_metrics,
    extract_robot_form_metrics,
    select_snapshot_before,
)
from research.trueskill2.season_delta import (
    SeasonDeltaConfig,
    apply_result_sigma_inflation,
    adjust_form_observation_for_freshness,
    compute_form_freshness_weight,
    compute_effective_sigma_theta,
    compute_event_form_freshness,
    compute_group_stage_sigma_floor,
    compute_form_observation,
    compute_match_result_observations,
    compute_opponent_adjusted_form_observation,
    compute_result_sigma_inflation,
    compute_result_momentum_update,
    compute_robot_gate_weight,
    fuse_observation,
)
from research.trueskill2.strategy_backtest import run_strategy_backtest, run_strategy_replay
from research.trueskill2 import cli as trueskill2_cli


def _group_rank_payload() -> dict[str, object]:
    return {
        "zones": [
            {
                "zoneName": "南部赛区",
                "groups": [
                    {
                        "groupName": "A组",
                        "groupPlayers": [
                            [
                                {"itemName": "排名", "itemValue": 1},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "Alpha University",
                                        "teamName": "Alpha",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "2/0/0"},
                                {"itemName": "时均总基地净胜血量", "itemValue": 220},
                                {"itemName": "时均全队总伤害血量", "itemValue": 3200},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 2},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "Beta University",
                                        "teamName": "Beta",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/1"},
                                {"itemName": "时均总基地净胜血量", "itemValue": 0},
                                {"itemName": "时均全队总伤害血量", "itemValue": 1500},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 3},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "Gamma University",
                                        "teamName": "Gamma",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "0/0/2"},
                                {"itemName": "时均总基地净胜血量", "itemValue": -160},
                                {"itemName": "时均全队总伤害血量", "itemValue": 600},
                            ],
                        ],
                    }
                ],
            }
        ]
    }


def _robot_payload() -> dict[str, object]:
    return {
        "zones": [
            {
                "zoneName": "南部赛区",
                "teams": [
                    {
                        "collegeName": "Alpha University",
                        "name": "Alpha",
                        "robots": [
                            {"type": "Infantry", "eagHurt": 900, "gKillCount": 2.5, "eagKdaScore": 2.2, "gkDamage": 90},
                            {"type": "Hero", "eagHurt": 120, "gKillCount": 0.8, "eagKdaScore": 1.0, "gkDamage": 320},
                        ],
                    },
                    {
                        "collegeName": "Beta University",
                        "name": "Beta",
                        "robots": [
                            {"type": "Infantry", "eagHurt": 360, "gKillCount": 1.0, "eagKdaScore": 0.7, "gkDamage": 40},
                            {"type": "Hero", "eagHurt": 40, "gKillCount": 0.2, "eagKdaScore": 0.4, "gkDamage": 80},
                        ],
                    },
                    {
                        "collegeName": "Gamma University",
                        "name": "Gamma",
                        "robots": [
                            {"type": "Infantry", "eagHurt": 120, "gKillCount": 0.2, "eagKdaScore": 0.2, "gkDamage": 15},
                            {"type": "Hero", "eagHurt": 0, "gKillCount": 0.0, "eagKdaScore": 0.1, "gkDamage": 10},
                        ],
                    },
                ],
            }
        ]
    }


def test_effective_sigma_grows_with_prior_shift_and_weak_history() -> None:
    cfg = SeasonDeltaConfig()

    low_shift = compute_effective_sigma_theta(
        pre_signal_sd=0.20,
        regional_prior_delta_theta=0.20,
        rmuc_history_strength=0.80,
        config=cfg,
    )
    high_shift = compute_effective_sigma_theta(
        pre_signal_sd=0.20,
        regional_prior_delta_theta=1.10,
        rmuc_history_strength=0.80,
        config=cfg,
    )
    weak_history = compute_effective_sigma_theta(
        pre_signal_sd=0.20,
        regional_prior_delta_theta=0.20,
        rmuc_history_strength=0.10,
        config=cfg,
    )

    assert high_shift > low_shift
    assert weak_history > low_shift


def test_fuse_observation_moves_high_sigma_team_faster() -> None:
    low_mu, low_sigma, low_gain = fuse_observation(
        mu=0.0,
        sigma=0.30,
        obs_mu=1.0,
        obs_sigma=0.45,
    )
    high_mu, high_sigma, high_gain = fuse_observation(
        mu=0.0,
        sigma=1.10,
        obs_mu=1.0,
        obs_sigma=0.45,
    )

    assert high_gain > low_gain
    assert high_mu > low_mu
    assert high_sigma >= 0.30
    assert low_sigma >= 0.30


def test_match_result_observation_uses_series_share_and_scoreline_uncertainty() -> None:
    obs = compute_match_result_observations(
        theta_red=0.40,
        theta_blue=0.00,
        season_delta_mu_red=0.20,
        season_delta_mu_blue=-0.10,
        actual_red_score=1.0,
        total_games=2,
        beta_perf=1.0,
    )

    assert obs.red_obs_mu > 0.20
    assert obs.blue_obs_mu < -0.10
    assert obs.obs_sigma == 0.60

    bo5 = compute_match_result_observations(
        theta_red=0.40,
        theta_blue=0.00,
        season_delta_mu_red=0.20,
        season_delta_mu_blue=-0.10,
        actual_red_score=1.0,
        total_games=5,
        beta_perf=1.0,
    )
    assert bo5.obs_sigma < obs.obs_sigma


def test_expected_underdog_loss_downweights_only_the_loser_result_gain() -> None:
    cfg = SeasonDeltaConfig(
        result_obs_sigma_base=0.45,
        expected_loss_sigma_multiplier=1.80,
        expected_loss_probability_threshold=0.35,
    )

    red_underdog_loss = compute_match_result_observations(
        theta_red=-2.00,
        theta_blue=1.00,
        season_delta_mu_red=0.00,
        season_delta_mu_blue=0.00,
        actual_red_score=0.0,
        total_games=2,
        beta_perf=1.0,
        config=cfg,
    )
    red_even_loss = compute_match_result_observations(
        theta_red=0.00,
        theta_blue=0.00,
        season_delta_mu_red=0.00,
        season_delta_mu_blue=0.00,
        actual_red_score=0.0,
        total_games=2,
        beta_perf=1.0,
        config=cfg,
    )

    red_mu, _, red_gain = fuse_observation(
        mu=0.0,
        sigma=0.42,
        obs_mu=red_underdog_loss.red_obs_mu,
        obs_sigma=red_underdog_loss.red_obs_sigma,
    )
    even_mu, _, even_gain = fuse_observation(
        mu=0.0,
        sigma=0.42,
        obs_mu=red_even_loss.red_obs_mu,
        obs_sigma=red_even_loss.red_obs_sigma,
    )

    assert red_underdog_loss.red_obs_sigma > red_underdog_loss.blue_obs_sigma
    assert red_underdog_loss.blue_obs_sigma == red_underdog_loss.obs_sigma
    assert red_gain < even_gain
    assert abs(red_mu) < abs(even_mu)

    blue_underdog_loss = compute_match_result_observations(
        theta_red=1.00,
        theta_blue=-2.00,
        season_delta_mu_red=0.00,
        season_delta_mu_blue=0.00,
        actual_red_score=1.0,
        total_games=2,
        beta_perf=1.0,
        config=cfg,
    )
    assert blue_underdog_loss.blue_obs_sigma > blue_underdog_loss.red_obs_sigma
    assert blue_underdog_loss.red_obs_sigma == blue_underdog_loss.obs_sigma


def test_result_momentum_update_is_residual_driven_capped_and_decays() -> None:
    cfg = SeasonDeltaConfig(
        result_momentum_scale=1.0,
        result_momentum_decay=0.5,
        result_momentum_cap=0.20,
    )

    red = compute_result_momentum_update(
        previous_momentum=0.0,
        side="red",
        actual_red_score=0.0,
        probability_red=0.9,
        total_games=2,
        config=cfg,
    )
    blue = compute_result_momentum_update(
        previous_momentum=0.0,
        side="blue",
        actual_red_score=0.0,
        probability_red=0.9,
        total_games=2,
        config=cfg,
    )

    assert red < 0.0
    assert blue > 0.0
    assert abs(red) <= cfg.result_momentum_cap
    assert abs(blue) <= cfg.result_momentum_cap

    cooled = compute_result_momentum_update(
        previous_momentum=red,
        side="red",
        actual_red_score=0.9,
        probability_red=0.9,
        total_games=2,
        config=cfg,
    )
    assert cooled < 0.0
    assert abs(cooled) < abs(red)


def test_large_surprise_result_inflates_next_match_uncertainty() -> None:
    cfg = SeasonDeltaConfig(
        surprise_residual_threshold=0.25,
        sweep_bonus_2_0=0.10,
        max_sigma_inflation=0.18,
    )

    expected_result = compute_result_sigma_inflation(
        actual_red_score=0.55,
        probability_red=0.50,
        total_games=2,
        config=cfg,
    )
    upset_sweep = compute_result_sigma_inflation(
        actual_red_score=0.0,
        probability_red=0.90,
        total_games=2,
        config=cfg,
    )

    assert expected_result.sigma_inflation == 0.0
    assert upset_sweep.surprise_residual > expected_result.surprise_residual
    assert 0.0 < upset_sweep.sigma_inflation <= cfg.max_sigma_inflation
    assert apply_result_sigma_inflation(0.30, upset_sweep.sigma_inflation, config=cfg) > 0.30


def test_form_freshness_weight_weakens_stale_snapshot_confidence() -> None:
    fresh = compute_form_freshness_weight(snapshot_age_minutes=0.0)
    stale = compute_form_freshness_weight(snapshot_age_minutes=180.0)

    assert fresh == 1.0
    assert 0.0 < stale < fresh

    fresh_obs = adjust_form_observation_for_freshness(obs_mu=0.8, obs_sigma=0.6, freshness_weight=fresh)
    stale_obs = adjust_form_observation_for_freshness(obs_mu=0.8, obs_sigma=0.6, freshness_weight=stale)

    assert stale_obs.obs_mu == fresh_obs.obs_mu
    assert stale_obs.obs_sigma > fresh_obs.obs_sigma


def test_opponent_adjusted_form_discounts_expected_strong_team_form() -> None:
    cfg = SeasonDeltaConfig(opponent_form_expected_scale=0.50, opponent_form_adjustment_weight=0.50)

    favorite = compute_opponent_adjusted_form_observation(
        obs_mu=0.8,
        team_theta=1.0,
        opponent_theta=0.0,
        beta_perf=1.0,
        config=cfg,
    )
    underdog = compute_opponent_adjusted_form_observation(
        obs_mu=0.8,
        team_theta=0.0,
        opponent_theta=1.0,
        beta_perf=1.0,
        config=cfg,
    )

    assert favorite.expected_form_mu > 0.0
    assert favorite.adjusted_obs_mu < 0.8
    assert underdog.expected_form_mu < 0.0
    assert underdog.adjusted_obs_mu > 0.8


def test_robot_gate_downweights_conflicting_or_stale_robot_signal() -> None:
    aligned = compute_robot_gate_weight(
        robot_reliability=1.0,
        alignment="aligned_positive",
        conflict=False,
        robot_snapshot_age_minutes=5.0,
    )
    conflict = compute_robot_gate_weight(
        robot_reliability=1.0,
        alignment="conflict",
        conflict=True,
        robot_snapshot_age_minutes=5.0,
    )
    stale = compute_robot_gate_weight(
        robot_reliability=1.0,
        alignment="aligned_positive",
        conflict=False,
        robot_snapshot_age_minutes=240.0,
    )

    assert aligned > 0.8
    assert conflict < 0.1
    assert stale < aligned


def test_form_observation_direction_and_reliability() -> None:
    strong = compute_form_observation(
        z_team_damage=1.5,
        z_base_hp_diff=0.5,
        group_matches_played=2,
    )
    weak = compute_form_observation(
        z_team_damage=-1.5,
        z_base_hp_diff=-0.5,
        group_matches_played=1,
    )

    assert strong.obs_mu > 0.0
    assert weak.obs_mu < 0.0
    assert strong.reliability > weak.reliability
    assert strong.obs_sigma < weak.obs_sigma


def test_form_observation_uses_opponent_points_as_schedule_quality() -> None:
    cfg = SeasonDeltaConfig(
        team_damage_weight=0.60,
        base_hp_weight=0.10,
        opponent_points_weight=0.30,
    )

    tough_schedule = compute_form_observation(
        z_team_damage=0.0,
        z_base_hp_diff=0.0,
        z_opponent_points=1.5,
        group_matches_played=2,
        config=cfg,
    )
    soft_schedule = compute_form_observation(
        z_team_damage=0.0,
        z_base_hp_diff=0.0,
        z_opponent_points=-1.5,
        group_matches_played=2,
        config=cfg,
    )

    assert tough_schedule.obs_mu > 0.0
    assert soft_schedule.obs_mu < 0.0
    assert tough_schedule.obs_sigma == soft_schedule.obs_sigma


def test_archive_manifest_selects_only_pre_match_fresh_snapshot(tmp_path: Path) -> None:
    import json
    import tarfile

    archive_path = tmp_path / "raw_data.tar.gz"
    old_json = tmp_path / "group_rank_info.20260513T010000Z.json"
    fresh_json = tmp_path / "group_rank_info.20260513T013000Z.json"
    future_json = tmp_path / "group_rank_info.20260513T020000Z.json"
    for path in (old_json, fresh_json, future_json):
        path.write_text(json.dumps({"zones": []}), encoding="utf-8")

    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(old_json, arcname=old_json.name)
        archive.add(fresh_json, arcname=fresh_json.name)
        archive.add(future_json, arcname=future_json.name)

    manifest = build_archive_manifest(archive_path)
    selected = select_snapshot_before(
        manifest,
        source_type="group_rank_info",
        cutoff=datetime(2026, 5, 13, 1, 45, tzinfo=UTC),
        max_age_minutes=30.0,
    )

    assert selected is not None
    assert selected.member_name == "group_rank_info.20260513T013000Z.json"
    assert selected.age_minutes == 15.0

    stale = select_snapshot_before(
        manifest,
        source_type="group_rank_info",
        cutoff=datetime(2026, 5, 13, 1, 45, tzinfo=UTC),
        max_age_minutes=10.0,
    )
    assert stale is None


def test_build_archive_manifest_ignores_non_live_snapshot_members(tmp_path: Path) -> None:
    import tarfile

    archive_path = tmp_path / "raw_data.tar.gz"
    keep = tmp_path / "robot_data.20260513T013000Z.json"
    skip = tmp_path / "README.txt"
    keep.write_text("{}", encoding="utf-8")
    skip.write_text("ignored", encoding="utf-8")

    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(keep, arcname=f"./{keep.name}")
        archive.add(skip, arcname=skip.name)

    manifest = build_archive_manifest(archive_path)

    assert [row.member_name for row in manifest] == [keep.name]
    assert manifest[0].source_type == "robot_data"


def test_group_rank_payload_builds_form_observations_without_robot_model_features() -> None:
    metrics = extract_group_rank_form_metrics(_group_rank_payload())

    assert set(metrics["school_name"]) == {
        "Alpha University",
        "Beta University",
        "Gamma University",
    }
    alpha_metrics = metrics.loc[metrics["school_name"] == "Alpha University"].iloc[0]
    assert alpha_metrics["region_name"] == "南部赛区"
    assert alpha_metrics["group_name"] == "A"
    assert alpha_metrics["group_matches_played"] == 2.0
    assert alpha_metrics["avg_team_damage"] == 3200.0
    assert alpha_metrics["avg_base_hp_diff"] == 220.0

    observations = build_form_observation_frame(
        metrics,
        snapshot_name="group_rank_info.20260513T013000Z.json",
        snapshot_age_minutes=15.0,
    )
    alpha = observations.loc[observations["school_name"] == "Alpha University"].iloc[0]
    gamma = observations.loc[observations["school_name"] == "Gamma University"].iloc[0]

    assert alpha["obs_mu"] > 0.0
    assert gamma["obs_mu"] < 0.0
    assert alpha["form_reliability"] == 1.0
    assert alpha["snapshot_name"] == "group_rank_info.20260513T013000Z.json"
    assert alpha["snapshot_age_minutes"] == 15.0
    assert bool(alpha["robot_signal_missing"]) is True
    assert bool(alpha["robot_signal_conflict"]) is False


def test_event_form_freshness_uses_completed_match_count_not_wall_clock_age() -> None:
    current = compute_event_form_freshness(
        snapshot_matches_played=1.0,
        expected_matches_played_before=1.0,
        time_freshness_weight=0.01,
    )
    stale = compute_event_form_freshness(
        snapshot_matches_played=0.0,
        expected_matches_played_before=1.0,
        time_freshness_weight=1.0,
    )
    future = compute_event_form_freshness(
        snapshot_matches_played=2.0,
        expected_matches_played_before=1.0,
        time_freshness_weight=1.0,
    )

    assert current.weight == 1.0
    assert current.status == "current"
    assert stale.weight == 0.0
    assert stale.status == "stale"
    assert future.weight == 0.0
    assert future.status == "future_leak"


def test_group_stage_sigma_floor_keeps_early_swiss_rounds_plastic() -> None:
    cfg = SeasonDeltaConfig(
        sigma_floor=0.30,
        early_group_sigma_floor=0.42,
        early_group_sigma_floor_matches=2.0,
    )

    assert compute_group_stage_sigma_floor(
        stage_family="regional_group",
        group_matches_played_before=0,
        config=cfg,
    ) == 0.42
    assert compute_group_stage_sigma_floor(
        stage_family="regional_group",
        group_matches_played_before=1,
        config=cfg,
    ) == 0.36
    assert compute_group_stage_sigma_floor(
        stage_family="regional_group",
        group_matches_played_before=2,
        config=cfg,
    ) == 0.30
    assert compute_group_stage_sigma_floor(
        stage_family="post_group",
        group_matches_played_before=1,
        config=cfg,
    ) == 0.30


def test_robot_payload_builds_conservative_family_signal() -> None:
    group_metrics = extract_group_rank_form_metrics(_group_rank_payload())
    robot_metrics = extract_robot_form_metrics(_robot_payload())

    assert set(robot_metrics["school_name"]) == {
        "Alpha University",
        "Beta University",
        "Gamma University",
    }
    alpha_robot = robot_metrics.loc[robot_metrics["school_name"] == "Alpha University"].iloc[0]
    gamma_robot = robot_metrics.loc[robot_metrics["school_name"] == "Gamma University"].iloc[0]
    assert alpha_robot["robot_output_hurt"] > gamma_robot["robot_output_hurt"]
    assert alpha_robot["robot_output_kda"] > gamma_robot["robot_output_kda"]

    group_only = build_form_observation_frame(group_metrics)
    combined = build_live_form_observation_frame(
        group_metrics,
        robot_metrics_frame=robot_metrics,
        snapshot_name="group_rank_info.20260513T013000Z.json",
        snapshot_age_minutes=90.0,
        robot_snapshot_name="robot_data.20260513T013500Z.json",
        robot_snapshot_age_minutes=10.0,
    )
    alpha_group = group_only.loc[group_only["school_name"] == "Alpha University"].iloc[0]
    alpha_combined = combined.loc[combined["school_name"] == "Alpha University"].iloc[0]
    gamma_combined = combined.loc[combined["school_name"] == "Gamma University"].iloc[0]

    assert bool(alpha_combined["robot_signal_missing"]) is False
    assert alpha_combined["robot_signal_alignment"] == "aligned_positive"
    assert 0.0 < alpha_combined["form_freshness_weight"] < 1.0
    assert alpha_combined["robot_gate_weight"] > 0.0
    assert alpha_combined["robot_family_signal"] > 0.0
    assert "robot_objective_signal" in combined.columns
    assert alpha_combined["robot_objective_signal"] > gamma_combined["robot_objective_signal"]
    assert alpha_combined["obs_mu"] >= alpha_group["obs_mu"]
    assert alpha_combined["obs_sigma"] > alpha_group["obs_sigma"]
    assert gamma_combined["robot_family_signal"] < 0.0
    assert gamma_combined["obs_mu"] < 0.0


def test_robot_payload_marks_base_capability_thresholds() -> None:
    group_payload = {
        "zones": [
            {
                "zoneName": "南部赛区",
                "groups": [
                    {
                        "groupName": "A组",
                        "groupPlayers": [
                            [
                                {"itemName": "排名", "itemValue": 1},
                                {
                                    "itemName": "战队",
                                    "itemValue": {"collegeName": "Fixed Dart University", "teamName": "Fixed"},
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/1"},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 2},
                                {
                                    "itemName": "战队",
                                    "itemValue": {"collegeName": "Base Dart University", "teamName": "BaseDart"},
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/1"},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 3},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "Reduced Dart University",
                                        "teamName": "ReducedDart",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/1"},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 4},
                                {
                                    "itemName": "战队",
                                    "itemValue": {"collegeName": "Key Damage University", "teamName": "KeyDamage"},
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/0"},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 5},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "Key Damage High University",
                                        "teamName": "KeyDamageHigh",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/0"},
                            ],
                            [
                                {"itemName": "排名", "itemValue": 6},
                                {
                                    "itemName": "战队",
                                    "itemValue": {"collegeName": "Snipe University", "teamName": "Snipe"},
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/0"},
                            ],
                        ],
                    },
                ],
            }
        ]
    }
    robot_payload = {
        "zones": [
            {
                "zoneName": "南部赛区",
                "teams": [
                    {
                        "collegeName": "Fixed Dart University",
                        "name": "Fixed",
                        "robots": [
                            {"type": "Dart", "etDartRDFixCnt": 1.0},
                            {"type": "Infantry", "gkDamage": 1650.0},
                        ],
                    },
                    {
                        "collegeName": "Base Dart University",
                        "name": "BaseDart",
                        "robots": [{"type": "Dart", "etDartRDMoveCnt": 1.0}],
                    },
                    {
                        "collegeName": "Reduced Dart University",
                        "name": "ReducedDart",
                        "robots": [{"type": "Dart", "etDartRDFixCnt": 1.2}],
                    },
                    {
                        "collegeName": "Key Damage University",
                        "name": "KeyDamage",
                        "robots": [{"type": "Infantry", "gkDamage": 1650.0}],
                    },
                    {
                        "collegeName": "Key Damage High University",
                        "name": "KeyDamageHigh",
                        "robots": [{"type": "Infantry", "gkDamage": 1650.1}],
                    },
                    {
                        "collegeName": "Snipe University",
                        "name": "Snipe",
                        "robots": [{"type": "Hero", "eaSnipeCnt": 0.5}],
                    },
                ],
            }
        ]
    }

    group_metrics = extract_group_rank_form_metrics(group_payload)
    robot_metrics = extract_robot_form_metrics(robot_payload)
    combined = build_live_form_observation_frame(group_metrics, robot_metrics_frame=robot_metrics).set_index("school_name")

    assert combined.loc["Fixed Dart University", "robot_base_dart_average"] == 150.0
    assert combined.loc["Fixed Dart University", "robot_base_capability_signal"] == 0.0
    assert combined.loc["Base Dart University", "robot_base_dart_average"] == 312.5
    assert combined.loc["Base Dart University", "robot_base_capability_signal"] == 1.0
    assert combined.loc["Reduced Dart University", "robot_base_dart_average"] == 180.0
    assert combined.loc["Reduced Dart University", "robot_base_capability_signal"] == 1.0
    assert combined.loc["Key Damage University", "robot_base_capability_signal"] == 0.0
    assert combined.loc["Key Damage High University", "robot_base_capability_signal"] == 1.0
    assert combined.loc["Snipe University", "robot_base_capability_signal"] == 1.0


def test_cli_build_form_observations_writes_csv(tmp_path: Path) -> None:
    import json

    group_rank_path = tmp_path / "group_rank_info.json"
    out_path = tmp_path / "form_observations.csv"
    group_rank_path.write_text(json.dumps(_group_rank_payload()), encoding="utf-8")

    exit_code = trueskill2_cli.main(
        [
            "build-form-observations",
            "--group-rank",
            str(group_rank_path),
            "--out",
            str(out_path),
        ]
    )

    assert exit_code == 0
    observations = pd.read_csv(out_path)
    assert {"school_key", "obs_mu", "obs_sigma", "robot_signal_missing"}.issubset(observations.columns)
    assert observations.loc[observations["school_name"] == "Alpha University", "obs_mu"].iloc[0] > 0.0


def test_strategy_replay_compares_required_abcde_variants() -> None:
    preseason = pd.DataFrame(
        [
            {
                "school_key": "a",
                "school_name": "Alpha",
                "rmuc_program_base_theta": 0.0,
                "season_delta_mu": 1.0,
                "season_delta_sigma_theta": 1.0,
            },
            {
                "school_key": "b",
                "school_name": "Beta",
                "rmuc_program_base_theta": 0.0,
                "season_delta_mu": 0.0,
                "season_delta_sigma_theta": 0.3,
            },
        ]
    )
    matches = pd.DataFrame(
        [
            {
                "match_id": "m1",
                "match_date": "2026-05-01",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 0,
                "blue_wins": 2,
                "winner_side": "blue",
                "stage_family": "regional_group",
            },
            {
                "match_id": "m2",
                "match_date": "2026-05-02",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 0,
                "blue_wins": 2,
                "winner_side": "blue",
                "stage_family": "regional_group",
            },
        ]
    )

    report = run_strategy_replay(
        preseason_snapshot=preseason,
        matches=matches,
        beta_perf=1.0,
        online_update_scale=0.2,
    )

    assert [row["name"] for row in report["strategies"]] == [
        "A_current_ts2",
        "B_new_sigma0",
        "C_result_fusion",
        "D_result_fusion_form",
        "E_general_flow_momentum",
        "F_transient_process_residual",
    ]
    assert report["strategies"][2]["team_states"]["a"]["season_delta_mu"] < report["strategies"][0]["team_states"]["a"]["season_delta_mu"]
    for row in report["strategies"]:
        assert {"log_loss", "brier", "accuracy", "ece", "correction_after_2"}.issubset(row)
        assert len(row["prematch_feature_frame"]) == len(row["predictions"])


def test_strategy_replay_general_momentum_affects_later_matches_without_round_rules() -> None:
    preseason = pd.DataFrame(
        [
            {"school_key": "a", "rmuc_program_base_theta": 0.4, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
            {"school_key": "b", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
        ]
    )
    matches = pd.DataFrame(
        [
            {
                "match_id": "m1",
                "match_date": "2026-05-01",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 0,
                "blue_wins": 2,
                "winner_side": "blue",
                "stage_family": "regional_group",
            },
            {
                "match_id": "m2",
                "match_date": "2026-05-02",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 1,
                "blue_wins": 2,
                "winner_side": "blue",
                "stage_family": "regional_group",
            },
        ]
    )

    report = run_strategy_replay(
        preseason_snapshot=preseason,
        matches=matches,
        beta_perf=1.0,
        config=SeasonDeltaConfig(result_momentum_scale=0.8, result_momentum_cap=0.50),
    )
    c_predictions = report["strategies"][2]["predictions"]
    e_predictions = report["strategies"][4]["predictions"]

    assert e_predictions[1]["red_momentum_theta"] < 0.0
    assert e_predictions[1]["blue_momentum_theta"] > 0.0
    assert e_predictions[1]["p_red_win"] < c_predictions[1]["p_red_win"]


def test_strategy_replay_applies_form_observation_before_prediction() -> None:
    preseason = pd.DataFrame(
        [
            {"school_key": "a", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.8},
            {"school_key": "b", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.8},
        ]
    )
    matches = pd.DataFrame(
        [
            {
                "match_id": "m1",
                "match_date": "2026-05-02",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 2,
                "blue_wins": 0,
                "winner_side": "red",
                "stage_family": "regional_group",
            }
        ]
    )
    form = pd.DataFrame(
        [
            {"match_id": "m1", "school_key": "a", "obs_mu": 0.8, "obs_sigma": 0.5},
            {"match_id": "m1", "school_key": "b", "obs_mu": -0.8, "obs_sigma": 0.5},
        ]
    )

    without_form = run_strategy_replay(preseason_snapshot=preseason, matches=matches, beta_perf=1.0)
    with_form = run_strategy_replay(
        preseason_snapshot=preseason,
        matches=matches,
        beta_perf=1.0,
        form_observations=form,
    )

    d_without = without_form["strategies"][3]["predictions"][0]["p_red_win"]
    d_with = with_form["strategies"][3]["predictions"][0]["p_red_win"]
    assert d_with > d_without


def test_strategy_replay_emits_residual_feature_frame_and_conflict_head() -> None:
    preseason = pd.DataFrame(
        [
            {"school_key": "a", "rmuc_program_base_theta": 0.6, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
            {"school_key": "b", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
            {"school_key": "c", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
        ]
    )
    matches = pd.DataFrame(
        [
            {
                "match_id": "m1",
                "match_date": "2026-05-01",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 0,
                "blue_wins": 2,
                "winner_side": "blue",
                "stage_family": "regional_group",
            },
            {
                "match_id": "m2",
                "match_date": "2026-05-02",
                "red_school_key": "a",
                "blue_school_key": "c",
                "red_wins": 1,
                "blue_wins": 2,
                "winner_side": "blue",
                "stage_family": "regional_group",
            },
        ]
    )
    form = pd.DataFrame(
        [
            {"match_id": "m2", "school_key": "a", "obs_mu": -0.5, "obs_sigma": 0.7},
            {"match_id": "m2", "school_key": "c", "obs_mu": 0.3, "obs_sigma": 0.7},
        ]
    )

    report = run_strategy_replay(
        preseason_snapshot=preseason,
        matches=matches,
        beta_perf=1.0,
        form_observations=form,
    )

    assert [row["name"] for row in report["strategies"]] == [
        "A_current_ts2",
        "B_new_sigma0",
        "C_result_fusion",
        "D_result_fusion_form",
        "E_general_flow_momentum",
        "F_transient_process_residual",
    ]
    assert report["residual_head_config"]["result_weight"] == 0.0
    assert report["residual_head_config"]["conflict_shrink_weight"] == 0.0
    c_predictions = report["strategies"][2]["predictions"]
    f_report = report["strategies"][5]
    f_features = f_report["prematch_feature_frame"]
    second = next(row for row in f_features if row["match_id"] == "m2")

    assert second["red_result_residual_sum_before"] < 0.0
    assert second["result_residual_diff"] < 0.0
    assert second["process_residual_diff"] < 0.0
    assert second["component_conflict_score"] > 0.0
    assert f_report["predictions"][1]["p_red_win"] < c_predictions[1]["p_red_win"]


def test_transient_process_residual_does_not_carry_without_fresh_form() -> None:
    preseason = pd.DataFrame(
        [
            {"school_key": "a", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
            {"school_key": "b", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
        ]
    )
    matches = pd.DataFrame(
        [
            {
                "match_id": "m1",
                "match_date": "2026-05-01",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 2,
                "blue_wins": 0,
                "winner_side": "red",
                "stage_family": "regional_group",
            },
            {
                "match_id": "m2",
                "match_date": "2026-05-02",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 2,
                "blue_wins": 1,
                "winner_side": "red",
                "stage_family": "regional_group",
            },
        ]
    )
    form = pd.DataFrame(
        [
            {"match_id": "m1", "school_key": "a", "obs_mu": 0.8, "obs_sigma": 0.7},
            {"match_id": "m1", "school_key": "b", "obs_mu": -0.8, "obs_sigma": 0.7},
        ]
    )

    report = run_strategy_replay(
        preseason_snapshot=preseason,
        matches=matches,
        beta_perf=1.0,
        form_observations=form,
    )

    f_features = report["strategies"][5]["prematch_feature_frame"]
    second = next(row for row in f_features if row["match_id"] == "m2")
    assert second["red_process_residual"] == 0.0
    assert second["blue_process_residual"] == 0.0
    assert second["process_residual_diff"] == 0.0


def test_strategy_backtest_writes_prematch_feature_frame_csv(tmp_path: Path) -> None:
    preseason_path = tmp_path / "preseason.csv"
    matches_path = tmp_path / "matches.csv"
    out_dir = tmp_path / "out"
    pd.DataFrame(
        [
            {"school_key": "a", "rmuc_program_base_theta": 0.3, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
            {"school_key": "b", "rmuc_program_base_theta": 0.0, "season_delta_mu": 0.0, "season_delta_sigma_theta": 0.6},
        ]
    ).to_csv(preseason_path, index=False)
    pd.DataFrame(
        [
            {
                "match_id": "m1",
                "match_date": "2026-05-01",
                "red_school_key": "a",
                "blue_school_key": "b",
                "red_wins": 2,
                "blue_wins": 0,
                "winner_side": "red",
                "stage_family": "regional_group",
            }
        ]
    ).to_csv(matches_path, index=False)

    run_strategy_backtest(
        preseason_path=preseason_path,
        matches_path=matches_path,
        out_dir=out_dir,
        beta_perf=1.0,
    )

    feature_frame = pd.read_csv(out_dir / "prematch_feature_frame.csv")
    assert {"strategy", "match_id", "component_conflict_score", "result_residual_diff"}.issubset(feature_frame.columns)
    assert set(feature_frame["strategy"]) == {
        "A_current_ts2",
        "B_new_sigma0",
        "C_result_fusion",
        "D_result_fusion_form",
        "E_general_flow_momentum",
        "F_transient_process_residual",
    }


def test_cli_exposes_strategy_backtest_command() -> None:
    parser = trueskill2_cli.build_parser()
    help_text = parser.format_help()
    assert "strategy-backtest" in help_text
    assert "build-form-observations" in help_text
