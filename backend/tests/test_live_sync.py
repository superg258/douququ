from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.app import service
from scripts import sync_rmuc_live


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_sync_mini_program_predictions_reuses_fresh_cache_and_fetches_windowed_matches(tmp_path: Path) -> None:
    runtime_dir = tmp_path / "rmuc_live"
    now = datetime(2026, 5, 11, 8, 0, tzinfo=UTC)
    normalized = {
        "sourceStatus": "active",
        "eventTitle": "RMUC 2026超级对抗赛",
        "season": 2026,
        "fetchedAt": now.isoformat(),
        "sourceUpdatedAt": "Mon, 11 May 2026 07:59:00 GMT",
        "regions": {
            "south_region": {
                "matches": [
                    {"officialMatchId": "30900", "plannedStartAt": "2026-05-11T08:10:00+00:00"},
                    {"officialMatchId": "30901", "plannedStartAt": "2026-05-11T09:10:00+00:00"},
                    {"officialMatchId": "MOCK-SOUTH-001", "plannedStartAt": "2026-05-11T10:10:00+00:00"},
                    {"officialMatchId": "30999", "plannedStartAt": "2026-05-20T08:10:00+00:00"},
                ]
            }
        },
    }
    _write_json(
        runtime_dir / "mini_program_predictions.json",
        {
            "generatedAt": "2026-05-11T07:59:30+00:00",
            "predictions": {
                "30900": {
                    "status": "available",
                    "matchId": "30900",
                    "redCount": 7,
                    "blueCount": 3,
                    "tieCount": 0,
                    "totalCount": 10,
                    "redRate": 0.7,
                    "blueRate": 0.3,
                    "tieRate": 0.0,
                    "fetchedAt": "2026-05-11T07:59:30+00:00",
                }
            },
        },
    )
    fetched: list[str] = []

    def fetcher(match_id: str) -> dict[str, Any]:
        fetched.append(match_id)
        return {
            "status": "available",
            "matchId": match_id,
            "redCount": 2,
            "blueCount": 8,
            "tieCount": 0,
            "totalCount": 10,
            "redRate": 0.2,
            "blueRate": 0.8,
            "tieRate": 0.0,
            "fetchedAt": now.isoformat(),
        }

    status = sync_rmuc_live.sync_mini_program_predictions(
        normalized,
        runtime_dir=runtime_dir,
        fetched_at=now,
        fetcher=fetcher,
        ttl_seconds=60,
        refresh_window_seconds=10,
        lookback_hours=1,
        lookahead_hours=48,
    )

    assert fetched == ["30901"]
    assert status["sourceStatus"] == "active"
    assert status["candidateMatchIds"] == 2
    assert status["reused"] == 1
    assert status["refreshed"] == 1

    payload = json.loads((runtime_dir / "mini_program_predictions.json").read_text(encoding="utf-8"))
    assert sorted(payload["predictions"]) == ["30900", "30901"]
    assert payload["predictions"]["30900"]["redRate"] == 0.7
    assert payload["predictions"]["30901"]["blueRate"] == 0.8

    manifest = sync_rmuc_live.build_sync_manifest(normalized, mini_program_status=status, fetched_at=now)
    assert manifest["officialSchedule"]["sourceStatus"] == "active"
    assert manifest["officialSchedule"]["matchCount"] == 4
    assert manifest["miniProgramPrediction"]["candidateMatchIds"] == 2


