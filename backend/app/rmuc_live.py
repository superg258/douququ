from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import Request, urlopen

from .competition import (
    SWISS_TOTAL_MATCHES,
    normalize_match_outcome,
    normalize_match_result,
    normalize_match_status,
    swiss_group_from_match_number,
    swiss_match_label,
    swiss_round_from_match_number,
    validate_distinct_matchup,
)
from .team_identity import resolve_team_identity

UPSTREAM_LIVE_URLS = {
    "schedule": "https://pro-robomasters-hz-n5i3.oss-cn-hangzhou.aliyuncs.com/live_json/schedule.json",
    "group_rank_info": "https://pro-robomasters-hz-n5i3.oss-cn-hangzhou.aliyuncs.com/live_json/group_rank_info.json",
    "robot_data": "https://pro-robomasters-hz-n5i3.oss-cn-hangzhou.aliyuncs.com/live_json/robot_data.json",
}
REGION_NAME_TO_SLUG = {
    "南部赛区": "south_region",
    "中部赛区": "south_region",
    "东部赛区": "east_region",
    "北部赛区": "north_region",
}
REGION_SLUG_TO_NAME = {
    "south_region": "南部赛区",
    "east_region": "东部赛区",
    "north_region": "北部赛区",
}
MP_MATCH_URL = "https://mp.robomaster.com/api/v1/match?matchID={match_id}"
POST_GROUP_SOURCE_LABELS = {
    "QF-1": ("R16-1", "R16-2"),
    "QF-2": ("R16-4", "R16-3"),
    "QF-3": ("R16-5", "R16-6"),
    "QF-4": ("R16-8", "R16-7"),
    "QUAL-1-1": ("R16-1", "R16-2"),
    "QUAL-1-2": ("R16-4", "R16-3"),
    "QUAL-1-3": ("R16-5", "R16-6"),
    "QUAL-1-4": ("R16-8", "R16-7"),
    "QUAL-2-1": ("QUAL-1-1", "QUAL-1-3"),
    "QUAL-2-2": ("QUAL-1-2", "QUAL-1-4"),
    "QUAL-R-1": ("QUAL-1-1", "QUAL-1-3"),
    "QUAL-R-2": ("QUAL-1-2", "QUAL-1-4"),
    "SF-1": ("QF-1", "QF-3"),
    "SF-2": ("QF-2", "QF-4"),
    "THIRD-1": ("SF-1", "SF-2"),
    "FINAL-1": ("SF-1", "SF-2"),
}


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _season_from_title(title: str) -> int | None:
    match = re.search(r"(20\d{2})", title)
    return int(match.group(1)) if match else None


def _is_rmuc_title(title: str) -> bool:
    return "RMUC" in title or "超级对抗赛" in title


