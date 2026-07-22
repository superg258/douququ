#!/usr/bin/env python3
"""Seed a synthetic finals runtime overlay for end-to-end live-chain testing.

Generates correct Swiss pairings: teams with the same record face each other
each round, producing the expected 2-before-round-3 + 2-after-round-3
elimination counts per group.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import finals_schedule, rmuc_live  # noqa: E402
from scripts import sync_finals_live  # noqa: E402


DEFAULT_BASE_SCHEDULE = ROOT / "data" / "reference" / "2026_finals" / "schedule.json"
DEFAULT_RUNTIME_DIR = ROOT / "data" / "runtime" / "rmuc_live" / "finals"
DEFAULT_SCENARIO_ID = "synthetic-finals-repechage-complete-nationals-swiss-round1"


@dataclass(frozen=True)
class ScenarioSpec:
    """One deterministic cross-event snapshot used by the live-chain tests."""

    scenario_id: str
    repechage_completed_numbers: frozenset[int] = frozenset()
    repechage_pending_numbers: frozenset[int] = frozenset()
    repechage_running_number: int | None = None
    national_qualifier_count: int = 0
    nationals_draw_completed: bool = False
    nationals_completed_numbers: frozenset[int] = frozenset()
    nationals_running_number: int | None = None
    description: str = ""


def _through(number: int) -> frozenset[int]:
    return frozenset(range(1, number + 1))


SCENARIO_SPECS: dict[str, ScenarioSpec] = {
    "synthetic-finals-prestart": ScenarioSpec(
        scenario_id="synthetic-finals-prestart",
        description="正式比赛尚未开始，复活赛和全国赛均无运行时对阵覆盖。",
    ),
    "synthetic-finals-repechage-r1-running-national-draw": ScenarioSpec(
        scenario_id="synthetic-finals-repechage-r1-running-national-draw",
        repechage_completed_numbers=_through(8),
        repechage_running_number=9,
        nationals_draw_completed=True,
        description="复活赛首轮已结束、第二轮进行中；全国赛抽签已完成，4 个复活赛席位待确认。",
    ),
    "synthetic-finals-repechage-partial-national-draw": ScenarioSpec(
        scenario_id="synthetic-finals-repechage-partial-national-draw",
        repechage_completed_numbers=_through(20),
        repechage_running_number=21,
        nationals_draw_completed=True,
        description="复活赛进行到第三轮；全国赛抽签已完成，4 个复活赛席位待确认。",
    ),
    "synthetic-finals-repechage-two-qualifiers-national-draw": ScenarioSpec(
        scenario_id="synthetic-finals-repechage-two-qualifiers-national-draw",
        repechage_completed_numbers=_through(30),
        repechage_pending_numbers=frozenset({31, 32}),
        national_qualifier_count=2,
        nationals_draw_completed=True,
        description="复活赛 2 个晋级名额已确定、另 2 个名额仍待定；全国赛抽签已完成。",
    ),
    "synthetic-finals-repechage-complete-national-draw": ScenarioSpec(
        scenario_id="synthetic-finals-repechage-complete-national-draw",
        repechage_completed_numbers=_through(32),
        national_qualifier_count=4,
        nationals_draw_completed=True,
        description="复活赛全部结束，4 个晋级队已确认进入全国赛；全国赛首轮已抽签但尚未开赛。",
    ),
    DEFAULT_SCENARIO_ID: ScenarioSpec(
        scenario_id=DEFAULT_SCENARIO_ID,
        repechage_completed_numbers=_through(32),
        national_qualifier_count=4,
        nationals_draw_completed=True,
        nationals_completed_numbers=_through(16),
        description="复活赛全部结束，全国赛首轮 16 场已完成。",
    ),
    "synthetic-finals-nationals-r1-live-after-repechage": ScenarioSpec(
        scenario_id="synthetic-finals-nationals-r1-live-after-repechage",
        repechage_completed_numbers=_through(32),
        national_qualifier_count=4,
        nationals_draw_completed=True,
        nationals_completed_numbers=frozenset({1, 2, 3, 4}),
        nationals_running_number=5,
        description="复活赛全部结束，全国赛首轮部分完赛且有一场进行中。",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-schedule", type=Path, default=DEFAULT_BASE_SCHEDULE)
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--scenario-id", default=DEFAULT_SCENARIO_ID)
    parser.add_argument(
        "--matrix-dir",
        type=Path,
        default=None,
        help="Write every built-in scenario below this directory instead of activating one scenario.",
    )
    parser.add_argument("--list-scenarios", action="store_true")
    parser.add_argument("--source-updated-at", default=None)
    parser.add_argument(
        "--nationals-2-0-match-numbers",
        default="",
        help="Comma-separated national Swiss-R1 match numbers to force to a 2:0 red win in the synthetic overlay.",
    )
    return parser.parse_args()


def list_scenarios() -> list[ScenarioSpec]:
    return list(SCENARIO_SPECS.values())


def scenario_spec(scenario_id: str) -> ScenarioSpec:
    try:
        return SCENARIO_SPECS[scenario_id]
    except KeyError as exc:
        available = ", ".join(SCENARIO_SPECS)
        raise ValueError(f"Unknown synthetic finals scenario {scenario_id!r}; choose one of: {available}") from exc


def parse_match_number_set(value: str) -> set[int]:
    numbers: set[int] = set()
    for token in str(value or "").split(","):
        token = token.strip()
        if not token:
            continue
        number = int(token)
        if number < 1:
            raise ValueError(f"Synthetic national match number must be positive: {number}")
        numbers.add(number)
    return numbers


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


DRAW_SLOT_GROUPS: dict[str, tuple[tuple[str, tuple[str, ...]], ...]] = {
    "repechage": (
        ("第一梯队", ("A1", "B1", "A2", "B2", "A3", "B3", "A4", "B4")),
        ("第二梯队", ("A5", "B5", "A6", "B6", "A7", "B7", "A8", "B8")),
    ),
    "nationals": (
        ("第一梯队", ("A1", "A2", "B1")),
        ("第二梯队", ("A3", "B2", "B3")),
        ("第三梯队", ("A4", "A5", "B4")),
        ("第四梯队", ("A6", "B5", "B6")),
        ("第五梯队", ("A7", "A8", "B7", "B8")),
        (
            "非种子抽签池",
            (
                "A9", "A10", "A11", "A12", "A13", "A14", "A15", "A16",
                "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16",
            ),
        ),
    ),
}


def canonical_team(participant: dict[str, Any], *, context: str) -> dict[str, str]:
    """Return a real, ratings-canonical team identity for synthetic fixtures."""
    college_name = str(participant.get("collegeName") or "").strip()
    team_name = str(participant.get("teamName") or "").strip()
    if not college_name or not team_name:
        raise ValueError(f"Synthetic {context} participant is missing a school or team name")
    identity = finals_schedule.resolve_final_participant_identity(
        {"collegeName": college_name, "teamName": team_name},
    )
    team_key = str(identity.get("teamKey") or "").strip()
    school_key = str(identity.get("schoolKey") or "").strip()
    if not team_key or not school_key:
        raise ValueError(f"Synthetic {context} participant has no canonical identity: {college_name} · {team_name}")
    return {
        "schoolKey": school_key,
        "teamKey": team_key,
        "collegeName": college_name,
        "teamName": team_name,
        "drawTier": str(participant.get("drawTier") or "").strip(),
    }


def team_pool(event: dict[str, Any], event_slug: str) -> list[dict[str, str]]:
    pool = [
        canonical_team(participant, context=event_slug)
        for participant in event.get("participants", [])
        if isinstance(participant, dict)
    ]
    team_keys = [team["teamKey"] for team in pool]
    if len(pool) < 2:
        raise ValueError(f"Finals event has too few teams for synthetic matchups: {event_slug}")
    if len(team_keys) != len(set(team_keys)):
        raise ValueError(f"Synthetic {event_slug} roster contains duplicate canonical teams")
    return pool


def build_draw_assignments(event_slug: str, pool: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    """Fill official Swiss slots by draw tier in stable participant order."""
    try:
        slot_groups = DRAW_SLOT_GROUPS[event_slug]
    except KeyError as exc:
        raise ValueError(f"Unsupported synthetic draw event: {event_slug}") from exc

    assignments: dict[str, dict[str, str]] = {}
    assigned_team_keys: set[str] = set()
    for tier, slots in slot_groups:
        tier_teams = [team for team in pool if team["drawTier"] == tier]
        if len(tier_teams) != len(slots):
            raise ValueError(
                f"Synthetic {event_slug} draw tier {tier} expects {len(slots)} teams, got {len(tier_teams)}",
            )
        for slot, team in zip(slots, tier_teams, strict=True):
            if team["teamKey"] in assigned_team_keys:
                raise ValueError(f"Synthetic {event_slug} draw repeats {team['teamKey']}")
            assignments[slot] = team
            assigned_team_keys.add(team["teamKey"])

    if len(assignments) != len(pool) or len(assigned_team_keys) != len(pool):
        raise ValueError(f"Synthetic {event_slug} draw does not assign every participant exactly once")
    return assignments


def _pool_slot(match_slot: str) -> str:
    matched = re.search(r"([AB]\d+)$", str(match_slot or "").replace(" ", ""))
    if matched is None:
        raise ValueError(f"Expected a Swiss pool slot, got {match_slot!r}")
    return matched.group(1)


# ── Swiss pairing engine ──────────────────────────────────────────────


def _roman_round(stage: str) -> int | None:
    """Extract Swiss round number (1-5) from a stage label like 'A组瑞士轮第二轮（BO3）'."""
    table = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5}
    for ch, num in table.items():
        if f"第{ch}轮" in stage:
            return num
    return None


def _slot_index(slot: str) -> int:
    """Extract numeric index from a Swiss pool slot like 'Ⅰ-A3' → 3."""
    import re
    m = re.search(r"(\d+)$", slot)
    return int(m.group(1)) if m else 0


def _group_prefix(stage: str) -> str:
    """Return 'A' or 'B' from a stage label."""
    if "A组" in stage:
        return "A"
    if "B组" in stage:
        return "B"
    return "A"


def build_swiss_match_table(
    matches: list[dict[str, Any]], pool: list[dict[str, str]],
) -> dict[int, tuple[int, int]]:
    """Return {match_number: (red_pool_index, blue_pool_index)} for all Swiss matches.

    The pairing follows real Swiss rules:
    - Round 1: teams paired in slot-index order (alternating wins).
    - Round 2+: teams grouped by record, paired within each record bucket,
      then mapped to the slots that the base schedule reserves for that bucket.
    """
    table: dict[int, tuple[int, int]] = {}

    # All Swiss matches sorted by number
    swiss_matches = sorted(
        [m for m in matches if m.get("stageKey") == "swiss"],
        key=lambda m: m["number"],
    )

    # Process each group independently
    for grp in ("A", "B"):
        grp_matches = [m for m in swiss_matches if _group_prefix(m["stage"]) == grp]

        # Pool indices for this group: A → 0..7, B → 8..15
        base = 0 if grp == "A" else 8
        group_pool = list(range(base, base + 8))

        # Track Swiss records: pool_idx → {wins, losses}
        records: dict[int, dict[str, int]] = {idx: {"wins": 0, "losses": 0} for idx in group_pool}

        # ── Round 1 ──
        r1 = sorted([m for m in grp_matches if _roman_round(m["stage"]) == 1], key=lambda m: m["number"])

        # Collect unique round-1 slots and sort by index
        r1_slots = sorted(
            set(s for m in r1 for s in (m.get("redSlot", ""), m.get("blueSlot", ""))),
            key=_slot_index,
        )
        # Assign pool indices to slots in order
        slot_to_pool: dict[str, int] = dict(zip(r1_slots, group_pool))

        for m in r1:
            red_idx = slot_to_pool[m["redSlot"]]
            blue_idx = slot_to_pool[m["blueSlot"]]
            table[m["number"]] = (red_idx, blue_idx)
            # Odd match number → red wins; even → blue wins
            if m["number"] % 2 == 1:
                records[red_idx]["wins"] += 1
                records[blue_idx]["losses"] += 1
            else:
                records[blue_idx]["wins"] += 1
                records[red_idx]["losses"] += 1

        # ── Subsequent rounds ──
        max_round = max(_roman_round(m["stage"]) or 0 for m in grp_matches)
        for rnd in range(2, max_round + 1):
            rnd_matches = sorted(
                [m for m in grp_matches if _roman_round(m["stage"]) == rnd],
                key=lambda m: m["number"],
            )
            # Collect unique slots for this round, sorted by index
            rnd_slots = sorted(
                set(s for m in rnd_matches for s in (m.get("redSlot", ""), m.get("blueSlot", ""))),
                key=_slot_index,
            )

            # Exclude teams that are already eliminated
            alive = [
                idx for idx in group_pool
                if records[idx]["losses"] < 2  # repechage eliminateLosses = 2
            ]

            # Sort alive teams by (wins descending, then by original slot assignment),
            # so higher-record teams map to lower slot indices.
            # Use the round-1 slot index as tiebreaker for consistent ordering.
            r1_slot_for_idx: dict[int, int] = {}
            for idx, slot in zip(group_pool, r1_slots):
                r1_slot_for_idx[idx] = _slot_index(slot)

            alive.sort(key=lambda idx: (-records[idx]["wins"], r1_slot_for_idx.get(idx, 99)))

            # Assign alive teams to this round's slots
            rnd_slot_to_pool: dict[str, int] = {}
            for slot, idx in zip(rnd_slots, alive):
                rnd_slot_to_pool[slot] = idx

            for m in rnd_matches:
                red_idx = rnd_slot_to_pool.get(m["redSlot"])
                blue_idx = rnd_slot_to_pool.get(m["blueSlot"])
                # If either slot is missing (e.g. not enough alive teams), skip
                if red_idx is None or blue_idx is None:
                    continue
                table[m["number"]] = (red_idx, blue_idx)
                # Odd match number → red wins; even → blue wins
                if m["number"] % 2 == 1:
                    records[red_idx]["wins"] += 1
                    records[blue_idx]["losses"] += 1
                else:
                    records[blue_idx]["wins"] += 1
                    records[red_idx]["losses"] += 1

    return table


# ── Raw schedule → enriched schedule ─────────────────────────────────


def should_complete(event_slug: str, match: dict[str, Any]) -> bool:
    # The synthetic scenario intentionally stops national play after Swiss R1.
    return (
        event_slug == "nationals"
        and match.get("stageKey") == "swiss"
        and "第一轮" in str(match.get("stage"))
    )


def completed_overlay_match(
    match: dict[str, Any], red: dict[str, str], blue: dict[str, str],
) -> dict[str, Any]:
    """Create a deterministic completed-match overlay for two resolved teams."""
    number = int(match["number"])
    # Odd match number → red wins 2:1; even → blue wins 1:2
    if number % 2 == 1:
        red_wins, blue_wins = 2, 1
        result = "red"
    else:
        red_wins, blue_wins = 1, 2
        result = "blue"

    return {
        "number": number,
        "bestOf": int(match.get("bestOf") or 3),
        "officialMatchId": f"SYNTH-FINALS-{number:03d}",
        "officialStatus": "DONE",
        "isCompleted": True,
        "isConfirmedMatchup": True,
        "hasLiveScoreline": True,
        "scoreline": f"{red_wins}:{blue_wins}",
        "result": result,
        "redWins": red_wins,
        "blueWins": blue_wins,
        "redSchoolKey": red["schoolKey"],
        "redTeamKey": red["teamKey"],
        "redCollegeName": red["collegeName"],
        "redTeamName": red["teamName"],
        "blueSchoolKey": blue["schoolKey"],
        "blueTeamKey": blue["teamKey"],
        "blueCollegeName": blue["collegeName"],
        "blueTeamName": blue["teamName"],
    }


def _winner_and_loser(match: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    red = {
        "schoolKey": str(match.get("redSchoolKey") or ""),
        "teamKey": str(match.get("redTeamKey") or ""),
        "collegeName": str(match.get("redCollegeName") or ""),
        "teamName": str(match.get("redTeamName") or ""),
        "drawTier": "",
    }
    blue = {
        "schoolKey": str(match.get("blueSchoolKey") or ""),
        "teamKey": str(match.get("blueTeamKey") or ""),
        "collegeName": str(match.get("blueCollegeName") or ""),
        "teamName": str(match.get("blueTeamName") or ""),
        "drawTier": "",
    }
    if not red["teamKey"] or not blue["teamKey"]:
        raise ValueError(f"Synthetic match {match.get('number')} has an unresolved side")
    if match.get("result") == "red":
        return red, blue
    if match.get("result") == "blue":
        return blue, red
    raise ValueError(f"Synthetic match {match.get('number')} has no decisive result")


def _normalize_flow_label(label: Any) -> str:
    return re.sub(r"（[^）]*）$", "", str(label or "")).strip()


def _repechage_pool_by_slot(event: dict[str, Any]) -> list[dict[str, str]]:
    assignments = build_draw_assignments("repechage", team_pool(event, "repechage"))
    return [
        *(assignments[f"A{index}"] for index in range(1, 9)),
        *(assignments[f"B{index}"] for index in range(1, 9)),
    ]


def build_repechage_group_qualifiers(
    matches: list[dict[str, Any]],
    pool: list[dict[str, str]],
    swiss_table: dict[int, tuple[int, int]],
) -> dict[str, dict[str, str]]:
    """Rank the completed synthetic Swiss records into A-1…B-4 bracket slots."""
    records = {index: {"wins": 0, "losses": 0} for index in range(len(pool))}
    for number, (red_index, blue_index) in swiss_table.items():
        if number % 2 == 1:
            records[red_index]["wins"] += 1
            records[blue_index]["losses"] += 1
        else:
            records[blue_index]["wins"] += 1
            records[red_index]["losses"] += 1

    qualifiers: dict[str, dict[str, str]] = {}
    for group, start in (("A", 0), ("B", 8)):
        ranked = sorted(
            range(start, start + 8),
            key=lambda index: (-records[index]["wins"], records[index]["losses"], index),
        )
        if len(ranked) < 4:
            raise ValueError(f"Synthetic repechage {group} group has fewer than four qualifiers")
        for rank, index in enumerate(ranked[:4], start=1):
            qualifiers[f"{group}-{rank}"] = pool[index]
    return qualifiers


def build_repechage_matches(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Complete repechage through its real Swiss and qualification flow graph."""
    pool = _repechage_pool_by_slot(event)
    matches = [dict(match) for match in event.get("matches", []) if isinstance(match, dict)]
    swiss_table = build_swiss_match_table(matches, pool)
    qualifiers = build_repechage_group_qualifiers(matches, pool, swiss_table)
    downstream_slots = {
        _normalize_flow_label(slot)
        for match in matches
        if match.get("stageKey") != "swiss"
        for slot in (match.get("redSlot"), match.get("blueSlot"))
    }
    flow_teams = dict(qualifiers)
    matches_out: list[dict[str, Any]] = []

    for match in matches:
        number = int(match["number"])
        enriched_match = dict(match)
        if match.get("stageKey") == "swiss":
            try:
                red_index, blue_index = swiss_table[number]
            except KeyError as exc:
                raise ValueError(f"Synthetic repechage Swiss match {number} has no pairing") from exc
            red, blue = pool[red_index], pool[blue_index]
        else:
            red = flow_teams.get(_normalize_flow_label(match.get("redSlot")))
            blue = flow_teams.get(_normalize_flow_label(match.get("blueSlot")))
            if red is None or blue is None:
                raise ValueError(
                    f"Synthetic repechage match {number} cannot resolve its official bracket flow",
                )

        enriched_match.update(completed_overlay_match(enriched_match, red, blue))
        enriched_match["officialMatchId"] = f"SYNTH-REPECHAGE-{number:03d}"
        matches_out.append(enriched_match)

        if match.get("stageKey") != "swiss":
            winner, loser = _winner_and_loser(enriched_match)
            for destination, team in ((match.get("winnerTo"), winner), (match.get("loserTo"), loser)):
                normalized_destination = _normalize_flow_label(destination)
                if normalized_destination in downstream_slots:
                    if normalized_destination in flow_teams:
                        raise ValueError(
                            f"Synthetic repechage flow destination is assigned twice: {normalized_destination}",
                        )
                    flow_teams[normalized_destination] = team
    return matches_out