def test_live_runtime_context_uses_persisted_mini_program_predictions(tmp_path: Path, monkeypatch) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    prediction_path = tmp_path / "mini_program_predictions.json"
    _write_json(
        normalized_path,
        {
            "sourceStatus": "active",
            "regions": {
                "south_region": {
                    "slotAssignments": {},
                    "groupRankMetrics": {},
                    "matches": [
                        {
                            "officialMatchId": "30900",
                            "matchId": "2026RMUC:30900",
                            "officialStatus": "DONE",
                            "plannedStartAt": "2026-05-11T08:10:00+00:00",
                            "stage": "swiss",
                            "stageFamily": "regional_group",
                            "roundNumber": 1,
                            "groupName": "A",
                            "matchLabel": "A-SWISS-1-1",
                            "orderNumber": 1,
                            "scoreline": "2:0",
                            "isCompleted": True,
                            "isConfirmedMatchup": True,
                            "redTeamKey": "red-school::red-team",
                            "blueTeamKey": "blue-school::blue-team",
                        }
                    ],
                }
            },
        },
    )
    _write_json(
        prediction_path,
        {
            "sourceStatus": "active",
            "predictions": {
                "30900": {
                    "status": "available",
                    "matchId": "30900",
                    "redCount": 75,
                    "blueCount": 25,
                    "tieCount": 0,
                    "totalCount": 100,
                    "redRate": 0.75,
                    "blueRate": 0.25,
                    "tieRate": 0.0,
                    "fetchedAt": "2026-05-11T08:00:00+00:00",
                }
            },
        },
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "MINI_PROGRAM_PREDICTIONS_PATH", prediction_path)

    def fail_fetch(match_id: str) -> dict[str, Any]:
        raise AssertionError(f"unexpected live mini-program fetch for {match_id}")

    monkeypatch.setattr(service.MINI_PROGRAM_CLIENT, "get", fail_fetch)

    context = service._load_live_runtime_context("south_region")
    override = context.payload_override_for(
        red_team_key="red-school::red-team",
        blue_team_key="blue-school::blue-team",
        stage="swiss",
        round_number=1,
        match_label="A-SWISS-1-1",
    )

    assert override["mini_program_prediction"]["redRate"] == 0.75


def test_mini_program_prediction_cache_respects_disabled_env(tmp_path: Path, monkeypatch) -> None:
    prediction_path = tmp_path / "mini_program_predictions.json"
    _write_json(
        prediction_path,
        {
            "sourceStatus": "active",
            "predictions": {
                "30900": {
                    "status": "available",
                    "matchId": "30900",
                    "redRate": 0.75,
                    "blueRate": 0.25,
                    "tieRate": 0.0,
                }
            },
        },
    )
    monkeypatch.setattr(service, "MINI_PROGRAM_PREDICTIONS_PATH", prediction_path)
    monkeypatch.setenv("RMUC_MINI_PROGRAM_ENABLED", "0")

    assert service.load_mini_program_predictions() == {}


def test_live_schedule_metadata_attaches_persisted_mini_program_prediction_for_placeholder(
    tmp_path: Path,
    monkeypatch,
) -> None:
    normalized_path = tmp_path / "normalized_schedule.json"
    prediction_path = tmp_path / "mini_program_predictions.json"
    _write_json(
        normalized_path,
        {
            "sourceStatus": "active",
            "regions": {
                "south_region": {
                    "matches": [
                        {
                            "matchLabel": "A-SWISS-1-1",
                            "officialMatchId": "30900",
                            "officialStatus": "WAITING",
                            "plannedStartAt": "2026-05-11T08:10:00+00:00",
                            "isConfirmedMatchup": False,
                            "scoreline": "0:0",
                            "redSlot": "A1",
                            "blueSlot": "A9",
                        }
                    ]
                }
            },
        },
    )
    _write_json(
        prediction_path,
        {
            "sourceStatus": "active",
            "predictions": {
                "30900": {
                    "status": "available",
                    "matchId": "30900",
                    "redCount": 6,
                    "blueCount": 4,
                    "tieCount": 0,
                    "totalCount": 10,
                    "redRate": 0.6,
                    "blueRate": 0.4,
                    "tieRate": 0.0,
                    "fetchedAt": "2026-05-11T08:00:00+00:00",
                }
            },
        },
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "MINI_PROGRAM_PREDICTIONS_PATH", prediction_path)
    payload = {
        "matches": [
            {
                "matchLabel": "A-SWISS-1-1",
                "isRealResult": False,
                "isConfirmedMatchup": False,
                "redTeam": {"teamKey": "predicted-red", "collegeName": "预测红方", "teamName": "预测红方"},
                "blueTeam": {"teamKey": "predicted-blue", "collegeName": "预测蓝方", "teamName": "预测蓝方"},
                "scoreline": "2:0",
                "winnerTeamKey": "predicted-red",
                "loserTeamKey": "predicted-blue",
                "pGameRed": 0.7,
                "pGameBlue": 0.3,
                "pSeriesRed": 0.8,
                "pSeriesBlue": 0.2,
                "deltaH2H": 0.0,
                "confidenceLabel": "medium",
            }
        ]
    }

    service._attach_live_schedule_metadata(payload, "south_region")

    assert payload["matches"][0]["miniProgramPrediction"]["redRate"] == 0.6
