from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import artifacts, finals_live, finals_schedule, main, revisions, rmuc_live, service, singleflight_cache, team_identity
from backend.app.competition import (
    SWISS_TOTAL_MATCHES,
    parse_series_scoreline,
    swiss_group_from_match_number,
    swiss_match_label,
    swiss_match_number,
    swiss_round_from_match_number,
)
from backend.app.singleflight_cache import SingleflightTTLCache


client = TestClient(main.app)


def test_live_revision_cache_reuses_stable_inputs_and_invalidates_on_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signatures = [("artifact.json", 1, 10)]
    builds = 0

    def build() -> dict[str, Any]:
        nonlocal builds
        builds += 1
        return {"etag": f"sha256:{builds}"}

    monkeypatch.setattr(revisions, "_revision_input_signatures", lambda: tuple(signatures))
    monkeypatch.setattr(revisions, "_build_live_revisions_payload", build)
    revisions.clear_revision_caches()

    assert revisions.build_live_revisions_payload()["etag"] == "sha256:1"
    assert revisions.build_live_revisions_payload()["etag"] == "sha256:1"
    signatures[0] = ("artifact.json", 2, 10)
    assert revisions.build_live_revisions_payload()["etag"] == "sha256:2"


def test_semantic_revision_ignores_operational_freshness_fields() -> None:
    before = {
        "fetchedAt": "2026-07-29T01:00:00Z",
        "generatedAt": "2026-07-29T01:00:00Z",
        "sourceAgeSeconds": 10,
        "matches": [{"id": "m1", "score": "2:0"}],
    }
    after = {
        **before,
        "fetchedAt": "2026-07-29T01:01:00Z",
        "generatedAt": "2026-07-29T01:01:00Z",
        "sourceAgeSeconds": 70,
        "matches": [{"id": "m1", "score": "2:0"}],
    }
    assert artifacts.semantic_digest(before) == artifacts.semantic_digest(after)
    after["matches"][0]["score"] = "2:1"
    assert artifacts.semantic_digest(before) != artifacts.semantic_digest(after)


def test_singleflight_cache_reuses_success_and_returns_independent_values() -> None:
    cache = SingleflightTTLCache()
    calls = 0

    def compute() -> dict[str, list[int]]:
        nonlocal calls
        calls += 1
        return {"values": [1]}

    first = cache.get_or_compute("key", compute, success_ttl_seconds=60)
    first["values"].append(2)
    second = cache.get_or_compute("key", compute, success_ttl_seconds=60)

    assert calls == 1
    assert second == {"values": [1]}


def test_singleflight_cache_bounds_entries_and_proactively_purges_expired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = 100.0
    monkeypatch.setattr(singleflight_cache, "monotonic", lambda: clock)
    cache = SingleflightTTLCache(max_entries=2)

    for key in ("a", "b", "c"):
        assert cache.get_or_compute(key, lambda key=key: key, success_ttl_seconds=10) == key

    assert list(cache._values) == ["b", "c"]

    clock = 111.0
    assert cache.get_or_compute("d", lambda: "d", success_ttl_seconds=10) == "d"
    assert list(cache._values) == ["d"]

    assert cache.get_or_compute("uncached", lambda: "value", success_ttl_seconds=0) == "value"
    assert "uncached" not in cache._values


def _finals_runtime(*, events: dict[str, Any]) -> dict[str, Any]:
    return finals_live.validate_runtime_payload(
        {
            "schemaVersion": "rmuc-finals-live-v1",
            "season": 2026,
            "sourceStatus": "active",
            "sourceKind": "synthetic",
            "sourceUpdatedAt": "2026-07-22T08:00:00+08:00",
            "scenarioId": "contract-test",
            "events": events,
        }
    )


def _pending_finals_match(**updates: Any) -> dict[str, Any]:
    return {
        "number": 1,
        "officialMatchId": "SYNTH-REPECHAGE-001",
        "bestOf": 3,
        "officialStatus": "PENDING",
        "isCompleted": False,
        "isConfirmedMatchup": False,
        **updates,
    }


def _regional_player(slot: str, college_name: str, team_name: str) -> dict[str, Any]:
    return {
        "name": slot,
        "team": {"collegeName": college_name, "name": team_name},
    }


def _regional_match(**updates: Any) -> dict[str, Any]:
    return {
        "id": "regional-contract-1",
        "matchType": "GROUP",
        "orderNumber": 1,
        "planGameCount": 3,
        "status": "FINISHED",
        "result": "RED",
        "redSideWinGameCount": 2,
        "blueSideWinGameCount": 0,
        "redSide": {"player": _regional_player("A1", "红方大学", "Red")},
        "blueSide": {"player": _regional_player("A9", "蓝方大学", "Blue")},
        **updates,
    }


