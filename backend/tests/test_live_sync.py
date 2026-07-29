from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from backend.app import service
from scripts import sync_rmuc_live


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _completed_normalized() -> dict[str, Any]:
    return {
        "schemaVersion": "rmuc-regionals-live-v1",
        "sourceStatus": "active",
        "sourceKind": "official",
        "eventTitle": "RoboMaster 2026 超级对抗赛",
        "season": 2026,
        "fetchedAt": "2026-05-11T08:00:00+00:00",
        "sourceUpdatedAt": "Mon, 11 May 2026 08:00:00 GMT",
        "regions": {
            "south_region": {
                "matches": [
                    {
                        "matchId": "2026RMUC:30900",
                        "officialMatchId": "30900",
                        "regionSlug": "south_region",
                        "orderNumber": 1,
                        "plannedStartAt": "2026-05-11T08:10:00+00:00",
                        "matchDate": "2026-05-11",
                        "stageFamily": "regional_group",
                        "isCompleted": True,
                        "redSchoolKey": "红方大学",
                        "blueSchoolKey": "蓝方大学",
                        "redWins": 2,
                        "blueWins": 0,
                    }
                ]
            }
        },
    }


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


def test_model_config_signature_change_requires_runtime_republish(tmp_path: Path) -> None:
    runtime_dir = tmp_path / "rmuc_live"
    _write_json(
        runtime_dir / "published_2026" / "published_manifest.json",
        {"model_config_signature": {"live_update_strategy": "obsolete"}},
    )

    decision = sync_rmuc_live.runtime_publication_decision(
        normalized=_completed_normalized(),
        runtime_dir=runtime_dir,
        config_path=None,
        schedule_changed=False,
        prediction_changed=False,
    )

    assert decision["modelConfigChanged"] is True
    assert decision["publicationRequired"] is True


def test_regional_schedule_digest_ignores_shared_upstream_header_rotation() -> None:
    previous = _completed_normalized()
    previous.update(
        {
            "fetchedAt": "2026-05-11T08:00:00+00:00",
            "sourceUpdatedAt": "Mon, 11 May 2026 08:00:00 GMT",
            "etag": '"regional-before"',
        }
    )
    current = deepcopy(previous)
    current.update(
        {
            "fetchedAt": "2026-05-11T08:00:30+00:00",
            "sourceUpdatedAt": "Mon, 11 May 2026 08:00:30 GMT",
            "etag": '"global-finals-changed"',
        }
    )

    assert sync_rmuc_live.regional_schedule_digest(current) == (
        sync_rmuc_live.regional_schedule_digest(previous)
    )


def test_runtime_match_records_sort_late_backfill_by_authoritative_time() -> None:
    normalized = _completed_normalized()
    later = normalized["regions"]["south_region"]["matches"][0]
    later["matchId"] = "2026RMUC:30902"
    later["officialMatchId"] = "30902"
    later["orderNumber"] = 2
    later["plannedStartAt"] = "2026-05-12T09:00:00+00:00"
    later["matchDate"] = "2026-05-12"
    earlier = deepcopy(later)
    earlier["matchId"] = "2026RMUC:30901"
    earlier["officialMatchId"] = "30901"
    earlier["orderNumber"] = 1
    earlier["plannedStartAt"] = "2026-05-11T09:00:00+00:00"
    earlier["matchDate"] = "2026-05-11"
    normalized["regions"]["south_region"]["matches"] = [later, earlier]

    records = sync_rmuc_live.rmuc_live.build_runtime_match_records(normalized)

    assert [row["match_id"] for row in records] == [
        "2026RMUC:30901",
        "2026RMUC:30902",
    ]
    assert [row["authoritative_order"] for row in records] == [0, 1]
    assert [row["planned_start_at"] for row in records] == [
        "2026-05-11T09:00:00+00:00",
        "2026-05-12T09:00:00+00:00",
    ]


