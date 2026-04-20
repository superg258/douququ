from __future__ import annotations

import csv
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app import service
from backend.app.south_actual_schedule import SOUTH_SWISS_ACTUAL_SCORELINES


client = TestClient(app)
ROOT = Path(__file__).resolve().parents[2]
TS2_DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


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
        mu_values = [team["mu0"] for team in region["teams"]]
        assert mu_values == sorted(mu_values, reverse=True)
        first_team = region["teams"][0]
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


def test_simulation_returns_expected_shape_for_all_regions() -> None:
    expectations = {
        "east_region": {"nationalSlots": 8, "repechageSlots": 6},
        "south_region": {"nationalSlots": 10, "repechageSlots": 4},
        "north_region": {"nationalSlots": 10, "repechageSlots": 6},
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


def test_south_live_mode_applies_actual_results_for_completed_swiss_matches() -> None:
    response = client.get(
        "/api/regions/south_region/simulation",
        params={"seed": 20260414, "mode": "live"},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["matches"]
    by_label = {match["matchLabel"]: match for match in payload["matches"]}
    completed_labels = set(SOUTH_SWISS_ACTUAL_SCORELINES)

    assert any(match["isRealResult"] for match in payload["matches"])
    for match_label in completed_labels:
        assert by_label[match_label]["isRealResult"] is True
        assert by_label[match_label]["scoreline"] == SOUTH_SWISS_ACTUAL_SCORELINES[match_label]


def test_south_live_mode_carries_round1_elo_into_round2() -> None:
    response = client.get(
        "/api/regions/south_region/simulation",
        params={"seed": 20260414, "mode": "live"},
    )
    assert response.status_code == 200
    payload = response.json()

    round1_after_by_team: dict[str, float] = {}
    round2_before_by_team: dict[str, float] = {}

    for match in payload["matches"]:
        if match["stage"] != "swiss":
            continue
        for side, base_key, delta_key in (
            ("redTeam", "redMu0", "redDelta"),
            ("blueTeam", "blueMu0", "blueDelta"),
        ):
            if match.get(base_key) is None or match.get(delta_key) is None:
                continue
            team_key = match[side]["teamKey"]
            base = float(match[base_key])
            delta = float(match[delta_key])
            if match["roundNumber"] == 1:
                round1_after_by_team[team_key] = base + delta
            elif match["roundNumber"] == 2:
                round2_before_by_team[team_key] = base

    assert round1_after_by_team
    assert round2_before_by_team
    assert round1_after_by_team.keys() == round2_before_by_team.keys()

    for team_key, round1_after in round1_after_by_team.items():
        assert abs(round2_before_by_team[team_key] - round1_after) < 0.15, team_key


def test_south_live_mode_omits_elo_fields_for_non_actual_matches() -> None:
    response = client.get(
        "/api/regions/south_region/simulation",
        params={"seed": 20260414, "mode": "live"},
    )
    assert response.status_code == 200
    payload = response.json()

    actual_matches = [match for match in payload["matches"] if match["isRealResult"]]
    non_actual_matches = [match for match in payload["matches"] if not match["isRealResult"]]

    assert actual_matches
    assert non_actual_matches
    assert all(match.get("redMu0") is not None for match in actual_matches)
    assert all(match.get("blueMu0") is not None for match in actual_matches)
    assert all(match.get("redDelta") is not None for match in actual_matches)
    assert all(match.get("blueDelta") is not None for match in actual_matches)
    assert all(match.get("redMu0") is None for match in non_actual_matches)
    assert all(match.get("blueMu0") is None for match in non_actual_matches)
    assert all(match.get("redDelta") is None for match in non_actual_matches)
    assert all(match.get("blueDelta") is None for match in non_actual_matches)


def test_live_state_returns_unavailable_when_published_artifacts_missing(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(service, "PUBLISHED_RATINGS_DIR", tmp_path / "published_2026")
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
    monkeypatch.setattr(service, "PUBLISHED_RATINGS_DIR", published_dir)
    service.load_ratings_rows.cache_clear()
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
