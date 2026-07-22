from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any


COMPLETED_MATCH_STATUSES = frozenset({"DONE", "FINISHED", "ENDED", "COMPLETE", "COMPLETED"})
RUNNING_MATCH_STATUSES = frozenset({"RUNNING", "STARTED", "ONGOING", "IN_PROGRESS", "LIVE"})
SUPPORTED_BEST_OF = frozenset({3, 5})
FINAL_EVENT_MATCH_COUNTS = {"repechage": 32, "nationals": 96}
FINAL_EVENT_SLUGS = frozenset(FINAL_EVENT_MATCH_COUNTS)

# Regional events and the nationals event use the same two-group Swiss layout.
SWISS_GROUP_MATCH_COUNTS = {1: 8, 2: 8, 3: 8, 4: 6, 5: 3}
SWISS_ROUND_START_MATCH_NUMBERS: dict[int, int] = {}
_next_swiss_match_number = 1
for _round_number, _group_match_count in SWISS_GROUP_MATCH_COUNTS.items():
    SWISS_ROUND_START_MATCH_NUMBERS[_round_number] = _next_swiss_match_number
    _next_swiss_match_number += _group_match_count * 2
SWISS_TOTAL_MATCHES = _next_swiss_match_number - 1

SCORELINE_RE = re.compile(r"^(\d+):(\d+)$")
EMPTY_RESULT_TOKENS = frozenset({"", "EMPTY", "NONE", "NULL"})


class RequestParameterError(ValueError):
    """Raised only for invalid caller-controlled API parameters."""


class UnknownResourceError(KeyError):
    """Base error for API resources that do not exist."""

    resource_name = "resource"

    def __init__(self, value: Any) -> None:
        self.value = str(value)
        super().__init__(self.value)

    @property
    def detail(self) -> str:
        return f"Unknown {self.resource_name}: {self.value}"


def normalize_match_status(value: Any) -> str:
    return str(value or "").strip().upper()


def normalize_match_result(value: Any) -> str:
    normalized = str(value or "").strip().upper()
    return "" if normalized in EMPTY_RESULT_TOKENS else normalized


def is_completed_match_status(value: Any) -> bool:
    return normalize_match_status(value) in COMPLETED_MATCH_STATUSES


def is_running_match_status(value: Any) -> bool:
    return normalize_match_status(value) in RUNNING_MATCH_STATUSES


@dataclass(frozen=True)
class SeriesScore:
    red_wins: int
    blue_wins: int
    best_of: int

    @property
    def wins_needed(self) -> int:
        return self.best_of // 2 + 1

    @property
    def is_decisive(self) -> bool:
        return (
            self.red_wins == self.wins_needed and self.blue_wins < self.wins_needed
        ) or (
            self.blue_wins == self.wins_needed and self.red_wins < self.wins_needed
        )

    @property
    def winner(self) -> str | None:
        if not self.is_decisive:
            return None
        return "red" if self.red_wins > self.blue_wins else "blue"


@dataclass(frozen=True)
class MatchOutcome:
    status: str
    result: str
    score: SeriesScore | None
    is_completed: bool
    has_live_scoreline: bool


def parse_series_scoreline(value: Any, *, best_of: int) -> SeriesScore:
    if best_of not in SUPPORTED_BEST_OF:
        raise ValueError(f"Unsupported best-of value: {best_of}")
    scoreline = str(value or "").strip()
    parsed = SCORELINE_RE.fullmatch(scoreline)
    if parsed is None:
        raise ValueError(f"Invalid scoreline: {scoreline}")
    score = SeriesScore(int(parsed.group(1)), int(parsed.group(2)), best_of)
    if score.red_wins > score.wins_needed or score.blue_wins > score.wins_needed:
        raise ValueError(f"Scoreline exceeds BO{best_of}: {scoreline}")
    if score.red_wins == score.wins_needed and score.blue_wins == score.wins_needed:
        raise ValueError(f"Both sides cannot reach the winning score in BO{best_of}: {scoreline}")
    return score


def validate_distinct_matchup(
    *,
    is_confirmed: bool,
    red_identity: Any,
    blue_identity: Any,
    context: str,
) -> None:
    red_key = str(red_identity or "").strip()
    blue_key = str(blue_identity or "").strip()
    if is_confirmed and red_key and red_key == blue_key:
        raise ValueError(f"{context} cannot contain the same team twice")


