#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import rmuc_live, service  # noqa: E402
from scripts.sync_rmuc_live import (  # noqa: E402
    DEFAULT_BASE_PUBLISHED_DIR,
    DEFAULT_PRESEASON_RATINGS,
    DEFAULT_RUNTIME_DIR,
    publish_runtime_artifacts,
    write_json_atomic,
)


DEFAULT_START_AT = "2026-05-01T01:00:00+00:00"
DEFAULT_RULES_SCHEDULE = ROOT / "rules" / "RMUC 2026 区域赛（南部赛区）赛程表总览版-赛程总览.csv"
DEFAULT_TIMEZONE = "Asia/Shanghai"
DEFAULT_TODAY_DAY = 2

RULE_DAY_COLUMNS = {
    1: {"match": 6, "red": 7, "blue": 8, "time": 9},
    2: {"match": 10, "red": 11, "blue": 12, "time": 13},
    3: {"match": 14, "red": 15, "blue": 16, "time": 17},
    4: {"match": 18, "red": 19, "blue": 20, "time": 23},
    5: {"match": 24, "red": 25, "blue": 26, "time": 29},
}
TIME_RANGE_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})")


@dataclass(frozen=True)
class RulesScheduleSlot:
    label: str
    rule_order_number: int
    day: int
    match_date: str
    time_range: str
    planned_start_at: str
    planned_end_at: str
    red_ref: str
    blue_ref: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed a mock RMUC live runtime with simulated official-like match results.")
    parser.add_argument("--region", choices=["south_region"], default="south_region")
    parser.add_argument(
        "--match-count",
        type=int,
        default=20,
        help="Number of rules-ordered matches to mark as DONE. Default finishes day 1 so today is day 2.",
    )
    parser.add_argument(
        "--upcoming-count",
        type=int,
        default=None,
        help="Number of additional confirmed but unfinished official-like matches. Default includes the full remaining schedule.",
    )
    parser.add_argument("--seed", type=int, default=20260414)
    parser.add_argument("--samples", type=int, default=1200)
    parser.add_argument("--rules-schedule", type=Path, default=DEFAULT_RULES_SCHEDULE)
    parser.add_argument("--today-date", default=None, help="Local date to treat as --today-day. Default is today in --timezone.")
    parser.add_argument("--today-day", type=int, choices=range(1, 6), default=DEFAULT_TODAY_DAY)
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--no-rules-schedule", action="store_true", help="Use legacy fixed-interval mock times instead of rules CSV.")
    parser.add_argument("--start-at", default=DEFAULT_START_AT, help="Legacy fixed-interval start time used with --no-rules-schedule.")
    parser.add_argument("--interval-minutes", type=int, default=25, help="Legacy fixed interval used with --no-rules-schedule.")
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--base-published-dir", type=Path, default=DEFAULT_BASE_PUBLISHED_DIR)
    parser.add_argument("--preseason-ratings", type=Path, default=DEFAULT_PRESEASON_RATINGS)
    parser.add_argument("--snapshot-date", default=datetime.now(tz=UTC).date().isoformat())
    parser.add_argument("--keep-existing-ledger", action="store_true", help="Do not clear runtime published_2026 before publishing.")
    parser.add_argument("--no-publish", action="store_true", help="Only write normalized_schedule.json and raw mock source.")
    return parser.parse_args()


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def stage_family(stage: str) -> str:
    if stage == "swiss":
        return "regional_group"
    if stage in {"qualification_round1", "qualification_round2"}:
        return "repechage"
    if stage in {"round_of_16", "quarterfinal", "semifinal", "third_place", "final"}:
        return "post_group"
    return stage


def school_key(team_key: str, college_name: str) -> str:
    if "::" in team_key:
        return team_key.split("::", maxsplit=1)[0]
    return rmuc_live.legacy_elo.make_school_key(college_name)


def planned_start(base: datetime, index: int, interval_minutes: int) -> str:
    return (base + timedelta(minutes=interval_minutes * (index - 1))).isoformat()


def _timezone(timezone_name: str) -> timezone | ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        if timezone_name == DEFAULT_TIMEZONE:
            return timezone(timedelta(hours=8), name=DEFAULT_TIMEZONE)
        return UTC


def _local_today(today_date_text: str | None, timezone_name: str) -> date:
    if today_date_text:
        return datetime.fromisoformat(today_date_text).date()
    return datetime.now(tz=_timezone(timezone_name)).date()


