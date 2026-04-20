#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
EVENT_CODE = "2026RMUC"
SEASON = "2026"
LEAGUE = "RMUC"
EVENT_TITLE = "RoboMaster 2026 超级对抗赛"
ZONE_ID = "660"
ZONE_NAME = "南部赛区"
ZONE_TYPE = "GROUP_ZONE"
GROUP_IDS = {"A": "2601", "B": "2602"}
GROUP_NAMES = {"A": "A组", "B": "B组"}
EXTRACTED_DIR = ROOT / "data" / "extracted" / EVENT_CODE
CLEANED_DIR = ROOT / "data" / "cleaned" / EVENT_CODE
SUMMARY_INDEX_PATH = ROOT / "data" / "extracted" / "summary.json"
PARTICIPANTS_PATH = ROOT / "data" / "reference" / "2026_regionals" / "participants_1912.csv"

TEAM_FIELDS = [
    "season",
    "event_code",
    "league",
    "event_title",
    "zone_id",
    "zone_name",
    "zone_type",
    "group_id",
    "group_name",
    "player_id",
    "player_name",
    "player_rank",
    "player_score",
    "team_id",
    "team_name",
    "college_name",
    "college_logo",
]

MATCH_FIELDS = [
    "season",
    "event_code",
    "league",
    "event_title",
    "zone_id",
    "zone_name",
    "zone_type",
    "stage_bucket",
    "match_id",
    "group_id",
    "match_type",
    "order_number",
    "plan_game_count",
    "plan_started_at",
    "match_date",
    "status",
    "result",
    "slug",
    "slug_name",
    "winner_placehold_name",
    "loser_placehold_name",
    "blue_side_score",
    "blue_side_win_game_count",
    "red_side_score",
    "red_side_win_game_count",
    "blue_side_id",
    "blue_fill_status",
    "blue_prepared_status",
    "blue_player_id",
    "blue_player_name",
    "blue_player_rank",
    "blue_player_score",
    "blue_team_id",
    "blue_team_name",
    "blue_college_name",
    "blue_college_logo",
    "red_side_id",
    "red_fill_status",
    "red_prepared_status",
    "red_player_id",
    "red_player_name",
    "red_player_rank",
    "red_player_score",
    "red_team_id",
    "red_team_name",
    "red_college_name",
    "red_college_logo",
    "winner_team_id",
    "winner_team_name",
    "winner_college_name",
    "winner_side",
]

GROUP_RANK_FIELDS = [
    "season",
    "event_code",
    "league",
    "zone_id",
    "zone_name",
    "group_name",
    "group_order",
    "college_name",
    "college_logo",
    "team_name",
    "w_d_l",
    "wins",
    "opponent_points",
    "avg_base_hp_diff",
    "avg_outpost_hp_diff",
    "avg_team_damage",
    "metrics_json",
]

CLEANED_TEAM_FIELDS = [
    "season",
    "event_code",
    "league",
    "zone_name",
    "group_name",
    "team_id",
    "team_name",
    "college_name",
    "player_rank",
    "player_score",
]

CLEANED_MATCH_FIELDS = [
    "season",
    "event_code",
    "league",
    "zone_name",
    "stage_bucket",
    "group_name",
    "match_id",
    "match_type",
    "order_number",
    "plan_game_count",
    "plan_started_at",
    "match_date",
    "result",
    "red_team_id",
    "red_team_name",
    "red_college_name",
    "red_side_score",
    "red_side_win_game_count",
    "blue_team_id",
    "blue_team_name",
    "blue_college_name",
    "blue_side_score",
    "blue_side_win_game_count",
    "winner_team_id",
    "winner_team_name",
    "winner_college_name",
    "winner_side",
]

CLEANED_GROUP_RANK_FIELDS = [
    "season",
    "event_code",
    "league",
    "zone_name",
    "group_name",
    "group_order",
    "college_name",
    "team_name",
    "w_d_l",
    "wins",
    "opponent_points",
    "avg_base_hp_diff",
    "avg_outpost_hp_diff",
    "avg_team_damage",
]


