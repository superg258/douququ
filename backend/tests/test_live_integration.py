from __future__ import annotations

from datetime import UTC, datetime
import json
import random
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


def _placeholder_player(slot: str) -> dict:
    return {
        "id": f"placeholder-{slot}",
        "name": slot,
        "rank": int(slot[1:]) if len(slot) > 1 and slot[1:].isdigit() else 0,
        "score": 0,
        "teamId": None,
        "team": None,
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


def test_normalize_schedule_payload_keeps_official_placeholder_schedule() -> None:
    def zone(zone_id: str, zone_name: str, match_id: str) -> dict:
        return {
            "id": zone_id,
            "name": zone_name,
            "zoneType": "GROUP_ZONE",
            "groups": {"nodes": []},
            "groupMatches": {
                "nodes": [
                    {
                        "id": match_id,
                        "matchType": "GROUP",
                        "groupId": f"group-{zone_id}",
                        "orderNumber": 1,
                        "planGameCount": 3,
                        "planStartedAt": "2026-05-13T00:10:00Z",
                        "status": "WAITING",
                        "result": "EMPTY",
                        "redSideWinGameCount": 0,
                        "blueSideWinGameCount": 0,
                        "redSide": {"player": _placeholder_player("A1")},
                        "blueSide": {"player": _placeholder_player("A9")},
                    },
                    {
                        "id": f"{match_id}-round2",
                        "matchType": "GROUP",
                        "groupId": f"group-{zone_id}",
                        "orderNumber": 17,
                        "planGameCount": 3,
                        "planStartedAt": "2026-05-13T12:00:00Z",
                        "status": "WAITING",
                        "result": "EMPTY",
                        "redSideWinGameCount": 0,
                        "blueSideWinGameCount": 0,
                        "redSide": {
                            "fillSourceId": f"group-{zone_id}",
                            "fillSourceType": "Group",
                            "fillSourceNumber": 1,
                            "fillStatus": "PENDING",
                            "player": None,
                        },
                        "blueSide": {
                            "fillSourceId": f"group-{zone_id}",
                            "fillSourceType": "Group",
                            "fillSourceNumber": 2,
                            "fillStatus": "PENDING",
                            "player": None,
                        },
                    }
                ]
            },
            "knockoutMatches": {"nodes": []},
        }

    payload = {
        "data": {
            "event": {
                "title": "RMUC 2026超级对抗赛",
                "zones": {
                    "nodes": [
                        zone("614", "南部赛区", "30900"),
                        zone("615", "东部赛区", "30988"),
                        zone("616", "北部赛区", "31077"),
                    ]
                },
            }
        }
    }

    normalized = rmuc_live.normalize_schedule_payload(
        payload,
        fetched_at=datetime(2026, 5, 10, tzinfo=UTC),
        source_headers={},
    )

    assert normalized["sourceStatus"] == "active"
    assert {slug: len(region["matches"]) for slug, region in normalized["regions"].items()} == {
        "south_region": 2,
        "east_region": 2,
        "north_region": 2,
    }
    match = normalized["regions"]["south_region"]["matches"][0]
    assert match["officialMatchId"] == "30900"
    assert match["matchLabel"] == "A-SWISS-1-1"
    assert match["redSlot"] == "A1"
    assert match["blueSlot"] == "A9"
    assert match["groupName"] == "A"
    assert match["roundNumber"] == 1
    assert match["plannedStartAt"] == "2026-05-13T00:10:00Z"
    assert match["officialStatus"] == "WAITING"
    assert match["isConfirmedMatchup"] is False
    assert match["isCompleted"] is False
    assert "redTeamKey" not in match
    assert "blueTeamKey" not in match
    assert normalized["regions"]["south_region"]["slotAssignments"] == {}
    source_match = normalized["regions"]["south_region"]["matches"][1]
    assert source_match["officialMatchId"] == "30900-round2"
    assert source_match["matchLabel"] == "A-SWISS-2-1"
    assert source_match["groupName"] == "A"
    assert source_match["roundNumber"] == 2
    assert source_match["redSlot"] == ""
    assert source_match["blueSlot"] == ""
    assert source_match["redFillSourceType"] == "Group"
    assert source_match["redFillSourceNumber"] == 1
    assert source_match["blueFillSourceType"] == "Group"
    assert source_match["isConfirmedMatchup"] is False


def test_placeholder_schedule_does_not_emit_runtime_match_records() -> None:
    payload = _schedule_payload()
    match = payload["data"]["event"]["zones"]["nodes"][0]["groupMatches"]["nodes"][0]
    match["status"] = "DONE"
    match["result"] = "RED"
    match["redSideWinGameCount"] = 2
    match["blueSideWinGameCount"] = 0
    match["redSide"] = {"player": _placeholder_player("A1")}
    match["blueSide"] = {"player": _placeholder_player("A9")}

    normalized = rmuc_live.normalize_schedule_payload(
        payload,
        fetched_at=datetime(2026, 5, 10, tzinfo=UTC),
        source_headers={},
    )

    normalized_match = normalized["regions"]["south_region"]["matches"][0]
    assert normalized_match["isConfirmedMatchup"] is False
    assert normalized_match["isCompleted"] is False
    assert rmuc_live.build_runtime_match_records(normalized) == []


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
                                {"itemName": "时均总基地净胜血量", "itemValue": 135.5},
                                {"itemName": "时均全队总伤害血量", "itemValue": 2468.5},
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
    assert metrics["source_reported_opponent_points"] == 99.0
    assert metrics["official_opponent_points"] == -2.0
    assert metrics["official_avg_base_hp_diff"] == 135.5
    assert metrics["official_avg_team_damage"] == 2468.5
    assert metrics["ranking_metric_source"] == "official_live"


def test_normalize_schedule_payload_maps_slot_only_group_rank_rows_after_official_draw() -> None:
    group_rank_payload = {
        "zones": [
            {
                "zoneName": "南部赛区",
                "groups": [
                    {
                        "groupName": "A组",
                        "groupPlayers": [
                            [
                                {
                                    "itemName": "战队",
                                    "itemValue": {
                                        "collegeName": "",
                                        "teamName": "A1",
                                    },
                                },
                                {"itemName": "胜/平/负", "itemValue": "2/0/1"},
                                {"itemName": "胜场数", "itemValue": 2},
                                {"itemName": "对手分", "itemValue": 7},
                                {"itemName": "时均总基地净胜血量", "itemValue": 88},
                                {"itemName": "时均全队总伤害血量", "itemValue": 1666},
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
    assert metrics["slot"] == "A1"
    assert metrics["wins"] == 2.0
    assert metrics["losses"] == 1.0
    assert metrics["official_opponent_points"] == -2.0
    assert metrics["source_reported_opponent_points"] == 7.0
    assert metrics["official_avg_base_hp_diff"] == 88.0
    assert metrics["official_avg_team_damage"] == 1666.0


def test_swiss_sort_prefers_fewer_losses_before_fallback_seed() -> None:
    region_core = service.region_sim.region_core
    stronger_record = SimpleNamespace(
        team_key="two-zero",
        swiss_status="active",
        swiss_wins=2,
        swiss_losses=0,
        swiss_qualified_round=None,
        official_opponent_points=4.0,
        official_avg_base_hp_diff=0.0,
        official_avg_team_damage=0.0,
        swiss_game_diff=2,
        swiss_opponents=[],
        mu0=1500.0,
        seed_rank_in_region=8,
    )
    weaker_record = SimpleNamespace(
        team_key="two-one",
        swiss_status="active",
        swiss_wins=2,
        swiss_losses=1,
        swiss_qualified_round=None,
        official_opponent_points=4.0,
        official_avg_base_hp_diff=0.0,
        official_avg_team_damage=0.0,
        swiss_game_diff=2,
        swiss_opponents=[],
        mu0=1500.0,
        seed_rank_in_region=1,
    )

    ranked = sorted(
        [weaker_record, stronger_record],
        key=lambda team: region_core.swiss_sort_key(team, {team.team_key: team for team in [stronger_record, weaker_record]}),
        reverse=True,
    )

    assert [team.team_key for team in ranked] == ["two-zero", "two-one"]


def test_simulate_swiss_group_can_start_from_official_current_records() -> None:
    region_core = service.region_sim.region_core

    def team(index: int) -> object:
        slot = f"A{index}"
        return region_core.RegionTeam(
            team_key=f"college-{index}::team",
            college_name=f"College {index}",
            team_name="team",
            admitted_region="南部赛区",
            seed_tier="unseeded",
            seed_rank_in_region=index,
            ranking_global_rank=index,
            shape_rank=index,
            mu0=1500.0 + index,
            sigma0=40.0,
            z_25game=0.0,
            z_robot25_raw=0.0,
            z_26rmul=0.0,
            z_form=0.0,
            tilde_z_hist=0.0,
            n_matches_2025_rmuc=0,
            n_matches_2026_rmul=0,
            robot_stage_reliability=0.0,
            simulation_mu=1500.0 + index,
            match_sigma=16.0,
            slot=slot,
            group_name="A",
        )

    teams = [team(index) for index in range(1, 17)]
    metrics = {
        team.team_key: {
            "wins": 1.0 if index <= 8 else 0.0,
            "losses": 0.0 if index <= 8 else 1.0,
            "official_opponent_points": 0.0,
            "ranking_metric_source": "official_live",
        }
        for index, team in enumerate(teams, start=1)
    }
    region_core.apply_official_swiss_ranking_metrics(teams, metrics, seed_current_state=True)

    def payload_builder(*args, **kwargs):
        return {
            "p_game_base_red": 1.0,
            "p_game_adj_red": 1.0,
            "p_series_red": 1.0,
            "p_series_blue": 0.0,
            "scoreline_distribution": {"2:0": 1.0},
            "head_to_head_summary": {"delta_h2h": 0.0},
            "confidence_label": "test",
        }

    _ranked, match_rows = region_core.simulate_swiss_group(
        "A",
        teams,
        rng=random.Random(20260414),
        head_to_head_index={},
        samples=1,
        payload_builder=payload_builder,
        use_csv_rank_pairings=True,
    )

    assert match_rows[0]["match_label"].startswith("A-SWISS-2-")
    assert len(match_rows) == 25


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


def test_normalize_schedule_payload_infers_official_post_group_labels() -> None:
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
                                        "slug": "半决赛",
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
                                        "slug": "全国赛名额争夺",
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
                                        "slug": "复活赛名额争夺",
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
                                        "slug": "冠军争夺战",
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
    assert (matches["N83"]["stage"], matches["N83"]["matchLabel"]) == ("semifinal", "SF-1")
    assert matches["N83"]["stageSlug"] == "半决赛"
    assert (matches["N85"]["stage"], matches["N85"]["matchLabel"]) == ("qualification_round2", "QUAL-2-1")
    assert (matches["N87"]["stage"], matches["N87"]["matchLabel"]) == ("qualification_round2", "QUAL-R-1")
    assert (matches["N90"]["stage"], matches["N90"]["matchLabel"]) == ("final", "FINAL-1")


def test_normalize_schedule_payload_aligns_south_final_day_with_official_slug() -> None:
    payload = _schedule_payload()
    zone = payload["data"]["event"]["zones"]["nodes"][0]
    zone["groupMatches"]["nodes"] = []
    zone["knockoutMatches"]["nodes"] = [
        {
            "id": official_id,
            "matchType": "KNOCKOUT",
            "orderNumber": order_number,
            "slug": slug,
            "planGameCount": 3,
            "planStartedAt": planned_start_at,
            "status": "PENDING",
            "result": "",
            "redSideWinGameCount": 0,
            "blueSideWinGameCount": 0,
            "redSide": {"fillSourceType": "Match", "fillSourceId": "source-red", "fillSourceNumber": 1, "player": None},
            "blueSide": {"fillSourceType": "Match", "fillSourceId": "source-blue", "fillSourceNumber": 1, "player": None},
        }
        for official_id, order_number, slug, planned_start_at in [
            ("S83", 83, "半决赛", "2026-05-17T02:50:00Z"),
            ("S84", 84, "半决赛", "2026-05-17T03:25:00Z"),
            ("S85", 85, "全国赛名额争夺", "2026-05-17T05:00:00Z"),
            ("S86", 86, "全国赛名额争夺", "2026-05-17T05:35:00Z"),
        ]
    ]

    normalized = rmuc_live.normalize_schedule_payload(
        payload,
        fetched_at=datetime(2026, 5, 10, tzinfo=UTC),
        source_headers={},
    )

    matches = {match["officialMatchId"]: match for match in normalized["regions"]["south_region"]["matches"]}
    assert (matches["S83"]["stage"], matches["S83"]["matchLabel"]) == ("semifinal", "SF-1")
    assert (matches["S84"]["stage"], matches["S84"]["matchLabel"]) == ("semifinal", "SF-2")
    assert (matches["S85"]["stage"], matches["S85"]["matchLabel"]) == ("qualification_round2", "QUAL-2-1")
    assert (matches["S86"]["stage"], matches["S86"]["matchLabel"]) == ("qualification_round2", "QUAL-2-2")


def test_regional_match_numbers_match_official_post_group_order() -> None:
    assert service._regional_match_number_from_label("SF-1", "south_region") == 83
    assert service._regional_match_number_from_label("SF-2", "south_region") == 84
    assert service._regional_match_number_from_label("QUAL-2-1", "south_region") == 85
    assert service._regional_match_number_from_label("QUAL-2-2", "south_region") == 86
    assert service._regional_match_number_from_label("SF-1", "north_region") == 83
    assert service._regional_match_number_from_label("QUAL-2-1", "north_region") == 85
    assert service._regional_match_number_from_label("QUAL-R-1", "north_region") == 87
    assert service._regional_match_number_from_label("THIRD-1", "north_region") == 89
    assert service._regional_match_number_from_label("FINAL-1", "north_region") == 90


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
        stage_family = _stage_family(match["stage"])
        stage = match["stage"]
        match_label = match["matchLabel"]
        if stage_family == "post_group":
            stage = rmuc_live._post_group_stage_from_order_number(index, "south_region") or stage
            match_label = (
                rmuc_live._post_group_match_label_from_order_number(index, stage=stage, region_slug="south_region")
                or match_label
            )
        matches.append(
            {
                "officialMatchId": f"MOCK-SOUTH-{index:03d}",
                "matchId": f"2026RMUC:MOCK-SOUTH-{index:03d}",
                "regionSlug": "south_region",
                "regionName": "南部赛区",
                "zoneName": "南部赛区",
                "stageFamily": stage_family,
                "stage": stage,
                "matchLabel": match_label,
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


def test_live_payload_builder_uses_deterministic_elo_favorite_for_pending_prediction_without_real_result() -> None:
    red_team_key = "red-school::main"
    blue_team_key = "blue-school::main"
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
        SimpleNamespace(
            team_key=red_team_key,
            college_name="红方大学",
            team_name="Main",
            mu0=1700.0,
            sigma0=40.0,
            beta_perf=0.5,
        ),
        SimpleNamespace(
            team_key=blue_team_key,
            college_name="蓝方大学",
            team_name="Main",
            mu0=1600.0,
            sigma0=40.0,
            beta_perf=0.5,
        ),
        best_of=3,
        samples=8,
        match_seed=1,
        head_to_head_index={},
        stage="swiss",
        round_number=1,
        match_label="",
    )

    assert payload["p_series_red"] > 0.5
    assert payload["p_series_blue"] < 0.5
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
    assert matches["SF-1"]["regionalMatchNumber"] == 83
    assert matches["SF-2"].get("officialStatus") is None


def test_live_mode_confirms_qualification_round2_from_its_own_round1_sources(tmp_path, monkeypatch) -> None:
    payload = _live_payload_from_mock(tmp_path, monkeypatch, completed_count=81)

    live_status = payload["meta"]["liveStatus"]
    assert live_status["completedOfficialMatches"] == 81
    assert live_status["confirmedOfficialMatches"] == 85
    matches = {match["matchLabel"]: match for match in payload["matches"]}
    assert matches["QUAL-2-1"]["regionalMatchNumber"] == 85
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
