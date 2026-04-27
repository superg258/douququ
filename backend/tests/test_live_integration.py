from __future__ import annotations

from datetime import UTC, datetime

from backend.app import rmuc_live


def _team(college_name: str, team_name: str, slot: str) -> dict:
    return {
        "name": slot,
        "team": {
            "collegeName": college_name,
            "name": team_name,
        },
    }


def _schedule_payload(title: str = "RoboMaster 2026 超级对抗赛") -> dict:
    red = _team("太原理工大学", "TRoMaC", "A1")
    blue = _team("西交利物浦大学", "GMaster", "A9")
    return {
        "data": {
            "event": {
                "title": title,
                "zones": {
                    "nodes": [
                        {
                            "id": "660",
                            "name": "南部赛区",
                            "zoneType": "GROUP_ZONE",
                            "groups": {
                                "nodes": [
                                    {
                                        "name": "A组",
                                        "players": {
                                            "nodes": [red, blue],
                                        },
                                    }
                                ]
                            },
                            "groupMatches": {
                                "nodes": [
                                    {
                                        "id": "296001",
                                        "matchType": "GROUP",
                                        "orderNumber": 1,
                                        "planGameCount": 3,
                                        "planStartedAt": "2026-11-11T00:40:00Z",
                                        "status": "DONE",
                                        "result": "RED",
                                        "redSideWinGameCount": 2,
                                        "blueSideWinGameCount": 0,
                                        "redSide": {"player": red},
                                        "blueSide": {"player": blue},
                                    }
                                ]
                            },
                            "knockoutMatches": {"nodes": []},
                        }
                    ]
                },
            }
        }
    }


def test_normalize_schedule_payload_marks_rmuc_source_active() -> None:
    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload(),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={"etag": "abc", "last-modified": "Mon, 27 Apr 2026 06:54:20 GMT"},
    )

    assert normalized["sourceStatus"] == "active"
    assert normalized["season"] == 2026
    assert normalized["regions"]["south_region"]["zoneName"] == "南部赛区"
    assert normalized["regions"]["south_region"]["slotAssignments"]["太原理工大学::TRoMaC"] == "A1"
    match = normalized["regions"]["south_region"]["matches"][0]
    assert match["officialMatchId"] == "296001"
    assert match["scoreline"] == "2:0"
    assert match["stageFamily"] == "regional_group"
    assert match["redTeamKey"] == "太原理工大学::TRoMaC"
    assert match["blueTeamKey"] == "西交利物浦大学::GMaster"


def test_normalize_schedule_payload_attaches_official_group_rank_metrics() -> None:
    group_rank_payload = {
        "zones": [
            {
                "zoneName": "南部赛区",
                "groups": [
                    {
                        "groupName": "A组",
                        "groupPlayers": [
                            [
                                {"itemName": "排名", "itemValue": 6},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "太原理工大学",
                                        "teamName": "TRoMaC",
                                    },
                                },
                                {"itemName": "对手分", "itemValue": 4},
                                {"itemName": "局均总基地净胜血量", "itemValue": 1200},
                                {"itemName": "局均全队总伤害血量", "itemValue": 7800},
                            ]
                        ],
                    }
                ],
            }
        ]
    }

    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload(),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
        group_rank_payload=group_rank_payload,
    )

    metrics = normalized["regions"]["south_region"]["groupRankMetrics"]["太原理工大学::TRoMaC"]
    assert metrics["group_name"] == "A"
    assert metrics["official_opponent_points"] == 4.0
    assert metrics["official_avg_base_hp_diff"] == 1200.0
    assert metrics["official_avg_team_damage"] == 7800.0
    assert metrics["ranking_metric_source"] == "official_live"


def test_normalize_schedule_payload_keeps_non_rmuc_source_inactive() -> None:
    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload("RoboMaster 2026 高校联盟赛-3V3对抗赛"),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
    )

    assert normalized["sourceStatus"] == "inactive"
    assert "RMUC" in normalized["reason"] or "超级对抗赛" in normalized["reason"]
    assert normalized["regions"] == {}


def test_build_runtime_match_records_filters_existing_match_school_pairs() -> None:
    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload(),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
    )

    records = rmuc_live.build_runtime_match_records(
        normalized,
        existing_match_school_pairs={("2026RMUC:296001", "太原理工大学")},
    )

    assert records == []