def derive_nationals_qualifiers(repechage_event: dict[str, Any]) -> list[dict[str, Any]]:
    """Materialize only completed repechage winners whose destination is nationals."""
    expected_count = int(repechage_event.get("advancementSlots") or 4)
    qualifiers: list[dict[str, Any]] = []
    seen_team_keys: set[str] = set()
    for match in repechage_event.get("matches", []):
        if not isinstance(match, dict) or match.get("winnerTo") != "全国赛":
            continue
        if not match.get("isCompleted") or not match.get("isConfirmedMatchup"):
            raise ValueError(f"Synthetic repechage qualifier match {match.get('number')} is not complete")
        winner, _ = _winner_and_loser(match)
        canonical = canonical_team(winner, context=f"repechage winner M{match.get('number')}")
        if canonical["teamKey"] in seen_team_keys:
            raise ValueError(f"Synthetic repechage produces a duplicate national qualifier: {canonical['teamKey']}")
        seen_team_keys.add(canonical["teamKey"])
        qualifiers.append(
            {
                **canonical,
                "drawTier": "非种子抽签池",
                "status": "confirmed",
                "entrySource": "repechage",
                "qualifiedFromMatchNumber": int(match["number"]),
            },
        )
    if len(qualifiers) != expected_count:
        raise ValueError(
            f"Synthetic repechage should produce {expected_count} national qualifiers, got {len(qualifiers)}",
        )
    return qualifiers


