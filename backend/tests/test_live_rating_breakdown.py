from __future__ import annotations

import pytest

from backend.app import service
from research.trueskill2 import fit


def _ledger_row(
    *,
    match_id: str,
    school_key: str,
    before: float,
    after: float,
    live_delta: float,
    prior_delta: float,
    stage_family: str = "regional_group",
    regional_group_matches_played: int = 1,
) -> dict:
    return {
        "match_id": match_id,
        "school_key": school_key,
        "published_rating_before_match": before,
        "published_rating_after_match": after,
        "live_update_delta_rating": live_delta,
        "prior_component_delta_rating": prior_delta,
        "stage_family": stage_family,
        "regional_group_matches_played": regional_group_matches_played,
    }


def test_attaches_live_and_prior_rating_breakdown_from_match_ledger() -> None:
    payload = {"match_id": "2026RMUC:TEST-1"}
    rating_index = {
        ("2026RMUC:TEST-1", "red-school"): _ledger_row(
            match_id="2026RMUC:TEST-1",
            school_key="red-school",
            before=1700.0,
            after=1694.0,
            live_delta=8.0,
            prior_delta=-14.0,
        ),
        ("2026RMUC:TEST-1", "blue-school"): _ledger_row(
            match_id="2026RMUC:TEST-1",
            school_key="blue-school",
            before=1680.0,
            after=1686.0,
            live_delta=-8.0,
            prior_delta=14.0,
        ),
    }

    service._attach_published_match_rating_history(
        payload,
        red_team_key="red-school::red-team",
        blue_team_key="blue-school::blue-team",
        rating_index=rating_index,
    )

    assert payload["red_rating_before_match"] == 1700.0
    assert payload["red_rating_after_match"] == 1694.0
    assert payload["red_live_delta"] == 8.0
    assert payload["red_prior_delta"] == -14.0
    assert payload["red_prior_adjustment_label"] == "前三轮先验修正"
    assert payload["blue_rating_before_match"] == 1680.0
    assert payload["blue_rating_after_match"] == 1686.0
    assert payload["blue_live_delta"] == -8.0
    assert payload["blue_prior_delta"] == 14.0
    assert payload["blue_prior_adjustment_label"] == "前三轮先验修正"


def test_prior_adjustment_label_is_not_first_three_after_group_window() -> None:
    payload = {"match_id": "2026RMUC:TEST-4"}
    rating_index = {
        ("2026RMUC:TEST-4", "red-school"): _ledger_row(
            match_id="2026RMUC:TEST-4",
            school_key="red-school",
            before=1700.0,
            after=1730.0,
            live_delta=20.0,
            prior_delta=10.0,
            regional_group_matches_played=4,
        ),
        ("2026RMUC:TEST-4", "blue-school"): _ledger_row(
            match_id="2026RMUC:TEST-4",
            school_key="blue-school",
            before=1680.0,
            after=1650.0,
            live_delta=-20.0,
            prior_delta=-10.0,
            regional_group_matches_played=4,
        ),
    }

    service._attach_published_match_rating_history(
        payload,
        red_team_key="red-school::red-team",
        blue_team_key="blue-school::blue-team",
        rating_index=rating_index,
    )

    assert payload["red_prior_adjustment_label"] == "赛前先验修正"
    assert payload["blue_prior_adjustment_label"] == "赛前先验修正"


def test_preseason_mu0_already_includes_regional_prior() -> None:
    row = service.load_ratings_rows()[0]

    assert float(row["mu0"]) == pytest.approx(float(row["regional_pre_rating"]))
    assert float(row["regional_pre_theta"]) == pytest.approx(
        float(row["program_base_theta"]) + float(row["prior_delta_theta"])
    )


def test_supported_prior_is_absorbed_without_prior_rating_delta() -> None:
    resolve_prior = getattr(fit, "_resolve_runtime_prior_components_after_match", None)
    assert resolve_prior is not None

    confirmed_prior, residual_prior, retention, absorption = resolve_prior(
        prior_theta=-0.9,
        live_update_delta_theta=-0.12,
        prior_retention_fraction_before=1.0,
        prior_absorption_fraction_before=0.0,
        stage_family="regional_group",
        regional_group_matches_played=1,
        pre_decay_matches=3,
    )

    assert retention == pytest.approx(1.0)
    assert absorption == pytest.approx(1 / 3)
    assert confirmed_prior + residual_prior == pytest.approx(-0.9)
    assert confirmed_prior == pytest.approx(-0.3)
    assert residual_prior == pytest.approx(-0.6)


