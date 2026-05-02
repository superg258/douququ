from __future__ import annotations

from datetime import UTC, datetime
import json
from types import SimpleNamespace

from backend.app import rmuc_live, service


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
                                {"itemName": "胜/平/负", "itemValue": "1/0/0"},
                                {"itemName": "积分", "itemValue": 3},
                                {"itemName": "总净胜胜利点", "itemValue": 2},
                                {"itemName": "全队总伤害血量", "itemValue": 7800},
                                {"itemName": "全队机器人总剩余血量", "itemValue": 1200},
                                {"itemName": "对手分", "itemValue": 99},
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
    assert metrics["wins"] == 1.0
    assert metrics["draws"] == 0.0
    assert metrics["losses"] == 0.0
    assert metrics["score_points"] == 3.0
    assert metrics["official_total_victory_points_diff"] == 2.0
    assert metrics["official_total_team_damage"] == 7800.0
    assert metrics["official_total_robot_remaining_hp"] == 1200.0
    assert metrics["official_opponent_points"] == -2.0
    assert metrics["ranking_metric_source"] == "official_live"


def test_live_school_rename_aliases_do_not_split_team_keys() -> None:
    payload = _schedule_payload()
    zone = payload["data"]["event"]["zones"]["nodes"][0]
    red_player = zone["groups"]["nodes"][0]["players"]["nodes"][0]
    red_player["name"] = "B5"
    red_player["team"]["collegeName"] = "华北科技学院"
    red_player["team"]["name"] = "风暴"
    group_rank_payload = {
        "zones": [
            {
                "zoneName": "南部赛区",
                "groups": [
                    {
                        "groupName": "B组",
                        "groupPlayers": [
                            [
                                {"itemName": "排名", "itemValue": 1},
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "应急管理学院",
                                        "teamName": "风暴",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "1/0/0"},
                                {"itemName": "积分", "itemValue": 3},
                            ]
                        ],
                    }
                ],
            }
        ]
    }

    normalized = rmuc_live.normalize_schedule_payload(
        payload,
        fetched_at=datetime(2026, 4, 27, tzinfo=UTC),
        source_headers={},
        group_rank_payload=group_rank_payload,
    )

    region = normalized["regions"]["south_region"]
    assert region["slotAssignments"]["应急管理大学::风暴"] == "B5"
    assert "应急管理大学::风暴" in region["groupRankMetrics"]
    assert "华北科技学院::风暴" not in region["slotAssignments"]
    assert "应急管理学院::风暴" not in region["groupRankMetrics"]
    match = region["matches"][0]
    assert match["redTeamKey"] == "应急管理大学::风暴"
    assert match["redCollegeName"] == "应急管理大学"


def test_normalize_schedule_payload_infers_north_extended_post_group_labels() -> None:
    red = _team("应急管理大学", "风暴", "A1")
    blue = _team("东北大学", "T-DT", "A9")
    payload = {
        "data": {
            "event": {
                "title": "RoboMaster 2026 超级对抗赛",
                "zones": {
                    "nodes": [
                        {
                            "id": "661",
                            "name": "北部赛区",
                            "zoneType": "GROUP_ZONE",
                            "groups": {"nodes": []},
                            "groupMatches": {"nodes": []},
                            "knockoutMatches": {
                                "nodes": [
                                    {
                                        "id": "N83",
                                        "matchType": "KNOCKOUT",
                                        "orderNumber": 83,
                                        "planGameCount": 3,
                                        "status": "PENDING",
                                        "result": "",
                                        "redSideWinGameCount": 0,
                                        "blueSideWinGameCount": 0,
                                        "redSide": {"player": red},
                                        "blueSide": {"player": blue},
                                    },
                                    {
                                        "id": "N85",
                                        "matchType": "KNOCKOUT",
                                        "orderNumber": 85,
                                        "planGameCount": 3,
                                        "status": "PENDING",
                                        "result": "",
                                        "redSideWinGameCount": 0,
                                        "blueSideWinGameCount": 0,
                                        "redSide": {"player": red},
                                        "blueSide": {"player": blue},
                                    },
                                    {
                                        "id": "N87",
                                        "matchType": "KNOCKOUT",
                                        "orderNumber": 87,
                                        "planGameCount": 3,
                                        "status": "PENDING",
                                        "result": "",
                                        "redSideWinGameCount": 0,
                                        "blueSideWinGameCount": 0,
                                        "redSide": {"player": red},
                                        "blueSide": {"player": blue},
                                    },
                                    {
                                        "id": "N90",
                                        "matchType": "KNOCKOUT",
                                        "orderNumber": 90,
                                        "planGameCount": 3,
                                        "status": "PENDING",
                                        "result": "",
                                        "redSideWinGameCount": 0,
                                        "blueSideWinGameCount": 0,
                                        "redSide": {"player": red},
                                        "blueSide": {"player": blue},
                                    },
                                ]
                            },
                        }
                    ]
                },
            }
        }
    }

    normalized = rmuc_live.normalize_schedule_payload(
        payload,
        fetched_at=datetime(2026, 4, 30, tzinfo=UTC),
        source_headers={},
    )

    matches = {match["officialMatchId"]: match for match in normalized["regions"]["north_region"]["matches"]}
    assert (matches["N83"]["stage"], matches["N83"]["matchLabel"]) == ("qualification_round2", "QUAL-2-1")
    assert (matches["N85"]["stage"], matches["N85"]["matchLabel"]) == ("qualification_round2", "QUAL-R-1")
    assert (matches["N87"]["stage"], matches["N87"]["matchLabel"]) == ("semifinal", "SF-1")
    assert (matches["N90"]["stage"], matches["N90"]["matchLabel"]) == ("final", "FINAL-1")