def append_nationals_qualifiers(
    nationals_event: dict[str, Any], qualifiers: list[dict[str, Any]],
) -> None:
    participants = [dict(row) for row in nationals_event.get("participants", []) if isinstance(row, dict)]
    existing_team_keys = {
        canonical_team(participant, context="nationals roster")["teamKey"]
        for participant in participants
    }
    for qualifier in qualifiers:
        if qualifier["teamKey"] in existing_team_keys:
            raise ValueError(f"Synthetic national qualifier is already in the direct field: {qualifier['teamKey']}")
        participants.append({**qualifier, "order": len(participants) + 1})
        existing_team_keys.add(qualifier["teamKey"])

    expected_size = sum(int(group.get("teamCount") or 0) for group in nationals_event.get("groups", []))
    if len(participants) != expected_size:
        raise ValueError(
            f"Synthetic nationals field expects {expected_size} teams, got {len(participants)}",
        )
    nationals_event["participants"] = participants
    nationals_event["participantCount"] = len(participants)


def build_nationals_round_one_matches(
    event: dict[str, Any],
    nationals_2_0_match_numbers: set[int] | None = None,
) -> list[dict[str, Any]]:
    """Generate the 16 completed national R1 fixtures from the tier-valid 32-team draw."""
    nationals_2_0_match_numbers = nationals_2_0_match_numbers or set()
    assignments = build_draw_assignments("nationals", team_pool(event, "nationals"))
    matches_out: list[dict[str, Any]] = []
    completed = 0
    for match in event.get("matches", []):
        if not isinstance(match, dict):
            continue
        enriched_match = dict(match)
        if should_complete("nationals", enriched_match):
            red = assignments[_pool_slot(str(match.get("redSlot") or ""))]
            blue = assignments[_pool_slot(str(match.get("blueSlot") or ""))]
            enriched_match.update(completed_overlay_match(enriched_match, red, blue))
            if int(match["number"]) in nationals_2_0_match_numbers:
                enriched_match.update(
                    {
                        "scoreline": "2:0",
                        "result": "red",
                        "redWins": 2,
                        "blueWins": 0,
                    }
                )
            enriched_match["officialMatchId"] = f"SYNTH-NATIONALS-{int(match['number']):03d}"
            completed += 1
        matches_out.append(enriched_match)
    if completed != 16:
        raise ValueError(f"Synthetic nationals should complete 16 Swiss-R1 matches, got {completed}")
    return matches_out