def test_shared_swiss_format_round_trips_every_match() -> None:
    assert SWISS_TOTAL_MATCHES == 66
    for match_number in range(1, SWISS_TOTAL_MATCHES + 1):
        round_number = swiss_round_from_match_number(match_number)
        group_name = swiss_group_from_match_number(match_number)
        label = swiss_match_label(match_number, group_name)
        assert round_number is not None
        assert group_name in {"A", "B"}
        assert label.startswith(f"{group_name}-SWISS-{round_number}-")
        group_index = int(label.rsplit("-", maxsplit=1)[1])
        assert swiss_match_number(round_number, group_name, group_index) == match_number


def test_series_score_contract_is_shared_for_bo3_and_bo5() -> None:
    assert parse_series_scoreline("2:1", best_of=3).winner == "red"
    assert parse_series_scoreline("2:3", best_of=5).winner == "blue"
    with pytest.raises(ValueError, match="Both sides"):
        parse_series_scoreline("2:2", best_of=3)
    with pytest.raises(ValueError, match="Both sides"):
        parse_series_scoreline("3:3", best_of=5)
    with pytest.raises(ValueError, match="Unsupported best-of"):
        parse_series_scoreline("4:0", best_of=7)


@pytest.mark.parametrize(
    ("college_name", "source_team_name", "team_key"),
    [
        ("大连理工大学", "凌 BUG", "大连理工大学::凌BUG"),
        ("复旦大学", "星云 EGA", "复旦大学::星云EGA"),
    ],
)
def test_team_identity_is_shared_across_finals_and_regionals(
    college_name: str,
    source_team_name: str,
    team_key: str,
) -> None:
    identity = team_identity.resolve_team_identity(college_name, source_team_name)
    regional = rmuc_live._player_team(_regional_player("A1", college_name, source_team_name))

    assert identity["matched"] is True
    assert identity["teamKey"] == team_key
    assert regional is not None and regional["teamKey"] == team_key


def test_unknown_team_identity_has_a_deterministic_fallback() -> None:
    identity = team_identity.resolve_team_identity("红方大学", "Red")

    assert identity["matched"] is False
    assert identity["teamKey"] == "红方大学::Red"


def test_finals_runtime_rejects_schedule_topology_overrides() -> None:
    runtime_match = _pending_finals_match(stageKey="tampered", kind="exhibition")
    with pytest.raises(ValueError, match="cannot override schedule fields"):
        _finals_runtime(events={"repechage": {"participants": [], "matches": [runtime_match]}})


def test_finals_runtime_rejects_invalid_bo_and_same_team() -> None:
    with pytest.raises(ValueError, match="best-of"):
        _finals_runtime(
            events={
                "repechage": {
                    "participants": [],
                    "matches": [_pending_finals_match(bestOf=7)],
                }
            }
        )
    same_team = _pending_finals_match(
        isConfirmedMatchup=True,
        redTeamKey="same-team",
        blueTeamKey="same-team",
    )
    with pytest.raises(ValueError, match="same team"):
        _finals_runtime(events={"repechage": {"participants": [], "matches": [same_team]}})


def test_finals_runtime_normalizes_live_win_counts_from_scoreline() -> None:
    runtime = _finals_runtime(
        events={
            "repechage": {
                "participants": [],
                "matches": [
                    _pending_finals_match(
                        officialStatus="RUNNING",
                        isConfirmedMatchup=True,
                        scoreline="1:0",
                        redWins=99,
                        blueWins=88,
                        redTeamKey="red-team",
                        blueTeamKey="blue-team",
                    )
                ],
            }
        }
    )

    match = runtime["events"]["repechage"]["matches"][0]
    assert (match["redWins"], match["blueWins"]) == (1, 0)


def test_finals_live_status_is_event_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = _finals_runtime(events={"repechage": {"participants": [], "matches": []}})
    monkeypatch.setattr(finals_schedule.finals_live, "load_finals_runtime", lambda: runtime)

    repechage = finals_schedule.build_final_event_payload("repechage")
    nationals = finals_schedule.build_final_event_payload("nationals")

    assert repechage["liveStatus"]["sourceStatus"] == "active"
    assert nationals["liveStatus"]["sourceStatus"] == "inactive"
    assert nationals["liveStatus"]["sourceReason"] == "实时源未包含当前赛事"
    assert nationals["liveStatus"]["sourceKind"] is None
    assert nationals["liveStatus"]["isSynthetic"] is False
    assert nationals["liveStatus"]["sourceUpdatedAt"] is None
    assert nationals["liveStatus"]["scenarioId"] is None
    assert nationals["scheduleStatus"] == finals_schedule.load_finals_schedule()["scheduleStatus"]
    assert nationals["verifiedAt"] == finals_schedule.load_finals_schedule()["verifiedAt"]