def test_live_overlay_forces_completed_scoreline_and_keeps_mp_payload() -> None:
    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload(),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
    )
    context = rmuc_live.LiveRuntimeContext.from_normalized(
        normalized,
        "south_region",
        mini_program_predictions={
            "296001": {
                "status": "available",
                "redRate": 0.7,
                "blueRate": 0.3,
                "tieRate": 0.0,
                "redCount": 7,
                "blueCount": 3,
                "tieCount": 0,
                "totalCount": 10,
                "fetchedAt": "2026-04-27T00:00:00+00:00",
            }
        },
    )

    payload = context.payload_override_for(
        red_team_key="太原理工大学::TRoMaC",
        blue_team_key="西交利物浦大学::GMaster",
        stage="swiss",
    )

    assert payload["fixed_scoreline"] == "2:0"
    assert payload["official_match_id"] == "296001"
    assert payload["official_status"] == "DONE"
    assert payload["mini_program_prediction"]["redRate"] == 0.7


def test_live_overlay_keeps_mini_program_for_confirmed_unfinished_match() -> None:
    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload(),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
    )
    match = normalized["regions"]["south_region"]["matches"][0]
    normalized["regions"]["south_region"]["matches"][0] = {
        **match,
        "officialStatus": "PENDING",
        "result": "",
        "scoreline": "0:0",
        "redWins": 0,
        "blueWins": 0,
        "isCompleted": False,
        "isConfirmedMatchup": True,
    }
    context = rmuc_live.LiveRuntimeContext.from_normalized(
        normalized,
        "south_region",
        mini_program_predictions={
            "296001": {
                "status": "available",
                "redRate": 0.62,
                "blueRate": 0.38,
                "tieRate": 0.0,
                "redCount": 62,
                "blueCount": 38,
                "tieCount": 0,
                "totalCount": 100,
                "fetchedAt": "2026-04-27T00:00:00+00:00",
            }
        },
    )

    payload = context.payload_override_for(
        red_team_key="太原理工大学::TRoMaC",
        blue_team_key="西交利物浦大学::GMaster",
        stage="swiss",
    )

    assert payload["official_match_id"] == "296001"
    assert payload["official_status"] == "PENDING"
    assert "fixed_scoreline" not in payload
    assert payload["mini_program_prediction"]["redRate"] == 0.62


def test_live_overlay_prefers_round_specific_match_when_pairs_repeat() -> None:
    normalized = rmuc_live.normalize_schedule_payload(
        _schedule_payload(),
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
    )
    match = normalized["regions"]["south_region"]["matches"][0]
    first_round = {
        **match,
        "officialMatchId": "296001",
        "matchId": "2026RMUC:296001",
        "roundNumber": 1,
        "matchLabel": "A-SWISS-1-1",
        "scoreline": "2:0",
        "redWins": 2,
        "blueWins": 0,
    }
    second_round = {
        **match,
        "officialMatchId": "296002",
        "matchId": "2026RMUC:296002",
        "roundNumber": 2,
        "matchLabel": "A-SWISS-2-1",
        "scoreline": "0:2",
        "redWins": 0,
        "blueWins": 2,
    }
    normalized["regions"]["south_region"]["matches"] = [first_round, second_round]
    context = rmuc_live.LiveRuntimeContext.from_normalized(normalized, "south_region")

    payload = context.payload_override_for(
        red_team_key="太原理工大学::TRoMaC",
        blue_team_key="西交利物浦大学::GMaster",
        stage="swiss",
        round_number=1,
        match_label="A-SWISS-1-1",
    )

    assert payload["official_match_id"] == "296001"
    assert payload["fixed_scoreline"] == "2:0"


def test_mini_program_prediction_failure_returns_unavailable_without_raising() -> None:
    client = rmuc_live.MiniProgramPredictionClient(
        fetcher=lambda match_id: (_ for _ in ()).throw(RuntimeError("network down")),
    )

    payload = client.get("296001")

    assert payload["status"] == "unavailable"
    assert payload["matchId"] == "296001"
    assert "network down" in payload["reason"]