def validate_synthetic_schedule(enriched: dict[str, Any]) -> None:
    """Fail closed when the synthetic cross-event field or fixtures are inconsistent."""
    events = enriched.get("events", {})
    repechage = events.get("repechage")
    nationals = events.get("nationals")
    if not isinstance(repechage, dict) or not isinstance(nationals, dict):
        raise ValueError("Synthetic finals schedule is missing a finals event")

    repechage_matches = {int(match["number"]): match for match in repechage.get("matches", []) if isinstance(match, dict)}
    qualification_routes = (
        (29, (23, "winner"), (24, "winner")),
        (30, (26, "winner"), (25, "winner")),
        (31, (29, "loser"), (28, "winner")),
        (32, (27, "winner"), (30, "loser")),
    )
    for number, red_source, blue_source in qualification_routes:
        match = repechage_matches[number]
        red_parent = _winner_and_loser(repechage_matches[red_source[0]])[0 if red_source[1] == "winner" else 1]
        blue_parent = _winner_and_loser(repechage_matches[blue_source[0]])[0 if blue_source[1] == "winner" else 1]
        if match.get("redTeamKey") != red_parent["teamKey"] or match.get("blueTeamKey") != blue_parent["teamKey"]:
            raise ValueError(f"Synthetic repechage M{number} breaks its bracket route")

    national_pool = team_pool(nationals, "nationals")
    national_assignments = build_draw_assignments("nationals", national_pool)
    expected_size = sum(int(group.get("teamCount") or 0) for group in nationals.get("groups", []))
    if len(national_pool) != expected_size:
        raise ValueError(f"Synthetic nationals roster size mismatch: {len(national_pool)} != {expected_size}")
    round_one = [
        match for match in nationals.get("matches", [])
        if isinstance(match, dict) and should_complete("nationals", match)
    ]
    side_keys: list[str] = []
    for match in round_one:
        expected_red = national_assignments[_pool_slot(str(match.get("redSlot") or ""))]
        expected_blue = national_assignments[_pool_slot(str(match.get("blueSlot") or ""))]
        if match.get("redTeamKey") != expected_red["teamKey"] or match.get("blueTeamKey") != expected_blue["teamKey"]:
            raise ValueError(f"Synthetic nationals M{match.get('number')} breaks its draw slot")
        side_keys.extend([expected_red["teamKey"], expected_blue["teamKey"]])
    if len(round_one) != 16 or len(side_keys) != expected_size or len(set(side_keys)) != expected_size:
        raise ValueError("Synthetic nationals round one does not resolve every team exactly once")
    if any(team_key.startswith("SYNTH-") for team_key in side_keys):
        raise ValueError("Synthetic nationals fixtures must not use synthetic team identities")