def test_regional_live_status_clears_metadata_for_a_missing_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        service,
        "load_normalized_live_schedule",
        lambda: {
            "sourceStatus": "active",
            "sourceKind": "synthetic",
            "sourceUpdatedAt": "2026-07-22T08:00:00+08:00",
            "isSynthetic": True,
            "scenarioId": "other-region-only",
            "regions": {},
        },
    )

    status = service.summarize_live_status("south_region")

    assert status["sourceStatus"] == "inactive"
    assert status["sourceKind"] is None
    assert status["isSynthetic"] is False
    assert status["sourceUpdatedAt"] is None
    assert status["scenarioId"] is None
    assert status["sourceReason"] == "实时源未包含当前赛区"


def test_combined_finals_endpoint_uses_one_runtime_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = _finals_runtime(
        events={
            "repechage": {"participants": [], "matches": []},
            "nationals": {"participants": [], "matches": []},
        }
    )
    calls = 0

    def load_once() -> dict[str, Any]:
        nonlocal calls
        calls += 1
        return runtime

    monkeypatch.setattr(finals_schedule.finals_live, "load_finals_runtime", load_once)
    monkeypatch.setattr(finals_schedule.finals_live, "runtime_artifact_version", lambda: "atomic-version")

    snapshot = finals_schedule.build_finals_snapshot_payload(mode="live")

    assert calls == 1
    assert snapshot["runtimeArtifactVersion"] == "atomic-version"
    assert {
        event["liveStatus"]["runtimeArtifactVersion"]
        for event in snapshot["events"].values()
    } == {"atomic-version"}


def test_finals_snapshot_retries_once_when_runtime_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = _finals_runtime(events={"repechage": {"participants": [], "matches": []}})
    versions = iter(("before-change", "after-change", "stable", "stable"))
    calls = 0

    def load_runtime() -> dict[str, Any]:
        nonlocal calls
        calls += 1
        return runtime

    monkeypatch.setattr(finals_schedule.finals_live, "load_finals_runtime", load_runtime)
    monkeypatch.setattr(finals_schedule.finals_live, "runtime_artifact_version", lambda: next(versions))

    snapshot = finals_schedule.build_finals_snapshot_payload(mode="live")

    assert calls == 2
    assert snapshot["runtimeArtifactVersion"] == "stable"


def test_finals_snapshot_fails_closed_when_runtime_keeps_changing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    versions = iter(("v1", "v2", "v3", "v4"))
    calls = 0

    def load_runtime() -> None:
        nonlocal calls
        calls += 1
        return None

    monkeypatch.setattr(finals_schedule.finals_live, "load_finals_runtime", load_runtime)
    monkeypatch.setattr(finals_schedule.finals_live, "runtime_artifact_version", lambda: next(versions))

    with pytest.raises(RuntimeError, match="changed repeatedly"):
        finals_schedule.build_finals_snapshot_payload(mode="live")

    assert calls == 2


def test_finals_sim_mode_never_merges_active_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    reference = finals_schedule.load_finals_schedule()
    extra = {**reference["events"]["repechage"]["participants"][0], "entrySource": "repechage"}
    runtime = _finals_runtime(events={"nationals": {"participants": [extra], "matches": []}})
    monkeypatch.setattr(finals_schedule.finals_live, "load_finals_runtime", lambda: runtime)

    live_payload = finals_schedule.build_final_event_payload("nationals", mode="live")
    sim_payload = finals_schedule.build_final_event_payload("nationals", mode="sim")

    assert live_payload["event"]["participantCount"] == 29
    assert sim_payload["event"]["participantCount"] == 28
    assert sim_payload["liveStatus"]["validationState"] == "disabled"
    assert sim_payload["liveStatus"]["runtimeArtifactVersion"] == "disabled"


