#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed a mock RMUC live runtime with simulated official-like match results.")
    parser.add_argument("--region", choices=["south_region"], default="south_region")
    parser.add_argument("--match-count", type=int, default=40, help="Number of ordered matches to mark as DONE.")
    parser.add_argument(
        "--upcoming-count",
        type=int,
        default=8,
        help="Number of additional confirmed but unfinished official-like matches to seed with mini-program votes.",
    )
    parser.add_argument("--seed", type=int, default=20260414)
    parser.add_argument("--samples", type=int, default=1200)
    parser.add_argument("--start-at", default=DEFAULT_START_AT)
    parser.add_argument("--interval-minutes", type=int, default=25)
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
    upcoming_count: int,
    start_at: str,
    interval_minutes: int,
) -> dict[str, Any]:
    simulation = service.build_simulation_payload(region_slug, seed, "sim", samples=samples)
    selected_count = match_count + upcoming_count
    selected_matches = simulation["matches"][:selected_count]
    if len(selected_matches) != selected_count:
        raise ValueError(f"Requested {selected_count} matches, simulation only produced {len(selected_matches)}")

    base_start = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
    if base_start.tzinfo is None:
        base_start = base_start.replace(tzinfo=UTC)

    slot_assignments = {
        str(slot["teamKey"]): str(slot["slot"])
        for slot in simulation["slots"]
        if slot.get("teamKey") and slot.get("slot")
    }
    normalized_matches: list[dict[str, Any]] = []
    for index, match in enumerate(selected_matches, start=1):
        official_id = f"MOCK-SOUTH-{index:03d}"
        red_score, blue_score = [int(part) for part in str(match["scoreline"]).split(":", maxsplit=1)]
        is_completed = index <= match_count
        result = "RED" if red_score > blue_score else "BLUE"
        official_status = "DONE" if is_completed else "PENDING"
        official_scoreline = match["scoreline"] if is_completed else "0:0"
        official_red_wins = red_score if is_completed else 0
        official_blue_wins = blue_score if is_completed else 0
        planned_at = planned_start(base_start, index, interval_minutes)
        red_team = match["redTeam"]
        blue_team = match["blueTeam"]
        normalized_matches.append(
            {
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
                "matchDate": planned_at[:10],
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
        )

    fetched_at = datetime.now(tz=UTC).isoformat()
    return {
        "sourceStatus": "active",
        "reason": None,
        "eventTitle": "RoboMaster 2026 超级对抗赛（南部赛区模拟实时源）",
        "season": 2026,
        "fetchedAt": fetched_at,
        "sourceUpdatedAt": fetched_at,
        "etag": f"mock-south-{seed}-{match_count}",
        "mockSource": {
            "kind": "south_first_n_simulated_results",
            "seed": seed,
            "samples": samples,
            "completedMatchCount": match_count,
            "upcomingConfirmedMatchCount": upcoming_count,
            "startAt": start_at,
            "intervalMinutes": interval_minutes,
        },
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
        "runtimeDir": str(args.runtime_dir),
        "published": not args.no_publish,
    }
    write_json_atomic(args.runtime_dir / "mock_summary.json", summary)
    print(summary)


if __name__ == "__main__":
    main()