def build_enriched_schedule(
    base: dict[str, Any],
    nationals_2_0_match_numbers: set[int] | None = None,
) -> tuple[dict[str, Any], dict[str, int]]:
    """Build one coherent, reproducible finals scenario from the official skeleton."""
    enriched = deepcopy(base)
    events = enriched.get("events", {})
    repechage = events.get("repechage")
    nationals = events.get("nationals")
    if not isinstance(repechage, dict) or not isinstance(nationals, dict):
        raise ValueError("Finals base schedule is missing repechage or nationals")

    repechage["matches"] = build_repechage_matches(repechage)
    qualifiers = derive_nationals_qualifiers(repechage)
    append_nationals_qualifiers(nationals, qualifiers)
    nationals["matches"] = build_nationals_round_one_matches(nationals, nationals_2_0_match_numbers)
    validate_synthetic_schedule(enriched)
    return enriched, {"repechage": 32, "nationals": 16}


RUNTIME_SIDE_FIELDS = (
    "SchoolKey",
    "TeamKey",
    "CollegeName",
    "TeamName",
)
RUNTIME_MATCH_FIELDS = (
    "officialMatchId",
    "officialStatus",
    "isCompleted",
    "isConfirmedMatchup",
    "hasLiveScoreline",
    "scoreline",
    "result",
    "redWins",
    "blueWins",
    "redSchoolKey",
    "redTeamKey",
    "redCollegeName",
    "redTeamName",
    "blueSchoolKey",
    "blueTeamKey",
    "blueCollegeName",
    "blueTeamName",
)