def normalize_match_outcome(
    *,
    status: Any,
    result: Any,
    scoreline: Any,
    best_of: int,
    is_confirmed: bool,
    is_completed: bool = False,
    has_live_scoreline: bool = False,
    context: str = "match",
) -> MatchOutcome:
    """Apply the shared regional/finals score, status, and winner contract."""
    normalized_status = normalize_match_status(status)
    normalized_result = normalize_match_result(result).lower()
    completed = bool(is_completed or is_completed_match_status(normalized_status))
    scoreline_text = str(scoreline or "").strip()
    score: SeriesScore | None = None
    if scoreline_text:
        try:
            score = parse_series_scoreline(scoreline_text, best_of=best_of)
        except ValueError as exc:
            raise ValueError(f"Invalid {context} scoreline: {scoreline_text} ({exc})") from exc

    if completed:
        if not is_confirmed or normalized_result not in {"red", "blue"}:
            raise ValueError(f"Completed {context} lacks confirmed teams or winner")
        if score is None:
            raise ValueError(f"Completed {context} has no scoreline")
        if not score.is_decisive:
            raise ValueError(f"Completed {context} scoreline is not decisive: {scoreline_text}")
        if normalized_result != score.winner:
            label = context[:1].upper() + context[1:]
            raise ValueError(f"{label} winner conflicts with scoreline")
    elif normalized_result:
        raise ValueError(f"Unfinished {context} must not declare a winner")

    return MatchOutcome(
        status=normalized_status,
        result=normalized_result,
        score=score,
        is_completed=completed,
        has_live_scoreline=bool(
            is_confirmed
            and score is not None
            and (
                completed
                or has_live_scoreline
                or is_running_match_status(normalized_status)
                or score.red_wins + score.blue_wins > 0
            )
        ),
    )


def swiss_round_from_match_number(match_number: int | None) -> int | None:
    if match_number is None:
        return None
    for round_number, start in SWISS_ROUND_START_MATCH_NUMBERS.items():
        group_count = SWISS_GROUP_MATCH_COUNTS[round_number]
        if start <= match_number < start + group_count * 2:
            return round_number
    return None


def swiss_group_from_match_number(match_number: int | None) -> str:
    round_number = swiss_round_from_match_number(match_number)
    if round_number is None or match_number is None:
        return ""
    start = SWISS_ROUND_START_MATCH_NUMBERS[round_number]
    group_count = SWISS_GROUP_MATCH_COUNTS[round_number]
    return "A" if match_number < start + group_count else "B"


def swiss_match_label(match_number: int | None, group_name: str | None = None) -> str:
    round_number = swiss_round_from_match_number(match_number)
    if round_number is None or match_number is None:
        return ""
    resolved_group = str(group_name or swiss_group_from_match_number(match_number)).strip().upper()
    if resolved_group not in {"A", "B"}:
        return ""
    start = SWISS_ROUND_START_MATCH_NUMBERS[round_number]
    group_count = SWISS_GROUP_MATCH_COUNTS[round_number]
    group_offset = 0 if resolved_group == "A" else group_count
    group_index = match_number - start - group_offset + 1
    if group_index < 1 or group_index > group_count:
        return ""
    return f"{resolved_group}-SWISS-{round_number}-{group_index}"


def swiss_match_number(round_number: int, group_name: str, group_index: int) -> int | None:
    group_name = str(group_name or "").strip().upper()
    group_count = SWISS_GROUP_MATCH_COUNTS.get(round_number)
    start = SWISS_ROUND_START_MATCH_NUMBERS.get(round_number)
    if start is None or group_count is None or group_name not in {"A", "B"}:
        return None
    if group_index < 1 or group_index > group_count:
        return None
    return start + (group_count if group_name == "B" else 0) + group_index - 1


def source_age_seconds(value: Any, *, now: datetime | None = None) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = parsedate_to_datetime(text) if "," in text else datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    current_time = now or datetime.now(tz=UTC)
    return max(0, int((current_time.astimezone(UTC) - parsed.astimezone(UTC)).total_seconds()))


def build_live_source_status(
    *,
    source_status: str,
    source_kind: str | None,
    source_updated_at: Any,
    artifact_version: str,
    completed_matches: int,
    confirmed_matches: int,
    is_synthetic: bool = False,
    source_reason: Any = None,
    validation_state: str | None = None,
    scenario_id: Any = None,
    scope_present: bool = True,
    missing_scope_reason: str | None = None,
) -> dict[str, Any]:
    normalized_status = str(source_status or "missing").strip().lower()
    if normalized_status == "active" and not scope_present:
        normalized_status = "inactive"
        source_kind = None
        source_updated_at = None
        is_synthetic = False
        source_reason = missing_scope_reason or source_reason
        validation_state = "inactive"
        scenario_id = None
    updated_at = str(source_updated_at or "").strip() or None
    age_seconds = source_age_seconds(updated_at)
    if normalized_status == "missing":
        freshness_label = "missing"
    elif is_synthetic:
        freshness_label = "synthetic"
    elif age_seconds is None:
        freshness_label = "unknown"
    else:
        freshness_label = "fresh" if age_seconds <= 900 else "stale"
    return {
        "sourceStatus": normalized_status,
        "sourceKind": source_kind,
        "isSynthetic": bool(is_synthetic),
        "sourceReason": str(source_reason) if source_reason else None,
        "sourceUpdatedAt": updated_at,
        "sourceAgeSeconds": age_seconds,
        "freshnessLabel": freshness_label,
        "validationState": validation_state or ("validated" if normalized_status == "active" else normalized_status),
        "scenarioId": str(scenario_id) if scenario_id else None,
        "runtimeArtifactVersion": artifact_version,
        "completedMatches": int(completed_matches),
        "confirmedMatches": int(confirmed_matches),
    }