def test_reverse_prior_deduction_is_capped_and_never_recovered() -> None:
    resolve_prior = getattr(fit, "_resolve_runtime_prior_components_after_match", None)
    assert resolve_prior is not None

    confirmed_prior, residual_prior, retention, absorption = resolve_prior(
        prior_theta=-0.9,
        live_update_delta_theta=0.9,
        prior_retention_fraction_before=1.0,
        prior_absorption_fraction_before=1 / 3,
        stage_family="regional_group",
        regional_group_matches_played=2,
        pre_decay_matches=3,
    )

    assert retention == pytest.approx(2 / 3)
    assert absorption == pytest.approx(2 / 3)
    assert confirmed_prior + residual_prior == pytest.approx(-0.6)

    confirmed_prior, residual_prior, retention, absorption = resolve_prior(
        prior_theta=-0.9,
        live_update_delta_theta=-0.9,
        prior_retention_fraction_before=retention,
        prior_absorption_fraction_before=absorption,
        stage_family="regional_group",
        regional_group_matches_played=3,
        pre_decay_matches=3,
    )

    assert retention == pytest.approx(2 / 3)
    assert absorption == pytest.approx(1.0)
    assert confirmed_prior == pytest.approx(-0.6)
    assert residual_prior == pytest.approx(0.0)


def test_runtime_prior_components_freeze_after_first_three_group_matches() -> None:
    resolve_prior = getattr(fit, "_resolve_runtime_prior_components_after_match", None)
    assert resolve_prior is not None

    confirmed_prior, residual_prior, retention, absorption = resolve_prior(
        prior_theta=1.0,
        live_update_delta_theta=-1.0,
        prior_retention_fraction_before=0.75,
        prior_absorption_fraction_before=1.0,
        stage_family="regional_group",
        regional_group_matches_played=4,
        pre_decay_matches=3,
    )

    assert retention == pytest.approx(0.75)
    assert absorption == pytest.approx(1.0)
    assert confirmed_prior == pytest.approx(0.75)
    assert residual_prior == pytest.approx(0.0)


def test_live_state_update_does_not_reopen_prior_after_third_group_match(monkeypatch: pytest.MonkeyPatch) -> None:
    pd = pytest.importorskip("pandas")
    monkeypatch.setattr(fit, "_load_2026_region_slug_map", lambda: {"red-school": "south_region", "blue-school": "south_region"})
    monkeypatch.setattr(fit, "require_dataframe_deps", lambda: (pd, None))
    preseason = pd.DataFrame(
        [
            {
                "school_key": "red-school",
                "school_name": "Red School",
                "season": 2026,
                "rmuc_program_base_theta": 0.0,
                "regional_prior_theta": 1.0,
            },
            {
                "school_key": "blue-school",
                "school_name": "Blue School",
                "season": 2026,
                "rmuc_program_base_theta": 0.0,
                "regional_prior_theta": 0.0,
            },
        ]
    )
    existing = pd.DataFrame(
        [
            {
                "match_id": "M3",
                "match_date": "2026-05-01",
                "school_key": "red-school",
                "live_state_theta_after_match": 0.5,
                "confirmed_prior_theta_after_match": 0.75,
                "residual_prior_theta_after_match": 0.0,
                "prior_retention_fraction_after_match": 0.75,
                "prior_absorption_fraction_after_match": 1.0,
                "regional_group_matches_played": 3,
            },
            {
                "match_id": "M3",
                "match_date": "2026-05-01",
                "school_key": "blue-school",
                "live_state_theta_after_match": -0.5,
                "confirmed_prior_theta_after_match": 0.0,
                "residual_prior_theta_after_match": 0.0,
                "prior_retention_fraction_after_match": 1.0,
                "prior_absorption_fraction_after_match": 1.0,
                "regional_group_matches_played": 3,
            },
        ]
    )
    new_matches = pd.DataFrame(
        [
            {
                "ruleset_id": "RMUC",
                "match_id": "M4",
                "match_date": "2026-05-02",
                "season": 2026,
                "stage_family": "regional_group",
                "red_school_key": "red-school",
                "blue_school_key": "blue-school",
                "red_wins": 0,
                "blue_wins": 2,
            }
        ]
    )

    updates = fit.build_published_live_state_updates(
        preseason_snapshot=preseason,
        live_state_store=existing,
        new_matches=new_matches,
        rating_scale=135.0,
        pre_decay_matches=3,
        beta_perf=1.0,
        online_update_scale=3.0,
    )
    red_update = updates[updates["school_key"] == "red-school"].iloc[0]

    assert red_update["regional_group_matches_played"] == 4
    assert red_update["confirmed_prior_theta_after_match"] == 0.75
    assert red_update["residual_prior_theta_after_match"] == 0.0
    assert red_update["prior_retention_fraction_after_match"] == 0.75
    assert red_update["prior_absorption_fraction_after_match"] == 1.0
    assert red_update["prior_component_delta_rating"] == 0.0
