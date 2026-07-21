from __future__ import annotations

import json
from argparse import Namespace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from backend.app import finals_live, finals_schedule
from scripts import sync_finals_live


def _payload(match: dict | None = None) -> dict:
    return {
        "schemaVersion": "rmuc-finals-live-v1",
        "season": 2026,
        "sourceStatus": "active",
        "sourceKind": "synthetic",
        "sourceUpdatedAt": "2026-07-21T21:00:00+08:00",
        "scenarioId": "test-scenario",
        "events": {
            "repechage": {
                "participants": [],
                "matches": [match] if match else [],
            }
        },
    }


def _completed_match() -> dict:
    return {
        "number": 1,
        "officialMatchId": "SYNTH-REP-001",
        "bestOf": 3,
        "officialStatus": "DONE",
        "isCompleted": True,
        "isConfirmedMatchup": True,
        "scoreline": "2:1",
        "result": "red",
        "redCollegeName": "红方大学",
        "redTeamName": "Red",
        "blueCollegeName": "蓝方大学",
        "blueTeamName": "Blue",
    }


def test_validates_and_labels_synthetic_completed_match() -> None:
    payload = finals_live.validate_runtime_payload(_payload(_completed_match()))
    match = payload["events"]["repechage"]["matches"][0]

    assert payload["isSynthetic"] is True
    assert match["sourceKind"] == "synthetic"
    assert match["isSynthetic"] is True
    assert match["redWins"] == 2
    assert match["blueWins"] == 1
    assert match["isCompleted"] is True


@pytest.mark.parametrize(
    ("updates", "error"),
    [
        ({"result": ""}, "lacks confirmed teams or winner"),
        ({"scoreline": "1:1"}, "not decisive"),
        ({"scoreline": "1:2", "result": "red"}, "conflicts"),
        ({"isConfirmedMatchup": True, "blueCollegeName": "", "blueTeamName": ""}, "missing a team"),
    ],
)
def test_rejects_invalid_completed_match_contract(updates: dict, error: str) -> None:
    match = {**_completed_match(), **updates}
    with pytest.raises(ValueError, match=error):
        finals_live.validate_runtime_payload(_payload(match))


def test_accepts_in_progress_score_without_declaring_a_winner() -> None:
    match = {
        **_completed_match(),
        "officialStatus": "LIVE",
        "isCompleted": False,
        "scoreline": "1:0",
        "result": "",
        "hasLiveScoreline": True,
    }

    normalized = finals_live.validate_runtime_payload(_payload(match))["events"]["repechage"]["matches"][0]

    assert normalized["hasLiveScoreline"] is True
    assert normalized["isCompleted"] is False
    assert not normalized.get("result")


@pytest.mark.parametrize(
    ("updates", "error"),
    [
        ({"number": 33}, "out of range"),
        ({"officialMatchId": "SYNTH-REP-001"}, "synthetic match ID"),
    ],
)
def test_official_runtime_rejects_invalid_identity_or_range(updates: dict, error: str) -> None:
    payload = _payload({**_completed_match(), "officialMatchId": "RMUC-FINAL-001", **updates})
    payload["sourceKind"] = "official"
    with pytest.raises(ValueError, match=error):
        finals_live.validate_runtime_payload(payload)


def test_sync_normalizer_requires_upstream_ids_for_official_enriched_input(tmp_path: Path) -> None:
    base_path = tmp_path / "base.json"
    base_path.write_text(
        json.dumps({"season": 2026, "events": {"repechage": {"participants": []}, "nationals": {"participants": []}}}),
        encoding="utf-8",
    )
    args = Namespace(
        input=None,
        source_url="https://example.invalid/finals.json",
        base_schedule=base_path,
        source_kind="official",
        scenario_id=None,
        source_updated_at=None,
    )
    enriched = {
        "season": 2026,
        "events": {
            "repechage": {"participants": [], "matches": [{**_completed_match(), "officialMatchId": ""}]},
            "nationals": {"participants": [], "matches": []},
        },
    }

    with pytest.raises(ValueError, match="no upstream officialMatchId"):
        sync_finals_live.normalize_raw_input(
            enriched,
            args,
            datetime(2026, 7, 21, tzinfo=UTC),
            source_headers={"etag": '"finals-v1"'},
        )


