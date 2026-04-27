from __future__ import annotations

import json
import re
import sys
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_elo as legacy_elo  # noqa: E402


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
    return {
        "collegeName": legacy_elo.normalize_school(college_name),
        "teamName": legacy_elo.normalize_team(team_name),
        "slot": str(player.get("name") or "").strip(),
        "schoolKey": legacy_elo.make_school_key(college_name),
        "teamKey": legacy_elo.make_team_key(college_name, team_name),
    }


def _side_team(match: dict[str, Any], side: str) -> dict[str, str] | None:
    side_payload = match.get(f"{side}Side")
    if not isinstance(side_payload, dict):
        return None
    return _player_team(side_payload.get("player"))


def _scoreline(match: dict[str, Any]) -> str:
    red_wins = int(match.get("redSideWinGameCount") or 0)
    blue_wins = int(match.get("blueSideWinGameCount") or 0)
    return f"{red_wins}:{blue_wins}"


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


def _metric_value(items: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = _optional_float(items.get(name))
        if value is not None:
            return value
    return None


def normalize_group_rank_metrics(
    payload: dict[str, Any] | None,
) -> dict[str, dict[str, dict[str, Any]]]:
    if not isinstance(payload, dict):
        return {}
    regions: dict[str, dict[str, dict[str, Any]]] = {}
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
        region_metrics = regions.setdefault(region_slug, {})
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
                if not college_name or not team_name:
                    continue
                team_key = legacy_elo.make_team_key(college_name, team_name)
                region_metrics[team_key] = {
                    "group_name": group_name,
                    "group_rank": _metric_value(items, "排名"),
                    "wins": _metric_value(items, "胜场数"),
                    "official_opponent_points": _metric_value(items, "对手分"),
                    "official_avg_base_hp_diff": _metric_value(
                        items,
                        "局均总基地净胜血量",
                        "平均总基地净胜血量",
                        "平均基地净胜血量",
                    ),
                    "official_avg_team_damage": _metric_value(
                        items,
                        "局均全队总伤害血量",
                        "平均全队总伤害血量",
                        "全队总伤害血量",
                    ),
                    "ranking_metric_source": "official_live",
                }
    return regions


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


def _normalize_match(match: dict[str, Any], *, region_slug: str, zone_name: str) -> dict[str, Any] | None:
    red = _side_team(match, "red")
    blue = _side_team(match, "blue")
    if red is None or blue is None:
        return None
    official_match_id = str(match.get("id") or "").strip()
    if not official_match_id:
        return None
    status = str(match.get("status") or "").strip().upper()
    result = str(match.get("result") or "").strip().upper()
    scoreline = _scoreline(match)
    stage_family = _stage_family(match, zone_name)
    planned_start_at = str(match.get("planStartedAt") or "").strip() or None
    match_date = planned_start_at[:10] if planned_start_at else None
    return {
        "officialMatchId": official_match_id,
        "matchId": f"2026RMUC:{official_match_id}",
        "regionSlug": region_slug,
        "regionName": REGION_SLUG_TO_NAME.get(region_slug, zone_name),
        "zoneName": zone_name,
        "stageFamily": stage_family,
        "stage": _stage_from_family(stage_family),
        "matchType": str(match.get("matchType") or ""),
        "orderNumber": int(match.get("orderNumber") or 0),
        "bestOf": int(match.get("planGameCount") or 3),
        "plannedStartAt": planned_start_at,
        "matchDate": match_date,
        "officialStatus": status,
        "result": result,
        "scoreline": scoreline,
        "isCompleted": status == "DONE" and result in {"RED", "BLUE"},
        "isConfirmedMatchup": True,
        "redSchoolKey": red["schoolKey"],
        "redTeamKey": red["teamKey"],
        "redCollegeName": red["collegeName"],
        "redTeamName": red["teamName"],
        "redSlot": red["slot"],
        "blueSchoolKey": blue["schoolKey"],
        "blueTeamKey": blue["teamKey"],
        "blueCollegeName": blue["collegeName"],
        "blueTeamName": blue["teamName"],
        "blueSlot": blue["slot"],
        "redWins": int(scoreline.split(":", maxsplit=1)[0]),
        "blueWins": int(scoreline.split(":", maxsplit=1)[1]),
    }


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
        "sourceStatus": "inactive",
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

    group_rank_metrics = normalize_group_rank_metrics(group_rank_payload)
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
        matches.sort(key=lambda row: (row["stageFamily"], row["orderNumber"], row["officialMatchId"]))
        regions[region_slug] = {
            "zoneId": str(zone.get("id") or ""),
            "zoneName": zone_name,
            "regionSlug": region_slug,
            "regionName": REGION_SLUG_TO_NAME[region_slug],
            "slotAssignments": _collect_slot_assignments(zone),
            "groupRankMetrics": group_rank_metrics.get(region_slug, {}),
            "matches": matches,
        }

    if not regions:
        base["reason"] = "官方 RMUC 赛程未包含已配置赛区"
        return base
    base["sourceStatus"] = "active"
    base["regions"] = regions
    return base


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


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
        for match in region.get("matches", []):
            if match.get("isCompleted"):
                completed_count += 1
            if match.get("isConfirmedMatchup"):
                confirmed_count += 1
            enriched = dict(match)
            official_id = str(match["officialMatchId"])
            if isinstance(match.get("miniProgramPrediction"), dict):
                enriched["miniProgramPrediction"] = match["miniProgramPrediction"]
            if official_id in mini_program_predictions:
                enriched["miniProgramPrediction"] = mini_program_predictions[official_id]
            red_team_key = str(match["redTeamKey"])
            blue_team_key = str(match["blueTeamKey"])
            stage = str(match["stage"])
            key = (red_team_key, blue_team_key, stage)
            matches_by_pair[key] = enriched
            if match.get("roundNumber") is not None:
                matches_by_pair_round[(red_team_key, blue_team_key, stage, int(match["roundNumber"]))] = enriched
            if match.get("matchLabel"):
                matches_by_pair_label[(red_team_key, blue_team_key, stage, str(match["matchLabel"]))] = enriched
            if stage == "swiss" and match.get("roundNumber") is not None:
                group_name = str(match.get("groupName") or "")
                if not group_name and match.get("matchLabel"):
                    group_name = str(match["matchLabel"]).split("-", maxsplit=1)[0]
                if not group_name:
                    group_name = str(match.get("redSlot") or "")[:1]
                if group_name:
                    swiss_pairing_rows.setdefault(group_name, {}).setdefault(int(match["roundNumber"]), []).append(
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
        if self.matches_by_pair_label or self.matches_by_pair_round:
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
            "official_match_id": match["officialMatchId"],
            "official_status": match["officialStatus"],
            "planned_start_at": match.get("plannedStartAt"),
        }
        if match.get("miniProgramPrediction"):
            out["mini_program_prediction"] = match["miniProgramPrediction"]
        if match.get("isCompleted"):
            out["fixed_scoreline"] = scoreline
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
        if total_count > 0:
            red_rate = red_count / total_count
            blue_rate = blue_count / total_count
            tie_rate = tie_count / total_count
        else:
            red_rate = blue_rate = tie_rate = 0.0
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
