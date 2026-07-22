from __future__ import annotations

from argparse import Namespace
from datetime import UTC, datetime

from backend.app import finals_live, finals_schedule
from scripts import seed_finals_live_mock, sync_finals_live


def _winner_key(match: dict) -> str:
    return str(match["redTeamKey"] if match["result"] == "red" else match["blueTeamKey"])


def _loser_key(match: dict) -> str:
    return str(match["blueTeamKey"] if match["result"] == "red" else match["redTeamKey"])


def _sync_args(scenario_id: str = seed_finals_live_mock.DEFAULT_SCENARIO_ID) -> Namespace:
    return Namespace(
        input=None,
        source_url=None,
        base_schedule=seed_finals_live_mock.DEFAULT_BASE_SCHEDULE,
        source_kind="synthetic",
        scenario_id=scenario_id,
        source_updated_at="2026-07-22T12:00:00+08:00",
    )


def test_seed_builds_a_bracket_consistent_32_team_nationals_round_one() -> None:
    enriched, completed = seed_finals_live_mock.build_enriched_schedule(
        finals_schedule.load_finals_schedule(),
    )
    repechage = enriched["events"]["repechage"]
    nationals = enriched["events"]["nationals"]
    repechage_matches = {int(match["number"]): match for match in repechage["matches"]}

    assert completed == {"repechage": 32, "nationals": 16}

    # M23–M32 must follow the published winner/loser bracket, rather than the
    # old independent modulo pairing fallback.
    assert repechage_matches[29]["redTeamKey"] == _winner_key(repechage_matches[23])
    assert repechage_matches[29]["blueTeamKey"] == _winner_key(repechage_matches[24])
    assert repechage_matches[30]["redTeamKey"] == _winner_key(repechage_matches[26])
    assert repechage_matches[30]["blueTeamKey"] == _winner_key(repechage_matches[25])
    assert repechage_matches[31]["redTeamKey"] == _loser_key(repechage_matches[29])
    assert repechage_matches[31]["blueTeamKey"] == _winner_key(repechage_matches[28])
    assert repechage_matches[32]["redTeamKey"] == _winner_key(repechage_matches[27])
    assert repechage_matches[32]["blueTeamKey"] == _loser_key(repechage_matches[30])

    qualifier_rows = nationals["participants"][28:]
    qualifier_keys = {row["teamKey"] for row in qualifier_rows}
    assert len(nationals["participants"]) == 32
    assert nationals["participantCount"] == 32
    assert all(row["status"] == "confirmed" for row in qualifier_rows)
    assert all(row["drawTier"] == "非种子抽签池" for row in qualifier_rows)
    assert {row["qualifiedFromMatchNumber"] for row in qualifier_rows} == {29, 30, 31, 32}
    assert qualifier_keys == {_winner_key(repechage_matches[number]) for number in range(29, 33)}

    national_pool = seed_finals_live_mock.team_pool(nationals, "nationals")
    assignments = seed_finals_live_mock.build_draw_assignments("nationals", national_pool)
    first_round = nationals["matches"][:16]
    side_keys = []
    for match in first_round:
        red_slot = seed_finals_live_mock._pool_slot(match["redSlot"])
        blue_slot = seed_finals_live_mock._pool_slot(match["blueSlot"])
        assert match["redTeamKey"] == assignments[red_slot]["teamKey"]
        assert match["blueTeamKey"] == assignments[blue_slot]["teamKey"]
        assert match["redCollegeName"] == assignments[red_slot]["collegeName"]
        assert match["blueCollegeName"] == assignments[blue_slot]["collegeName"]
        side_keys.extend([match["redTeamKey"], match["blueTeamKey"]])

    assert len(side_keys) == 32
    assert len(set(side_keys)) == 32
    assert set(side_keys) == {team["teamKey"] for team in national_pool}
    assert not any(team_key.startswith("SYNTH-") for team_key in side_keys)

    runtime = sync_finals_live.normalize_raw_input(
        enriched,
        _sync_args(),
        datetime(2026, 7, 22, tzinfo=UTC),
    )
    national_runtime = runtime["events"]["nationals"]
    assert len(national_runtime["participants"]) == 4
    assert {row["teamKey"] for row in national_runtime["participants"]} == qualifier_keys
    assert len(national_runtime["matches"]) == 16
    assert all(match["isCompleted"] is True for match in national_runtime["matches"])


def test_seed_scenario_matrix_preserves_partial_cross_event_states() -> None:
    base = finals_schedule.load_finals_schedule()
    expected = {
        "synthetic-finals-prestart": (0, 0, 0, 0),
        "synthetic-finals-repechage-r1-running-national-draw": (8, 0, 0, 4),
        "synthetic-finals-repechage-partial-national-draw": (20, 0, 0, 4),
        "synthetic-finals-repechage-two-qualifiers-national-draw": (30, 0, 2, 2),
        "synthetic-finals-repechage-complete-national-draw": (32, 0, 4, 0),
        seed_finals_live_mock.DEFAULT_SCENARIO_ID: (32, 16, 4, 0),
        "synthetic-finals-nationals-r1-live-after-repechage": (32, 4, 4, 0),
    }

    for scenario_id, (repechage_completed, nationals_completed, qualifier_count, pending_count) in expected.items():
        enriched, completed = seed_finals_live_mock.build_scenario_schedule(base, scenario_id)
        runtime = sync_finals_live.normalize_raw_input(
            enriched,
            _sync_args(scenario_id),
            datetime(2026, 7, 22, tzinfo=UTC),
        )
        assert completed == {"repechage": repechage_completed, "nationals": nationals_completed}
        assert runtime["sourceKind"] == "synthetic"
        assert runtime["scenarioId"] == scenario_id

        repechage_runtime = runtime.get("events", {}).get("repechage", {})
        nationals_runtime = runtime.get("events", {}).get("nationals", {})
        assert sum(match.get("isCompleted") is True for match in repechage_runtime.get("matches", [])) == repechage_completed
        assert sum(match.get("isCompleted") is True for match in nationals_runtime.get("matches", [])) == nationals_completed
        assert len(nationals_runtime.get("participants", [])) == qualifier_count
        assert nationals_runtime.get("pendingEntryCount", 0) == pending_count

        finals_live.validate_runtime_payload(runtime)

    _, two_qualifier_runtime_counts = seed_finals_live_mock.build_scenario_schedule(
        base,
        "synthetic-finals-repechage-two-qualifiers-national-draw",
    )
    assert two_qualifier_runtime_counts == {"repechage": 30, "nationals": 0}


def test_partial_national_draw_has_explicit_unresolved_repechage_slots() -> None:
    base = finals_schedule.load_finals_schedule()
    enriched, _ = seed_finals_live_mock.build_scenario_schedule(
        base,
        "synthetic-finals-repechage-two-qualifiers-national-draw",
    )
    runtime = sync_finals_live.normalize_raw_input(
        enriched,
        _sync_args("synthetic-finals-repechage-two-qualifiers-national-draw"),
        datetime(2026, 7, 22, tzinfo=UTC),
    )
    event = runtime["events"]["nationals"]

    assert event["pendingEntryCount"] == 2
    assert [slot["label"] for slot in event["pendingEntrySlots"]] == ["复活赛晋级 3", "复活赛晋级 4"]
    unresolved = [match for match in event["matches"] if match.get("isConfirmedMatchup") is False]
    assert {match["number"] for match in unresolved} == {15, 16}
    assert all("复活赛晋级" in match["blueCollegeName"] for match in unresolved)
    assert all(match["isCompleted"] is False for match in unresolved)