@dataclass
class TeamMeta:
    team_key: str
    team_id: str
    player_id: str
    side_id: str
    slot: str
    group_name: str
    college_name: str
    team_name: str
    college_logo: str
    player_rank: str
    player_score: str
    seed_rank_in_region: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a synthetic 2026RMUC south-region snapshot through Swiss round 2.")
    parser.add_argument("--write-summary-index", action="store_true", help="Append/update data/extracted/summary.json.")
    return parser.parse_args()


def slot_sort_key(slot: str) -> tuple[int, int]:
    return (0 if slot.startswith("A") else 1, int(slot[1:]))


def load_service_payload() -> dict[str, Any]:
    from backend.app.service import build_simulation_payload
    from backend.app.south_actual_schedule import SOUTH_FIXED_SEED

    return build_simulation_payload("south_region", SOUTH_FIXED_SEED, mode="live", samples=32)


def load_participants() -> dict[str, dict[str, str]]:
    with PARTICIPANTS_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    south = [row for row in rows if row["admitted_region"] == ZONE_NAME]
    return {f"{row['college_name']}::{row['team_name_2026']}": row for row in south}


def load_logo_lookup() -> tuple[dict[tuple[str, str], str], dict[str, str]]:
    team_lookup: dict[tuple[str, str], str] = {}
    school_lookup: dict[str, str] = {}
    for event_code in ("2026RMUL", "2025RMUC", "2024RMUC"):
        path = ROOT / "data" / "extracted" / event_code / "teams.csv"
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                logo = row.get("college_logo", "").strip()
                if not logo:
                    continue
                key = (row["college_name"], row["team_name"])
                team_lookup.setdefault(key, logo)
                school_lookup.setdefault(row["college_name"], logo)
    return team_lookup, school_lookup


def build_team_rows(
    slot_rows: list[dict[str, Any]],
    participants: dict[str, dict[str, str]],
    team_logos: dict[tuple[str, str], str],
    school_logos: dict[str, str],
) -> tuple[list[dict[str, str]], dict[str, TeamMeta]]:
    rows: list[dict[str, str]] = []
    team_meta: dict[str, TeamMeta] = {}
    for index, slot_row in enumerate(sorted(slot_rows, key=lambda row: slot_sort_key(row["slot"])), start=1):
        team_key = str(slot_row["teamKey"])
        participant = participants[team_key]
        college_name = str(slot_row["collegeName"])
        team_name = str(slot_row["teamName"])
        group_name = str(slot_row["groupName"])
        team_id = str(960000 + index)
        player_id = str(126000 + index)
        side_id = str(526000 + index)
        college_logo = team_logos.get((college_name, team_name), school_logos.get(college_name, ""))
        player_rank = participant["seed_rank_in_region"]
        player_score = participant["ranking_score"]
        meta = TeamMeta(
            team_key=team_key,
            team_id=team_id,
            player_id=player_id,
            side_id=side_id,
            slot=str(slot_row["slot"]),
            group_name=group_name,
            college_name=college_name,
            team_name=team_name,
            college_logo=college_logo,
            player_rank=player_rank,
            player_score=player_score,
            seed_rank_in_region=int(participant["seed_rank_in_region"]),
        )
        team_meta[team_key] = meta
        rows.append(
            {
                "season": SEASON,
                "event_code": EVENT_CODE,
                "league": LEAGUE,
                "event_title": EVENT_TITLE,
                "zone_id": ZONE_ID,
                "zone_name": ZONE_NAME,
                "zone_type": ZONE_TYPE,
                "group_id": GROUP_IDS[group_name],
                "group_name": group_name,
                "player_id": player_id,
                "player_name": meta.slot,
                "player_rank": player_rank,
                "player_score": player_score,
                "team_id": team_id,
                "team_name": team_name,
                "college_name": college_name,
                "college_logo": college_logo,
            }
        )
    return rows, team_meta