def test_live_post_group_labels_follow_actual_order_over_stale_rule_labels() -> None:
    completed_r16_1 = {
        "regionSlug": "south_region",
        "stageFamily": "post_group",
        "stage": "round_of_16",
        "matchLabel": "stale-from-rules",
        "orderNumber": 67,
        "isCompleted": True,
    }
    completed_r16_2 = {
        "regionSlug": "south_region",
        "stageFamily": "post_group",
        "stage": "round_of_16",
        "matchLabel": "also-stale",
        "orderNumber": 68,
        "isCompleted": True,
    }
    pending_qf_1 = {
        "regionSlug": "south_region",
        "stageFamily": "post_group",
        "stage": "round_of_16",
        "matchLabel": "R16-1",
        "orderNumber": 75,
        "isCompleted": False,
        "isConfirmedMatchup": True,
    }
    matches = [completed_r16_1, completed_r16_2, pending_qf_1]

    assert rmuc_live._live_match_stage(pending_qf_1) == "quarterfinal"
    assert rmuc_live._live_match_label(pending_qf_1) == "QF-1"
    assert rmuc_live._live_match_can_lock(pending_qf_1, matches) is True


def _context_with_slots(slot_assignments: dict[str, str]) -> rmuc_live.LiveRuntimeContext:
    return rmuc_live.LiveRuntimeContext(
        region_slug="south_region",
        source_status="active",
        reason=None,
        matches_by_pair={},
        matches_by_pair_round={},
        matches_by_pair_label={},
        swiss_pairings={},
        slot_assignments=slot_assignments,
        group_rank_metrics={},
        completed_count=0,
        confirmed_count=0,
    )


def _stage_family(stage: str) -> str:
    if stage == "swiss":
        return "regional_group"
    if stage in {"qualification_round1", "qualification_round2"}:
        return "repechage"
    return "post_group"


def _school_key(team_key: str) -> str:
    return team_key.split("::", maxsplit=1)[0]


