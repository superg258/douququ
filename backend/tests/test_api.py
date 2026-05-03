from __future__ import annotations

import csv
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app import service


client = TestClient(app)
ROOT = Path(__file__).resolve().parents[2]
TS2_DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"


def teardown_function() -> None:
    service.load_ratings_rows.cache_clear()
    service.load_preseason_global_elo_rank_map.cache_clear()
    service.load_current_rating_index.cache_clear()
    service.load_global_elo_rank_map.cache_clear()
    service._reset_live_state_caches()


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _write_region_summary(root: Path, region_slug: str) -> None:
    region_dir = root / region_slug
    region_dir.mkdir(parents=True, exist_ok=True)
    (region_dir / "monte_carlo_summary.json").write_text(
        json.dumps(
            {
                "aggregation_mode": "single_seed",
                "seed_count": 1,
                "iterations_per_seed": 100,
                "effective_iterations": 100,
                "seeds": [20260414],
                "pair_probability_samples": 1200,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ts2_backend_artifacts_exist_with_expected_schema() -> None:
    ratings_path = TS2_DERIVED_DIR / "preseason_ratings.csv"
    manifest_path = TS2_DERIVED_DIR / "model_manifest.json"

    assert ratings_path.exists()
    assert manifest_path.exists()

    rows = _read_csv(ratings_path)
    assert len(rows) == 96
    assert {
        "team_key",
        "college_name",
        "team_name",
        "admitted_region",
        "seed_rank_in_region",
        "seed_tier",
        "ranking_global_rank",
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
    }.issubset(rows[0].keys())

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["snapshot_kind"] == "preseason"
    assert manifest["team_count"] == 96


def test_overview_contains_three_regions_sorted_by_elo() -> None:
    response = client.get("/api/overview")
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["regions"]) == 3
    assert [region["regionSlug"] for region in payload["regions"]] == [
        "south_region",
        "east_region",
        "north_region",
    ]
    for region in payload["regions"]:
        assert region["teams"]
        current_elo_values = [team["currentElo"] for team in region["teams"]]
        assert current_elo_values == sorted(current_elo_values, reverse=True)
        first_team = region["teams"][0]
        assert abs(first_team["currentElo"] - (first_team["preseasonElo"] + first_team["eloDeltaFromPreseason"])) < 1e-6
        assert first_team["eloRankSource"] in {"live", "preseason"}
        assert set(first_team["probabilities"]) == {"roundOf16", "repechage", "national", "champion"}
        assert first_team["eloGlobalRank"] >= 1
        assert first_team["eloRegionRank"] == 1
        assert region["monteCarlo"]["aggregationMode"] in {"single_seed", "mean_of_seed_runs"}
        assert region["monteCarlo"]["effectiveIterations"] >= region["monteCarlo"]["iterationsPerSeed"]
        assert region["monteCarlo"]["seedCount"] >= 1


def test_overview_uses_ts2_preseason_ratings() -> None:
    ratings_rows = _read_csv(TS2_DERIVED_DIR / "preseason_ratings.csv")
    ratings_by_team_key = {row["team_key"]: row for row in ratings_rows}

    response = client.get("/api/overview")
    assert response.status_code == 200
    payload = response.json()

    for region in payload["regions"]:
        for team in region["teams"]:
            source = ratings_by_team_key[team["teamKey"]]
            assert abs(team["mu0"] - float(source["mu0"])) < 1e-6
            assert abs(team["sigma0"] - float(source["sigma0"])) < 1e-6


def test_overview_ranks_teams_by_current_live_elo_without_changing_probabilities(tmp_path, monkeypatch) -> None:
    ratings_path = tmp_path / "preseason_ratings.csv"
    region_sim_dir = tmp_path / "region_simulations"
    published_dir = tmp_path / "published_2026"
    published_dir.mkdir(parents=True)

    teams = [
        {
            "team_key": service.compute_team_key("South Alpha", "Main"),
            "school_key": "south_alpha",
            "college_name": "South Alpha",
            "team_name": "Main",
            "admitted_region": "南部赛区",
            "mu0": 1700,
            "sigma0": 40,
            "seed_tier": "tier1",
            "seed_rank_in_region": 1,
        },
        {
            "team_key": service.compute_team_key("South Beta", "Main"),
            "school_key": "south_beta",
            "college_name": "South Beta",
            "team_name": "Main",
            "admitted_region": "南部赛区",
            "mu0": 1600,
            "sigma0": 40,
            "seed_tier": "tier2",
            "seed_rank_in_region": 2,
        },
        {
            "team_key": service.compute_team_key("East Alpha", "Main"),
            "school_key": "east_alpha",
            "college_name": "East Alpha",
            "team_name": "Main",
            "admitted_region": "东部赛区",
            "mu0": 1500,
            "sigma0": 40,
            "seed_tier": "tier1",
            "seed_rank_in_region": 1,
        },
        {
            "team_key": service.compute_team_key("North Alpha", "Main"),
            "school_key": "north_alpha",
            "college_name": "North Alpha",
            "team_name": "Main",
            "admitted_region": "北部赛区",
            "mu0": 1400,
            "sigma0": 40,
            "seed_tier": "tier1",
            "seed_rank_in_region": 1,
        },
    ]
    _write_csv(ratings_path, teams)
    for region_slug in ("south_region", "east_region", "north_region"):
        _write_region_summary(region_sim_dir, region_slug)

    _write_csv(
        region_sim_dir / "south_region" / "monte_carlo_team_rates.csv",
        [
            {
                "college_name": "South Alpha",
                "team_name": "Main",
                "mu0": 1700,
                "sigma0": 40,
                "seed_tier": "tier1",
                "seed_rank_in_region": 1,
                "round_of_16_rate": 0.9,
                "repechage_rate": 0.2,
                "national_rate": 0.77,
                "champion_rate": 0.31,
            },
            {
                "college_name": "South Beta",
                "team_name": "Main",
                "mu0": 1600,
                "sigma0": 40,
                "seed_tier": "tier2",
                "seed_rank_in_region": 2,
                "round_of_16_rate": 0.8,
                "repechage_rate": 0.1,
                "national_rate": 0.11,
                "champion_rate": 0.03,
            },
        ],
    )
    for region_slug, college_name, mu0 in (("east_region", "East Alpha", 1500), ("north_region", "North Alpha", 1400)):
        _write_csv(
            region_sim_dir / region_slug / "monte_carlo_team_rates.csv",
            [
                {
                    "college_name": college_name,
                    "team_name": "Main",
                    "mu0": mu0,
                    "sigma0": 40,
                    "seed_tier": "tier1",
                    "seed_rank_in_region": 1,
                    "round_of_16_rate": 0.9,
                    "repechage_rate": 0.1,
                    "national_rate": 0.5,
                    "champion_rate": 0.05,
                }
            ],
        )
    (published_dir / "current_snapshot.json").write_text(
        json.dumps(
            [
                {"school_key": "south_alpha", "published_rating": 1580.0},
                {"school_key": "south_beta", "published_rating": 1810.0},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(service, "PRESEASON_RATINGS_CSV", ratings_path)
    monkeypatch.setattr(service, "REGION_SIM_DIR", region_sim_dir)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", published_dir)
    service.load_ratings_rows.cache_clear()
    service.load_region_probability_rows.cache_clear()
    service.load_region_summary.cache_clear()
    service.load_preseason_global_elo_rank_map.cache_clear()
    service.load_current_rating_index.cache_clear()
    service.load_global_elo_rank_map.cache_clear()
    service._reset_live_state_caches()

    payload = service.build_overview_payload()
    south = next(region for region in payload["regions"] if region["regionSlug"] == "south_region")

    assert [team["collegeName"] for team in south["teams"]] == ["South Beta", "South Alpha"]
    assert south["teams"][0]["currentElo"] == 1810.0
    assert south["teams"][0]["preseasonElo"] == 1600.0
    assert south["teams"][0]["eloDeltaFromPreseason"] == 210.0
    assert south["teams"][0]["eloRankSource"] == "live"
    assert south["teams"][0]["eloRegionRank"] == 1
    assert south["teams"][0]["probabilities"]["national"] == 0.11
    assert south["teams"][1]["currentElo"] == 1580.0
    assert south["teams"][1]["probabilities"]["national"] == 0.77


def test_simulation_returns_expected_shape_for_all_regions() -> None:
    expectations = {
        "east_region": {"nationalSlots": 8, "repechageSlots": 6},
        "south_region": {"nationalSlots": 10, "repechageSlots": 6},
        "north_region": {"nationalSlots": 10, "repechageSlots": 4},
    }
    for region_slug, expected in expectations.items():
        response = client.get(f"/api/regions/{region_slug}/simulation", params={"seed": 20260414})
        assert response.status_code == 200
        payload = response.json()

        assert payload["meta"]["regionSlug"] == region_slug
        assert payload["meta"]["nationalSlots"] == expected["nationalSlots"]
        assert payload["meta"]["repechageSlots"] == expected["repechageSlots"]
        assert payload["meta"]["monteCarlo"]["aggregationMode"] in {"single_seed", "mean_of_seed_runs"}
        assert payload["meta"]["monteCarlo"]["effectiveIterations"] >= payload["meta"]["monteCarlo"]["iterationsPerSeed"]
        assert payload["meta"]["monteCarlo"]["seedCount"] >= 1
        assert len(payload["slots"]) == 32
        assert len(payload["finalRankings"]) == 32
        assert len(payload["summary"]["nationalQualifiers"]) == expected["nationalSlots"]
        assert len(payload["summary"]["repechageQualifiers"]) == expected["repechageSlots"]
        assert payload["matches"]
        assert {"round_of_16", "quarterfinal", "semifinal", "final"}.issubset(payload["summary"]["matchCountByStage"].keys())


def test_live_simulation_serialization_exposes_current_elo_without_replacing_mu0(tmp_path, monkeypatch) -> None:
    ratings_path = tmp_path / "preseason_ratings.csv"
    region_sim_dir = tmp_path / "region_simulations"
    published_dir = tmp_path / "published_2026"
    published_dir.mkdir(parents=True)
    _write_region_summary(region_sim_dir, "south_region")
    _write_csv(
        ratings_path,
        [
            {
                "team_key": service.compute_team_key("Alpha", "Main"),
                "school_key": "alpha",
                "college_name": "Alpha",
                "team_name": "Main",
                "admitted_region": "南部赛区",
                "mu0": 1700,
                "sigma0": 40,
                "seed_tier": "tier1",
                "seed_rank_in_region": 1,
            },
            {
                "team_key": service.compute_team_key("Beta", "Main"),
                "school_key": "beta",
                "college_name": "Beta",
                "team_name": "Main",
                "admitted_region": "南部赛区",
                "mu0": 1600,
                "sigma0": 40,
                "seed_tier": "tier2",
                "seed_rank_in_region": 2,
            },
        ],
    )
    (published_dir / "current_snapshot.json").write_text(
        json.dumps(
            [
                {"school_key": "alpha", "published_rating": 1665.0},
                {"school_key": "beta", "published_rating": 1735.0},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "PRESEASON_RATINGS_CSV", ratings_path)
    monkeypatch.setattr(service, "REGION_SIM_DIR", region_sim_dir)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", published_dir)
    service.load_ratings_rows.cache_clear()
    service.load_region_summary.cache_clear()
    service.load_preseason_global_elo_rank_map.cache_clear()
    service.load_current_rating_index.cache_clear()
    service.load_global_elo_rank_map.cache_clear()
    service._reset_live_state_caches()

    simulation = {
        "slot_rows": [
            {
                "college_name": "Alpha",
                "team_name": "Main",
                "group_name": "A",
                "slot": "A1",
                "draw_box": "box1",
                "seed_tier": "tier1",
                "seed_rank_in_region": 1,
                "mu0": 1700,
                "sigma0": 40,
            },
            {
                "college_name": "Beta",
                "team_name": "Main",
                "group_name": "A",
                "slot": "A2",
                "draw_box": "box2",
                "seed_tier": "tier2",
                "seed_rank_in_region": 2,
                "mu0": 1600,
                "sigma0": 40,
            },
        ],
        "match_rows": [
            {
                "match_label": "A-SWISS-1-1",
                "stage": "swiss",
                "stage_order": 1,
                "round_number": 1,
                "group_name": "A",
                "best_of": 3,
                "is_actual_result": True,
                "is_confirmed_matchup": True,
                "red_college_name": "Alpha",
                "red_team_name": "Main",
                "red_slot": "A1",
                "blue_college_name": "Beta",
                "blue_team_name": "Main",
                "blue_slot": "A2",
                "winner_college_name": "Beta",
                "winner_team_name": "Main",
                "loser_college_name": "Alpha",
                "loser_team_name": "Main",
                "scoreline": "0:2",
                "p_game_red": 0.6,
                "p_game_blue": 0.4,
                "p_series_red": 0.65,
                "p_series_blue": 0.35,
                "delta_h2h": 100,
                "confidence_label": "test",
                "winner_next": "",
                "loser_next": "",
            }
        ],
        "summary": {
            "samples_per_match": 32,
            "configuration": {"national_slots": 1, "repechage_slots": 1},
            "group_rankings": {
                "A": [
                    {"college_name": "Beta", "team_name": "Main", "slot": "A2", "group_rank": 1, "wins": 1, "losses": 0, "status": "qualified"},
                    {"college_name": "Alpha", "team_name": "Main", "slot": "A1", "group_rank": 2, "wins": 0, "losses": 1, "status": "active"},
                ]
            },
            "final_rankings": [
                {
                    "rank": 1,
                    "college_name": "Beta",
                    "team_name": "Main",
                    "group_name": "A",
                    "slot": "A2",
                    "seed_tier": "tier2",
                    "seed_rank_in_region": 2,
                    "swiss_wins": 1,
                    "swiss_losses": 0,
                    "swiss_group_rank": 1,
                    "mu0": 1600,
                    "final_bucket": "champion",
                    "advancement": "national_qualified",
                },
                {
                    "rank": 2,
                    "college_name": "Alpha",
                    "team_name": "Main",
                    "group_name": "A",
                    "slot": "A1",
                    "seed_tier": "tier1",
                    "seed_rank_in_region": 1,
                    "swiss_wins": 0,
                    "swiss_losses": 1,
                    "swiss_group_rank": 2,
                    "mu0": 1700,
                    "final_bucket": "runner_up",
                    "advancement": "repechage_qualified",
                },
            ],
            "champion": {"college_name": "Beta", "team_name": "Main"},
            "runner_up": {"college_name": "Alpha", "team_name": "Main"},
            "third_place": {"college_name": "Alpha", "team_name": "Main"},
            "fourth_place": {"college_name": "Alpha", "team_name": "Main"},
            "match_count_by_stage": {"swiss": 1},
        },
    }

    payload = service._serialize_simulation("south_region", 20260414, simulation, include_current_ratings=True)

    assert payload["slots"][0]["mu0"] == 1700.0
    assert payload["slots"][0]["currentElo"] == 1665.0
    assert payload["slots"][0]["eloDeltaFromPreseason"] == -35.0
    assert payload["slots"][1]["eloGlobalRank"] == 1
    assert payload["matches"][0]["redCurrentElo"] == 1665.0
    assert payload["matches"][0]["blueCurrentElo"] == 1735.0
    assert payload["finalRankings"][0]["currentElo"] == 1735.0


def test_simulation_uses_ts2_preseason_ratings() -> None:
    ratings_rows = _read_csv(TS2_DERIVED_DIR / "preseason_ratings.csv")
    ratings_by_team_key = {row["team_key"]: row for row in ratings_rows}

    response = client.get("/api/regions/east_region/simulation", params={"seed": 20260414})
    assert response.status_code == 200
    payload = response.json()

    for slot in payload["slots"]:
        source = ratings_by_team_key[slot["teamKey"]]
        assert abs(slot["mu0"] - float(source["mu0"])) < 1e-6
        assert abs(slot["sigma0"] - float(source["sigma0"])) < 1e-6

    for match in payload["matches"][:8]:
        assert abs(match["pGameRed"] + match["pGameBlue"] - 1.0) < 1e-6
        assert abs(match["pSeriesRed"] + match["pSeriesBlue"] - 1.0) < 1e-6


def test_south_sim_mode_starts_from_scratch_without_actual_results() -> None:
    response = client.get(
        "/api/regions/south_region/simulation",
        params={"seed": 20261111, "mode": "sim"},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["matches"]
    assert all(not match["isRealResult"] for match in payload["matches"])
    assert all(match.get("redMu0") is None for match in payload["matches"])
    assert all(match.get("blueMu0") is None for match in payload["matches"])
    assert all(match.get("redDelta") is None for match in payload["matches"])
    assert all(match.get("blueDelta") is None for match in payload["matches"])


def test_live_mode_falls_back_to_plain_simulation_when_official_source_missing(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", tmp_path / "missing_normalized_schedule.json")

    response = client.get(
        "/api/regions/south_region/simulation",
        params={"seed": 20260414, "mode": "live"},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["matches"]
    assert payload["meta"]["seed"] == 20260414
    assert payload["meta"]["liveStatus"]["sourceStatus"] == "missing"
    assert all(not match["isRealResult"] for match in payload["matches"])
    assert all(match.get("officialMatchId") is None for match in payload["matches"])
    assert all(match.get("redMu0") is None for match in payload["matches"])
    assert all(match.get("blueMu0") is None for match in payload["matches"])
    assert all(match.get("redDelta") is None for match in payload["matches"])
    assert all(match.get("blueDelta") is None for match in payload["matches"])
def test_live_state_returns_unavailable_when_published_artifacts_missing(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "reason": None,
                "fetchedAt": "2026-11-11T09:00:00+00:00",
                "regions": {
                    "south_region": {
                        "matches": [],
                        "slotAssignments": {},
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", tmp_path / "missing_published_2026")
    service._reset_live_state_caches()

    response = client.get("/api/regions/south_region/live-state")
    assert response.status_code == 200
    payload = response.json()

    assert payload["available"] is False
    assert payload["regionSlug"] == "south_region"
    assert payload["currentSnapshot"] == []
    assert payload["matchLedger"] == []
    assert payload["teamIndex"] == {}


def test_live_state_uses_published_artifacts_when_present(tmp_path, monkeypatch) -> None:
    ratings_path = tmp_path / "preseason_ratings.csv"
    ratings_path.write_text(
        "\n".join(
            [
                "team_key,school_key,college_name,team_name,admitted_region,mu0,sigma0",
                "alpha::main,alpha,阿尔法大学,Main,南部赛区,1700,40",
                "beta::main,beta,贝塔大学,Main,南部赛区,1680,40",
            ]
        ),
        encoding="utf-8",
    )
    published_dir = tmp_path / "published_2026"
    published_dir.mkdir(parents=True)
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "reason": None,
                "fetchedAt": "2026-11-11T09:00:00+00:00",
                "regions": {
                    "south_region": {
                        "matches": [
                            {
                                "isCompleted": True,
                                "isConfirmedMatchup": True,
                            }
                        ],
                        "slotAssignments": {},
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (published_dir / "published_manifest.json").write_text(
        json.dumps(
            {
                "season": 2026,
                "snapshot_date": "2026-11-11",
                "rating_scale": 120.0,
                "generated_at": "2026-11-11T09:00:00+00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (published_dir / "current_snapshot.json").write_text(
        json.dumps(
            [
                {
                    "school_key": "alpha",
                    "school_name": "阿尔法大学",
                    "published_rating": 1694.0,
                    "rmuc_live_state_theta": -0.05,
                    "confirmed_prior_theta": 0.0,
                    "residual_prior_theta": 0.35,
                    "regional_group_matches_played": 2,
                    "regional_pre_decay_factor": 1.0 / 3.0,
                    "current_stage_family": "regional_group",
                },
                {
                    "school_key": "beta",
                    "school_name": "贝塔大学",
                    "published_rating": 1686.0,
                    "rmuc_live_state_theta": 0.05,
                    "confirmed_prior_theta": 0.0,
                    "residual_prior_theta": -0.15,
                    "regional_group_matches_played": 2,
                    "regional_pre_decay_factor": 1.0 / 3.0,
                    "current_stage_family": "regional_group",
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (published_dir / "live_match_ledger.json").write_text(
        json.dumps(
            [
                {
                    "match_id": "official-1",
                    "match_date": "2026-11-11",
                    "season": 2026,
                    "region_slug": "south_region",
                    "stage_family": "regional_group",
                    "school_key": "alpha",
                    "school_name": "阿尔法大学",
                    "opponent_school_key": "beta",
                    "opponent_school_name": "贝塔大学",
                    "team_side": "red",
                    "scoreline": "2:0",
                    "match_result": "win",
                    "published_rating_before_match": 1700.0,
                    "published_rating_after_match": 1694.0,
                    "published_delta_rating": -6.0,
                    "live_update_delta_rating": 8.0,
                    "prior_component_delta_rating": -14.0,
                    "confirmed_prior_rating_after_match": 0.0,
                    "residual_prior_rating_after_match": 42.0,
                },
                {
                    "match_id": "official-1",
                    "match_date": "2026-11-11",
                    "season": 2026,
                    "region_slug": "south_region",
                    "stage_family": "regional_group",
                    "school_key": "beta",
                    "school_name": "贝塔大学",
                    "opponent_school_key": "alpha",
                    "opponent_school_name": "阿尔法大学",
                    "team_side": "blue",
                    "scoreline": "0:2",
                    "match_result": "loss",
                    "published_rating_before_match": 1680.0,
                    "published_rating_after_match": 1686.0,
                    "published_delta_rating": 6.0,
                    "live_update_delta_rating": -8.0,
                    "prior_component_delta_rating": 14.0,
                    "confirmed_prior_rating_after_match": 0.0,
                    "residual_prior_rating_after_match": -18.0,
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(service, "PRESEASON_RATINGS_CSV", ratings_path)
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", published_dir)
    service.load_ratings_rows.cache_clear()
    service.load_preseason_global_elo_rank_map.cache_clear()
    service.load_current_rating_index.cache_clear()
    service.load_global_elo_rank_map.cache_clear()
    service._reset_live_state_caches()

    response = client.get("/api/regions/south_region/live-state")
    assert response.status_code == 200
    payload = response.json()

    assert payload["available"] is True
    assert payload["currentSnapshot"][0]["teamKey"] == "alpha::main"
    assert payload["currentSnapshot"][0]["currentPublishedRating"] == 1694.0
    assert payload["currentSnapshot"][0]["publishedDeltaFromPreseason"] == -6.0
    assert payload["matchLedger"][0]["matchId"] == "official-1"
    assert payload["teamIndex"]["alpha::main"]["schoolKey"] == "alpha"