def _rules_label_for_order(order_number: int) -> str:
    if 1 <= order_number <= 8:
        return f"A-SWISS-1-{order_number}"
    if 9 <= order_number <= 16:
        return f"B-SWISS-1-{order_number - 8}"
    if 17 <= order_number <= 24:
        return f"A-SWISS-2-{order_number - 16}"
    if 25 <= order_number <= 32:
        return f"B-SWISS-2-{order_number - 24}"
    if 33 <= order_number <= 40:
        return f"A-SWISS-3-{order_number - 32}"
    if 41 <= order_number <= 48:
        return f"B-SWISS-3-{order_number - 40}"
    if 49 <= order_number <= 54:
        return f"A-SWISS-4-{order_number - 48}"
    if 55 <= order_number <= 60:
        return f"B-SWISS-4-{order_number - 54}"
    if 61 <= order_number <= 63:
        return f"A-SWISS-5-{order_number - 60}"
    if 64 <= order_number <= 66:
        return f"B-SWISS-5-{order_number - 63}"
    if 67 <= order_number <= 74:
        return f"R16-{order_number - 66}"
    if 75 <= order_number <= 78:
        return f"QF-{order_number - 74}"
    if 79 <= order_number <= 82:
        return f"QUAL-1-{order_number - 78}"
    if 83 <= order_number <= 84:
        return f"SF-{order_number - 82}"
    if 85 <= order_number <= 86:
        return f"QUAL-2-{order_number - 84}"
    if order_number == 87:
        return "THIRD-1"
    if order_number == 88:
        return "FINAL-1"
    raise ValueError(f"Unsupported south rules match order: {order_number}")


def _parse_time_range(value: str) -> tuple[time, time]:
    match = TIME_RANGE_RE.match(value)
    if not match:
        raise ValueError(f"Unsupported rules time range: {value!r}")
    start_hour, start_minute, end_hour, end_minute = (int(part) for part in match.groups())
    return time(start_hour, start_minute), time(end_hour, end_minute)


def load_rules_schedule(
    path: Path,
    *,
    today_date_text: str | None,
    today_day: int,
    timezone_name: str,
) -> dict[str, RulesScheduleSlot]:
    if today_day not in RULE_DAY_COLUMNS:
        raise ValueError(f"Unsupported today day: {today_day}")
    local_today = _local_today(today_date_text, timezone_name)
    tzinfo = _timezone(timezone_name)
    schedule: dict[str, RulesScheduleSlot] = {}
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))

    for row in rows[4:]:
        for day, columns in RULE_DAY_COLUMNS.items():
            match_text = row[columns["match"]].strip() if len(row) > columns["match"] else ""
            if not match_text.isdigit():
                continue
            order_number = int(match_text)
            time_range = row[columns["time"]].strip() if len(row) > columns["time"] else ""
            start_time, end_time = _parse_time_range(time_range)
            match_date = local_today + timedelta(days=day - today_day)
            label = _rules_label_for_order(order_number)
            if label in schedule:
                raise ValueError(f"Duplicate rules schedule label: {label}")
            start_at = datetime.combine(match_date, start_time, tzinfo=tzinfo)
            end_at = datetime.combine(match_date, end_time, tzinfo=tzinfo)
            schedule[label] = RulesScheduleSlot(
                label=label,
                rule_order_number=order_number,
                day=day,
                match_date=match_date.isoformat(),
                time_range=time_range,
                planned_start_at=start_at.isoformat(),
                planned_end_at=end_at.isoformat(),
                red_ref=row[columns["red"]].strip() if len(row) > columns["red"] else "",
                blue_ref=row[columns["blue"]].strip() if len(row) > columns["blue"] else "",
            )

    if len(schedule) != 88:
        raise ValueError(f"Expected 88 south rules matches, found {len(schedule)}")
    return schedule


def prediction_payload(match: dict[str, Any], official_id: str, index: int) -> dict[str, Any]:
    total = 1000
    # Use model probability as the crowd baseline, but add a deterministic tiny skew so
    # the mock mini-program signal is visibly independent from the model number.
    skew = (((index * 37) % 11) - 5) / 100.0
    red_rate = clamp(float(match["pSeriesRed"]) + skew, 0.03, 0.97)
    red_count = int(round(red_rate * total))
    blue_count = total - red_count
    return {
        "status": "available",
        "matchId": official_id,
        "redCount": red_count,
        "blueCount": blue_count,
        "tieCount": 0,
        "totalCount": total,
        "redRate": red_count / total,
        "blueRate": blue_count / total,
        "tieRate": 0.0,
        "fetchedAt": datetime.now(tz=UTC).isoformat(),
    }