def _mock_south_live_normalized(*, completed_count: int) -> dict:
    simulation = service.build_simulation_payload("south_region", 20260414, mode="sim", samples=32)
    slot_assignments = {slot["teamKey"]: slot["slot"] for slot in simulation["slots"]}
    matches = []
    for index, match in enumerate(simulation["matches"], start=1):
        is_completed = index <= completed_count
        red_wins, blue_wins = [int(piece) for piece in str(match["scoreline"]).split(":", maxsplit=1)]
        official_red_wins = red_wins if is_completed else 0
        official_blue_wins = blue_wins if is_completed else 0
        red_team = match["redTeam"]
        blue_team = match["blueTeam"]
        matches.append(
            {
                "officialMatchId": f"MOCK-SOUTH-{index:03d}",
                "matchId": f"2026RMUC:MOCK-SOUTH-{index:03d}",
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "zoneName": "南部赛区",
                "stageFamily": _stage_family(match["stage"]),
                "stage": match["stage"],
                "matchLabel": match["matchLabel"],
                "roundNumber": int(match["roundNumber"]),
                "matchType": "GROUP" if match["stage"] == "swiss" else "KNOCKOUT",
                "orderNumber": index,
                "bestOf": int(match["bestOf"]),
                "plannedStartAt": f"2026-05-01T{index % 24:02d}:00:00+00:00",
                "matchDate": "2026-05-01",
                "officialStatus": "DONE" if is_completed else "PENDING",
                "result": "RED" if is_completed and red_wins > blue_wins else "BLUE" if is_completed else "",
                "scoreline": match["scoreline"] if is_completed else "0:0",
                "isCompleted": is_completed,
                "isConfirmedMatchup": True,
                "redSchoolKey": _school_key(red_team["teamKey"]),
                "redTeamKey": red_team["teamKey"],
                "redCollegeName": red_team["collegeName"],
                "redTeamName": red_team["teamName"],
                "redSlot": red_team.get("slot"),
                "blueSchoolKey": _school_key(blue_team["teamKey"]),
                "blueTeamKey": blue_team["teamKey"],
                "blueCollegeName": blue_team["collegeName"],
                "blueTeamName": blue_team["teamName"],
                "blueSlot": blue_team.get("slot"),
                "redWins": official_red_wins,
                "blueWins": official_blue_wins,
            }
        )
    return {
        "sourceStatus": "active",
        "reason": None,
        "eventTitle": "RoboMaster 2026 超级对抗赛（南部赛区模拟实时源）",
        "season": 2026,
        "fetchedAt": "2026-04-30T00:00:00+00:00",
        "sourceUpdatedAt": "2026-04-30T00:00:00+00:00",
        "regions": {
            "south_region": {
                "zoneId": "mock-south",
                "zoneName": "南部赛区",
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "slotAssignments": slot_assignments,
                "matches": matches,
            }
        },
    }


