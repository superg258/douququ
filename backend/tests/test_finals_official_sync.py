from __future__ import annotations

import json
from argparse import Namespace
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from backend.app import finals_schedule, revisions
from backend.app.artifacts import semantic_digest
from scripts import sync_finals_live

GROUP_IDS = {
    "repechage": {"A": "2715", "B": "2716"},
    "nationals": {"A": "2717", "B": "2718"},
}


def _utc_iso(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _unresolved_side(slot: str) -> dict[str, Any]:
    return {
        "playerId": "1",
        "player": {
            "id": "1",
            "name": slot,
            "teamId": None,
            "team": None,
        },
    }


def _official_match(reference: dict[str, Any], event_slug: str) -> dict[str, Any]:
    number = int(reference["number"])
    is_group = reference["stageKey"] == "swiss"
    group_name = str(reference["stage"])[:1] if is_group else ""
    prefix = "41" if event_slug == "repechage" else "51"
    return {
        "id": f"{prefix}{number:03d}",
        "groupId": GROUP_IDS[event_slug][group_name] if is_group else None,
        "matchType": "GROUP" if is_group else "KNOCKOUT",
        "orderNumber": number,
        "planGameCount": int(reference["bestOf"]),
        "planStartedAt": _utc_iso(reference["startsAt"]),
        "result": "EMPTY",
        "slug": None if is_group else str(reference["stage"]),
        "slugName": "1",
        "status": "PENDING",
        "redSideWinGameCount": 0,
        "blueSideWinGameCount": 0,
        "redSide": _unresolved_side(str(reference.get("redSlot") or "")),
        "blueSide": _unresolved_side(str(reference.get("blueSlot") or "")),
    }


def _all_star_match(number: int, group_id: str, best_of: int) -> dict[str, Any]:
    return {
        "id": f"61{number:03d}",
        "groupId": group_id,
        "matchType": "GROUP",
        "orderNumber": number,
        "planGameCount": best_of,
        "planStartedAt": f"2026-08-09T08:{10 if number == 97 else 30}:00Z",
        "result": None,
        "slug": None,
        "slugName": None,
        "status": "WAITING",
        "redSideWinGameCount": 0,
        "blueSideWinGameCount": 0,
        "redSide": _unresolved_side("全明星红方"),
        "blueSide": _unresolved_side("全明星蓝方"),
    }


def _official_payload(base: dict[str, Any]) -> dict[str, Any]:
    zones: list[dict[str, Any]] = []
    for event_slug, zone_name in (("repechage", "复活赛"), ("nationals", "全国赛")):
        group_matches: list[dict[str, Any]] = []
        knockout_matches: list[dict[str, Any]] = []
        for reference in base["events"][event_slug]["matches"]:
            target = group_matches if reference["stageKey"] == "swiss" else knockout_matches
            target.append(_official_match(reference, event_slug))
        groups = [
            {"id": GROUP_IDS[event_slug]["A"], "name": "A"},
            {"id": GROUP_IDS[event_slug]["B"], "name": "B"},
        ]
        if event_slug == "nationals":
            groups.extend(
                [
                    {"id": "2721", "name": "全明星赛-第二局"},
                    {"id": "2722", "name": "全明星赛-第一局"},
                ]
            )
            group_matches.extend(
                [
                    _all_star_match(98, "2721", 2),
                    _all_star_match(97, "2722", 1),
                ]
            )
        zones.append(
            {
                "id": "617" if event_slug == "repechage" else "618",
                "name": zone_name,
                "groups": {"nodes": groups},
                "groupMatches": {"nodes": group_matches},
                "knockoutMatches": {"nodes": knockout_matches},
            }
        )
    zones.append(
        {
            "id": "619",
            "name": "搭建直播",
            "groups": {"nodes": []},
            "groupMatches": {"nodes": []},
            "knockoutMatches": {"nodes": []},
        }
    )
    return {
        "data": {
            "event": {
                "title": "RMUC 2026超级对抗赛",
                "zones": {"nodes": zones},
            }
        }
    }


def _args(tmp_path: Path | None = None) -> Namespace:
    return Namespace(
        input=None,
        source_url="https://example.invalid/live_json/schedule.json",
        base_schedule=finals_schedule.FINALS_SCHEDULE_PATH,
        runtime_dir=tmp_path,
        source_kind="official",
        scenario_id=None,
        source_updated_at=None,
    )


def _zone(payload: dict[str, Any], name: str) -> dict[str, Any]:
    return next(row for row in payload["data"]["event"]["zones"]["nodes"] if row["name"] == name)


def _formal_match(payload: dict[str, Any], zone_name: str, number: int) -> dict[str, Any]:
    zone = _zone(payload, zone_name)
    return next(
        row
        for bucket in ("groupMatches", "knockoutMatches")
        for row in zone[bucket]["nodes"]
        if int(row["orderNumber"]) == number
    )


def _assign_team(side: dict[str, Any], college_name: str, team_name: str) -> None:
    side["player"]["teamId"] = "9001"
    side["player"]["team"] = {
        "id": "9001",
        "collegeName": college_name,
        "name": team_name,
    }


def test_official_schedule_maps_by_order_number_and_excludes_all_star() -> None:
    base = finals_schedule.load_finals_schedule()
    raw = _official_payload(base)
    first = _formal_match(raw, "复活赛", 1)
    first_start = datetime.fromisoformat(first["planStartedAt"].replace("Z", "+00:00"))
    first["planStartedAt"] = (first_start + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
    first.update(
        {
            "status": "DONE",
            "result": "RED",
            "redSideWinGameCount": 2,
            "blueSideWinGameCount": 1,
        }
    )
    _assign_team(first["redSide"], "红方大学", "Red")
    _assign_team(first["blueSide"], "蓝方大学", "Blue")

    normalized = sync_finals_live.normalize_raw_input(
        raw,
        _args(),
        datetime(2026, 7, 29, 9, 0, tzinfo=UTC),
        source_headers={
            "etag": '"finals-v1"',
            "last-modified": "Wed, 29 Jul 2026 08:59:21 GMT",
        },
    )

    assert len(normalized["events"]["repechage"]["matches"]) == 32
    assert len(normalized["events"]["nationals"]["matches"]) == 96
    assert {row["number"] for row in normalized["events"]["nationals"]["matches"]} == set(
        range(1, 97)
    )
    assert not {
        "61097",
        "61098",
    } & {
        row["officialMatchId"]
        for row in normalized["events"]["nationals"]["matches"]
    }
    mapped = normalized["events"]["repechage"]["matches"][0]
    assert mapped == {
        **mapped,
        "number": 1,
        "bestOf": 3,
        "officialMatchId": "41001",
        "officialStatus": "DONE",
        "result": "red",
        "scoreline": "2:1",
        "redWins": 2,
        "blueWins": 1,
        "isCompleted": True,
        "isConfirmedMatchup": True,
        "hasLiveScoreline": True,
        "startsAt": "2026-07-31T19:15:00+08:00",
        "endsAt": "2026-07-31T19:50:00+08:00",
    }
    assert normalized["events"]["repechage"]["matches"][1]["officialStatus"] == "PENDING"
    assert normalized["sourceUpdatedAt"] == "Wed, 29 Jul 2026 08:59:21 GMT"
    assert normalized["lastCheckedAt"] == "2026-07-29T09:00:00+00:00"
    merged = finals_schedule._merge_runtime_event(
        base["events"]["repechage"],
        normalized["events"]["repechage"],
    )
    assert merged["matches"][0]["startTime"] == "19:15"
    assert merged["matches"][0]["endTime"] == "19:50"


@pytest.mark.parametrize(
    ("mutate", "error"),
    [
        (
            lambda raw: _formal_match(raw, "复活赛", 1).__setitem__("planGameCount", 5),
            "does not match reference",
        ),
        (
            lambda raw: _formal_match(raw, "复活赛", 2).__setitem__("orderNumber", 1),
            "duplicate match #1",
        ),
        (
            lambda raw: _formal_match(raw, "全国赛", 1).__setitem__("groupId", "9999"),
            "unexpected groupId",
        ),
        (
            lambda raw: _zone(raw, "全国赛")["groupMatches"]["nodes"].append(
                _all_star_match(99, "2721", 2)
            ),
            "unexpected out-of-range match #99",
        ),
        (
            lambda raw: _zone(raw, "复活赛")["groupMatches"]["nodes"].pop(0),
            "does not cover 1..32",
        ),
    ],
)
def test_official_schedule_mapping_fails_closed(mutate, error: str) -> None:
    raw = _official_payload(finals_schedule.load_finals_schedule())
    mutate(raw)

    with pytest.raises(ValueError, match=error):
        sync_finals_live.normalize_raw_input(
            raw,
            _args(),
            datetime(2026, 7, 29, 9, 0, tzinfo=UTC),
            source_headers={"last-modified": "Wed, 29 Jul 2026 08:59:21 GMT"},
        )


def test_official_source_does_not_invent_source_updated_at() -> None:
    raw = _official_payload(finals_schedule.load_finals_schedule())

    with pytest.raises(ValueError, match="no Last-Modified/sourceUpdatedAt"):
        sync_finals_live.normalize_raw_input(
            raw,
            _args(),
            datetime(2026, 7, 29, 9, 0, tzinfo=UTC),
            source_headers={},
        )


def test_official_reschedule_changes_finals_schedule_revision() -> None:
    base = finals_schedule.load_finals_schedule()
    raw = _official_payload(base)
    runtime_before = sync_finals_live.normalize_raw_input(
        raw,
        _args(),
        datetime(2026, 7, 29, 9, 0, tzinfo=UTC),
        source_headers={"last-modified": "Wed, 29 Jul 2026 08:59:21 GMT"},
    )
    changed_raw = deepcopy(raw)
    changed = _formal_match(changed_raw, "全国赛", 96)
    changed_start = datetime.fromisoformat(changed["planStartedAt"].replace("Z", "+00:00"))
    changed["planStartedAt"] = (changed_start + timedelta(minutes=20)).isoformat().replace(
        "+00:00",
        "Z",
    )
    runtime_after = sync_finals_live.normalize_raw_input(
        changed_raw,
        _args(),
        datetime(2026, 7, 29, 9, 1, tzinfo=UTC),
        source_headers={"last-modified": "Wed, 29 Jul 2026 09:00:21 GMT"},
    )

    before = revisions.finals_revisions(
        reference=base,
        runtime=runtime_before,
        runtime_loaded=True,
    )
    after = revisions.finals_revisions(
        reference=base,
        runtime=runtime_after,
        runtime_loaded=True,
    )

    assert before["scheduleRevision"] != after["scheduleRevision"]
    assert before["dataRevision"] != after["dataRevision"]


def test_sync_once_preserves_last_known_good_and_tracks_304(tmp_path: Path) -> None:
    base = finals_schedule.load_finals_schedule()
    raw = _official_payload(base)
    args = _args(tmp_path)
    first_headers = {
        "etag": '"finals-v1"',
        "last-modified": "Wed, 29 Jul 2026 08:59:21 GMT",
    }

    def first_fetch(*_args, **_kwargs):
        return raw, first_headers, True

    first_checked_at = datetime(2026, 7, 29, 9, 0, tzinfo=UTC)
    sync_finals_live.sync_once(args, fetched_at=first_checked_at, fetcher=first_fetch)
    normalized_path = tmp_path / "normalized_schedule.json"
    first_normalized = json.loads(normalized_path.read_text(encoding="utf-8"))

    def not_modified_fetch(_url, previous_headers, **_kwargs):
        assert previous_headers["etag"] == '"finals-v1"'
        return None, dict(previous_headers), False

    second_checked_at = datetime(2026, 7, 29, 9, 1, tzinfo=UTC)
    sync_finals_live.sync_once(
        args,
        fetched_at=second_checked_at,
        fetcher=not_modified_fetch,
    )
    second_normalized = json.loads(normalized_path.read_text(encoding="utf-8"))
    success_status = json.loads((tmp_path / "check_status.json").read_text(encoding="utf-8"))
    assert semantic_digest(first_normalized) == semantic_digest(second_normalized)
    assert second_normalized["lastCheckedAt"] == second_checked_at.isoformat()
    assert success_status["status"] == "ok"
    assert success_status["lastSuccessAt"] == second_checked_at.isoformat()

    invalid_raw = deepcopy(raw)
    _formal_match(invalid_raw, "复活赛", 1)["planGameCount"] = 5

    def invalid_fetch(*_args, **_kwargs):
        return invalid_raw, {
            "etag": '"finals-invalid"',
            "last-modified": "Wed, 29 Jul 2026 09:02:21 GMT",
        }, True

    with pytest.raises(ValueError, match="does not match reference"):
        sync_finals_live.sync_once(
            args,
            fetched_at=datetime(2026, 7, 29, 9, 2, tzinfo=UTC),
            fetcher=invalid_fetch,
        )

    assert json.loads(normalized_path.read_text(encoding="utf-8")) == second_normalized
    failed_status = json.loads((tmp_path / "check_status.json").read_text(encoding="utf-8"))
    persisted_headers = json.loads(
        (tmp_path / "raw" / "upstream_headers.json").read_text(encoding="utf-8")
    )
    assert failed_status["status"] == "failed"
    assert failed_status["lastSuccessAt"] == second_checked_at.isoformat()
    assert failed_status["lastKnownGoodPreserved"] is True
    assert persisted_headers["etag"] == '"finals-v1"'