def score_to_side_value(wins: int, losses: int) -> str:
    return "1" if wins > losses else "0"


def plan_started_at_for(order_number: int, round_number: int) -> tuple[str, str]:
    match_day = datetime(2026, 11, 11 if round_number == 1 else 12, 0, 40, tzinfo=UTC)
    offset = timedelta(minutes=35 * ((order_number - 1) % 16))
    started = match_day + offset
    return started.isoformat().replace("+00:00", "Z"), started.date().isoformat()


def build_match_rows(matches: list[dict[str, Any]], team_meta: dict[str, TeamMeta]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    filtered = [row for row in matches if row["stage"] == "swiss" and int(row["roundNumber"]) <= 2]
    for index, match in enumerate(filtered, start=1):
        red = team_meta[str(match["redTeam"]["teamKey"])]
        blue = team_meta[str(match["blueTeam"]["teamKey"])]
        red_wins, blue_wins = [int(piece) for piece in str(match["scoreline"]).split(":", maxsplit=1)]
        winner = red if red_wins > blue_wins else blue
        winner_side = "red" if winner is red else "blue"
        plan_started_at, match_date = plan_started_at_for(index, int(match["roundNumber"]))
        rows.append(
            {
                "season": SEASON,
                "event_code": EVENT_CODE,
                "league": LEAGUE,
                "event_title": EVENT_TITLE,
                "zone_id": ZONE_ID,
                "zone_name": ZONE_NAME,
                "zone_type": ZONE_TYPE,
                "stage_bucket": "group",
                "match_id": str(296000 + index),
                "group_id": GROUP_IDS[str(match["groupName"])],
                "match_type": "GROUP",
                "order_number": str(index),
                "plan_game_count": "3",
                "plan_started_at": plan_started_at,
                "match_date": match_date,
                "status": "DONE",
                "result": winner_side.upper(),
                "slug": str(match["matchLabel"]),
                "slug_name": str(match["matchLabel"]),
                "winner_placehold_name": "",
                "loser_placehold_name": "",
                "blue_side_score": score_to_side_value(blue_wins, red_wins),
                "blue_side_win_game_count": str(blue_wins),
                "red_side_score": score_to_side_value(red_wins, blue_wins),
                "red_side_win_game_count": str(red_wins),
                "blue_side_id": blue.side_id,
                "blue_fill_status": "DONE",
                "blue_prepared_status": "TO_GAME_FIELD",
                "blue_player_id": blue.player_id,
                "blue_player_name": blue.slot,
                "blue_player_rank": blue.player_rank,
                "blue_player_score": blue.player_score,
                "blue_team_id": blue.team_id,
                "blue_team_name": blue.team_name,
                "blue_college_name": blue.college_name,
                "blue_college_logo": blue.college_logo,
                "red_side_id": red.side_id,
                "red_fill_status": "DONE",
                "red_prepared_status": "TO_GAME_FIELD",
                "red_player_id": red.player_id,
                "red_player_name": red.slot,
                "red_player_rank": red.player_rank,
                "red_player_score": red.player_score,
                "red_team_id": red.team_id,
                "red_team_name": red.team_name,
                "red_college_name": red.college_name,
                "red_college_logo": red.college_logo,
                "winner_team_id": winner.team_id,
                "winner_team_name": winner.team_name,
                "winner_college_name": winner.college_name,
                "winner_side": winner_side,
            }
        )
    return rows


def build_group_rank_rows(match_rows: list[dict[str, str]], team_meta: dict[str, TeamMeta]) -> list[dict[str, str]]:
    stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"wins": 0, "losses": 0, "game_wins": 0, "game_losses": 0, "opponents": []}
    )
    for row in match_rows:
        red_key = next(key for key, meta in team_meta.items() if meta.team_id == row["red_team_id"])
        blue_key = next(key for key, meta in team_meta.items() if meta.team_id == row["blue_team_id"])
        red_wins = int(row["red_side_win_game_count"])
        blue_wins = int(row["blue_side_win_game_count"])
        stats[red_key]["game_wins"] += red_wins
        stats[red_key]["game_losses"] += blue_wins
        stats[blue_key]["game_wins"] += blue_wins
        stats[blue_key]["game_losses"] += red_wins
        stats[red_key]["opponents"].append(blue_key)
        stats[blue_key]["opponents"].append(red_key)
        if row["winner_side"] == "red":
            stats[red_key]["wins"] += 1
            stats[blue_key]["losses"] += 1
        else:
            stats[blue_key]["wins"] += 1
            stats[red_key]["losses"] += 1

    rows: list[dict[str, str]] = []
    for group_name in ("A", "B"):
        group_team_keys = [key for key, meta in team_meta.items() if meta.group_name == group_name]

        def sort_key(team_key: str) -> tuple[int, int, int, int, str]:
            team_stats = stats[team_key]
            opponent_points = sum(stats[opponent]["wins"] for opponent in team_stats["opponents"])
            meta = team_meta[team_key]
            return (
                -team_stats["wins"],
                -(team_stats["game_wins"] - team_stats["game_losses"]),
                -opponent_points,
                meta.seed_rank_in_region,
                meta.slot,
            )

        ordered = sorted(group_team_keys, key=sort_key)
        for order, team_key in enumerate(ordered, start=1):
            meta = team_meta[team_key]
            team_stats = stats[team_key]
            opponent_points = sum(stats[opponent]["wins"] for opponent in team_stats["opponents"])
            w_d_l = f"{team_stats['wins']}/0/{team_stats['losses']}"
            metrics = {
                "胜/平/负": w_d_l,
                "胜场数": team_stats["wins"],
                "对手分": opponent_points,
                "局分净胜": team_stats["game_wins"] - team_stats["game_losses"],
            }
            rows.append(
                {
                    "season": SEASON,
                    "event_code": EVENT_CODE,
                    "league": LEAGUE,
                    "zone_id": ZONE_ID,
                    "zone_name": ZONE_NAME,
                    "group_name": GROUP_NAMES[group_name],
                    "group_order": str(order),
                    "college_name": meta.college_name,
                    "college_logo": meta.college_logo,
                    "team_name": meta.team_name,
                    "w_d_l": w_d_l,
                    "wins": str(team_stats["wins"]),
                    "opponent_points": str(opponent_points),
                    "avg_base_hp_diff": "0",
                    "avg_outpost_hp_diff": "0",
                    "avg_team_damage": "0",
                    "metrics_json": json.dumps(metrics, ensure_ascii=False),
                }
            )
    return rows