def _clear_runtime_match_fields(match: dict[str, Any]) -> None:
    for field in RUNTIME_MATCH_FIELDS:
        match.pop(field, None)


def _copy_match_side(
    target: dict[str, Any],
    source: dict[str, Any],
    side: str,
    *,
    known: bool,
    placeholder_label: str | None = None,
) -> None:
    for suffix in RUNTIME_SIDE_FIELDS:
        field = f"{side}{suffix}"
        target.pop(field, None)
        if known and source.get(field) is not None:
            target[field] = source[field]
    if not known:
        if not placeholder_label:
            raise ValueError(f"Missing placeholder label for unresolved {side} side")
        target[f"{side}CollegeName"] = placeholder_label
        target[f"{side}TeamName"] = "待确认"


def _runtime_match_from_source(
    base_match: dict[str, Any],
    source_match: dict[str, Any],
    *,
    state: str,
    red_known: bool = True,
    blue_known: bool = True,
    red_placeholder: str | None = None,
    blue_placeholder: str | None = None,
) -> dict[str, Any]:
    if state not in {"pending", "running", "completed"}:
        raise ValueError(f"Unsupported synthetic match state: {state}")
    if state == "completed" and not red_known and not blue_known:
        raise ValueError("A completed synthetic match cannot have unresolved sides")

    if state == "completed":
        target = dict(source_match)
        if not red_known or not blue_known:
            raise ValueError("A completed synthetic match cannot have an unresolved side")
        return target

    target = dict(base_match)
    _clear_runtime_match_fields(target)
    target["officialMatchId"] = str(source_match.get("officialMatchId") or "").strip()
    if not target["officialMatchId"]:
        raise ValueError(f"Synthetic match {base_match.get('number')} has no officialMatchId")
    _copy_match_side(
        target,
        source_match,
        "red",
        known=red_known,
        placeholder_label=red_placeholder,
    )
    _copy_match_side(
        target,
        source_match,
        "blue",
        known=blue_known,
        placeholder_label=blue_placeholder,
    )
    target.update(
        {
            "officialStatus": "LIVE" if state == "running" else "PENDING",
            "isCompleted": False,
            "isConfirmedMatchup": red_known and blue_known,
        }
    )
    if state == "running":
        if not red_known or not blue_known:
            raise ValueError("A running synthetic match cannot have an unresolved side")
        target.update(
            {
                "hasLiveScoreline": True,
                "scoreline": "1:0",
            }
        )
    return target


