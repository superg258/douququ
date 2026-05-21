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


def test_clear_stale_runtime_published_artifacts_removes_live_outputs(tmp_path: Path) -> None:
    runtime_dir = tmp_path / "rmuc_live"
    published_dir = runtime_dir / "published_2026"
    for filename in ("live_state_updates.json", "live_match_ledger.json", "current_snapshot.json", "published_manifest.json"):
        _write_json(published_dir / filename, [{"stale": True}])

    sync_rmuc_live.clear_stale_runtime_published_artifacts(runtime_dir)

    assert not (published_dir / "live_state_updates.json").exists()
    assert not (published_dir / "live_match_ledger.json").exists()
    assert not (published_dir / "current_snapshot.json").exists()
    assert (published_dir / "published_manifest.json").exists()


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
                "30888": {
                    "status": "available",
                    "matchId": "30888",
                    "redCount": 4,
                    "blueCount": 6,
                    "tieCount": 0,
                    "totalCount": 10,
                    "redRate": 0.4,
                    "blueRate": 0.6,
                    "tieRate": 0.0,
                    "fetchedAt": "2026-05-10T07:59:30+00:00",
                },
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
    assert status["storedPredictions"] == 3

    payload = json.loads((runtime_dir / "mini_program_predictions.json").read_text(encoding="utf-8"))
    assert sorted(payload["predictions"]) == ["30888", "30900", "30901"]
    assert payload["predictions"]["30888"]["redRate"] == 0.4
    assert payload["predictions"]["30900"]["redRate"] == 0.7
    assert payload["predictions"]["30901"]["blueRate"] == 0.8

    manifest = sync_rmuc_live.build_sync_manifest(normalized, mini_program_status=status, fetched_at=now)
    assert manifest["officialSchedule"]["sourceStatus"] == "active"
    assert manifest["officialSchedule"]["matchCount"] == 4
    assert manifest["miniProgramPrediction"]["candidateMatchIds"] == 2


def test_collect_mini_program_match_ids_treats_naive_schedule_times_as_beijing() -> None:
    now = datetime(2026, 5, 12, 16, 0, tzinfo=UTC)
    normalized = {
        "sourceStatus": "active",
        "regions": {
            "south_region": {
                "matches": [
                    {"officialMatchId": "30900", "plannedStartAt": "2026-05-13T00:10:00"},
                    {"officialMatchId": "30901", "plannedStartAt": "2026-05-13T08:10:00"},
                ]
            }
        },
    }

    match_ids = sync_rmuc_live.collect_mini_program_match_ids(
        normalized,
        now=now,
        lookback_hours=0,
        lookahead_hours=1,
    )

    assert match_ids == ["30900"]


def _group_rank_player(
    college_name: str,
    team_name: str,
    *,
    record: str,
    damage: float,
    base_hp_diff: float,
    opponent_points: float,
) -> list[dict[str, Any]]:
    return [
        {"itemName": "战队", "itemValue": {"collegeName": college_name, "teamName": team_name}},
        {"itemName": "胜/平/负", "itemValue": record},
        {"itemName": "对手分", "itemValue": opponent_points},
        {"itemName": "时均总基地净胜血量", "itemValue": str(base_hp_diff)},
        {"itemName": "时均全队总伤害血量", "itemValue": str(damage)},
    ]


