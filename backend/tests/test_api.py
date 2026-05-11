from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

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
        assert abs(first_team["currentElo"] - (first_team["preseasonElo"] + first_team["eloDeltaFromPreseason"])) < 1e-5
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


def test_current_live_elo_reloads_when_runtime_snapshot_changes(tmp_path, monkeypatch) -> None:
    published_dir = tmp_path / "published_2026"
    published_dir.mkdir(parents=True)
    rating_row = next(row for row in service.load_ratings_rows() if row.get("school_key"))
    school_key = str(rating_row["school_key"])
    team_key = str(rating_row["team_key"])

    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", published_dir)

    def write_snapshot(rating: float, marker: str) -> None:
        (published_dir / "current_snapshot.json").write_text(
            json.dumps([{"school_key": school_key, "published_rating": rating, "marker": marker}], ensure_ascii=False),
            encoding="utf-8",
        )

    write_snapshot(1111.0, "old")
    service._reset_live_state_caches()
    assert service.load_current_rating_index()[team_key]["currentElo"] == 1111.0
    first_version = service.summarize_live_status("south_region")["runtimeArtifactVersion"]

    write_snapshot(2222.0, "new-snapshot")
    assert service.summarize_live_status("south_region")["runtimeArtifactVersion"] != first_version
    assert service.load_current_rating_index()[team_key]["currentElo"] == 2222.0


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


def test_official_live_slot_placeholders_do_not_emit_simulated_slots() -> None:
    context = service.rmuc_live.LiveRuntimeContext(
        region_slug="south_region",
        source_status="active",
        reason=None,
        matches_by_pair={},
        matches_by_pair_round={},
        matches_by_pair_label={},
        swiss_pairings={},
        slot_assignments={},
        group_rank_metrics={},
        completed_count=0,
        confirmed_count=0,
    )

    slots = service._official_live_slot_placeholders("south_region", context)

    assert len(slots) == 32
    assert {slot["slot"] for slot in slots} == set(service.region_sim.region_core.ALL_SLOTS)
    assert all(slot["teamKey"] == "" for slot in slots)
    assert slots[0]["collegeName"] == "A1"
    assert slots[0]["teamName"] == "学校队伍待确认"
    slots_by_slot = {slot["slot"]: slot for slot in slots}
    assert slots_by_slot["A1"]["seedTier"] == "tier1"
    assert slots_by_slot["A2"]["seedTier"] == "tier2"
    assert slots_by_slot["A9"]["seedTier"] == "unseeded"
    assert slots_by_slot["B1"]["seedTier"] == "tier1"
    assert slots_by_slot["B2"]["seedTier"] == "tier2"
    assert slots_by_slot["B9"]["seedTier"] == "unseeded"
    assert all(slot["collegeName"] != "上海交通大学" for slot in slots)


