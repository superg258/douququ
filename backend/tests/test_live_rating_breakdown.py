from __future__ import annotations

from backend.app import service


def _ledger_row(
    *,
    match_id: str,
    school_key: str,
    before: float,
    after: float,
    live_delta: float,
    prior_delta: float,
    stage_family: str = "regional_group",
) -> dict:
    return {
        "match_id": match_id,
        "school_key": school_key,
        "published_rating_before_match": before,
        "published_rating_after_match": after,
        "live_update_delta_rating": live_delta,
        "prior_component_delta_rating": prior_delta,
        "stage_family": stage_family,
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
