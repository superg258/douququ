from __future__ import annotations

import csv
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app


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