def build_mock_normalized(
    *,
    region_slug: str,
    seed: int,
    samples: int,
    match_count: int,
    upcoming_count: int | None,
    start_at: str,
    interval_minutes: int,
    use_rules_schedule: bool,
    rules_schedule: Path,
    today_date: str | None,
    today_day: int,
    timezone_name: str,
) -> dict[str, Any]:
    simulation = service.build_simulation_payload(region_slug, seed, "sim", samples=samples)
    total_match_count = len(simulation["matches"])
    if match_count < 0:
        raise ValueError("match_count must be >= 0")
    if upcoming_count is not None and upcoming_count < 0:
        raise ValueError("upcoming_count must be >= 0")
    selected_count = total_match_count if upcoming_count is None else match_count + upcoming_count
    selected_matches = simulation["matches"][:selected_count]
    if len(selected_matches) != selected_count:
        raise ValueError(f"Requested {selected_count} matches, simulation only produced {len(selected_matches)}")

    base_start = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
    if base_start.tzinfo is None:
        base_start = base_start.replace(tzinfo=UTC)
    rules_by_label = (
        load_rules_schedule(
            rules_schedule,
            today_date_text=today_date,
            today_day=today_day,
            timezone_name=timezone_name,
        )
        if use_rules_schedule
        else {}
    )

    slot_assignments = {
        str(slot["teamKey"]): str(slot["slot"])
        for slot in simulation["slots"]
        if slot.get("teamKey") and slot.get("slot")
    }
    normalized_matches: list[dict[str, Any]] = []
    for index, match in enumerate(selected_matches, start=1):
        schedule_slot = rules_by_label.get(str(match["matchLabel"]))
        if use_rules_schedule and schedule_slot is None:
            raise ValueError(f"Missing rules schedule for match label: {match['matchLabel']}")
        rules_order = schedule_slot.rule_order_number if schedule_slot is not None else index
        official_id = f"MOCK-SOUTH-{rules_order:03d}"
        red_score, blue_score = [int(part) for part in str(match["scoreline"]).split(":", maxsplit=1)]
        is_completed = rules_order <= match_count
        result = "RED" if red_score > blue_score else "BLUE"
        official_status = "DONE" if is_completed else "PENDING"
        official_scoreline = match["scoreline"] if is_completed else "0:0"
        official_red_wins = red_score if is_completed else 0
        official_blue_wins = blue_score if is_completed else 0
        planned_at = schedule_slot.planned_start_at if schedule_slot is not None else planned_start(base_start, index, interval_minutes)
        red_team = match["redTeam"]
        blue_team = match["blueTeam"]
        normalized_match = {
            "officialMatchId": official_id,
            "matchId": f"2026RMUC:{official_id}",
            "regionSlug": region_slug,
            "regionName": simulation["meta"]["regionName"],
            "zoneName": simulation["meta"]["regionName"],
            "stageFamily": stage_family(str(match["stage"])),
            "stage": match["stage"],
            "matchLabel": match["matchLabel"],
            "roundNumber": int(match["roundNumber"]),
            "matchType": "GROUP" if match["stage"] == "swiss" else "KNOCKOUT",
            "orderNumber": index,
            "bestOf": int(match["bestOf"]),
            "plannedStartAt": planned_at,
            "matchDate": schedule_slot.match_date if schedule_slot is not None else planned_at[:10],
            "officialStatus": official_status,
            "result": result if is_completed else "",
            "scoreline": official_scoreline,
            "isCompleted": is_completed,
            "isConfirmedMatchup": True,
            "redSchoolKey": school_key(red_team["teamKey"], red_team["collegeName"]),
            "redTeamKey": red_team["teamKey"],
            "redCollegeName": red_team["collegeName"],
            "redTeamName": red_team["teamName"],
            "redSlot": red_team.get("slot"),
            "blueSchoolKey": school_key(blue_team["teamKey"], blue_team["collegeName"]),
            "blueTeamKey": blue_team["teamKey"],
            "blueCollegeName": blue_team["collegeName"],
            "blueTeamName": blue_team["teamName"],
            "blueSlot": blue_team.get("slot"),
            "redWins": official_red_wins,
            "blueWins": official_blue_wins,
            "miniProgramPrediction": prediction_payload(match, official_id, index),
        }
        if schedule_slot is not None:
            normalized_match.update(
                {
                    "ruleOrderNumber": schedule_slot.rule_order_number,
                    "ruleScheduleDay": schedule_slot.day,
                    "plannedEndAt": schedule_slot.planned_end_at,
                    "plannedTimeRange": schedule_slot.time_range,
                    "ruleRedRef": schedule_slot.red_ref,
                    "ruleBlueRef": schedule_slot.blue_ref,
                }
            )
        normalized_matches.append(normalized_match)

    fetched_at = datetime.now(tz=UTC).isoformat()
    mock_source = {
        "kind": "south_rules_schedule_mock" if use_rules_schedule else "south_first_n_simulated_results",
        "seed": seed,
        "samples": samples,
        "completedMatchCount": match_count,
        "upcomingConfirmedMatchCount": sum(1 for match in normalized_matches if not match.get("isCompleted")),
    }
    if use_rules_schedule:
        mock_source.update(
            {
                "rulesSchedule": str(rules_schedule),
                "todayDate": _local_today(today_date, timezone_name).isoformat(),
                "todayDay": today_day,
                "timezone": timezone_name,
            }
        )
    else:
        mock_source.update({"startAt": start_at, "intervalMinutes": interval_minutes})
    return {
        "sourceStatus": "active",
        "reason": None,
        "eventTitle": "RoboMaster 2026 超级对抗赛（南部赛区模拟实时源）",
        "season": 2026,
        "fetchedAt": fetched_at,
        "sourceUpdatedAt": fetched_at,
        "etag": f"mock-south-{seed}-{match_count}-{mock_source.get('todayDate', start_at)}",
        "mockSource": mock_source,
        "regions": {
            region_slug: {
                "zoneId": "mock-south-region",
                "zoneName": simulation["meta"]["regionName"],
                "regionSlug": region_slug,
                "regionName": simulation["meta"]["regionName"],
                "slotAssignments": slot_assignments,
                "matches": normalized_matches,
            }
        },
    }