def _national_qualifier_slots(
    nationals_event: dict[str, Any],
    qualifiers: list[dict[str, Any]],
) -> dict[str, tuple[int, str]]:
    assignments = build_draw_assignments("nationals", team_pool(nationals_event, "nationals"))
    qualifier_by_key = {qualifier["teamKey"]: (index, qualifier) for index, qualifier in enumerate(qualifiers, start=1)}
    slots: dict[str, tuple[int, str]] = {}
    for slot, participant in assignments.items():
        qualifier = qualifier_by_key.get(participant["teamKey"])
        if qualifier is not None:
            rank, _ = qualifier
            slots[slot] = (rank, f"复活赛晋级 {rank}")
    if len(slots) != len(qualifiers):
        raise ValueError("Synthetic national draw did not assign every repechage qualifier")
    return slots


def _materialize_scenario(
    full_schedule: dict[str, Any],
    base_schedule: dict[str, Any],
    spec: ScenarioSpec,
) -> tuple[dict[str, Any], dict[str, int]]:
    """Project the complete deterministic bracket into one live-time snapshot."""
    if spec.scenario_id == "synthetic-finals-prestart":
        return deepcopy(base_schedule), {"repechage": 0, "nationals": 0}

    enriched = deepcopy(base_schedule)
    full_events = full_schedule["events"]
    events = enriched["events"]
    full_repechage = full_events["repechage"]
    full_nationals = full_events["nationals"]
    repechage = events["repechage"]
    nationals = events["nationals"]

    full_repechage_by_number = {
        int(match["number"]): match
        for match in full_repechage["matches"]
        if isinstance(match, dict)
    }
    base_repechage_by_number = {
        int(match["number"]): match
        for match in base_schedule["events"]["repechage"]["matches"]
        if isinstance(match, dict)
    }
    repechage_matches: list[dict[str, Any]] = []
    for number in sorted(base_repechage_by_number):
        base_match = base_repechage_by_number[number]
        source_match = full_repechage_by_number[number]
        if number in spec.repechage_completed_numbers:
            match = _runtime_match_from_source(base_match, source_match, state="completed")
        elif number in spec.repechage_pending_numbers:
            match = _runtime_match_from_source(base_match, source_match, state="pending")
        elif number == spec.repechage_running_number:
            match = _runtime_match_from_source(base_match, source_match, state="running")
        else:
            match = dict(base_match)
        repechage_matches.append(match)
    repechage["matches"] = repechage_matches

    all_qualifiers = [
        dict(participant)
        for participant in full_nationals.get("participants", [])[28:]
        if isinstance(participant, dict)
    ]
    if spec.national_qualifier_count > len(all_qualifiers):
        raise ValueError(
            f"Synthetic scenario requests {spec.national_qualifier_count} qualifiers, got {len(all_qualifiers)}",
        )
    confirmed_qualifiers = all_qualifiers[:spec.national_qualifier_count]
    nationals["participants"] = [
        *[dict(participant) for participant in base_schedule["events"]["nationals"]["participants"]],
        *confirmed_qualifiers,
    ]
    nationals["participantCount"] = len(nationals["participants"])
    nationals["fieldCapacity"] = sum(int(group.get("teamCount") or 0) for group in nationals.get("groups", []))
    nationals["drawStatus"] = "completed" if spec.nationals_draw_completed else "pending"

    full_national_pool = team_pool(full_nationals, "nationals")
    full_assignments = build_draw_assignments("nationals", full_national_pool)
    qualifier_keys = {qualifier["teamKey"] for qualifier in all_qualifiers}
    confirmed_qualifier_keys = {qualifier["teamKey"] for qualifier in confirmed_qualifiers}
    qualifier_rank_by_key = {
        qualifier["teamKey"]: rank
        for rank, qualifier in enumerate(all_qualifiers, start=1)
    }
    pending_entry_slots: list[dict[str, Any]] = []
    for slot, participant in full_assignments.items():
        if participant["teamKey"] in qualifier_keys and participant["teamKey"] not in confirmed_qualifier_keys:
            rank = qualifier_rank_by_key[participant["teamKey"]]
            pending_entry_slots.append(
                {
                    "slot": f"Ⅰ-{slot}",
                    "label": f"复活赛晋级 {rank}",
                    "sourceEvent": "repechage",
                    "sourceRank": rank,
                    "status": "pending",
                }
            )
    nationals["pendingEntrySlots"] = sorted(pending_entry_slots, key=lambda row: row["sourceRank"])
    nationals["pendingEntryCount"] = len(pending_entry_slots)

    full_national_by_number = {
        int(match["number"]): match
        for match in full_nationals["matches"]
        if isinstance(match, dict)
    }
    base_national_by_number = {
        int(match["number"]): match
        for match in base_schedule["events"]["nationals"]["matches"]
        if isinstance(match, dict)
    }
    nationals_matches: list[dict[str, Any]] = []
    for number in sorted(base_national_by_number):
        base_match = base_national_by_number[number]
        source_match = full_national_by_number[number]
        if not spec.nationals_draw_completed or number > 16:
            nationals_matches.append(dict(base_match))
            continue

        red_key = str(source_match.get("redTeamKey") or "")
        blue_key = str(source_match.get("blueTeamKey") or "")
        red_known = red_key not in qualifier_keys or red_key in confirmed_qualifier_keys
        blue_known = blue_key not in qualifier_keys or blue_key in confirmed_qualifier_keys
        red_rank = qualifier_rank_by_key.get(red_key)
        blue_rank = qualifier_rank_by_key.get(blue_key)
        if number in spec.nationals_completed_numbers:
            match = _runtime_match_from_source(
                base_match,
                source_match,
                state="completed",
                red_known=red_known,
                blue_known=blue_known,
            )
        elif number == spec.nationals_running_number:
            match = _runtime_match_from_source(
                base_match,
                source_match,
                state="running",
                red_known=red_known,
                blue_known=blue_known,
            )
        else:
            match = _runtime_match_from_source(
                base_match,
                source_match,
                state="pending",
                red_known=red_known,
                blue_known=blue_known,
                red_placeholder=f"复活赛晋级 {red_rank}" if red_rank and not red_known else None,
                blue_placeholder=f"复活赛晋级 {blue_rank}" if blue_rank and not blue_known else None,
            )
        nationals_matches.append(match)
    nationals["matches"] = nationals_matches

    completed_by_event = {
        "repechage": sum(match.get("isCompleted") is True for match in repechage_matches),
        "nationals": sum(match.get("isCompleted") is True for match in nationals_matches),
    }
    return enriched, completed_by_event