def test_finals_alias_participant_merges_by_canonical_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = _finals_runtime(
        events={
            "nationals": {
                "participants": [
                    {
                        "collegeName": "北京理工大学珠海学院",
                        "teamName": "毅恒",
                        "status": "confirmed",
                    }
                ],
                "matches": [],
            }
        }
    )
    monkeypatch.setattr(finals_schedule.finals_live, "load_finals_runtime", lambda: runtime)

    participants = finals_schedule.build_final_event_payload("nationals")["event"]["participants"]

    assert len(participants) == 28
    team_keys = [row["teamKey"] for row in participants]
    assert len(team_keys) == len(set(team_keys))


def test_regional_completed_status_and_score_contract_are_strict() -> None:
    normalized = rmuc_live._normalize_match(
        _regional_match(),
        region_slug="south_region",
        zone_name="南部赛区",
    )
    assert normalized and normalized["isCompleted"] is True

    with pytest.raises(ValueError, match="winner conflicts"):
        rmuc_live._normalize_match(
            _regional_match(result="BLUE"),
            region_slug="south_region",
            zone_name="南部赛区",
        )
    with pytest.raises(ValueError, match="Unfinished regional match"):
        rmuc_live._normalize_match(
            _regional_match(
                status="RUNNING",
                result="RED",
                redSideWinGameCount=1,
                blueSideWinGameCount=0,
            ),
            region_slug="south_region",
            zone_name="南部赛区",
        )
    with pytest.raises(ValueError, match="same team"):
        rmuc_live._normalize_match(
            _regional_match(
                blueSide={"player": _regional_player("A9", "红方大学", "Red")},
            ),
            region_slug="south_region",
            zone_name="南部赛区",
        )


def test_persisted_regional_runtime_rejects_unfinished_winner_and_same_team() -> None:
    match = {
        "officialMatchId": "regional-contract-1",
        "orderNumber": 1,
        "officialStatus": "RUNNING",
        "bestOf": 3,
        "scoreline": "1:0",
        "isCompleted": False,
        "isConfirmedMatchup": True,
        "result": "RED",
        "redTeamKey": "red-team",
        "blueTeamKey": "blue-team",
    }
    payload = {
        "schemaVersion": "rmuc-regionals-live-v1",
        "sourceStatus": "active",
        "regions": {"south_region": {"matches": [match]}},
    }

    with pytest.raises(ValueError, match="Unfinished regional match"):
        rmuc_live.validate_normalized_schedule_payload(payload)

    match["result"] = ""
    match["blueTeamKey"] = "red-team"
    with pytest.raises(ValueError, match="same team"):
        rmuc_live.validate_normalized_schedule_payload(payload)


def test_duplicate_pairings_keep_each_persisted_audience_prediction(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    matches = []
    predictions: dict[str, Any] = {}
    for round_number, official_id in ((1, "repeat-1"), (2, "repeat-2")):
        matches.append(
            {
                "officialMatchId": official_id,
                "matchId": f"2026RMUC:{official_id}",
                "officialStatus": "DONE",
                "stage": "swiss",
                "stageFamily": "regional_group",
                "roundNumber": round_number,
                "groupName": "A",
                "matchLabel": f"A-SWISS-{round_number}-1",
                "orderNumber": 1 if round_number == 1 else 17,
                "scoreline": "2:0",
                "isCompleted": True,
                "isConfirmedMatchup": True,
                "redTeamKey": "red::team",
                "blueTeamKey": "blue::team",
            }
        )
        predictions[official_id] = {"status": "available", "matchId": official_id, "redRate": round_number / 10}

    normalized_path = tmp_path / "normalized_schedule.json"
    prediction_path = tmp_path / "mini_program_predictions.json"
    normalized_path.write_text(
        json.dumps(
            {
                "sourceStatus": "active",
                "regions": {"south_region": {"matches": matches, "slotAssignments": {}, "groupRankMetrics": {}}},
            }
        ),
        encoding="utf-8",
    )
    prediction_path.write_text(json.dumps({"predictions": predictions}), encoding="utf-8")
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "MINI_PROGRAM_PREDICTIONS_PATH", prediction_path)
    monkeypatch.setenv("RMUC_MINI_PROGRAM_ENABLED", "1")

    context = service._load_live_runtime_context("south_region")

    assert context.matches_by_pair_round[("red::team", "blue::team", "swiss", 1)]["miniProgramPrediction"]["matchId"] == "repeat-1"
    assert context.matches_by_pair_round[("red::team", "blue::team", "swiss", 2)]["miniProgramPrediction"]["matchId"] == "repeat-2"