def main() -> None:
    args = parse_args()
    normalized = build_mock_normalized(
        region_slug=args.region,
        seed=args.seed,
        samples=args.samples,
        match_count=args.match_count,
        upcoming_count=args.upcoming_count,
        start_at=args.start_at,
        interval_minutes=args.interval_minutes,
        use_rules_schedule=not args.no_rules_schedule,
        rules_schedule=args.rules_schedule,
        today_date=args.today_date,
        today_day=args.today_day,
        timezone_name=args.timezone,
    )

    raw_dir = args.runtime_dir / "raw"
    write_json_atomic(raw_dir / "mock_south_schedule.json", normalized)
    write_json_atomic(args.runtime_dir / "normalized_schedule.json", normalized)
    if not args.no_publish:
        if not args.keep_existing_ledger:
            shutil.rmtree(args.runtime_dir / "published_2026", ignore_errors=True)
        publish_runtime_artifacts(
            normalized=normalized,
            runtime_dir=args.runtime_dir,
            base_published_dir=args.base_published_dir,
            preseason_ratings=args.preseason_ratings,
            snapshot_date=args.snapshot_date,
        )

    matches = normalized["regions"][args.region]["matches"]
    summary = {
        "sourceStatus": normalized["sourceStatus"],
        "regionSlug": args.region,
        "totalOfficialMatchCount": len(matches),
        "doneMatchCount": sum(1 for match in matches if match.get("isCompleted")),
        "upcomingConfirmedMatchCount": sum(1 for match in matches if match.get("isConfirmedMatchup") and not match.get("isCompleted")),
        "firstMatch": matches[0]["matchLabel"] if matches else None,
        "lastMatch": matches[-1]["matchLabel"] if matches else None,
        "firstPlannedStartAt": matches[0].get("plannedStartAt") if matches else None,
        "lastPlannedStartAt": matches[-1].get("plannedStartAt") if matches else None,
        "todayDate": normalized.get("mockSource", {}).get("todayDate"),
        "todayDay": normalized.get("mockSource", {}).get("todayDay"),
        "runtimeDir": str(args.runtime_dir),
        "published": not args.no_publish,
    }
    write_json_atomic(args.runtime_dir / "mock_summary.json", summary)
    print(summary)


if __name__ == "__main__":
    main()