def test_live_payload_hides_unofficial_final_rankings(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "sourceUpdatedAt": "2026-05-10T12:00:00+08:00",
                "regions": {
                    "south_region": {
                        "matches": [],
                        "slotAssignments": {},
                        "groupRankMetrics": {},
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    service._reset_live_state_caches()

    payload = service.build_simulation_payload("south_region", 20260414, mode="live", samples=8)

    assert payload["meta"]["liveStatus"]["sourceStatus"] == "active"
    assert payload["finalRankings"]
    assert all(row["teamKey"] == "" for row in payload["finalRankings"])
    assert all(row["collegeName"] != "上海交通大学" for row in payload["finalRankings"])
    assert payload["finalRankings"][0]["collegeName"] == "待确认"
    assert payload["finalRankings"][0]["teamName"] == "学校队伍待确认"
    assert payload["summary"]["nationalQualifiers"] == []
    assert payload["summary"]["repechageQualifiers"] == []


def test_live_payload_hides_predicted_final_rankings_after_official_draw_until_finals_complete(tmp_path, monkeypatch) -> None:
    sim_payload = service.build_simulation_payload("south_region", 20260414, mode="sim", samples=8)
    slot_assignments = {slot["teamKey"]: slot["slot"] for slot in sim_payload["slots"]}
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "sourceUpdatedAt": "2026-05-10T12:00:00+08:00",
                "regions": {
                    "south_region": {
                        "matches": [],
                        "slotAssignments": slot_assignments,
                        "groupRankMetrics": {},
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    service._reset_live_state_caches()

    payload = service.build_simulation_payload("south_region", 20260414, mode="live", samples=8)

    assert payload["meta"]["liveStatus"]["slotAssignmentSource"] == "official"
    assert payload["finalRankings"]
    assert all(row["teamKey"] == "" for row in payload["finalRankings"])
    assert all(row["collegeName"] == "待确认" for row in payload["finalRankings"])
    assert payload["summary"]["nationalQualifiers"] == []
    assert payload["summary"]["repechageQualifiers"] == []


def _south_region_official_slot_assignments() -> dict[str, str]:
    rows = [row for row in service.load_ratings_rows() if row["admitted_region"] == "南部赛区"]
    return {
        service.compute_team_key(row["college_name"], row["team_name"]): slot
        for row, slot in zip(rows, service.region_sim.region_core.ALL_SLOTS, strict=True)
    }


def _write_active_live_schedule(
    path: Path,
    *,
    region_slug: str = "south_region",
    slot_assignments: dict[str, str] | None = None,
    matches: list[dict[str, object]] | None = None,
) -> None:
    path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "sourceUpdatedAt": "2026-05-10T12:00:00+08:00",
                "fetchedAt": "2026-05-10T12:00:00+08:00",
                "regions": {
                    region_slug: {
                        "matches": matches or [],
                        "slotAssignments": slot_assignments or {},
                        "groupRankMetrics": {},
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _without_volatile_simulation_fields(payload: dict[str, object]) -> dict[str, object]:
    stable = json.loads(json.dumps(payload, ensure_ascii=False))
    meta = stable.get("meta", {})
    if isinstance(meta, dict):
        meta.pop("seed", None)
        meta.pop("generatedAt", None)
    return stable


def test_active_live_prediction_payload_is_seed_independent_with_official_slots(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    _write_active_live_schedule(normalized_path, slot_assignments=_south_region_official_slot_assignments())
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    service._reset_live_state_caches()

    first = service.build_simulation_payload("south_region", 20260414, mode="live", samples=1)
    second = service.build_simulation_payload("south_region", 20261111, mode="live", samples=1)

    assert first["meta"]["liveStatus"]["predictionBasis"] == "current_elo_h2h_deterministic"
    assert second["meta"]["liveStatus"]["predictionBasis"] == "current_elo_h2h_deterministic"
    assert _without_volatile_simulation_fields(first) == _without_volatile_simulation_fields(second)


def test_active_live_prediction_uses_current_elo_before_preseason_rating(tmp_path, monkeypatch) -> None:
    rows = [row for row in service.load_ratings_rows() if row["admitted_region"] == "南部赛区"]
    weakest = min(rows, key=lambda row: float(row["mu0"]))
    strongest = max(rows, key=lambda row: float(row["mu0"]))
    reserved_team_keys = {str(weakest["team_key"]), str(strongest["team_key"])}
    remaining_team_keys = [str(row["team_key"]) for row in rows if str(row["team_key"]) not in reserved_team_keys]
    slot_assignments = {
        str(weakest["team_key"]): "A1",
        str(strongest["team_key"]): "A9",
    }
    remaining_slots = [slot for slot in service.region_sim.region_core.ALL_SLOTS if slot not in {"A1", "A9"}]
    slot_assignments.update(
        {team_key: slot for team_key, slot in zip(remaining_team_keys, remaining_slots, strict=True)}
    )

    normalized_path = tmp_path / "normalized_schedule.json"
    published_dir = tmp_path / "published_2026"
    published_dir.mkdir(parents=True)
    _write_active_live_schedule(normalized_path, slot_assignments=slot_assignments)
    (published_dir / "current_snapshot.json").write_text(
        json.dumps(
            [
                {"school_key": weakest.get("school_key") or service.rmuc_live.legacy_elo.make_school_key(weakest["college_name"]), "published_rating": 2200.0},
                {"school_key": strongest.get("school_key") or service.rmuc_live.legacy_elo.make_school_key(strongest["college_name"]), "published_rating": 1200.0},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", published_dir)
    service.load_current_rating_index.cache_clear()
    service.load_global_elo_rank_map.cache_clear()
    service._reset_live_state_caches()

    payload = service.build_simulation_payload("south_region", 20260414, mode="live", samples=1)
    match = next(row for row in payload["matches"] if row["matchLabel"] == "A-SWISS-1-1")

    assert match["redTeam"]["teamKey"] == weakest["team_key"]
    assert match["blueTeam"]["teamKey"] == strongest["team_key"]
    assert match["redCurrentElo"] == 2200.0
    assert match["blueCurrentElo"] == 1200.0
    assert match["pGameRed"] == 0.95
    assert match["winnerTeamKey"] == weakest["team_key"]


def test_live_builder_keeps_official_results_and_uses_runtime_h2h_for_later_predictions() -> None:
    red_team = SimpleNamespace(
        team_key="red-school::main",
        college_name="红方大学",
        team_name="Main",
        mu0=1700.0,
        sigma0=40.0,
        beta_perf=0.5,
    )
    blue_team = SimpleNamespace(
        team_key="blue-school::main",
        college_name="蓝方大学",
        team_name="Main",
        mu0=1600.0,
        sigma0=40.0,
        beta_perf=0.5,
    )
    context = service.rmuc_live.LiveRuntimeContext(
        region_slug="south_region",
        source_status="active",
        reason=None,
        matches_by_pair={},
        matches_by_pair_round={
            ("red-school::main", "blue-school::main", "swiss", 1): {
                "matchId": "2026RMUC:OFFICIAL-1",
                "officialMatchId": "OFFICIAL-1",
                "officialStatus": "DONE",
                "plannedStartAt": "2026-05-02T12:00:00+00:00",
                "scoreline": "0:2",
                "isCompleted": True,
            }
        },
        matches_by_pair_label={},
        swiss_pairings={},
        slot_assignments={},
        group_rank_metrics={},
        completed_count=1,
        confirmed_count=1,
    )
    builder = service.live_payload_builder_factory(context, current_rating_index={})
    head_to_head_index = service.region_sim.h2h.clone_runtime_head_to_head_index()

    official_payload = builder(
        red_team,
        blue_team,
        best_of=3,
        samples=1,
        match_seed=111,
        head_to_head_index=head_to_head_index,
        stage="swiss",
        round_number=1,
        match_label="A-SWISS-1-1",
    )
    service.region_sim.record_runtime_head_to_head_result(head_to_head_index, red_team, blue_team, 0, 2)
    later_payload = builder(
        red_team,
        blue_team,
        best_of=3,
        samples=1,
        match_seed=222,
        head_to_head_index=head_to_head_index,
        stage="swiss",
        round_number=2,
        match_label="A-SWISS-2-1",
    )

    assert official_payload["fixed_scoreline"] == "0:2"
    assert later_payload["head_to_head_summary"]["delta_h2h"] < 0
    assert later_payload["p_game_adj_red"] < later_payload["p_game_base_red"]


def test_live_builder_uses_ledger_before_ratings_for_completed_match_probability() -> None:
    red_team = SimpleNamespace(
        team_key="red-school::main",
        college_name="红方大学",
        team_name="Main",
        mu0=1700.0,
        sigma0=40.0,
        beta_perf=0.5,
    )
    blue_team = SimpleNamespace(
        team_key="blue-school::main",
        college_name="蓝方大学",
        team_name="Main",
        mu0=1600.0,
        sigma0=40.0,
        beta_perf=0.5,
    )
    context = service.rmuc_live.LiveRuntimeContext(
        region_slug="south_region",
        source_status="active",
        reason=None,
        matches_by_pair={},
        matches_by_pair_round={
            ("red-school::main", "blue-school::main", "swiss", 1): {
                "matchId": "2026RMUC:OFFICIAL-1",
                "officialMatchId": "OFFICIAL-1",
                "officialStatus": "DONE",
                "plannedStartAt": "2026-05-02T12:00:00+00:00",
                "scoreline": "0:2",
                "isCompleted": True,
            }
        },
        matches_by_pair_label={},
        swiss_pairings={},
        slot_assignments={},
        group_rank_metrics={},
        completed_count=1,
        confirmed_count=1,
    )
    builder = service.live_payload_builder_factory(
        context,
        {
            ("2026RMUC:OFFICIAL-1", "red-school"): {
                "published_rating_before_match": 1300.0,
                "published_rating_after_match": 1288.0,
            },
            ("2026RMUC:OFFICIAL-1", "blue-school"): {
                "published_rating_before_match": 1900.0,
                "published_rating_after_match": 1912.0,
            },
        },
        current_rating_index={
            "red-school::main": {"currentElo": 2200.0},
            "blue-school::main": {"currentElo": 1200.0},
        },
    )

    payload = builder(
        red_team,
        blue_team,
        best_of=3,
        samples=1,
        match_seed=111,
        head_to_head_index={},
        stage="swiss",
        round_number=1,
        match_label="A-SWISS-1-1",
    )

    assert payload["fixed_scoreline"] == "0:2"
    assert payload["p_game_base_red"] == 0.05
    assert payload["p_game_adj_red"] == 0.05
    assert payload["p_series_red"] < 0.01


def test_live_payload_without_official_slots_hides_simulated_group_rankings(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    _write_active_live_schedule(normalized_path, slot_assignments={})
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    service._reset_live_state_caches()

    payload = service.build_simulation_payload("south_region", 20260414, mode="live", samples=1)

    assert payload["meta"]["liveStatus"]["slotAssignmentSource"] == "official_placeholder"
    assert payload["groupRankings"] == {"A": [], "B": []}
    assert all(slot["teamKey"] == "" for slot in payload["slots"])


def _fake_match(
    *,
    match_label: str,
    planned_start_at: str | None,
    is_real_result: bool,
    p_series_red: float,
    p_game_red: float,
    mini_program_prediction: dict[str, object] | None = None,
    official_status: str | None = "PENDING",
    official_match_id: str | None = None,
    red_team_key: str | None = None,
    blue_team_key: str | None = None,
    winner_team_key: str | None = None,
    scoreline: str = "0:0",
) -> dict[str, object]:
    red_key = red_team_key or f"red::{match_label}"
    blue_key = blue_team_key or f"blue::{match_label}"
    winner_key = winner_team_key or red_key
    loser_key = blue_key if winner_key == red_key else red_key
    payload: dict[str, object] = {
        "matchLabel": match_label,
        "stage": "swiss",
        "stageOrder": 1,
        "roundNumber": 1,
        "groupName": "A",
        "bestOf": 3,
        "isRealResult": is_real_result,
        "isConfirmedMatchup": True,
        "redTeam": {"teamKey": red_key, "collegeName": f"红方{match_label}", "teamName": "Red"},
        "blueTeam": {"teamKey": blue_key, "collegeName": f"蓝方{match_label}", "teamName": "Blue"},
        "scoreline": scoreline,
        "winnerTeamKey": winner_key,
        "loserTeamKey": loser_key,
        "pGameRed": p_game_red,
        "pGameBlue": 1.0 - p_game_red,
        "pSeriesRed": p_series_red,
        "pSeriesBlue": 1.0 - p_series_red,
        "deltaH2H": 0.0,
        "confidenceLabel": "medium",
        "winnerNext": "",
        "loserNext": "",
    }
    if planned_start_at is not None:
        payload["plannedStartAt"] = planned_start_at
    if official_status is not None:
        payload["officialStatus"] = official_status
    if official_match_id is not None:
        payload["officialMatchId"] = official_match_id
    if mini_program_prediction is not None:
        payload["miniProgramPrediction"] = mini_program_prediction
    return payload


def test_live_schedule_metadata_adds_rules_time_without_official_lock(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "regions": {
                    "south_region": {
                        "matches": [
                            {
                                "matchLabel": "SIM-UNLOCKED",
                                "plannedStartAt": "2026-05-15T17:40:00+08:00",
                                "miniProgramPrediction": {
                                    "status": "available",
                                    "redRate": 0.33,
                                    "blueRate": 0.67,
                                    "tieRate": 0.0,
                                    "totalCount": 120,
                                },
                            }
                        ]
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    payload = {
        "matches": [
            _fake_match(
                match_label="SIM-UNLOCKED",
                planned_start_at=None,
                is_real_result=False,
                p_series_red=0.66,
                p_game_red=0.6,
                official_status=None,
                official_match_id=None,
            )
        ]
    }

    service._attach_live_schedule_metadata(payload, "south_region")

    match = payload["matches"][0]
    assert match["plannedStartAt"] == "2026-05-15T17:40:00+08:00"
    assert match["miniProgramPrediction"]["redRate"] == 0.33
    assert "officialMatchId" not in match
    assert "officialStatus" not in match


def test_live_schedule_metadata_uses_unconfirmed_official_placeholder(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "regions": {
                    "south_region": {
                        "matches": [
                            {
                                "matchLabel": "A-SWISS-1-1",
                                "officialMatchId": "30900",
                                "officialStatus": "WAITING",
                                "plannedStartAt": "2026-05-13T08:10:00+08:00",
                                "isConfirmedMatchup": False,
                                "scoreline": "0:0",
                                "redSlot": "A1",
                                "blueSlot": "A9",
                            }
                        ]
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    payload = {
        "matches": [
            _fake_match(
                match_label="A-SWISS-1-1",
                planned_start_at=None,
                is_real_result=False,
                p_series_red=0.72,
                p_game_red=0.64,
                official_status=None,
                official_match_id=None,
            )
        ]
    }

    service._attach_live_schedule_metadata(payload, "south_region")

    match = payload["matches"][0]
    assert match["officialMatchId"] == "30900"
    assert match["officialStatus"] == "WAITING"
    assert match["plannedStartAt"] == "2026-05-13T08:10:00+08:00"
    assert match["isConfirmedMatchup"] is False
    assert match["redTeam"] == {
        "teamKey": "",
        "collegeName": "A1",
        "teamName": "官方槽位待确认",
        "slot": "A1",
    }
    assert match["blueTeam"]["teamKey"] == ""
    assert match["blueTeam"]["collegeName"] == "A9"
    assert match["pSeriesRed"] == 0.5
    assert match["winnerTeamKey"] == ""


def test_live_schedule_metadata_preserves_predicted_unconfirmed_matchups_after_draw(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "regions": {
                    "south_region": {
                        "matches": [
                            {
                                "matchLabel": "A-SWISS-2-1",
                                "officialMatchId": "30916",
                                "officialStatus": "WAITING",
                                "plannedStartAt": "2026-05-13T20:00:00+08:00",
                                "isConfirmedMatchup": False,
                                "scoreline": "0:0",
                                "redFillSourceType": "Group",
                                "redFillSourceId": "2707",
                                "redFillSourceNumber": 1,
                                "blueFillSourceType": "Group",
                                "blueFillSourceId": "2707",
                                "blueFillSourceNumber": 2,
                            }
                        ]
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    payload = {
        "matches": [
            _fake_match(
                match_label="A-SWISS-2-1",
                planned_start_at=None,
                is_real_result=False,
                p_series_red=0.72,
                p_game_red=0.64,
                official_status=None,
                official_match_id=None,
                scoreline="2:1",
            )
        ]
    }
    payload["matches"][0]["isConfirmedMatchup"] = False

    service._attach_live_schedule_metadata(
        payload,
        "south_region",
        preserve_predicted_unconfirmed=True,
    )

    match = payload["matches"][0]
    assert match["officialMatchId"] == "30916"
    assert match["officialStatus"] == "WAITING"
    assert match["plannedStartAt"] == "2026-05-13T20:00:00+08:00"
    assert match["isConfirmedMatchup"] is False
    assert match["redTeam"]["teamKey"] == "red::A-SWISS-2-1"
    assert match["blueTeam"]["teamKey"] == "blue::A-SWISS-2-1"
    assert match["pSeriesRed"] == 0.72
    assert match["winnerTeamKey"] == "red::A-SWISS-2-1"
    live_status = {"sourceStatus": "active"}
    assert service._prematch_data_source("live", live_status, match) == "simulation_proxy"
    assert service._prematch_schedule_state("simulation_proxy", match) == "simulation_proxy"


def test_live_schedule_metadata_names_unconfirmed_source_matches(tmp_path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "regions": {
                    "south_region": {
                        "matches": [
                            {
                                "matchLabel": "A-SWISS-2-1",
                                "isConfirmedMatchup": False,
                                "redFillSourceType": "Group",
                                "redFillSourceId": "2707",
                                "redFillSourceNumber": 1,
                                "blueFillSourceType": "Group",
                                "blueFillSourceId": "2707",
                                "blueFillSourceNumber": 2,
                            },
                            {
                                "matchLabel": "B-SWISS-2-1",
                                "isConfirmedMatchup": False,
                                "redFillSourceType": "Group",
                                "redFillSourceId": "2708",
                                "redFillSourceNumber": 2,
                                "blueFillSourceType": "Group",
                                "blueFillSourceId": "2708",
                                "blueFillSourceNumber": 1,
                            },
                            {
                                "matchLabel": "R16-1",
                                "officialMatchId": "30966",
                                "orderNumber": 67,
                                "officialStatus": "WAITING",
                                "isConfirmedMatchup": False,
                                "scoreline": "0:0",
                                "redFillSourceType": "Group",
                                "redFillSourceId": "2708",
                                "redFillSourceNumber": 1,
                                "blueFillSourceType": "Group",
                                "blueFillSourceId": "2707",
                                "blueFillSourceNumber": 8,
                            },
                            {
                                "matchLabel": "R16-2",
                                "officialMatchId": "30967",
                                "orderNumber": 68,
                                "isConfirmedMatchup": False,
                            },
                            {
                                "matchLabel": "QUAL-1-1",
                                "officialMatchId": "30978",
                                "orderNumber": 79,
                                "officialStatus": "WAITING",
                                "plannedStartAt": "2026-05-16T17:30:00+08:00",
                                "isConfirmedMatchup": False,
                                "scoreline": "0:0",
                                "redFillSourceType": "Match",
                                "redFillSourceId": "30966",
                                "redFillSourceNumber": 2,
                                "blueFillSourceType": "Match",
                                "blueFillSourceId": "30967",
                                "blueFillSourceNumber": 2,
                            }
                        ]
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    payload = {
        "matches": [
            _fake_match(
                match_label="R16-1",
                planned_start_at=None,
                is_real_result=False,
                p_series_red=0.72,
                p_game_red=0.64,
                official_status=None,
                official_match_id=None,
            ),
            _fake_match(
                match_label="QUAL-1-1",
                planned_start_at=None,
                is_real_result=False,
                p_series_red=0.72,
                p_game_red=0.64,
                official_status=None,
                official_match_id=None,
            )
        ]
    }

    service._attach_live_schedule_metadata(payload, "south_region")

    round_of_16 = payload["matches"][0]
    assert round_of_16["regionalMatchNumber"] == 67
    assert round_of_16["redTeam"]["collegeName"] == "B组第1名"
    assert round_of_16["blueTeam"]["collegeName"] == "A组第8名"

    match = payload["matches"][1]
    assert match["regionalMatchNumber"] == 79
    assert match["redTeam"] == {
        "teamKey": "",
        "collegeName": "第67场败者",
        "teamName": "晋级来源待确认",
        "slot": None,
    }
    assert match["blueTeam"]["collegeName"] == "第68场败者"
    assert match["blueTeam"]["teamName"] == "晋级来源待确认"


def test_prematch_center_groups_today_next_and_prediction_signals(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        assert region_slug == "south_region"
        assert seed == 20260414
        assert mode == "live"
        return {
            "meta": {
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-03T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-03T00:00:00+00:00",
                    "completedOfficialMatches": 1,
                    "confirmedOfficialMatches": 3,
                    "ledgerRows": 2,
                },
            },
            "matches": [
                _fake_match(
                    match_label="DONE-1",
                    planned_start_at="2026-05-03T01:00:00+00:00",
                    is_real_result=True,
                    p_series_red=0.7,
                    p_game_red=0.62,
                    official_match_id="DONE-1",
                    official_status="DONE",
                ),
                _fake_match(
                    match_label="NEXT-1",
                    planned_start_at="2026-05-03T02:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.68,
                    p_game_red=0.61,
                    official_match_id="NEXT-1",
                    mini_program_prediction={
                        "status": "available",
                        "matchId": "NEXT-1",
                        "redCount": 44,
                        "blueCount": 56,
                        "tieCount": 0,
                        "totalCount": 100,
                        "redRate": 0.44,
                        "blueRate": 0.56,
                        "tieRate": 0.0,
                        "fetchedAt": "2026-05-03T00:00:00+00:00",
                    },
                ),
                _fake_match(
                    match_label="LATER-1",
                    planned_start_at="2026-05-04T02:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.52,
                    p_game_red=0.51,
                    official_match_id="LATER-1",
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-03",
        region_slugs=["south_region"],
    )

    assert payload["pendingMatchCount"] == 2
    assert payload["completedMatchCount"] == 1
    assert payload["nextMatch"]["matchLabel"] == "NEXT-1"
    assert [match["matchLabel"] for match in payload["todayMatches"]] == ["NEXT-1"]
    assert [match["matchLabel"] for match in payload["allUpcomingMatches"]] == ["NEXT-1", "LATER-1"]
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["reviewPending"]] == ["DONE-1"]
    next_match = payload["nextMatch"]
    assert next_match["workspaceView"] == "swiss-a"
    assert next_match["predictedScoreline"] == "2:1"
    assert next_match["predictedWinnerSide"] == "red"
    assert next_match["modelAudienceDivergence"]["label"] == "明显分歧"
    assert next_match["modelAudienceDivergence"]["audienceFavoriteSide"] == "blue"
    assert next_match["upsetRisk"]["label"] in {"中", "高"}


def test_prematch_center_timeline_keeps_overdue_out_of_next_action(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        assert region_slug == "south_region"
        return {
            "meta": {
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-06T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-06T01:30:00+00:00",
                    "completedOfficialMatches": 4,
                    "confirmedOfficialMatches": 7,
                    "ledgerRows": 8,
                },
            },
            "matches": [
                _fake_match(
                    match_label="PAST-UNSYNC",
                    planned_start_at="2026-05-01T02:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.7,
                    p_game_red=0.62,
                    official_match_id="PAST-UNSYNC",
                ),
                _fake_match(
                    match_label="NEXT-FUTURE",
                    planned_start_at="2026-05-06T13:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.58,
                    p_game_red=0.55,
                    official_match_id="NEXT-FUTURE",
                ),
                _fake_match(
                    match_label="SIM-TBD",
                    planned_start_at=None,
                    is_real_result=False,
                    p_series_red=0.53,
                    p_game_red=0.51,
                    official_match_id=None,
                    official_status=None,
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-06",
        region_slugs=["south_region"],
        now=datetime(2026, 5, 6, 10, 0, tzinfo=UTC),
    )

    states = {match["matchLabel"]: match["timelineState"] for match in payload["allUpcomingMatches"]}
    assert states["PAST-UNSYNC"] == "overdue_unresolved"
    assert states["NEXT-FUTURE"] == "up_next"
    assert "SIM-TBD" not in states
    assert payload["nextMatch"]["matchLabel"] == "PAST-UNSYNC"
    assert payload["nextActionMatch"]["matchLabel"] == "NEXT-FUTURE"
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["overdueUnresolved"]] == ["PAST-UNSYNC"]
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["upNext"]] == ["NEXT-FUTURE"]
    assert payload["timelineBuckets"]["simulationUnassigned"] == []
    assert payload["sourceFreshness"]["officialScheduleUpdatedAt"] == "2026-05-06T01:30:00+00:00"
    assert payload["sourceFreshness"]["regionStatuses"][0]["regionSlug"] == "south_region"


def test_command_center_endpoint_returns_timeline_buckets(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": service.resolve_region_name(region_slug),
                "seed": seed,
                "generatedAt": "2099-01-01T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2099-01-01T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [
                _fake_match(
                    match_label=f"NEXT-{region_slug}",
                    planned_start_at="2099-01-01T09:00:00+08:00",
                    is_real_result=False,
                    p_series_red=0.62,
                    p_game_red=0.58,
                    official_match_id=f"NEXT-{region_slug}",
                )
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    response = client.get("/api/command-center?seed=20260414&mode=live&date=2099-01-01")

    assert response.status_code == 200
    payload = response.json()
    assert payload["nextActionMatch"]["matchLabel"] == "NEXT-south_region"
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["upNext"]] == [
        "NEXT-south_region"
    ]
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["todayPending"]] == [
        "NEXT-east_region",
        "NEXT-north_region",
    ]
    assert payload["sourceFreshness"]["activeRegionCount"] == 3


def test_prediction_recap_endpoint_aggregates_cross_region_accuracy(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        if region_slug == "north_region":
            matches = [
                _fake_match(
                    match_label="PENDING",
                    planned_start_at="2099-01-01T10:00:00+08:00",
                    is_real_result=False,
                    p_series_red=0.55,
                    p_game_red=0.52,
                    official_match_id="PENDING",
                )
            ]
        elif region_slug == "east_region":
            matches = [
                _fake_match(
                    match_label="UPSET-MISS",
                    planned_start_at="2026-05-01T10:00:00+08:00",
                    is_real_result=True,
                    p_series_red=0.78,
                    p_game_red=0.72,
                    winner_team_key="blue::UPSET-MISS",
                    scoreline="0:2",
                    official_match_id="UPSET-MISS",
                )
            ]
        else:
            matches = [
                _fake_match(
                    match_label="HIT-EXACT",
                    planned_start_at="2026-05-01T09:00:00+08:00",
                    is_real_result=True,
                    p_series_red=0.8,
                    p_game_red=0.74,
                    scoreline="2:0",
                    official_match_id="HIT-EXACT",
                )
            ]
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": service.resolve_region_name(region_slug),
                "seed": seed,
                "generatedAt": "2026-05-06T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-06T00:00:00+00:00",
                    "completedOfficialMatches": 2,
                    "confirmedOfficialMatches": 3,
                    "ledgerRows": 2,
                },
            },
            "matches": matches,
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    response = client.get("/api/prediction-recap?seed=20260414&mode=live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["completedMatches"] == 2
    assert payload["summary"]["pendingMatches"] == 1
    assert payload["summary"]["winnerHits"] == 1
    assert payload["summary"]["scorelineHits"] == 1
    assert payload["summary"]["upsetMisses"] == 1
    assert payload["byRegion"]["south_region"]["winnerHits"] == 1
    assert payload["byRegion"]["east_region"]["upsetMisses"] == 1
    assert payload["notableMatches"][0]["matchLabel"] == "UPSET-MISS"
    assert payload["notableMatches"][0]["redTeam"]["teamKey"] == "red::UPSET-MISS"
    assert payload["notableMatches"][0]["blueTeam"]["teamKey"] == "blue::UPSET-MISS"
    assert payload["notableMatches"][0]["predictedWinnerSide"] == "red"


def test_prediction_recap_live_mode_excludes_simulation_proxy_matches(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": service.resolve_region_name(region_slug),
                "seed": seed,
                "generatedAt": "2026-05-06T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "missing",
                    "sourceReason": "尚未同步官方实时赛程",
                    "sourceUpdatedAt": None,
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 0,
                    "ledgerRows": 0,
                },
            },
            "matches": [
                _fake_match(
                    match_label="SIM-PENDING",
                    planned_start_at="2099-01-01T10:00:00+08:00",
                    is_real_result=False,
                    p_series_red=0.55,
                    p_game_red=0.52,
                    official_match_id=None,
                    official_status=None,
                ),
                _fake_match(
                    match_label="SIM-COMPLETED",
                    planned_start_at="2026-05-01T10:00:00+08:00",
                    is_real_result=True,
                    p_series_red=0.78,
                    p_game_red=0.72,
                    scoreline="2:0",
                    official_match_id=None,
                    official_status=None,
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    response = client.get("/api/prediction-recap?seed=20260414&mode=live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["completedMatches"] == 0
    assert payload["summary"]["pendingMatches"] == 0
    assert payload["notableMatches"] == []
    assert all(group["completedMatches"] == 0 for group in payload["byRegion"].values())
    assert all(group["pendingMatches"] == 0 for group in payload["byRegion"].values())


def test_team_profile_endpoint_returns_team_path_and_region_link(monkeypatch) -> None:
    team_key = "alpha::main"

    def fake_overview() -> dict[str, object]:
        return {
            "generatedAt": "2026-05-06T00:00:00+00:00",
            "regions": [
                {
                    "regionSlug": "south_region",
                    "regionName": "南部赛区",
                    "nationalSlots": 8,
                    "repechageSlots": 4,
                    "liveStatus": service.summarize_live_status("south_region"),
                    "teams": [
                        {
                            "teamKey": team_key,
                            "collegeName": "Alpha University",
                            "teamName": "Main",
                            "mu0": 1700.0,
                            "sigma0": 40.0,
                            "eloGlobalRank": 3,
                            "eloRegionRank": 1,
                            "currentElo": 1712.0,
                            "preseasonElo": 1700.0,
                            "eloDeltaFromPreseason": 12.0,
                            "eloRankSource": "live",
                            "seedTier": "tier1",
                            "seedRankInRegion": 1,
                            "regionSlug": "south_region",
                            "regionName": "南部赛区",
                            "probabilities": {
                                "roundOf16": 1.0,
                                "repechage": 0.42,
                                "national": 0.81,
                                "champion": 0.2,
                            },
                        }
                    ],
                }
            ],
        }

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        assert region_slug == "south_region"
        return {
            "meta": {
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-06T00:00:00+00:00",
                "liveStatus": service.summarize_live_status("south_region"),
            },
            "slots": [
                {
                    "teamKey": team_key,
                    "collegeName": "Alpha University",
                    "teamName": "Main",
                    "groupName": "A",
                    "slot": "A1",
                    "drawBox": "A",
                    "seedTier": "tier1",
                    "seedRankInRegion": 1,
                    "mu0": 1700.0,
                    "sigma0": 40.0,
                    "eloGlobalRank": 3,
                    "currentElo": 1712.0,
                    "preseasonElo": 1700.0,
                    "eloDeltaFromPreseason": 12.0,
                    "eloRankSource": "live",
                }
            ],
            "matches": [
                _fake_match(
                    match_label="DONE-ALPHA",
                    planned_start_at="2026-05-01T09:00:00+08:00",
                    is_real_result=True,
                    p_series_red=0.72,
                    p_game_red=0.66,
                    red_team_key=team_key,
                    blue_team_key="beta::main",
                    winner_team_key=team_key,
                    official_match_id="DONE-ALPHA",
                    official_status="DONE",
                    scoreline="2:0",
                ),
                _fake_match(
                    match_label="NEXT-ALPHA",
                    planned_start_at="2099-01-01T09:00:00+08:00",
                    is_real_result=False,
                    p_series_red=0.58,
                    p_game_red=0.54,
                    red_team_key=team_key,
                    blue_team_key="gamma::main",
                    official_match_id="NEXT-ALPHA",
                ),
                _fake_match(
                    match_label="PROJECTED-AFTER-NEXT",
                    planned_start_at=None,
                    is_real_result=False,
                    p_series_red=0.51,
                    p_game_red=0.5,
                    red_team_key=team_key,
                    blue_team_key="delta::main",
                    official_status=None,
                ),
            ],
            "finalRankings": [
                {
                    "rank": 2,
                    "teamKey": team_key,
                    "collegeName": "Alpha University",
                    "teamName": "Main",
                    "groupName": "A",
                    "slot": "A1",
                    "seedTier": "tier1",
                    "seedRankInRegion": 1,
                    "swissWins": 5,
                    "swissLosses": 1,
                    "swissGroupRank": 1,
                    "mu0": 1700.0,
                    "currentElo": 1712.0,
                    "preseasonElo": 1700.0,
                    "eloDeltaFromPreseason": 12.0,
                    "eloRankSource": "live",
                    "finalBucket": "runner_up",
                    "advancement": "national_qualified",
                }
            ],
        }

    monkeypatch.setattr(service, "build_overview_payload", fake_overview)
    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    response = client.get(f"/api/teams/{quote(team_key, safe='')}?seed=20260414&mode=live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["team"]["teamKey"] == team_key
    assert payload["team"]["currentElo"] == 1712.0
    assert payload["region"]["regionSlug"] == "south_region"
    assert payload["slot"] is None
    assert payload["finalRanking"] is None
    assert [match["matchLabel"] for match in payload["matchPath"]] == ["DONE-ALPHA"]
    assert payload["completedMatches"][0]["resultForTeam"] == "win"
    assert [match["matchLabel"] for match in payload["completedMatches"]] == ["DONE-ALPHA"]
    assert [match["matchLabel"] for match in payload["upcomingMatches"]] == [
        "NEXT-ALPHA",
        "PROJECTED-AFTER-NEXT",
    ]
    assert payload["upcomingMatches"][0]["opponent"]["teamKey"] == "gamma::main"
    assert payload["upcomingMatches"][1]["opponent"]["teamKey"] == "delta::main"
    assert payload["regionEntry"]["highlightTeamKey"] == team_key


def test_team_profile_hides_simulation_path_before_confirmed_live_data(monkeypatch) -> None:
    team_key = "alpha::main"

    def fake_overview() -> dict[str, object]:
        return {
            "generatedAt": "2026-05-06T00:00:00+00:00",
            "regions": [
                {
                    "regionSlug": "south_region",
                    "regionName": "南部赛区",
                    "nationalSlots": 8,
                    "repechageSlots": 4,
                    "liveStatus": service.summarize_live_status("south_region"),
                    "teams": [
                        {
                            "teamKey": team_key,
                            "collegeName": "Alpha University",
                            "teamName": "Main",
                            "mu0": 1700.0,
                            "sigma0": 40.0,
                            "eloGlobalRank": 3,
                            "eloRegionRank": 1,
                            "currentElo": 1712.0,
                            "preseasonElo": 1700.0,
                            "eloDeltaFromPreseason": 12.0,
                            "eloRankSource": "live",
                            "seedTier": "tier1",
                            "seedRankInRegion": 1,
                            "regionSlug": "south_region",
                            "regionName": "南部赛区",
                            "probabilities": {
                                "roundOf16": 1.0,
                                "repechage": 0.42,
                                "national": 0.81,
                                "champion": 0.2,
                            },
                        }
                    ],
                }
            ],
        }

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        assert region_slug == "south_region"
        return {
            "meta": {
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-06T00:00:00+00:00",
                "liveStatus": service.summarize_live_status("south_region"),
            },
            "slots": [
                {
                    "teamKey": team_key,
                    "collegeName": "Alpha University",
                    "teamName": "Main",
                    "groupName": "A",
                    "slot": "A1",
                    "drawBox": "A",
                    "seedTier": "tier1",
                    "seedRankInRegion": 1,
                    "mu0": 1700.0,
                    "sigma0": 40.0,
                    "eloGlobalRank": 3,
                    "currentElo": 1712.0,
                    "preseasonElo": 1700.0,
                    "eloDeltaFromPreseason": 12.0,
                    "eloRankSource": "live",
                }
            ],
            "matches": [
                _fake_match(
                    match_label="SIM-ONLY",
                    planned_start_at=None,
                    is_real_result=False,
                    p_series_red=0.58,
                    p_game_red=0.54,
                    red_team_key=team_key,
                    blue_team_key="beta::main",
                    official_status=None,
                ),
            ],
            "finalRankings": [
                {
                    "rank": 1,
                    "teamKey": team_key,
                    "collegeName": "Alpha University",
                    "teamName": "Main",
                    "groupName": "A",
                    "slot": "A1",
                    "seedTier": "tier1",
                    "seedRankInRegion": 1,
                    "swissWins": 5,
                    "swissLosses": 0,
                    "swissGroupRank": 1,
                    "mu0": 1700.0,
                    "currentElo": 1712.0,
                    "preseasonElo": 1700.0,
                    "eloDeltaFromPreseason": 12.0,
                    "eloRankSource": "live",
                    "finalBucket": "champion",
                    "advancement": "national_qualified",
                }
            ],
        }

    monkeypatch.setattr(service, "build_overview_payload", fake_overview)
    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    response = client.get(f"/api/teams/{quote(team_key, safe='')}?seed=20260414&mode=live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["slot"] is None
    assert payload["finalRanking"] is None
    assert payload["matchPath"] == []
    assert payload["completedMatches"] == []
    assert payload["upcomingMatches"] == []


def test_team_profile_keeps_official_live_slot_assignment(monkeypatch) -> None:
    team_key = "alpha::main"

    def fake_overview() -> dict[str, object]:
        return {
            "generatedAt": "2026-05-06T00:00:00+00:00",
            "regions": [
                {
                    "regionSlug": "south_region",
                    "regionName": "南部赛区",
                    "nationalSlots": 8,
                    "repechageSlots": 4,
                    "liveStatus": service.summarize_live_status("south_region"),
                    "teams": [
                        {
                            "teamKey": team_key,
                            "collegeName": "Alpha University",
                            "teamName": "Main",
                            "mu0": 1700.0,
                            "sigma0": 40.0,
                            "eloGlobalRank": 3,
                            "eloRegionRank": 1,
                            "currentElo": 1712.0,
                            "preseasonElo": 1700.0,
                            "eloDeltaFromPreseason": 12.0,
                            "eloRankSource": "live",
                            "seedTier": "tier1",
                            "seedRankInRegion": 1,
                            "regionSlug": "south_region",
                            "regionName": "南部赛区",
                            "probabilities": {
                                "roundOf16": 1.0,
                                "repechage": 0.42,
                                "national": 0.81,
                                "champion": 0.2,
                            },
                        }
                    ],
                }
            ],
        }

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        assert region_slug == "south_region"
        return {
            "meta": {
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-06T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-06T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 0,
                    "ledgerRows": 0,
                    "slotAssignmentSource": "official",
                    "slotAssignmentReason": None,
                },
            },
            "slots": [
                {
                    "teamKey": team_key,
                    "collegeName": "Alpha University",
                    "teamName": "Main",
                    "groupName": "A",
                    "slot": "A1",
                    "drawBox": "A",
                    "seedTier": "tier1",
                    "seedRankInRegion": 1,
                    "mu0": 1700.0,
                    "sigma0": 40.0,
                    "eloGlobalRank": 3,
                    "currentElo": 1712.0,
                    "preseasonElo": 1700.0,
                    "eloDeltaFromPreseason": 12.0,
                    "eloRankSource": "live",
                }
            ],
            "matches": [],
            "finalRankings": [],
        }

    monkeypatch.setattr(service, "build_overview_payload", fake_overview)
    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)
    monkeypatch.setattr(service, "build_live_state_payload", lambda region_slug: {"available": False})

    response = client.get(f"/api/teams/{quote(team_key, safe='')}?seed=20260414&mode=live")

    assert response.status_code == 200
    payload = response.json()
    assert payload["slot"]["slot"] == "A1"


def test_prematch_center_marks_only_previous_upset_winners_for_spotlight(monkeypatch) -> None:
    upset_team_key = "team::prior-upset-winner"
    favorite_team_key = "team::heavy-favorite"

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-03T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-03T00:00:00+00:00",
                    "completedOfficialMatches": 1,
                    "confirmedOfficialMatches": 3,
                    "ledgerRows": 2,
                },
            },
            "matches": [
                _fake_match(
                    match_label="DONE-UPSET",
                    planned_start_at="2026-05-03T01:00:00+00:00",
                    is_real_result=True,
                    p_series_red=0.26,
                    p_game_red=0.31,
                    red_team_key=upset_team_key,
                    blue_team_key=favorite_team_key,
                    winner_team_key=upset_team_key,
                    official_match_id="DONE-UPSET",
                    official_status="DONE",
                ),
                _fake_match(
                    match_label="UPSET-TEAM-NEXT",
                    planned_start_at="2026-05-03T02:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.68,
                    p_game_red=0.61,
                    red_team_key=upset_team_key,
                    official_match_id="UPSET-TEAM-NEXT",
                ),
                _fake_match(
                    match_label="CURRENT-RISK-ONLY",
                    planned_start_at="2026-05-03T03:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.51,
                    p_game_red=0.51,
                    official_match_id="CURRENT-RISK-ONLY",
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)
    monkeypatch.setattr(service, "load_global_elo_rank_map", lambda: {})

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-03",
        region_slugs=["south_region"],
    )

    by_label = {match["matchLabel"]: match for match in payload["allUpcomingMatches"]}
    assert by_label["UPSET-TEAM-NEXT"]["hasPriorUpsetTeam"] is True
    assert by_label["UPSET-TEAM-NEXT"]["priorUpsetTeamKeys"] == [upset_team_key]
    assert by_label["CURRENT-RISK-ONLY"]["hasPriorUpsetTeam"] is False
    assert by_label["CURRENT-RISK-ONLY"]["priorUpsetTeamKeys"] == []


def test_prematch_center_exposes_live_elo_overperformer_threshold_signals(monkeypatch) -> None:
    overperformer_key = "team::live-overperformer"
    below_threshold_key = "team::below-threshold"

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-03T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-03T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [
                _fake_match(
                    match_label="ELO-SIGNAL",
                    planned_start_at="2026-05-03T02:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.58,
                    p_game_red=0.54,
                    red_team_key=overperformer_key,
                    blue_team_key=below_threshold_key,
                    official_match_id="ELO-SIGNAL",
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)
    monkeypatch.setattr(
        service,
        "load_current_rating_index",
        lambda: {
            overperformer_key: {
                "teamKey": overperformer_key,
                "schoolKey": "live-overperformer",
                "currentElo": 1755.0,
                "preseasonElo": 1700.0,
                "eloDeltaFromPreseason": 55.0,
                "eloRankSource": "live",
            },
            below_threshold_key: {
                "teamKey": below_threshold_key,
                "schoolKey": "below-threshold",
                "currentElo": 1649.0,
                "preseasonElo": 1600.0,
                "eloDeltaFromPreseason": 49.0,
                "eloRankSource": "live",
            },
        },
    )
    monkeypatch.setattr(service, "load_global_elo_rank_map", lambda: {overperformer_key: 7, below_threshold_key: 18})

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-03",
        region_slugs=["south_region"],
    )

    match = payload["allUpcomingMatches"][0]
    assert match["redCurrentElo"] == 1755.0
    assert match["redPreseasonElo"] == 1700.0
    assert match["redEloDeltaFromPreseason"] == 55.0
    assert match["redSeasonOverperformer"] is True
    assert match["blueCurrentElo"] == 1649.0
    assert match["bluePreseasonElo"] == 1600.0
    assert match["blueEloDeltaFromPreseason"] == 49.0
    assert match["blueSeasonOverperformer"] is False
    assert match["seasonOverperformerTeamKeys"] == [overperformer_key]
    assert match["hasSeasonOverperformerTeam"] is True


def test_prematch_center_treats_top32_as_strong_team_signal(monkeypatch) -> None:
    red_key = "team::rank-32"
    blue_key = "team::rank-40"

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-03T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-03T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [
                _fake_match(
                    match_label="RANK-32-SIGNAL",
                    planned_start_at="2026-05-03T02:00:00+00:00",
                    is_real_result=False,
                    p_series_red=0.58,
                    p_game_red=0.54,
                    red_team_key=red_key,
                    blue_team_key=blue_key,
                    official_match_id="RANK-32-SIGNAL",
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)
    monkeypatch.setattr(service, "load_current_rating_index", lambda: {})
    monkeypatch.setattr(service, "load_global_elo_rank_map", lambda: {red_key: 32, blue_key: 40})

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-03",
        region_slugs=["south_region"],
    )

    match = payload["allUpcomingMatches"][0]
    assert match["redTeamGlobalRank"] == 32
    assert match["blueTeamGlobalRank"] == 40
    assert match["strongTeamInvolved"] is True


def test_prematch_center_excludes_live_fallback_simulation_proxy_matches(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "东部赛区",
                "seed": seed,
                "generatedAt": "2026-05-03T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "missing",
                    "sourceReason": "尚未同步官方实时赛程",
                    "sourceUpdatedAt": None,
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 0,
                    "ledgerRows": 0,
                },
            },
            "matches": [
                _fake_match(
                    match_label="SIM-1",
                    planned_start_at=None,
                    is_real_result=False,
                    p_series_red=0.74,
                    p_game_red=0.63,
                    official_status=None,
                    official_match_id=None,
                )
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-03",
        region_slugs=["east_region"],
    )

    assert payload["source"]["effectiveMode"] == "simulation_proxy"
    assert payload["source"]["regionStatuses"][0]["sourceStatus"] == "missing"
    assert payload["allUpcomingMatches"] == []
    assert payload["todayMatches"] == []
    assert all(not matches for matches in payload["timelineBuckets"].values())
    assert payload["nextMatch"] is None
    assert payload["nextActionMatch"] is None
    assert payload["pendingMatchCount"] == 0
    assert payload["scheduledPendingMatchCount"] == 0


def test_prematch_center_excludes_simulation_proxy_matches_from_mixed_live_payload(monkeypatch) -> None:
    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-03T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-03T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [
                _fake_match(
                    match_label="OFFICIAL-1",
                    planned_start_at="2026-05-03T09:00:00+08:00",
                    is_real_result=False,
                    p_series_red=0.62,
                    p_game_red=0.56,
                    official_match_id="OFFICIAL-1",
                    official_status="PENDING",
                ),
                _fake_match(
                    match_label="SIM-PROXY-1",
                    planned_start_at="2026-05-03T10:00:00+08:00",
                    is_real_result=False,
                    p_series_red=0.58,
                    p_game_red=0.54,
                    official_match_id=None,
                    official_status=None,
                ),
            ],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-03",
        region_slugs=["south_region"],
        now=datetime(2026, 5, 3, 8, 0, tzinfo=service._prematch_timezone("Asia/Shanghai")),
    )

    assert payload["source"]["effectiveMode"] == "live"
    assert [match["matchLabel"] for match in payload["allUpcomingMatches"]] == ["OFFICIAL-1"]
    assert [match["matchLabel"] for match in payload["todayMatches"]] == ["OFFICIAL-1"]
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["upNext"]] == ["OFFICIAL-1"]
    assert payload["pendingMatchCount"] == 1
    assert payload["confirmedPendingMatchCount"] == 1
    assert payload["scheduledPendingMatchCount"] == 1


def test_prematch_center_does_not_count_official_placeholders_as_scheduled(monkeypatch) -> None:
    placeholder = _fake_match(
        match_label="A-SWISS-1-1",
        planned_start_at="2026-05-13T08:10:00+08:00",
        is_real_result=False,
        p_series_red=0.5,
        p_game_red=0.5,
        official_match_id="30900",
        official_status="WAITING",
        red_team_key="",
        blue_team_key="",
        winner_team_key="",
        scoreline="0:0",
    )
    placeholder["isConfirmedMatchup"] = False
    placeholder["redTeam"] = {"teamKey": "", "collegeName": "A1", "teamName": "官方槽位待确认", "slot": "A1"}
    placeholder["blueTeam"] = {"teamKey": "", "collegeName": "A9", "teamName": "官方槽位待确认", "slot": "A9"}

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-10T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-10T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 0,
                    "ledgerRows": 0,
                },
            },
            "matches": [placeholder],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-13",
        region_slugs=["south_region"],
        now=datetime(2026, 5, 13, 7, 0, tzinfo=service._prematch_timezone("Asia/Shanghai")),
    )

    assert payload["pendingMatchCount"] == 1
    assert payload["confirmedPendingMatchCount"] == 0
    assert payload["scheduledPendingMatchCount"] == 0
    assert payload["officialPlaceholderMatchCount"] == 1
    assert payload["allUpcomingMatches"][0]["scheduleState"] == "official_placeholder"


def test_source_freshness_parses_rfc1123_official_schedule_timestamp() -> None:
    payload = service.build_source_freshness(
        generated_at="2026-05-11T15:00:00+08:00",
        now=datetime(2026, 5, 11, 15, 0, tzinfo=service._prematch_timezone("Asia/Shanghai")),
        region_statuses=[
            {
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "sourceStatus": "active",
                "sourceReason": None,
                "sourceUpdatedAt": "Sun, 10 May 2026 11:52:27 GMT",
                "completedOfficialMatches": 0,
                "confirmedOfficialMatches": 0,
                "officialScheduleMatches": 88,
                "officialPlaceholderMatches": 88,
                "slotAssignmentSource": "official_placeholder",
            }
        ],
    )

    assert payload["officialScheduleUpdatedAt"] == "2026-05-10T11:52:27+00:00"
    assert payload["coverageLabel"] == "南部赛区官方排期"


def test_prematch_center_treats_unconfirmed_predicted_shell_as_simulation_proxy(monkeypatch) -> None:
    confirmed = _fake_match(
        match_label="CONFIRMED-1",
        planned_start_at="2026-05-13T08:10:00+08:00",
        is_real_result=False,
        p_series_red=0.62,
        p_game_red=0.56,
        official_match_id="31001",
        official_status="WAITING",
    )
    predicted_shell = _fake_match(
        match_label="PREDICTED-SHELL-1",
        planned_start_at="2026-05-14T08:10:00+08:00",
        is_real_result=False,
        p_series_red=0.72,
        p_game_red=0.64,
        official_match_id="31002",
        official_status="WAITING",
        red_team_key="red::predicted",
        blue_team_key="blue::predicted",
    )
    predicted_shell["isConfirmedMatchup"] = False

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-10T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-10T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [confirmed, predicted_shell],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)
    monkeypatch.setattr(service, "load_current_rating_index", lambda: {})
    monkeypatch.setattr(service, "load_global_elo_rank_map", lambda: {})

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-13",
        region_slugs=["south_region"],
        now=datetime(2026, 5, 13, 7, 0, tzinfo=service._prematch_timezone("Asia/Shanghai")),
    )

    predicted = next(match for match in payload["allUpcomingMatches"] if match["matchLabel"] == "PREDICTED-SHELL-1")
    assert predicted["dataSource"] == "simulation_proxy"
    assert predicted["scheduleState"] == "simulation_proxy"
    assert predicted["timelineState"] == "simulation_unassigned"
    assert predicted["redTeam"]["teamKey"] == "red::predicted"
    assert predicted["blueTeam"]["teamKey"] == "blue::predicted"
    assert payload["confirmedPendingMatchCount"] == 1
    assert payload["scheduledPendingMatchCount"] == 1
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["confirmedUpcoming"]] == []
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["simulationUnassigned"]] == ["PREDICTED-SHELL-1"]


def test_prematch_center_keeps_predicted_shells_out_of_next_action(monkeypatch) -> None:
    predicted_shell = _fake_match(
        match_label="PREDICTED-EARLY",
        planned_start_at="2026-05-13T08:00:00+08:00",
        is_real_result=False,
        p_series_red=0.72,
        p_game_red=0.64,
        official_match_id="31002",
        official_status="WAITING",
        red_team_key="red::predicted",
        blue_team_key="blue::predicted",
    )
    predicted_shell["isConfirmedMatchup"] = False
    official_later = _fake_match(
        match_label="OFFICIAL-LATER",
        planned_start_at="2026-05-13T09:00:00+08:00",
        is_real_result=False,
        p_series_red=0.62,
        p_game_red=0.56,
        official_match_id="31003",
        official_status="WAITING",
    )

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-10T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-10T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [predicted_shell, official_later],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)
    monkeypatch.setattr(service, "load_current_rating_index", lambda: {})
    monkeypatch.setattr(service, "load_global_elo_rank_map", lambda: {})

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-13",
        region_slugs=["south_region"],
        now=datetime(2026, 5, 13, 7, 0, tzinfo=service._prematch_timezone("Asia/Shanghai")),
    )

    assert payload["nextActionMatch"]["matchLabel"] == "OFFICIAL-LATER"
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["upNext"]] == ["OFFICIAL-LATER"]
    assert [match["matchLabel"] for match in payload["timelineBuckets"]["simulationUnassigned"]] == ["PREDICTED-EARLY"]


def test_prematch_center_excludes_official_placeholders_from_confirmed_upcoming(monkeypatch) -> None:
    confirmed = _fake_match(
        match_label="CONFIRMED-1",
        planned_start_at="2026-05-13T08:10:00+08:00",
        is_real_result=False,
        p_series_red=0.62,
        p_game_red=0.56,
        official_match_id="31001",
        official_status="WAITING",
    )
    placeholder = _fake_match(
        match_label="PLACEHOLDER-1",
        planned_start_at="2026-05-14T08:10:00+08:00",
        is_real_result=False,
        p_series_red=0.5,
        p_game_red=0.5,
        official_match_id="31002",
        official_status="WAITING",
        red_team_key="",
        blue_team_key="",
        winner_team_key="",
    )
    placeholder["isConfirmedMatchup"] = False
    placeholder["redTeam"] = {"teamKey": "", "collegeName": "第83场胜者", "teamName": "官方槽位待确认"}
    placeholder["blueTeam"] = {"teamKey": "", "collegeName": "第84场胜者", "teamName": "官方槽位待确认"}

    def fake_simulation(region_slug: str, seed: int, mode: str = "sim", samples: int = service.DEFAULT_SIMULATION_SAMPLES) -> dict[str, object]:
        return {
            "meta": {
                "regionSlug": region_slug,
                "regionName": "南部赛区",
                "seed": seed,
                "generatedAt": "2026-05-10T00:00:00+00:00",
                "liveStatus": {
                    "sourceStatus": "active",
                    "sourceReason": None,
                    "sourceUpdatedAt": "2026-05-10T00:00:00+00:00",
                    "completedOfficialMatches": 0,
                    "confirmedOfficialMatches": 1,
                    "ledgerRows": 0,
                },
            },
            "matches": [confirmed, placeholder],
        }

    monkeypatch.setattr(service, "build_simulation_payload", fake_simulation)

    payload = service.build_prematch_center_payload(
        seed=20260414,
        mode="live",
        date="2026-05-13",
        region_slugs=["south_region"],
        now=datetime(2026, 5, 13, 7, 0, tzinfo=service._prematch_timezone("Asia/Shanghai")),
    )

    assert [match["matchLabel"] for match in payload["timelineBuckets"]["upNext"]] == ["CONFIRMED-1"]
    assert payload["allUpcomingMatches"][1]["scheduleState"] == "official_placeholder"
    assert payload["allUpcomingMatches"][1]["timelineState"] == "confirmed_upcoming"
    assert payload["timelineBuckets"]["confirmedUpcoming"] == []
