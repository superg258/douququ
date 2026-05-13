from __future__ import annotations

from types import SimpleNamespace

from backend.app import service


def _team(team_key: str, *, seed_rank: int) -> SimpleNamespace:
    return SimpleNamespace(
        team_key=team_key,
        swiss_status="active",
        swiss_wins=0,
        swiss_losses=0,
        swiss_qualified_round=None,
        swiss_eliminated_round=None,
        swiss_game_diff=0,
        swiss_opponents=[],
        official_opponent_points=None,
        source_reported_opponent_points=None,
        official_avg_base_hp_diff=None,
        official_avg_team_damage=None,
        official_record_seeded=False,
        ranking_metric_source="simulation_proxy",
        ranking_completeness="simulation_proxy",
        mu0=1500.0,
        seed_rank_in_region=seed_rank,
    )


def _empty_official_metric() -> dict[str, float | str]:
    return {
        "wins": 0.0,
        "losses": 0.0,
        "official_opponent_points": 0.0,
        "source_reported_opponent_points": 0.0,
        "official_avg_base_hp_diff": 0.0,
        "official_avg_team_damage": 0.0,
        "ranking_metric_source": "official_live",
        "ranking_completeness": "official_rank_snapshot",
    }


def test_empty_official_rank_snapshot_does_not_freeze_simulated_opponent_score() -> None:
    region_core = service.region_sim.region_core
    two_one = _team("two-one-winner", seed_rank=2)
    two_zero = _team("two-zero-winner", seed_rank=1)
    opponent_of_two_one = _team("opponent-of-two-one", seed_rank=3)
    opponent_of_two_zero = _team("opponent-of-two-zero", seed_rank=4)
    teams = [two_one, two_zero, opponent_of_two_one, opponent_of_two_zero]

    region_core.apply_official_swiss_ranking_metrics(
        teams,
        {team.team_key: _empty_official_metric() for team in teams},
        seed_current_state=True,
    )

    two_one.swiss_wins = 1
    two_one.swiss_game_diff = 1
    two_one.swiss_opponents = [opponent_of_two_one.team_key]
    opponent_of_two_one.swiss_losses = 1
    opponent_of_two_one.swiss_game_diff = -1
    opponent_of_two_one.swiss_opponents = [two_one.team_key]

    two_zero.swiss_wins = 1
    two_zero.swiss_game_diff = 2
    two_zero.swiss_opponents = [opponent_of_two_zero.team_key]
    opponent_of_two_zero.swiss_losses = 1
    opponent_of_two_zero.swiss_game_diff = -2
    opponent_of_two_zero.swiss_opponents = [two_zero.team_key]

    teams_by_key = {team.team_key: team for team in teams}
    ranked = sorted(
        [two_zero, two_one],
        key=lambda team: region_core.swiss_sort_key(team, teams_by_key),
        reverse=True,
    )

    assert region_core.effective_swiss_opponent_score(two_one, teams_by_key) == -1.0
    assert region_core.effective_swiss_opponent_score(two_zero, teams_by_key) == -2.0
    assert [team.team_key for team in ranked] == ["two-one-winner", "two-zero-winner"]


def test_official_rank_snapshot_only_applies_to_matching_completed_state() -> None:
    region_core = service.region_sim.region_core
    official_one_zero = _team("official-one-zero", seed_rank=2)
    predicted_one_zero = _team("predicted-one-zero", seed_rank=1)
    official_opponent = _team("official-opponent", seed_rank=3)
    predicted_opponent = _team("predicted-opponent", seed_rank=4)
    teams = [official_one_zero, predicted_one_zero, official_opponent, predicted_opponent]

    region_core.apply_official_swiss_ranking_metrics(
        teams,
        {
            official_one_zero.team_key: {
                "wins": 1.0,
                "losses": 0.0,
                "official_opponent_points": -1.0,
                "ranking_metric_source": "official_live",
            },
            predicted_one_zero.team_key: {
                "wins": 0.0,
                "losses": 0.0,
                "official_opponent_points": 0.0,
                "ranking_metric_source": "official_live",
            },
        },
    )

    official_one_zero.swiss_wins = 1
    official_one_zero.swiss_game_diff = 1
    official_one_zero.swiss_opponents = [official_opponent.team_key]
    official_opponent.swiss_losses = 1
    official_opponent.swiss_game_diff = -1
    official_opponent.swiss_opponents = [official_one_zero.team_key]

    predicted_one_zero.swiss_wins = 1
    predicted_one_zero.swiss_game_diff = 2
    predicted_one_zero.swiss_opponents = [predicted_opponent.team_key]
    predicted_opponent.swiss_losses = 1
    predicted_opponent.swiss_game_diff = -2
    predicted_opponent.swiss_opponents = [predicted_one_zero.team_key]

    teams_by_key = {team.team_key: team for team in teams}
    ranked = sorted(
        [predicted_one_zero, official_one_zero],
        key=lambda team: region_core.swiss_sort_key(team, teams_by_key),
        reverse=True,
    )

    assert region_core.effective_swiss_opponent_score(official_one_zero, teams_by_key) == -1.0
    assert region_core.effective_swiss_opponent_score(predicted_one_zero, teams_by_key) == -2.0
    assert [team.team_key for team in ranked] == ["official-one-zero", "predicted-one-zero"]