def _live_payload_from_mock(tmp_path, monkeypatch, *, completed_count: int) -> dict:
    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(
        json.dumps(_mock_south_live_normalized(completed_count=completed_count), ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", tmp_path / "published_2026")
    monkeypatch.setenv("RMUC_MINI_PROGRAM_ENABLED", "0")
    service._reset_live_state_caches()
    return service.build_simulation_payload("south_region", 20260414, mode="live", samples=32)


def test_live_slot_assignments_fall_back_when_incomplete() -> None:
    context = _context_with_slots({"太原理工大学::TRoMaC": "A1"})

    assignments, reason = service._validated_live_slot_assignments("south_region", context)

    assert assignments is None
    assert reason is not None
    assert "32" in reason


def test_live_slot_assignments_accept_only_complete_legal_region_slots() -> None:
    rows = [row for row in service.load_ratings_rows() if row["admitted_region"] == "南部赛区"]
    slot_assignments = {
        service.compute_team_key(row["college_name"], row["team_name"]): slot
        for row, slot in zip(rows, service.region_sim.region_core.ALL_SLOTS, strict=True)
    }
    context = _context_with_slots(slot_assignments)

    assignments, reason = service._validated_live_slot_assignments("south_region", context)

    assert assignments == slot_assignments
    assert reason is None


def test_live_payload_builder_uses_ai_favorite_for_pending_prediction_without_real_result(monkeypatch) -> None:
    red_team_key = "red-school::main"
    blue_team_key = "blue-school::main"

    def fake_prediction_payload(*args, **kwargs) -> dict:
        return {
            "p_game_base_red": 0.72,
            "p_game_adj_red": 0.72,
            "p_series_red": 0.8,
            "p_series_blue": 0.2,
            "scoreline_distribution": {"0:2": 1.0},
            "head_to_head_summary": {"delta_h2h": 0.0},
            "confidence_label": "high",
        }

    monkeypatch.setattr(service.region_sim, "build_prediction_payload", fake_prediction_payload)
    context = rmuc_live.LiveRuntimeContext(
        region_slug="south_region",
        source_status="active",
        reason=None,
        matches_by_pair={},
        matches_by_pair_round={
            (red_team_key, blue_team_key, "swiss", 1): {
                "matchId": "2026RMUC:PENDING-1",
                "officialMatchId": "PENDING-1",
                "officialStatus": "PENDING",
                "plannedStartAt": "2026-05-02T12:00:00+00:00",
                "scoreline": "0:0",
                "isCompleted": False,
            }
        },
        matches_by_pair_label={},
        swiss_pairings={},
        slot_assignments={},
        group_rank_metrics={},
        completed_count=0,
        confirmed_count=1,
    )
    builder = service.live_payload_builder_factory(context)

    payload = builder(
        SimpleNamespace(team_key=red_team_key),
        SimpleNamespace(team_key=blue_team_key),
        best_of=3,
        samples=8,
        match_seed=1,
        head_to_head_index={},
        stage="swiss",
        round_number=1,
        match_label="",
    )

    assert payload["p_series_red"] == 0.8
    assert payload["p_series_blue"] == 0.2
    assert payload["scoreline_distribution"] == {"2:0": 1.0}
    assert "fixed_scoreline" not in payload


def test_live_mode_defers_pending_matches_until_source_rounds_are_complete(tmp_path, monkeypatch) -> None:
    payload = _live_payload_from_mock(tmp_path, monkeypatch, completed_count=46)

    live_status = payload["meta"]["liveStatus"]
    assert live_status["completedOfficialMatches"] == 46
    assert live_status["confirmedOfficialMatches"] == 57
    assert sum(1 for match in payload["matches"] if match["isRealResult"]) == 46
    assert sum(1 for match in payload["matches"] if match.get("officialStatus") == "DONE") == 46
    assert sum(1 for match in payload["matches"] if match.get("officialStatus") == "PENDING") == 11
    assert sum(1 for match in payload["matches"] if match.get("officialMatchId")) == 57
    assert payload["matches"][54]["matchLabel"] == "B-SWISS-4-1"
    assert payload["matches"][54]["officialStatus"] == "PENDING"
    assert payload["matches"][56]["matchLabel"] == "B-SWISS-4-3"
    assert payload["matches"][56]["officialStatus"] == "PENDING"
    assert payload["matches"][57]["matchLabel"] == "B-SWISS-4-4"
    assert payload["matches"][57].get("officialStatus") is None


def test_live_mode_uses_match_ledger_rating_history_without_current_snapshot_backfill(tmp_path, monkeypatch) -> None:
    normalized = _mock_south_live_normalized(completed_count=1)
    first_live_match = normalized["regions"]["south_region"]["matches"][0]
    ratings_by_team_key = {
        service.compute_team_key(row["college_name"], row["team_name"]): row
        for row in service.load_ratings_rows()
    }
    red_team_key = first_live_match["redTeamKey"]
    blue_team_key = first_live_match["blueTeamKey"]
    red_preseason = float(ratings_by_team_key[red_team_key]["mu0"])
    blue_preseason = float(ratings_by_team_key[blue_team_key]["mu0"])

    normalized_path = tmp_path / "normalized_schedule.json"
    normalized_path.write_text(json.dumps(normalized, ensure_ascii=False), encoding="utf-8")
    published_dir = tmp_path / "published_2026"
    published_dir.mkdir(parents=True)
    (published_dir / "current_snapshot.json").write_text(
        json.dumps(
            [
                {
                    "school_key": first_live_match["redSchoolKey"],
                    "school_name": first_live_match["redCollegeName"],
                    "published_rating": red_preseason + 100.0,
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (published_dir / "live_match_ledger.json").write_text(
        json.dumps(
            [
                {
                    "match_id": first_live_match["matchId"],
                    "match_date": first_live_match["matchDate"],
                    "region_slug": "south_region",
                    "stage_family": "regional_group",
                    "school_key": first_live_match["redSchoolKey"],
                    "school_name": first_live_match["redCollegeName"],
                    "opponent_school_key": first_live_match["blueSchoolKey"],
                    "opponent_school_name": first_live_match["blueCollegeName"],
                    "team_side": "red",
                    "scoreline": first_live_match["scoreline"],
                    "match_result": "win",
                    "published_rating_before_match": red_preseason,
                    "published_rating_after_match": red_preseason + 10.0,
                    "published_delta_rating": 10.0,
                    "live_update_delta_rating": 10.0,
                    "prior_component_delta_rating": 0.0,
                    "confirmed_prior_rating_after_match": 0.0,
                    "residual_prior_rating_after_match": 0.0,
                },
                {
                    "match_id": first_live_match["matchId"],
                    "match_date": first_live_match["matchDate"],
                    "region_slug": "south_region",
                    "stage_family": "regional_group",
                    "school_key": first_live_match["blueSchoolKey"],
                    "school_name": first_live_match["blueCollegeName"],
                    "opponent_school_key": first_live_match["redSchoolKey"],
                    "opponent_school_name": first_live_match["redCollegeName"],
                    "team_side": "blue",
                    "scoreline": first_live_match["scoreline"],
                    "match_result": "loss",
                    "published_rating_before_match": blue_preseason,
                    "published_rating_after_match": blue_preseason - 10.0,
                    "published_delta_rating": -10.0,
                    "live_update_delta_rating": -10.0,
                    "prior_component_delta_rating": 0.0,
                    "confirmed_prior_rating_after_match": 0.0,
                    "residual_prior_rating_after_match": 0.0,
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(service, "NORMALIZED_LIVE_SCHEDULE_PATH", normalized_path)
    monkeypatch.setattr(service, "RUNTIME_PUBLISHED_RATINGS_DIR", published_dir)
    monkeypatch.setenv("RMUC_MINI_PROGRAM_ENABLED", "0")
    service._reset_live_state_caches()

    payload = service.build_simulation_payload("south_region", 20260414, mode="live", samples=8)
    first_payload_match = next(match for match in payload["matches"] if match.get("officialMatchId") == first_live_match["officialMatchId"])

    assert first_payload_match["isRealResult"] is True
    assert first_payload_match["redMu0"] == round(red_preseason, 1)
    assert first_payload_match["blueMu0"] == round(blue_preseason, 1)
    assert first_payload_match["redDelta"] == 10.0
    assert first_payload_match["blueDelta"] == -10.0
    assert first_payload_match["redLiveDelta"] == 10.0
    assert first_payload_match["blueLiveDelta"] == -10.0
    assert first_payload_match["redPriorDelta"] == 0.0
    assert first_payload_match["bluePriorDelta"] == 0.0
    assert first_payload_match["redPriorAdjustmentLabel"] == "前三轮先验修正"
    assert first_payload_match["bluePriorAdjustmentLabel"] == "前三轮先验修正"


def test_live_mode_confirms_post_group_matches_when_their_sources_complete(tmp_path, monkeypatch) -> None:
    payload = _live_payload_from_mock(tmp_path, monkeypatch, completed_count=68)

    live_status = payload["meta"]["liveStatus"]
    assert live_status["completedOfficialMatches"] == 68
    assert live_status["confirmedOfficialMatches"] == 76
    matches = {match["matchLabel"]: match for match in payload["matches"]}
    assert matches["QF-1"]["officialStatus"] == "PENDING"
    assert matches["QUAL-1-1"]["officialStatus"] == "PENDING"
    assert matches["QF-2"].get("officialStatus") is None
    assert matches["QUAL-1-2"].get("officialStatus") is None


def test_live_mode_confirms_semifinal_from_its_own_quarterfinal_sources(tmp_path, monkeypatch) -> None:
    payload = _live_payload_from_mock(tmp_path, monkeypatch, completed_count=77)

    live_status = payload["meta"]["liveStatus"]
    assert live_status["completedOfficialMatches"] == 77
    assert live_status["confirmedOfficialMatches"] == 83
    matches = {match["matchLabel"]: match for match in payload["matches"]}
    assert matches["SF-1"]["officialStatus"] == "PENDING"
    assert matches["SF-2"].get("officialStatus") is None


def test_live_mode_confirms_qualification_round2_from_its_own_round1_sources(tmp_path, monkeypatch) -> None:
    payload = _live_payload_from_mock(tmp_path, monkeypatch, completed_count=81)

    live_status = payload["meta"]["liveStatus"]
    assert live_status["completedOfficialMatches"] == 81
    assert live_status["confirmedOfficialMatches"] == 85
    matches = {match["matchLabel"]: match for match in payload["matches"]}
    assert matches["QUAL-2-1"]["officialStatus"] == "PENDING"
    assert matches["QUAL-2-2"].get("officialStatus") is None


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