def _nodes(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        nodes = value.get("nodes", [])
        return nodes if isinstance(nodes, list) else []
    return []


def _player_team(player: dict[str, Any] | None) -> dict[str, str] | None:
    if not isinstance(player, dict):
        return None
    team = player.get("team")
    if not isinstance(team, dict):
        return None
    college_name = str(team.get("collegeName") or "").strip()
    team_name = str(team.get("name") or "").strip()
    if not college_name or not team_name:
        return None
    identity = resolve_team_identity(college_name, team_name)
    return {
        "collegeName": str(identity["collegeName"]),
        "teamName": str(identity["teamName"]),
        "slot": str(player.get("name") or "").strip(),
        "schoolKey": str(identity["schoolKey"]),
        "teamKey": str(identity["teamKey"]),
    }


def _player_slot(player: dict[str, Any] | None) -> str:
    if not isinstance(player, dict):
        return ""
    return str(player.get("name") or "").strip()


def _side_payload(match: dict[str, Any], side: str) -> dict[str, Any] | None:
    side_payload = match.get(f"{side}Side")
    if not isinstance(side_payload, dict):
        return None
    return side_payload


def _side_team(match: dict[str, Any], side: str) -> dict[str, str] | None:
    side_payload = _side_payload(match, side)
    if side_payload is None:
        return None
    return _player_team(side_payload.get("player"))


def _side_slot(match: dict[str, Any], side: str) -> str:
    side_payload = _side_payload(match, side)
    if side_payload is None:
        return ""
    return _player_slot(side_payload.get("player"))


def _side_source(match: dict[str, Any], side: str) -> dict[str, Any]:
    side_payload = _side_payload(match, side)
    if side_payload is None:
        return {}
    out: dict[str, Any] = {}
    fill_source_type = str(side_payload.get("fillSourceType") or "").strip()
    fill_source_id = str(side_payload.get("fillSourceId") or "").strip()
    fill_source_number = _optional_int(side_payload.get("fillSourceNumber"))
    fill_status = str(side_payload.get("fillStatus") or "").strip()
    if fill_source_type:
        out[f"{side}FillSourceType"] = fill_source_type
    if fill_source_id:
        out[f"{side}FillSourceId"] = fill_source_id
    if fill_source_number is not None:
        out[f"{side}FillSourceNumber"] = fill_source_number
    if fill_status:
        out[f"{side}FillStatus"] = fill_status
    return out


def _side_has_schedule_source(match: dict[str, Any], side: str) -> bool:
    return bool(_side_slot(match, side) or _side_source(match, side))


def _scoreline(match: dict[str, Any]) -> str:
    red_wins = int(match.get("redSideWinGameCount") or 0)
    blue_wins = int(match.get("blueSideWinGameCount") or 0)
    return f"{red_wins}:{blue_wins}"


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _rank_items(row: Any) -> dict[str, Any]:
    if not isinstance(row, list):
        return {}
    out: dict[str, Any] = {}
    for item in row:
        if not isinstance(item, dict):
            continue
        name = str(item.get("itemName") or "").strip()
        if name:
            out[name] = item.get("itemValue")
    return out


def _rank_team_slot(team_name: str) -> str:
    value = str(team_name or "").strip().upper()
    if re.fullmatch(r"[AB]\d{1,2}", value):
        return value
    return ""


def _metric_value(items: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = _optional_float(items.get(name))
        if value is not None:
            return value
    return None


def _win_draw_loss_metrics(value: Any) -> dict[str, float | None]:
    if value is None:
        return {"wins": None, "draws": None, "losses": None}
    parts = re.findall(r"-?\d+(?:\.\d+)?", str(value))
    if len(parts) < 3:
        return {"wins": None, "draws": None, "losses": None}
    return {
        "wins": float(parts[0]),
        "draws": float(parts[1]),
        "losses": float(parts[2]),
    }


def _group_rank_metric_record(items: dict[str, Any], group_name: str, *, slot: str = "") -> dict[str, Any]:
    wdl_metrics = _win_draw_loss_metrics(items.get("胜/平/负"))
    source_opponent_points = _metric_value(items, "对手分")
    record = {
        "group_name": group_name,
        "slot": slot,
        "group_rank": _metric_value(items, "排名"),
        "wins": _metric_value(items, "胜场数", "胜") if wdl_metrics["wins"] is None else wdl_metrics["wins"],
        "draws": _metric_value(items, "平") if wdl_metrics["draws"] is None else wdl_metrics["draws"],
        "losses": _metric_value(items, "负场数", "负") if wdl_metrics["losses"] is None else wdl_metrics["losses"],
        "score_points": _metric_value(items, "积分"),
        "official_opponent_points": source_opponent_points,
        "source_reported_opponent_points": source_opponent_points,
        "official_total_victory_points_diff": _metric_value(items, "总净胜胜利点"),
        "official_total_team_damage": _metric_value(items, "全队总伤害血量"),
        "official_total_robot_remaining_hp": _metric_value(items, "全队机器人总剩余血量"),
        "official_avg_base_hp_diff": _metric_value(
            items,
            "时均总基地净胜血量",
            "局均总基地净胜血量",
            "平均总基地净胜血量",
            "平均基地净胜血量",
        ),
        "official_avg_team_damage": _metric_value(
            items,
            "时均全队总伤害血量",
            "局均全队总伤害血量",
            "平均全队总伤害血量",
            "全队总伤害血量",
        ),
        "ranking_metric_source": "official_live",
        "ranking_completeness": "official_rank_snapshot",
    }
    return record


def _normalize_group_rank_metric_buckets(
    payload: dict[str, Any] | None,
) -> dict[str, dict[str, dict[str, dict[str, Any]]]]:
    if not isinstance(payload, dict):
        return {}
    regions: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
    zones = payload.get("zones", [])
    if not isinstance(zones, list):
        return regions
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        zone_name = str(zone.get("zoneName") or zone.get("name") or "").strip()
        region_slug = REGION_NAME_TO_SLUG.get(zone_name)
        if region_slug is None:
            continue
        region_metrics = regions.setdefault(region_slug, {"teams": {}, "slots": {}})
        groups = zone.get("groups", [])
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            raw_group_name = str(group.get("groupName") or group.get("name") or "").strip()
            group_name = raw_group_name[:1]
            players = group.get("groupPlayers", [])
            if not isinstance(players, list):
                continue
            for player_row in players:
                items = _rank_items(player_row)
                team = items.get("战队")
                if not isinstance(team, dict):
                    continue
                college_name = str(team.get("collegeName") or "").strip()
                team_name = str(team.get("teamName") or team.get("name") or "").strip()
                if not team_name:
                    continue
                slot = _rank_team_slot(team_name)
                record = _group_rank_metric_record(items, group_name, slot=slot)
                if college_name:
                    team_key = str(resolve_team_identity(college_name, team_name)["teamKey"])
                    region_metrics["teams"][team_key] = record
                elif slot:
                    region_metrics["slots"][slot] = record
    return regions


def _computed_swiss_opponent_points(matches: list[dict[str, Any]]) -> dict[str, float]:
    stats: dict[str, dict[str, int]] = {}
    opponents: dict[str, list[str]] = {}

    def ensure(team_key: str) -> None:
        stats.setdefault(team_key, {"game_wins": 0, "game_losses": 0})
        opponents.setdefault(team_key, [])

    for match in matches:
        if str(match.get("stage") or "") != "swiss" or not match.get("isCompleted"):
            continue
        red_key = str(match.get("redTeamKey") or "")
        blue_key = str(match.get("blueTeamKey") or "")
        if not red_key or not blue_key:
            continue
        red_wins = int(match.get("redWins") or 0)
        blue_wins = int(match.get("blueWins") or 0)
        ensure(red_key)
        ensure(blue_key)
        stats[red_key]["game_wins"] += red_wins
        stats[red_key]["game_losses"] += blue_wins
        stats[blue_key]["game_wins"] += blue_wins
        stats[blue_key]["game_losses"] += red_wins
        opponents[red_key].append(blue_key)
        opponents[blue_key].append(red_key)

    return {
        team_key: float(
            sum(
                stats[opponent_key]["game_wins"] - stats[opponent_key]["game_losses"]
                for opponent_key in opponent_keys
            )
        )
        for team_key, opponent_keys in opponents.items()
    }


def _has_locked_official_post_group_schedule(matches: list[dict[str, Any]]) -> bool:
    return any(
        str(match.get("stageFamily") or "") == "post_group" and bool(match.get("isConfirmedMatchup"))
        for match in matches
    )


def _stage_family(match: dict[str, Any], zone_name: str) -> str:
    match_type = str(match.get("matchType") or "").upper()
    if "复活" in zone_name:
        return "repechage"
    if "全国" in zone_name:
        return "nationals"
    if match_type == "GROUP":
        return "regional_group"
    return "post_group"


def _stage_from_family(stage_family: str) -> str:
    if stage_family == "regional_group":
        return "swiss"
    if stage_family == "post_group":
        return "round_of_16"
    return stage_family


def _slot_group_name(*slots: Any) -> str:
    groups = {str(slot or "").strip()[:1] for slot in slots if str(slot or "").strip()}
    groups.discard("")
    if len(groups) == 1:
        return next(iter(groups))
    return ""


def _post_group_normalized_order_number(order_number: int | None) -> int | None:
    if order_number is None:
        return None
    if order_number >= 67:
        return order_number - 66
    return order_number if order_number > 0 else None


def _post_group_stage_from_slug(stage_slug: Any, normalized_order: int | None) -> str | None:
    text = str(stage_slug or "").strip()
    if not text:
        return None
    if "16进8" in text:
        return "round_of_16"
    if "8进4" in text:
        return "quarterfinal"
    if "半决赛" in text:
        return "semifinal"
    if "季军" in text:
        return "third_place"
    if "冠军" in text:
        return "final"
    if "全国赛名额争夺" in text or "复活赛名额争夺" in text:
        if normalized_order is not None and normalized_order >= 19:
            return "qualification_round2"
        return "qualification_round1"
    return None


def _post_group_stage_from_order_number(
    order_number: int | None,
    region_slug: str | None = None,
    stage_slug: Any = None,
) -> str | None:
    normalized_order = _post_group_normalized_order_number(order_number)
    if normalized_order is None:
        return None
    slug_stage = _post_group_stage_from_slug(stage_slug, normalized_order)
    if slug_stage is not None:
        return slug_stage
    if 1 <= normalized_order <= 8:
        return "round_of_16"
    if 9 <= normalized_order <= 12:
        return "quarterfinal"
    if 13 <= normalized_order <= 16:
        return "qualification_round1"
    if 17 <= normalized_order <= 18:
        return "semifinal"
    if 19 <= normalized_order <= 20:
        return "qualification_round2"
    if region_slug == "north_region":
        if 21 <= normalized_order <= 22:
            return "qualification_round2"
        if normalized_order == 23:
            return "third_place"
        if normalized_order == 24:
            return "final"
        return None
    if normalized_order == 21:
        return "third_place"
    if normalized_order == 22:
        return "final"
    if normalized_order == 23:
        return "third_place"
    if normalized_order == 24:
        return "final"
    return None


def _live_match_stage(match: dict[str, Any]) -> str:
    stage = str(match.get("stage") or "").strip()
    if str(match.get("stageFamily") or "") == "post_group":
        return _post_group_stage_from_order_number(
            _optional_int(match.get("orderNumber")),
            str(match.get("regionSlug") or ""),
            match.get("stageSlug"),
        ) or stage
    return stage


def _post_group_match_label_from_order_number(
    order_number: int | None,
    *,
    stage: str,
    region_slug: str,
) -> str | None:
    normalized_order = _post_group_normalized_order_number(order_number)
    if normalized_order is None:
        return None
    if stage == "round_of_16" and 1 <= normalized_order <= 8:
        return f"R16-{normalized_order}"
    if stage == "quarterfinal" and 9 <= normalized_order <= 12:
        return f"QF-{normalized_order - 8}"
    if stage == "qualification_round1" and 13 <= normalized_order <= 16:
        return f"QUAL-1-{normalized_order - 12}"
    if stage == "qualification_round2":
        if region_slug == "north_region" and 21 <= normalized_order <= 22:
            return f"QUAL-R-{normalized_order - 20}"
        if 19 <= normalized_order <= 20:
            return f"QUAL-2-{normalized_order - 18}"
        if 17 <= normalized_order <= 18:
            return f"QUAL-2-{normalized_order - 16}"
    if stage == "semifinal":
        index = normalized_order - 16
        if 1 <= index <= 2:
            return f"SF-{index}"
    if stage == "third_place":
        return "THIRD-1"
    if stage == "final":
        return "FINAL-1"
    return None


def _live_match_label(match: dict[str, Any]) -> str:
    stage = _live_match_stage(match)
    if str(match.get("stageFamily") or "") == "post_group":
        # The live source order is the authority once official data exists.
        # Rule-table/mock labels are useful as a plan, but must not override
        # a changed official knockout/qualification order.
        return _post_group_match_label_from_order_number(
            _optional_int(match.get("orderNumber")),
            stage=stage,
            region_slug=str(match.get("regionSlug") or ""),
        ) or ""
    match_label = str(match.get("matchLabel") or "").strip()
    if match_label:
        return match_label
    if stage == "swiss":
        return ""
    return _post_group_match_label_from_order_number(
        _optional_int(match.get("orderNumber")),
        stage=stage,
        region_slug=str(match.get("regionSlug") or ""),
    ) or ""


def _live_match_round_number(match: dict[str, Any]) -> int | None:
    round_number = _optional_int(match.get("roundNumber"))
    if round_number is not None:
        return round_number
    if _live_match_stage(match) == "swiss":
        return swiss_round_from_match_number(_optional_int(match.get("orderNumber")))
    return 1


def _live_match_group_name(match: dict[str, Any]) -> str:
    group_name = str(match.get("groupName") or "").strip()
    if group_name:
        return group_name[:1]
    if match.get("matchLabel"):
        return str(match["matchLabel"]).split("-", maxsplit=1)[0][:1]
    return _slot_group_name(match.get("redSlot"), match.get("blueSlot"))


def _completed_stage_matches(
    matches: list[dict[str, Any]],
    *,
    stage: str,
    expected_count: int,
) -> bool:
    stage_matches = [match for match in matches if _live_match_stage(match) == stage]
    return len(stage_matches) >= expected_count and all(bool(match.get("isCompleted")) for match in stage_matches)


def _completed_post_group_match_labels(matches: list[dict[str, Any]]) -> set[str]:
    completed: set[str] = set()
    for match in matches:
        if not match.get("isCompleted"):
            continue
        if _live_match_stage(match) == "swiss":
            continue
        match_label = _live_match_label(match)
        if match_label:
            completed.add(match_label)
    return completed


def _post_group_sources_complete(match: dict[str, Any], matches: list[dict[str, Any]]) -> bool:
    match_label = _live_match_label(match)
    source_labels = POST_GROUP_SOURCE_LABELS.get(match_label)
    if not source_labels:
        return False
    completed_labels = _completed_post_group_match_labels(matches)
    return all(source_label in completed_labels for source_label in source_labels)


def _swiss_completed_records(matches: list[dict[str, Any]], group_name: str) -> dict[str, tuple[int, int, int]]:
    records: dict[str, list[int]] = {}
    for match in matches:
        if _live_match_stage(match) != "swiss" or _live_match_group_name(match) != group_name or not match.get("isCompleted"):
            continue
        red_key = str(match.get("redTeamKey") or "")
        blue_key = str(match.get("blueTeamKey") or "")
        if not red_key or not blue_key:
            continue
        red_wins = int(match.get("redWins") or 0)
        blue_wins = int(match.get("blueWins") or 0)
        records.setdefault(red_key, [0, 0, 0])
        records.setdefault(blue_key, [0, 0, 0])
        records[red_key][2] += 1
        records[blue_key][2] += 1
        if red_wins > blue_wins:
            records[red_key][0] += 1
            records[blue_key][1] += 1
        elif blue_wins > red_wins:
            records[blue_key][0] += 1
            records[red_key][1] += 1
    return {team_key: (wins, losses, played) for team_key, (wins, losses, played) in records.items()}


def _pending_swiss_match_can_feed_record(
    match: dict[str, Any],
    records: dict[str, tuple[int, int, int]],
    *,
    target_wins: int,
    target_losses: int,
    target_played: int,
) -> bool:
    for side in ("redTeamKey", "blueTeamKey"):
        team_key = str(match.get(side) or "")
        wins, losses, played = records.get(team_key, (0, 0, 0))
        if played + 1 != target_played:
            continue
        if (wins + 1, losses) == (target_wins, target_losses):
            return True
        if (wins, losses + 1) == (target_wins, target_losses):
            return True
    return False


def _swiss_rank_source_ready(match: dict[str, Any], matches: list[dict[str, Any]]) -> bool:
    round_number = _live_match_round_number(match)
    if round_number is None:
        return False
    if round_number <= 1:
        return True
    group_name = _live_match_group_name(match)
    if not group_name:
        return False

    red_key = str(match.get("redTeamKey") or "")
    blue_key = str(match.get("blueTeamKey") or "")
    if not red_key or not blue_key:
        return False

    records = _swiss_completed_records(matches, group_name)
    red_record = records.get(red_key)
    blue_record = records.get(blue_key)
    if red_record is None or blue_record is None:
        return False
    if red_record != blue_record:
        return False
    target_wins, target_losses, target_played = red_record
    if target_played != round_number - 1:
        return False
    if target_wins >= 3 or target_losses >= 3:
        return False

    pending_sources = [
        candidate
        for candidate in matches
        if _live_match_stage(candidate) == "swiss"
        and _live_match_group_name(candidate) == group_name
        and not candidate.get("isCompleted")
        and (_live_match_round_number(candidate) or 0) < round_number
    ]
    return not any(
        _pending_swiss_match_can_feed_record(
            candidate,
            records,
            target_wins=target_wins,
            target_losses=target_losses,
            target_played=target_played,
        )
        for candidate in pending_sources
    )


def _live_match_dependency_ready(match: dict[str, Any], matches: list[dict[str, Any]]) -> bool:
    stage = _live_match_stage(match)
    if stage == "swiss":
        return _swiss_rank_source_ready(match, matches)
    if stage == "round_of_16":
        return _completed_stage_matches(matches, stage="swiss", expected_count=SWISS_TOTAL_MATCHES)
    if stage in {"quarterfinal", "qualification_round1", "qualification_round2", "semifinal", "third_place", "final"}:
        return _post_group_sources_complete(match, matches)
    return False


def _live_match_can_lock(match: dict[str, Any], matches: list[dict[str, Any]]) -> bool:
    if match.get("isCompleted"):
        return True
    if match.get("hasLiveScoreline"):
        return True
    return bool(match.get("isConfirmedMatchup")) and _live_match_dependency_ready(match, matches)


def _normalize_match(match: dict[str, Any], *, region_slug: str, zone_name: str) -> dict[str, Any] | None:
    red = _side_team(match, "red")
    blue = _side_team(match, "blue")
    official_match_id = str(match.get("id") or "").strip()
    if not official_match_id:
        return None
    red_slot = red["slot"] if red is not None else _side_slot(match, "red")
    blue_slot = blue["slot"] if blue is not None else _side_slot(match, "blue")
    if red is None and blue is None and not (
        red_slot or blue_slot or _side_has_schedule_source(match, "red") or _side_has_schedule_source(match, "blue")
    ):
        return None
    is_confirmed_matchup = red is not None and blue is not None
    validate_distinct_matchup(
        is_confirmed=is_confirmed_matchup,
        red_identity=red["teamKey"] if red is not None else None,
        blue_identity=blue["teamKey"] if blue is not None else None,
        context=f"Regional match {official_match_id}",
    )
    scoreline = _scoreline(match)
    best_of = int(match.get("planGameCount") or 3)
    source_status = normalize_match_status(match.get("status"))
    source_result = normalize_match_result(match.get("result"))
    outcome = normalize_match_outcome(
        status=source_status if is_confirmed_matchup else "",
        result=source_result if is_confirmed_matchup else "",
        scoreline=scoreline,
        best_of=best_of,
        is_confirmed=is_confirmed_matchup,
        context=f"regional match {official_match_id}",
    )
    if outcome.score is None:
        raise ValueError(f"Regional match {official_match_id} has no scoreline")
    score = outcome.score
    red_wins = score.red_wins
    blue_wins = score.blue_wins
    stage_family = _stage_family(match, zone_name)
    order_number = int(match.get("orderNumber") or 0)
    stage = _stage_from_family(stage_family)
    group_name = ""
    round_number: int | None = None
    match_label = ""
    if stage == "swiss":
        group_name = _slot_group_name(red_slot, blue_slot) or swiss_group_from_match_number(order_number)
        round_number = swiss_round_from_match_number(order_number)
        match_label = swiss_match_label(order_number, group_name)
    elif stage_family == "post_group":
        stage = _post_group_stage_from_order_number(order_number, region_slug, match.get("slug")) or stage
        round_number = 1
        match_label = _post_group_match_label_from_order_number(order_number, stage=stage, region_slug=region_slug)
    planned_start_at = str(match.get("planStartedAt") or "").strip() or None
    match_date = planned_start_at[:10] if planned_start_at else None
    normalized_match = {
        "officialMatchId": official_match_id,
        "matchId": f"2026RMUC:{official_match_id}",
        "regionSlug": region_slug,
        "regionName": REGION_SLUG_TO_NAME.get(region_slug, zone_name),
        "zoneName": zone_name,
        "stageFamily": stage_family,
        "stageSlug": str(match.get("slug") or "").strip() or None,
        "stage": stage,
        "matchType": str(match.get("matchType") or ""),
        "orderNumber": order_number,
        "roundNumber": round_number,
        "groupName": group_name,
        "bestOf": best_of,
        "plannedStartAt": planned_start_at,
        "matchDate": match_date,
        "officialStatus": source_status,
        "result": source_result,
        "scoreline": scoreline,
        "isCompleted": outcome.is_completed,
        "hasLiveScoreline": outcome.has_live_scoreline,
        "isConfirmedMatchup": is_confirmed_matchup,
        "redSlot": red_slot,
        "blueSlot": blue_slot,
        "redWins": red_wins,
        "blueWins": blue_wins,
    }
    if red is not None:
        normalized_match.update(
            {
                "redSchoolKey": red["schoolKey"],
                "redTeamKey": red["teamKey"],
                "redCollegeName": red["collegeName"],
                "redTeamName": red["teamName"],
            }
        )
    else:
        normalized_match.update(_side_source(match, "red"))
    if blue is not None:
        normalized_match.update(
            {
                "blueSchoolKey": blue["schoolKey"],
                "blueTeamKey": blue["teamKey"],
                "blueCollegeName": blue["collegeName"],
                "blueTeamName": blue["teamName"],
            }
        )
    else:
        normalized_match.update(_side_source(match, "blue"))
    if match_label:
        normalized_match["matchLabel"] = match_label
    return normalized_match


def _collect_slot_assignments(zone: dict[str, Any]) -> dict[str, str]:
    assignments: dict[str, str] = {}
    for group in _nodes(zone.get("groups")):
        for player in _nodes(group.get("players")):
            team = _player_team(player)
            if team and team["slot"]:
                assignments[team["teamKey"]] = team["slot"]
    for bucket in ("groupMatches", "knockoutMatches"):
        for match in _nodes(zone.get(bucket)):
            for side in ("red", "blue"):
                team = _side_team(match, side)
                if team and team["slot"]:
                    assignments.setdefault(team["teamKey"], team["slot"])
    return assignments


def normalize_schedule_payload(
    payload: dict[str, Any],
    *,
    fetched_at: datetime | None = None,
    source_headers: dict[str, str] | None = None,
    group_rank_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fetched_at = fetched_at or datetime.now(tz=UTC)
    source_headers = source_headers or {}
    event = payload.get("data", {}).get("event", {})
    title = str(event.get("title") or "")
    season = _season_from_title(title)
    base = {
        "schemaVersion": "rmuc-regionals-live-v1",
        "sourceStatus": "inactive",
        "sourceKind": "official",
        "isSynthetic": False,
        "reason": None,
        "eventTitle": title,
        "season": season,
        "fetchedAt": fetched_at.isoformat(),
        "sourceUpdatedAt": source_headers.get("last-modified") or source_headers.get("Last-Modified"),
        "etag": source_headers.get("etag") or source_headers.get("ETag"),
        "regions": {},
    }
    if not _is_rmuc_title(title):
        base["reason"] = "当前官方 live_json 不是 RMUC 超级对抗赛"
        return base

    group_rank_metric_buckets = _normalize_group_rank_metric_buckets(group_rank_payload)
    regions: dict[str, Any] = {}
    for zone in _nodes(event.get("zones")):
        zone_name = str(zone.get("name") or "").strip()
        region_slug = REGION_NAME_TO_SLUG.get(zone_name)
        if region_slug is None:
            continue
        matches: list[dict[str, Any]] = []
        for bucket in ("groupMatches", "knockoutMatches"):
            for match in _nodes(zone.get(bucket)):
                normalized_match = _normalize_match(match, region_slug=region_slug, zone_name=zone_name)
                if normalized_match is not None:
                    matches.append(normalized_match)
        official_match_ids = [str(match["officialMatchId"]) for match in matches]
        order_numbers = [int(match["orderNumber"]) for match in matches]
        if len(official_match_ids) != len(set(official_match_ids)):
            raise ValueError(f"Duplicate officialMatchId in {region_slug}")
        if len(order_numbers) != len(set(order_numbers)):
            raise ValueError(f"Duplicate orderNumber in {region_slug}")
        stage_family_order = {"regional_group": 0, "post_group": 1, "repechage": 2, "nationals": 3}
        matches.sort(
            key=lambda row: (
                stage_family_order.get(str(row["stageFamily"]), 99),
                row["orderNumber"],
                row["officialMatchId"],
            )
        )
        locked_post_group_schedule = _has_locked_official_post_group_schedule(matches)
        slot_assignments = _collect_slot_assignments(zone)
        metric_bucket = group_rank_metric_buckets.get(region_slug, {})
        region_group_rank_metrics = dict(metric_bucket.get("teams", {}))
        team_key_by_slot = {slot: team_key for team_key, slot in slot_assignments.items()}
        for slot, metrics in metric_bucket.get("slots", {}).items():
            team_key = team_key_by_slot.get(slot)
            if team_key:
                region_group_rank_metrics.setdefault(team_key, dict(metrics))
        for team_key, opponent_points in _computed_swiss_opponent_points(matches).items():
            metrics = region_group_rank_metrics.setdefault(
                team_key,
                {
                    "group_name": str(slot_assignments.get(team_key) or "")[:1],
                    "ranking_metric_source": "official_live",
                },
            )
            reported_opponent_points = _optional_float(metrics.get("source_reported_opponent_points"))
            if locked_post_group_schedule and reported_opponent_points is not None:
                metrics["official_opponent_points"] = reported_opponent_points
                metrics.setdefault("ranking_completeness", "official_rank_snapshot")
                continue
            metrics["official_opponent_points"] = opponent_points
            metrics["ranking_metric_source"] = "official_live"
            metrics["ranking_completeness"] = "official_schedule_replay"
        regions[region_slug] = {
            "zoneId": str(zone.get("id") or ""),
            "zoneName": zone_name,
            "regionSlug": region_slug,
            "regionName": REGION_SLUG_TO_NAME[region_slug],
            "slotAssignments": slot_assignments,
            "groupRankMetrics": region_group_rank_metrics,
            "matches": matches,
        }

    if not regions:
        base["reason"] = "官方 RMUC 赛程未包含已配置赛区"
        return base
    base["sourceStatus"] = "active"
    base["regions"] = regions
    return base


def validate_normalized_schedule_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate the persisted regional runtime before any API consumes it."""
    if not isinstance(payload, dict):
        raise ValueError("Regional runtime payload must be an object")
    source_status = str(payload.get("sourceStatus") or "inactive").strip().lower()
    if source_status not in {"active", "inactive", "missing"}:
        raise ValueError("Regional runtime sourceStatus is invalid")
    default_source_kind = "synthetic" if isinstance(payload.get("mockSource"), dict) else "official"
    source_kind = str(payload.get("sourceKind") or default_source_kind).strip().lower()
    if source_kind not in {"official", "synthetic"}:
        raise ValueError("Regional runtime sourceKind must be official or synthetic")
    regions = payload.get("regions", {})
    if not isinstance(regions, dict):
        raise ValueError("Regional runtime regions must be an object")
    schema_version = payload.get("schemaVersion")
    if schema_version not in {None, "rmuc-regionals-live-v1"}:
        raise ValueError("Unsupported regional runtime schemaVersion")
    strict = schema_version == "rmuc-regionals-live-v1"
    for region_slug, region in regions.items():
        if region_slug not in REGION_SLUG_TO_NAME or not isinstance(region, dict):
            raise ValueError(f"Invalid regional runtime region: {region_slug}")
        matches = region.get("matches", [])
        if not isinstance(matches, list):
            raise ValueError(f"Regional runtime matches must be a list: {region_slug}")
        seen_ids: set[str] = set()
        seen_numbers: set[int] = set()
        for match in matches:
            if not isinstance(match, dict):
                raise ValueError(f"Invalid regional runtime match: {region_slug}")
            official_match_id = str(match.get("officialMatchId") or "").strip()
            order_number = int(match.get("orderNumber") or 0)
            if strict and (not official_match_id or official_match_id in seen_ids):
                raise ValueError(f"Duplicate or missing officialMatchId in {region_slug}: {official_match_id}")
            if strict and (order_number <= 0 or order_number in seen_numbers):
                raise ValueError(f"Duplicate or invalid orderNumber in {region_slug}: {order_number}")
            if official_match_id:
                if official_match_id in seen_ids:
                    raise ValueError(f"Duplicate officialMatchId in {region_slug}: {official_match_id}")
                seen_ids.add(official_match_id)
            if order_number > 0:
                if order_number in seen_numbers:
                    raise ValueError(f"Duplicate orderNumber in {region_slug}: {order_number}")
                seen_numbers.add(order_number)
            has_complete_score_contract = match.get("scoreline") is not None and match.get("bestOf") is not None
            if not strict and not has_complete_score_contract:
                continue
            is_confirmed = match.get("isConfirmedMatchup") is True
            validate_distinct_matchup(
                is_confirmed=is_confirmed,
                red_identity=match.get("redTeamKey"),
                blue_identity=match.get("blueTeamKey"),
                context=f"Regional match {official_match_id}",
            )
            if not is_confirmed and match.get("isCompleted") is not True:
                continue
            normalize_match_outcome(
                status=match.get("officialStatus"),
                result=match.get("result"),
                scoreline=match.get("scoreline"),
                best_of=int(match.get("bestOf") or 3),
                is_confirmed=is_confirmed,
                is_completed=match.get("isCompleted") is True,
                has_live_scoreline=match.get("hasLiveScoreline") is True,
                context=f"regional match {official_match_id}",
            )
    return {
        **payload,
        "sourceStatus": source_status,
        "sourceKind": source_kind,
        "isSynthetic": source_kind == "synthetic",
    }


def build_runtime_match_records(
    normalized: dict[str, Any],
    *,
    existing_match_school_pairs: set[tuple[str, str]] | None = None,
) -> list[dict[str, Any]]:
    existing_match_school_pairs = existing_match_school_pairs or set()
    if normalized.get("sourceStatus") != "active":
        return []
    records: list[dict[str, Any]] = []
    for region in normalized.get("regions", {}).values():
        for match in region.get("matches", []):
            if not match.get("isCompleted"):
                continue
            match_id = str(match["matchId"])
            red_school = str(match["redSchoolKey"])
            blue_school = str(match["blueSchoolKey"])
            if (match_id, red_school) in existing_match_school_pairs or (match_id, blue_school) in existing_match_school_pairs:
                continue
            records.append(
                {
                    "match_id": match_id,
                    "match_date": match.get("matchDate") or normalized.get("fetchedAt", "")[:10],
                    "season": int(normalized.get("season") or 0),
                    "ruleset_id": "RMUC",
                    "stage_family": match["stageFamily"],
                    "red_school_key": red_school,
                    "blue_school_key": blue_school,
                    "red_wins": int(match["redWins"]),
                    "blue_wins": int(match["blueWins"]),
                    "region_slug": match["regionSlug"],
                }
            )
    return records


@dataclass(frozen=True)
class LiveRuntimeContext:
    region_slug: str
    source_status: str
    reason: str | None
    matches_by_pair: dict[tuple[str, str, str], dict[str, Any]]
    matches_by_pair_round: dict[tuple[str, str, str, int], dict[str, Any]]
    matches_by_pair_label: dict[tuple[str, str, str, str], dict[str, Any]]
    swiss_pairings: dict[str, dict[int, list[tuple[str, str]]]]
    slot_assignments: dict[str, str]
    group_rank_metrics: dict[str, dict[str, Any]]
    completed_count: int
    confirmed_count: int

    @classmethod
    def inactive(cls, region_slug: str, reason: str | None = None) -> "LiveRuntimeContext":
        return cls(
            region_slug=region_slug,
            source_status="inactive",
            reason=reason,
            matches_by_pair={},
            matches_by_pair_round={},
            matches_by_pair_label={},
            swiss_pairings={},
            slot_assignments={},
            group_rank_metrics={},
            completed_count=0,
            confirmed_count=0,
        )

    @classmethod
    def from_normalized(
        cls,
        normalized: dict[str, Any],
        region_slug: str,
        *,
        mini_program_predictions: dict[str, dict[str, Any]] | None = None,
    ) -> "LiveRuntimeContext":
        if normalized.get("sourceStatus") != "active":
            return cls.inactive(region_slug, str(normalized.get("reason") or "实时源未激活"))
        region = normalized.get("regions", {}).get(region_slug)
        if not region:
            return cls.inactive(region_slug, "实时源未包含当前赛区")
        mini_program_predictions = mini_program_predictions or {}
        matches_by_pair: dict[tuple[str, str, str], dict[str, Any]] = {}
        matches_by_pair_round: dict[tuple[str, str, str, int], dict[str, Any]] = {}
        matches_by_pair_label: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        swiss_pairing_rows: dict[str, dict[int, list[tuple[int, str, str]]]] = {}
        completed_count = 0
        confirmed_count = 0
        matches = [match for match in region.get("matches", []) if isinstance(match, dict)]
        for match in matches:
            if match.get("isCompleted"):
                completed_count += 1
            if not _live_match_can_lock(match, matches):
                continue
            enriched = dict(match)
            official_id = str(match.get("officialMatchId") or "")
            if not official_id:
                continue
            if isinstance(match.get("miniProgramPrediction"), dict):
                enriched["miniProgramPrediction"] = match["miniProgramPrediction"]
            elif official_id in mini_program_predictions:
                enriched["miniProgramPrediction"] = mini_program_predictions[official_id]
            red_team_key = str(match.get("redTeamKey") or "")
            blue_team_key = str(match.get("blueTeamKey") or "")
            if not red_team_key or not blue_team_key:
                continue
            stage = _live_match_stage(match)
            round_number = _live_match_round_number(match)
            group_name = _live_match_group_name(match)
            match_label = _live_match_label(match)
            enriched["stage"] = stage
            if round_number is not None:
                enriched["roundNumber"] = round_number
            if group_name and not enriched.get("groupName"):
                enriched["groupName"] = group_name
            if match_label and not enriched.get("matchLabel"):
                enriched["matchLabel"] = match_label
            confirmed_count += 1
            key = (red_team_key, blue_team_key, stage)
            matches_by_pair[key] = enriched
            if round_number is not None:
                matches_by_pair_round[(red_team_key, blue_team_key, stage, round_number)] = enriched
            if match_label:
                matches_by_pair_label[(red_team_key, blue_team_key, stage, match_label)] = enriched
            if stage == "swiss" and round_number is not None:
                if group_name:
                    swiss_pairing_rows.setdefault(group_name, {}).setdefault(round_number, []).append(
                        (int(match.get("orderNumber") or 0), red_team_key, blue_team_key)
                    )
        swiss_pairings = {
            group_name: {
                round_number: [
                    (red_team_key, blue_team_key)
                    for _, red_team_key, blue_team_key in sorted(rows, key=lambda row: row[0])
                ]
                for round_number, rows in rounds.items()
            }
            for group_name, rounds in swiss_pairing_rows.items()
        }
        return cls(
            region_slug=region_slug,
            source_status="active",
            reason=None,
            matches_by_pair=matches_by_pair,
            matches_by_pair_round=matches_by_pair_round,
            matches_by_pair_label=matches_by_pair_label,
            swiss_pairings=swiss_pairings,
            slot_assignments=dict(region.get("slotAssignments", {})),
            group_rank_metrics=dict(region.get("groupRankMetrics", {})),
            completed_count=completed_count,
            confirmed_count=confirmed_count,
        )

    def _lookup_match(
        self,
        *,
        red_team_key: str,
        blue_team_key: str,
        stage: str,
        round_number: int | None,
        match_label: str | None,
    ) -> tuple[dict[str, Any] | None, str]:
        if match_label:
            match = self.matches_by_pair_label.get((red_team_key, blue_team_key, stage, match_label))
            if match is not None:
                return match, "normal"
            match = self.matches_by_pair_label.get((blue_team_key, red_team_key, stage, match_label))
            if match is not None:
                return match, "swapped"
        if round_number is not None:
            match = self.matches_by_pair_round.get((red_team_key, blue_team_key, stage, round_number))
            if match is not None:
                return match, "normal"
            match = self.matches_by_pair_round.get((blue_team_key, red_team_key, stage, round_number))
            if match is not None:
                return match, "swapped"
        if (match_label or round_number is not None) and (self.matches_by_pair_label or self.matches_by_pair_round):
            return None, "normal"
        match = self.matches_by_pair.get((red_team_key, blue_team_key, stage))
        if match is not None:
            return match, "normal"
        match = self.matches_by_pair.get((blue_team_key, red_team_key, stage))
        if match is not None:
            return match, "swapped"
        return None, "normal"

    def payload_override_for(
        self,
        *,
        red_team_key: str,
        blue_team_key: str,
        stage: str,
        round_number: int | None = None,
        match_label: str | None = None,
    ) -> dict[str, Any]:
        match, orientation = self._lookup_match(
            red_team_key=red_team_key,
            blue_team_key=blue_team_key,
            stage=stage,
            round_number=round_number,
            match_label=match_label,
        )
        if match is None:
            return {}
        scoreline = str(match["scoreline"])
        if orientation == "swapped":
            red_score, blue_score = scoreline.split(":", maxsplit=1)
            scoreline = f"{blue_score}:{red_score}"
        out = {
            "match_id": match.get("matchId"),
            "official_match_id": match["officialMatchId"],
            "official_status": match["officialStatus"],
            "planned_start_at": match.get("plannedStartAt"),
        }
        if match.get("miniProgramPrediction"):
            out["mini_program_prediction"] = match["miniProgramPrediction"]
        if match.get("isCompleted"):
            out["fixed_scoreline"] = scoreline
        elif match.get("hasLiveScoreline"):
            out["display_scoreline"] = scoreline
        return out


class MiniProgramPredictionClient:
    def __init__(
        self,
        *,
        fetcher: Callable[[str], dict[str, Any]] | None = None,
        ttl_seconds: int = 60,
        refresh_window_seconds: int = 10,
    ) -> None:
        self.fetcher = fetcher or self._default_fetcher
        self.ttl_seconds = ttl_seconds
        self.refresh_window_seconds = refresh_window_seconds
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._refreshing: set[str] = set()
        self._lock = threading.Lock()

    def get(self, match_id: str) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            cached = self._cache.get(match_id)
        if cached and now - cached[0] < self.ttl_seconds:
            if now - cached[0] >= max(self.ttl_seconds - self.refresh_window_seconds, 0):
                self._refresh_async(match_id)
            return cached[1]
        try:
            payload = self._normalize_response(match_id, self.fetcher(match_id))
        except Exception as exc:  # noqa: BLE001 - external API failures must not break simulation.
            fallback = dict(cached[1]) if cached else {}
            fallback.update(
                {
                    "status": "unavailable",
                    "matchId": match_id,
                    "reason": str(exc),
                    "fetchedAt": _now_iso(),
                }
            )
            return fallback
        with self._lock:
            self._cache[match_id] = (now, payload)
        return payload

    def _refresh_async(self, match_id: str) -> None:
        with self._lock:
            if match_id in self._refreshing:
                return
            self._refreshing.add(match_id)

        def _refresh() -> None:
            try:
                payload = self._normalize_response(match_id, self.fetcher(match_id))
                with self._lock:
                    self._cache[match_id] = (time.time(), payload)
            except Exception:
                pass
            finally:
                with self._lock:
                    self._refreshing.discard(match_id)

        thread = threading.Thread(target=_refresh, name=f"rmuc-mp-refresh-{match_id}", daemon=True)
        thread.start()

    def _default_fetcher(self, match_id: str) -> dict[str, Any]:
        request = Request(
            MP_MATCH_URL.format(match_id=match_id),
            headers={
                "Referer": "https://servicewechat.com/wx449772ad6960c39f/34/page-frame.html",
                "Origin": "https://servicewechat.com",
                "User-Agent": "douququ-live-sync/1.0",
            },
        )
        try:
            with urlopen(request, timeout=8) as response:  # noqa: S310 - fixed trusted URL.
                return json.loads(response.read().decode("utf-8"))
        except URLError as exc:
            raise RuntimeError(str(exc)) from exc

    @staticmethod
    def _normalize_response(match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = payload.get("data", payload)
        red_count = int(data.get("redCount") or 0)
        blue_count = int(data.get("blueCount") or 0)
        tie_count = int(data.get("tieCount") or 0)
        total_count = red_count + blue_count + tie_count
        if total_count <= 0:
            return {
                "status": "unavailable",
                "matchId": match_id,
                "reason": "mini-program prediction has no votes",
                "redCount": red_count,
                "blueCount": blue_count,
                "tieCount": tie_count,
                "totalCount": total_count,
                "fetchedAt": _now_iso(),
            }
        red_rate = red_count / total_count
        blue_rate = blue_count / total_count
        tie_rate = tie_count / total_count
        return {
            "status": "available",
            "matchId": match_id,
            "redCount": red_count,
            "blueCount": blue_count,
            "tieCount": tie_count,
            "totalCount": total_count,
            "redRate": red_rate,
            "blueRate": blue_rate,
            "tieRate": tie_rate,
            "fetchedAt": _now_iso(),
        }