def test_versioned_json_cache_reloads_same_size_replacement(tmp_path: Path) -> None:
    path = tmp_path / "artifact.json"
    path.write_text('{"value":1}', encoding="utf-8")
    first = artifacts.read_versioned_json(path)
    first_mtime = path.stat().st_mtime_ns
    path.write_text('{"value":2}', encoding="utf-8")
    os.utime(path, ns=(first_mtime + 1_000_000, first_mtime + 1_000_000))

    second = artifacts.read_versioned_json(path)

    assert first == {"value": 1}
    assert second == {"value": 2}


def test_rating_index_cache_tracks_preseason_artifact_version(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ratings_path = tmp_path / "ratings.csv"
    ratings_path.write_text(
        "team_key,school_key,college_name,team_name,mu0\nteam,school,学校,队伍,1000\n",
        encoding="utf-8",
    )
    runtime_dir = tmp_path / "published"
    runtime_dir.mkdir()
    monkeypatch.setattr(service, "PRESEASON_RATINGS_CSV", ratings_path)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", runtime_dir)
    service.load_ratings_rows.cache_clear()
    service.load_current_rating_index.cache_clear()

    first = service.load_current_rating_index()
    first_mtime = ratings_path.stat().st_mtime_ns
    ratings_path.write_text(
        "team_key,school_key,college_name,team_name,mu0\nteam,school,学校,队伍,2000\n",
        encoding="utf-8",
    )
    os.utime(ratings_path, ns=(first_mtime + 1_000_000, first_mtime + 1_000_000))

    second = service.load_current_rating_index()

    assert first["team"]["currentElo"] == 1000
    assert second["team"]["currentElo"] == 2000


def test_api_rejects_invalid_modes_and_dates() -> None:
    assert client.get("/api/regions/south_region/simulation?mode=bogus").status_code == 400
    assert client.get("/api/finals/repechage?mode=bogus").status_code == 400
    assert client.get("/api/prematch-center?date=not-a-date").status_code == 400


def test_region_sim_mode_disables_live_source_metadata() -> None:
    payload = service.build_simulation_payload("south_region", 20260414, mode="sim", samples=1)
    live_status = payload["meta"]["liveStatus"]

    assert live_status["sourceStatus"] == "inactive"
    assert live_status["validationState"] == "disabled"
    assert live_status["runtimeArtifactVersion"] == "disabled"


def test_only_unknown_finals_event_is_mapped_to_404(monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.get("/api/finals/not-an-event").status_code == 404

    def broken_builder(event_slug: str, *, mode: str = "live") -> dict[str, Any]:
        raise KeyError("corrupt artifact")

    monkeypatch.setattr(main, "build_final_event_payload", broken_builder)
    error_client = TestClient(main.app, raise_server_exceptions=False)
    assert error_client.get("/api/finals/repechage").status_code == 500

    def corrupt_builder(event_slug: str, *, mode: str = "live") -> dict[str, Any]:
        raise ValueError("corrupt runtime")

    monkeypatch.setattr(main, "build_final_event_payload", corrupt_builder)
    assert error_client.get("/api/finals/repechage").status_code == 500


def test_only_explicit_unknown_region_and_team_are_mapped_to_404(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert client.get("/api/regions/not-a-region/live-state").status_code == 404
    assert client.get("/api/teams/not-a-team").status_code == 404

    def broken_simulation(region_slug: str, seed: int, mode: str) -> dict[str, Any]:
        raise KeyError("corrupt simulation artifact")

    def broken_live_state(region_slug: str) -> dict[str, Any]:
        raise KeyError("corrupt live artifact")

    def broken_team(team_key: str, *, seed: int, mode: str) -> dict[str, Any]:
        raise KeyError("corrupt team artifact")

    error_client = TestClient(main.app, raise_server_exceptions=False)
    monkeypatch.setattr(main, "build_simulation_payload", broken_simulation)
    assert error_client.get("/api/regions/south_region/simulation").status_code == 500
    monkeypatch.setattr(main, "build_live_state_payload", broken_live_state)
    assert error_client.get("/api/regions/south_region/live-state").status_code == 500
    monkeypatch.setattr(main, "build_team_profile_payload", broken_team)
    assert error_client.get("/api/teams/existing-looking-team").status_code == 500


def test_finals_rating_index_is_linear_and_uses_current_snapshot() -> None:
    participants = finals_schedule.build_final_event_payload("repechage", mode="sim")["event"]["participants"][:2]
    rating_index = service.build_finals_team_rating_index(participants)
    current_ratings = service.load_current_rating_index()

    assert set(rating_index) == {participant["teamKey"] for participant in participants}
    for team_key, rating in rating_index.items():
        assert rating["currentElo"] == pytest.approx(current_ratings[team_key]["currentElo"])