def test_publish_runtime_artifacts_replays_from_empty_authoritative_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import pandas as pd

    runtime_dir = tmp_path / "rmuc_live"
    _write_json(
        runtime_dir / "published_2026" / "live_state_updates.json",
        [{"match_id": "stale-result"}],
    )
    captured: dict[str, Any] = {}

    monkeypatch.setattr(
        sync_rmuc_live,
        "load_manifest",
        lambda _path: {
            "season": 2026,
            "rating_scale": 135.0,
            "beta_perf": 1.8,
            "online_live_update_scale": 0.33,
        },
    )
    monkeypatch.setattr(
        sync_rmuc_live,
        "build_preseason_snapshot",
        lambda *_args, **_kwargs: pd.DataFrame(),
    )
    monkeypatch.setattr(
        sync_rmuc_live,
        "build_runtime_live_form_observations",
        lambda **_kwargs: pd.DataFrame(),
    )
    monkeypatch.setattr(
        sync_rmuc_live,
        "build_runtime_prediction_form_observations",
        lambda **_kwargs: pd.DataFrame(),
    )

    def build_updates(**kwargs: Any) -> Any:
        captured["existing_empty"] = kwargs["live_state_store"].empty
        captured["match_ids"] = kwargs["new_matches"]["match_id"].tolist()
        return pd.DataFrame()

    monkeypatch.setattr(sync_rmuc_live, "build_published_live_state_updates", build_updates)
    monkeypatch.setattr(
        sync_rmuc_live,
        "_build_published_current_snapshot",
        lambda **_kwargs: pd.DataFrame(),
    )

    sync_rmuc_live.publish_runtime_artifacts(
        normalized=_completed_normalized(),
        runtime_dir=runtime_dir,
        base_published_dir=tmp_path / "base",
        preseason_ratings=tmp_path / "preseason.csv",
        snapshot_date="2026-05-11",
        config_path=None,
    )

    assert captured == {
        "existing_empty": True,
        "match_ids": ["2026RMUC:30900"],
    }


def test_failed_publish_keeps_pending_marker_and_next_run_forces_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_dir = tmp_path / "rmuc_live"
    _write_json(runtime_dir / "raw" / "schedule.json", {})
    regional_cfg = sync_rmuc_live.load_regional_config(None)
    _write_json(
        runtime_dir / "published_2026" / "published_manifest.json",
        {
            "model_config_signature": sync_rmuc_live.runtime_model_config_signature(
                regional_cfg
            )
        },
    )
    args = SimpleNamespace(
        runtime_dir=runtime_dir,
        base_published_dir=tmp_path / "base",
        preseason_ratings=tmp_path / "preseason.csv",
        config=None,
        snapshot_date="2026-05-11",
        skip_fetch=True,
        skip_mini_program=True,
        mini_program_ttl_seconds=60,
        mini_program_refresh_window_seconds=10,
        mini_program_lookback_hours=1,
        mini_program_lookahead_hours=1,
        mini_program_max_matches=1,
    )
    monkeypatch.setattr(sync_rmuc_live, "parse_args", lambda: args)
    monkeypatch.setattr(
        sync_rmuc_live.rmuc_live,
        "normalize_schedule_payload",
        lambda *_args, **_kwargs: _completed_normalized(),
    )
    attempts = 0

    def publish(**_kwargs: Any) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("injected publish failure")

    monkeypatch.setattr(sync_rmuc_live, "publish_runtime_artifacts", publish)
    monkeypatch.setattr(sync_rmuc_live, "runtime_generation_complete", lambda *_args, **_kwargs: True)

    with pytest.raises(RuntimeError, match="injected publish failure"):
        sync_rmuc_live.main()

    assert (runtime_dir / sync_rmuc_live.PUBLISH_PENDING_FILENAME).is_file()
    failed = json.loads(
        (runtime_dir / sync_rmuc_live.CHECK_STATUS_FILENAME).read_text(encoding="utf-8")
    )
    assert failed["status"] == "failed"
    assert failed["publishPending"] is True

    sync_rmuc_live.main()

    assert attempts == 2
    assert not (runtime_dir / sync_rmuc_live.PUBLISH_PENDING_FILENAME).exists()
    recovered = json.loads(
        (runtime_dir / sync_rmuc_live.CHECK_STATUS_FILENAME).read_text(encoding="utf-8")
    )
    assert recovered["status"] == "ok"
    assert recovered["recoveryPending"] is True
    assert recovered["publishPending"] is False


def test_raw_snapshot_capacity_status_warns_without_deleting_originals(
    tmp_path: Path,
) -> None:
    raw_dir = tmp_path / "raw"
    first = raw_dir / "schedule.20260729T010000Z.json"
    second = raw_dir / "robot_data.20260729T010030Z.json"
    _write_json(first, {"payload": "a"})
    _write_json(second, {"payload": "b"})

    status = sync_rmuc_live.raw_snapshot_capacity_status(
        raw_dir,
        warning_bytes=10**9,
        warning_files=2,
    )

    assert status["retentionMode"] == "retain-originals"
    assert status["automaticDeletion"] is False
    assert status["timestampedFileCount"] == 2
    assert status["overWarningThreshold"] is True
    assert status["warningReasons"] == ["files"]
    assert first.exists() and second.exists()


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