def test_prediction_form_observations_use_pending_match_round_counts(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    _write_json(
        raw_dir / "group_rank_info.json",
        {
            "zones": [
                {
                    "zoneName": "东部赛区",
                    "groups": [
                        {
                            "groupName": "A组",
                            "groupPlayers": [
                                _group_rank_player(
                                    "红方大学",
                                    "Red",
                                    record="1/0/0",
                                    damage=12.0,
                                    base_hp_diff=1.2,
                                    opponent_points=1.0,
                                ),
                                _group_rank_player(
                                    "蓝方大学",
                                    "Blue",
                                    record="1/0/0",
                                    damage=8.0,
                                    base_hp_diff=-1.2,
                                    opponent_points=-1.0,
                                ),
                            ],
                        }
                    ],
                }
            ]
        },
    )
    _write_json(
        raw_dir / "robot_data.json",
        {
            "zones": [
                {
                    "zoneName": "东部赛区",
                    "teams": [
                        {
                            "collegeName": "红方大学",
                            "name": "Red",
                            "robots": [{"eagHurt": 2000, "gKillCount": 6, "eagKdaScore": 7, "gkDamage": 900}],
                        },
                        {
                            "collegeName": "蓝方大学",
                            "name": "Blue",
                            "robots": [{"eagHurt": 300, "gKillCount": 0, "eagKdaScore": 0, "gkDamage": 100}],
                        },
                    ],
                }
            ]
        },
    )
    normalized = {
        "sourceStatus": "active",
        "regions": {
            "east_region": {
                "matches": [
                    {
                        "matchId": "2026RMUC:R1-PENDING",
                        "officialMatchId": "R1-PENDING",
                        "regionSlug": "east_region",
                        "stage": "swiss",
                        "stageFamily": "regional_group",
                        "roundNumber": 1,
                        "groupName": "A",
                        "plannedStartAt": "2026-05-21T08:00:00+00:00",
                        "officialStatus": "WAITING",
                        "isCompleted": False,
                        "hasLiveScoreline": False,
                        "isConfirmedMatchup": True,
                        "redSchoolKey": "红方大学",
                        "blueSchoolKey": "蓝方大学",
                        "redTeamKey": "红方大学::Red",
                        "blueTeamKey": "蓝方大学::Blue",
                    },
                    {
                        "matchId": "2026RMUC:R1-DONE",
                        "officialMatchId": "R1-DONE",
                        "regionSlug": "east_region",
                        "stage": "swiss",
                        "stageFamily": "regional_group",
                        "roundNumber": 1,
                        "groupName": "A",
                        "plannedStartAt": "2026-05-21T08:10:00+00:00",
                        "officialStatus": "DONE",
                        "isCompleted": True,
                        "hasLiveScoreline": True,
                        "isConfirmedMatchup": True,
                        "redSchoolKey": "红方大学",
                        "blueSchoolKey": "蓝方大学",
                        "redTeamKey": "红方大学::Red",
                        "blueTeamKey": "蓝方大学::Blue",
                    },
                    {
                        "matchId": "2026RMUC:R2-PENDING",
                        "officialMatchId": "R2-PENDING",
                        "regionSlug": "east_region",
                        "stage": "swiss",
                        "stageFamily": "regional_group",
                        "roundNumber": 2,
                        "groupName": "A",
                        "plannedStartAt": "2026-05-21T09:00:00+00:00",
                        "officialStatus": "WAITING",
                        "isCompleted": False,
                        "hasLiveScoreline": False,
                        "isConfirmedMatchup": True,
                        "redSchoolKey": "红方大学",
                        "blueSchoolKey": "蓝方大学",
                        "redTeamKey": "红方大学::Red",
                        "blueTeamKey": "蓝方大学::Blue",
                    },
                    {
                        "matchId": "2026RMUC:R2-DONE",
                        "officialMatchId": "R2-DONE",
                        "regionSlug": "east_region",
                        "stage": "swiss",
                        "stageFamily": "regional_group",
                        "roundNumber": 2,
                        "groupName": "A",
                        "plannedStartAt": "2026-05-21T10:00:00+00:00",
                        "officialStatus": "DONE",
                        "isCompleted": True,
                        "hasLiveScoreline": True,
                        "isConfirmedMatchup": True,
                        "redSchoolKey": "红方大学",
                        "blueSchoolKey": "蓝方大学",
                        "redTeamKey": "红方大学::Red",
                        "blueTeamKey": "蓝方大学::Blue",
                    },
                    {
                        "matchId": "2026RMUC:R3-PENDING",
                        "officialMatchId": "R3-PENDING",
                        "regionSlug": "east_region",
                        "stage": "swiss",
                        "stageFamily": "regional_group",
                        "roundNumber": 3,
                        "groupName": "A",
                        "plannedStartAt": "2026-05-21T11:00:00+00:00",
                        "officialStatus": "WAITING",
                        "isCompleted": False,
                        "hasLiveScoreline": False,
                        "isConfirmedMatchup": True,
                        "redSchoolKey": "红方大学",
                        "blueSchoolKey": "蓝方大学",
                        "redTeamKey": "红方大学::Red",
                        "blueTeamKey": "蓝方大学::Blue",
                    },
                ]
            }
        },
    }

    frame = sync_rmuc_live.build_runtime_prediction_form_observations(
        normalized=normalized,
        raw_dir=raw_dir,
        regional_cfg=sync_rmuc_live.load_regional_config(sync_rmuc_live.DEFAULT_TS2_CONFIG),
    )
    rows = frame.to_dict(orient="records")

    assert [(row["match_id"], row["school_key"]) for row in rows] == [
        ("2026RMUC:R2-PENDING", "红方大学"),
        ("2026RMUC:R2-PENDING", "蓝方大学"),
    ]
    assert {row["form_event_freshness_status"] for row in rows} == {"current"}
    assert rows[0]["form_robot_family_signal"] != 0.0
    assert rows[0]["form_expected_group_matches_before"] == 1.0


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