def project_rows(rows: list[dict[str, str]], field_names: list[str]) -> list[dict[str, str]]:
    return [{field: row[field] for field in field_names} for row in rows]


def build_cleaned_match_rows(match_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    group_id_to_name = {group_id: group_name for group_name, group_id in GROUP_IDS.items()}
    rows: list[dict[str, str]] = []
    for row in match_rows:
        cleaned_row = {field: row[field] for field in CLEANED_MATCH_FIELDS if field != "group_name"}
        cleaned_row["group_name"] = group_id_to_name[row["group_id"]]
        rows.append(cleaned_row)
    return rows


def write_csv(path: Path, field_names: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=field_names)
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_event_summary() -> dict[str, Any]:
    return {
        "event_code": EVENT_CODE,
        "season": 2026,
        "league": LEAGUE,
        "event_title": EVENT_TITLE,
        "sources": {
            "participants.csv": str(PARTICIPANTS_PATH.relative_to(ROOT)),
            "live_schedule_seed": "south_region?mode=live&seed=20261111",
            "actual_scorelines": "backend/app/south_actual_schedule.py",
        },
        "outputs": {
            "teams.csv": 32,
            "matches.csv": 32,
            "group_rank.csv": 32,
        },
        "note": "Synthetic south-region snapshot through Swiss round 2 generated from the live simulation schedule.",
    }


def build_cleaned_summary() -> dict[str, Any]:
    return {
        "season_dir": EVENT_CODE,
        "source_dir": str(EXTRACTED_DIR),
        "cleaned_dir": str(CLEANED_DIR),
        "files": {
            "teams.csv": {
                "rows": 32,
                "source_rows": 32,
                "filtered_rows": 32,
                "dropped_columns": [
                    "college_logo",
                    "event_title",
                    "group_id",
                    "player_id",
                    "player_name",
                    "zone_id",
                    "zone_type",
                ],
            },
            "matches.csv": {
                "rows": 32,
                "source_rows": 32,
                "filtered_rows": 32,
                "dropped_columns": [
                    "blue_college_logo",
                    "blue_fill_status",
                    "blue_player_id",
                    "blue_player_name",
                    "blue_player_rank",
                    "blue_player_score",
                    "blue_prepared_status",
                    "blue_side_id",
                    "event_title",
                    "group_id",
                    "loser_placehold_name",
                    "red_college_logo",
                    "red_fill_status",
                    "red_player_id",
                    "red_player_name",
                    "red_player_rank",
                    "red_player_score",
                    "red_prepared_status",
                    "red_side_id",
                    "slug",
                    "slug_name",
                    "status",
                    "winner_placehold_name",
                    "zone_id",
                    "zone_type",
                ],
            },
            "group_rank.csv": {
                "rows": 32,
                "source_rows": 32,
                "filtered_rows": 32,
                "dropped_columns": [
                    "college_logo",
                    "metrics_json",
                    "zone_id",
                ],
            },
        },
        "note": "Synthetic south-region snapshot through Swiss round 2.",
    }


def update_summary_index(event_summary: dict[str, Any]) -> None:
    existing = json.loads(SUMMARY_INDEX_PATH.read_text(encoding="utf-8"))
    filtered = [row for row in existing if row.get("event_code") != EVENT_CODE]
    filtered.append(event_summary)
    write_json(SUMMARY_INDEX_PATH, filtered)


def main() -> int:
    args = parse_args()
    payload = load_service_payload()
    participants = load_participants()
    team_logos, school_logos = load_logo_lookup()

    team_rows, team_meta = build_team_rows(payload["slots"], participants, team_logos, school_logos)
    match_rows = build_match_rows(payload["matches"], team_meta)
    group_rank_rows = build_group_rank_rows(match_rows, team_meta)

    write_csv(EXTRACTED_DIR / "teams.csv", TEAM_FIELDS, team_rows)
    write_csv(EXTRACTED_DIR / "matches.csv", MATCH_FIELDS, match_rows)
    write_csv(EXTRACTED_DIR / "group_rank.csv", GROUP_RANK_FIELDS, group_rank_rows)
    write_json(EXTRACTED_DIR / "summary.json", build_event_summary())

    write_csv(CLEANED_DIR / "teams.csv", CLEANED_TEAM_FIELDS, project_rows(team_rows, CLEANED_TEAM_FIELDS))
    write_csv(CLEANED_DIR / "matches.csv", CLEANED_MATCH_FIELDS, build_cleaned_match_rows(match_rows))
    write_csv(CLEANED_DIR / "group_rank.csv", CLEANED_GROUP_RANK_FIELDS, project_rows(group_rank_rows, CLEANED_GROUP_RANK_FIELDS))
    write_json(CLEANED_DIR / "summary.json", build_cleaned_summary())

    if args.write_summary_index:
        update_summary_index(build_event_summary())

    print(
        json.dumps(
            {
                "event_code": EVENT_CODE,
                "teams": len(team_rows),
                "matches": len(match_rows),
                "group_rank_rows": len(group_rank_rows),
                "extracted_dir": str(EXTRACTED_DIR),
                "cleaned_dir": str(CLEANED_DIR),
                "summary_index_updated": bool(args.write_summary_index),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