def test_sync_normalizer_records_remote_provenance(tmp_path: Path) -> None:
    base_path = tmp_path / "base.json"
    base_path.write_text(
        json.dumps({"season": 2026, "events": {"repechage": {"participants": []}, "nationals": {"participants": []}}}),
        encoding="utf-8",
    )
    args = Namespace(
        input=None,
        source_url="https://example.invalid/finals.json",
        base_schedule=base_path,
        source_kind="official",
        scenario_id=None,
        source_updated_at=None,
    )
    enriched = {
        "season": 2026,
        "events": {
            "repechage": {
                "participants": [],
                "matches": [{**_completed_match(), "officialMatchId": "RMUC-FINAL-001"}],
            },
            "nationals": {"participants": [], "matches": []},
        },
    }

    normalized = sync_finals_live.normalize_raw_input(
        enriched,
        args,
        datetime(2026, 7, 21, tzinfo=UTC),
        source_headers={"etag": '"finals-v1"', "last-modified": "Tue, 21 Jul 2026 12:00:00 GMT"},
    )

    assert normalized["sourceUrl"] == "https://example.invalid/finals.json"
    assert normalized["etag"] == '"finals-v1"'
    assert normalized["sourceUpdatedAt"] == "Tue, 21 Jul 2026 12:00:00 GMT"


def test_runtime_loader_reloads_when_file_changes(tmp_path: Path, monkeypatch) -> None:
    runtime_path = tmp_path / "normalized_schedule.json"
    monkeypatch.setattr(finals_live, "FINALS_RUNTIME_PATH", runtime_path)
    finals_live.load_finals_runtime.cache_clear()
    runtime_path.write_text(json.dumps(_payload(), ensure_ascii=False), encoding="utf-8")
    first = finals_live.load_finals_runtime()
    changed = _payload()
    changed["scenarioId"] = "changed-scenario-with-different-size"
    runtime_path.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
    second = finals_live.load_finals_runtime()

    assert first and first["scenarioId"] == "test-scenario"
    assert second and second["scenarioId"] == "changed-scenario-with-different-size"


def test_finals_api_exposes_runtime_provenance_without_mutating_reference(monkeypatch) -> None:
    runtime = finals_live.validate_runtime_payload(_payload(_completed_match()))
    monkeypatch.setattr(finals_live, "load_finals_runtime", lambda: runtime)
    monkeypatch.setattr(finals_live, "runtime_artifact_version", lambda: "normalized_schedule.json:1:2")
    reference = finals_schedule.load_finals_schedule()

    payload = finals_schedule.build_final_event_payload("repechage")
    first_match = payload["event"]["matches"][0]

    assert payload["scheduleStatus"] == "synthetic_scenario_active"
    assert payload["liveStatus"] == {
        "sourceStatus": "active",
        "sourceKind": "synthetic",
        "isSynthetic": True,
        "sourceUpdatedAt": "2026-07-21T21:00:00+08:00",
        "sourceAgeSeconds": payload["liveStatus"]["sourceAgeSeconds"],
        "freshnessLabel": "synthetic",
        "validationState": "validated",
        "scenarioId": "test-scenario",
        "runtimeArtifactVersion": "normalized_schedule.json:1:2",
        "completedMatches": 1,
        "confirmedMatches": 1,
    }
    assert isinstance(payload["liveStatus"]["sourceAgeSeconds"], int)
    assert payload["sources"][-1]["isSynthetic"] is True
    assert first_match["officialMatchId"] == "SYNTH-REP-001"
    assert first_match["isSynthetic"] is True
    assert "officialStatus" not in reference["events"]["repechage"]["matches"][0]
