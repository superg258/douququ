from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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