def build_scenario_schedule(
    base: dict[str, Any],
    scenario_id: str,
    nationals_2_0_match_numbers: set[int] | None = None,
) -> tuple[dict[str, Any], dict[str, int]]:
    """Build one named snapshot; the official reference schedule is never mutated."""
    spec = scenario_spec(scenario_id)
    full_schedule, _ = build_enriched_schedule(base, nationals_2_0_match_numbers)
    return _materialize_scenario(full_schedule, base, spec)


def write_runtime_artifacts(
    base: dict[str, Any],
    *,
    base_schedule: Path,
    runtime_dir: Path,
    scenario_id: str,
    source_updated_at: str,
    fetched_at: datetime,
    nationals_2_0_match_numbers: set[int] | None = None,
) -> dict[str, Any]:
    enriched, completed_by_event = build_scenario_schedule(
        base,
        scenario_id,
        nationals_2_0_match_numbers,
    )
    normalize_args = argparse.Namespace(
        input=None,
        source_url=None,
        base_schedule=base_schedule,
        source_kind="synthetic",
        scenario_id=scenario_id,
        source_updated_at=source_updated_at,
    )
    normalized = sync_finals_live.normalize_raw_input(
        enriched, normalize_args, fetched_at
    )
    raw_dir = runtime_dir / "raw"
    timestamp = fetched_at.strftime("%Y%m%dT%H%M%SZ")
    rmuc_live.write_json_atomic(raw_dir / "finals_schedule.json", enriched)
    rmuc_live.write_json_atomic(
        raw_dir / f"finals_schedule.{timestamp}.json", enriched
    )
    rmuc_live.write_json_atomic(
        runtime_dir / "normalized_schedule.json", normalized
    )

    match_count = sum(
        len(event.get("matches", [])) for event in normalized["events"].values()
    )
    completed_count = sum(
        match.get("isCompleted") is True
        for event in normalized["events"].values()
        for match in event.get("matches", [])
    )
    manifest = {
        "schemaVersion": "rmuc-finals-live-manifest-v1",
        "generatedAt": fetched_at.isoformat(),
        "sourceStatus": normalized["sourceStatus"],
        "sourceKind": normalized["sourceKind"],
        "sourceUpdatedAt": normalized.get("sourceUpdatedAt"),
        "scenarioId": normalized.get("scenarioId"),
        "sourceChanged": True,
        "matchCount": match_count,
        "completedMatches": completed_count,
        "completedMatchesByEvent": completed_by_event,
        "description": scenario_spec(scenario_id).description,
    }
    rmuc_live.write_json_atomic(runtime_dir / "sync_manifest.json", manifest)
    return manifest


def main() -> None:
    args = parse_args()
    if args.list_scenarios:
        for spec in list_scenarios():
            print(f"{spec.scenario_id}\t{spec.description}")
        return

    base = read_json(args.base_schedule)
    nationals_2_0_match_numbers = parse_match_number_set(args.nationals_2_0_match_numbers)
    source_updated_at = args.source_updated_at or datetime.now(
        tz=ZoneInfo("Asia/Shanghai")
    ).isoformat()
    fetched_at = datetime.now(tz=UTC)
    if args.matrix_dir is not None:
        for spec in list_scenarios():
            manifest = write_runtime_artifacts(
                base,
                base_schedule=args.base_schedule,
                runtime_dir=args.matrix_dir / spec.scenario_id,
                scenario_id=spec.scenario_id,
                source_updated_at=source_updated_at,
                fetched_at=fetched_at,
                nationals_2_0_match_numbers=nationals_2_0_match_numbers,
            )
            print(json.dumps(manifest, ensure_ascii=False))
        return

    manifest = write_runtime_artifacts(
        base,
        base_schedule=args.base_schedule,
        runtime_dir=args.runtime_dir,
        scenario_id=args.scenario_id,
        source_updated_at=source_updated_at,
        fetched_at=fetched_at,
        nationals_2_0_match_numbers=nationals_2_0_match_numbers,
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
