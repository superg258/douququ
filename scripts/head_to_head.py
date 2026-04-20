from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import build_rmuc_elo as elo_model


ROOT = Path(__file__).resolve().parents[1]
TS2_MODEL_MANIFEST_PATH = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "model_manifest.json"
HISTORICAL_MATCH_PATHS = (
    ROOT / "data" / "extracted" / "2024RMUC" / "matches.csv",
    ROOT / "data" / "extracted" / "2025RMUC" / "matches.csv",
    ROOT / "data" / "extracted" / "2026RMUL" / "matches.csv",
)
SOURCE_WEIGHTS = {
    "RMUC": 1.0,
    "RMUL": 0.45,
}
TIME_DECAY_HALF_LIFE_DAYS = 365.0
MIN_EFFECTIVE_WEIGHT = 0.35
PRIOR_WEIGHT = 14.0
MAX_DELTA_LOGIT = 0.12


def _clip_probability(value: float) -> float:
    return min(max(float(value), 1e-4), 1.0 - 1e-4)


def _logit(value: float) -> float:
    clipped = _clip_probability(value)
    return math.log(clipped / (1.0 - clipped))


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def _normalize_school_name(value: str) -> str:
    return elo_model.normalize_school(value)


def _resolve_match_source(row: dict[str, Any]) -> str | None:
    league = str(row.get("league", "")).strip().upper()
    if league in SOURCE_WEIGHTS:
        return league
    event_code = str(row.get("event_code", "")).strip().upper()
    for candidate in SOURCE_WEIGHTS:
        if event_code.endswith(candidate):
            return candidate
    return None


def _parse_match_date(value: str) -> date | None:
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _time_decay(match_date: date, reference_date: date) -> float:
    days_ago = max((reference_date - match_date).days, 0)
    return math.exp(-math.log(2.0) * (days_ago / TIME_DECAY_HALF_LIFE_DAYS))


def _effective_match_weight(row: dict[str, Any], reference_date: date) -> tuple[str, float] | None:
    source = _resolve_match_source(row)
    if source is None:
        return None
    match_date = _parse_match_date(str(row.get("match_date", "")))
    if match_date is None:
        return None
    return source, SOURCE_WEIGHTS[source] * _time_decay(match_date, reference_date)


@lru_cache(maxsize=1)
def load_reference_date() -> date:
    manifest = json.loads(TS2_MODEL_MANIFEST_PATH.read_text(encoding="utf-8"))
    return date.fromisoformat(str(manifest["snapshot_date"]))


def build_head_to_head_index(
    rows: Iterable[dict[str, Any]],
    *,
    reference_date: date,
) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        weighted = _effective_match_weight(row, reference_date)
        if weighted is None:
            continue
        source, effective_weight = weighted
        school_a = _normalize_school_name(str(row.get("red_college_name", "")))
        school_b = _normalize_school_name(str(row.get("blue_college_name", "")))
        if not school_a or not school_b or school_a == school_b:
            continue
        pair_key = tuple(sorted((school_a, school_b)))
        summary = index.setdefault(
            pair_key,
            {
                "meetings_count": 0,
                "effective_weight": 0.0,
                "school_scores": defaultdict(float),
                "season_counts": Counter(),
                "season_weights": defaultdict(float),
                "weighted_ties": 0.0,
            },
        )
        summary["meetings_count"] += 1
        summary["effective_weight"] += effective_weight
        summary["season_counts"][source] += 1
        summary["season_weights"][source] += effective_weight

        result = str(row.get("result", "")).strip().upper()
        winner_side = str(row.get("winner_side", "")).strip().lower()
        if result == "TIE":
            summary["school_scores"][school_a] += 0.5 * effective_weight
            summary["school_scores"][school_b] += 0.5 * effective_weight
            summary["weighted_ties"] += effective_weight
            continue
        if winner_side == "red":
            summary["school_scores"][school_a] += effective_weight
        elif winner_side == "blue":
            summary["school_scores"][school_b] += effective_weight
    return index


@lru_cache(maxsize=1)
def load_head_to_head_index() -> dict[tuple[str, str], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in HISTORICAL_MATCH_PATHS:
        rows.extend(elo_model.read_csv(path))
    return build_head_to_head_index(rows, reference_date=load_reference_date())


def summarize_head_to_head(
    school_a: str,
    school_b: str,
    *,
    p_base: float,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    normalized_a = _normalize_school_name(school_a)
    normalized_b = _normalize_school_name(school_b)
    pair_key = tuple(sorted((normalized_a, normalized_b)))
    raw = head_to_head_index.get(pair_key)
    if raw is None:
        return {
            "meetings_count": 0,
            "effective_meeting_weight": 0.0,
            "weighted_record": {
                "school_a_weighted_wins": 0.0,
                "school_b_weighted_wins": 0.0,
                "weighted_ties": 0.0,
            },
            "sources_used": [],
            "season_counts": {},
            "season_weights": {},
            "observed_rate": 0.5,
            "p_base": round(float(p_base), 6),
            "p_h2h": round(float(p_base), 6),
            "reliability": 0.0,
            "delta_logit": 0.0,
            "delta_h2h": 0.0,
            "p_game_adj": round(float(p_base), 6),
        }

    effective_weight = float(raw["effective_weight"])
    score_a = float(raw["school_scores"].get(normalized_a, 0.0))
    score_b = float(raw["school_scores"].get(normalized_b, 0.0))
    observed_rate = 0.5 if effective_weight <= 0.0 else score_a / effective_weight
    if effective_weight < MIN_EFFECTIVE_WEIGHT:
        return {
            "meetings_count": int(raw["meetings_count"]),
            "effective_meeting_weight": round(effective_weight, 6),
            "weighted_record": {
                "school_a_weighted_wins": round(score_a, 6),
                "school_b_weighted_wins": round(score_b, 6),
                "weighted_ties": round(float(raw["weighted_ties"]), 6),
            },
            "sources_used": sorted(raw["season_counts"].keys()),
            "season_counts": dict(sorted(raw["season_counts"].items())),
            "season_weights": {key: round(float(value), 6) for key, value in sorted(raw["season_weights"].items())},
            "observed_rate": round(observed_rate, 6),
            "p_base": round(float(p_base), 6),
            "p_h2h": round(float(p_base), 6),
            "reliability": round(effective_weight / (effective_weight + PRIOR_WEIGHT), 6),
            "delta_logit": 0.0,
            "delta_h2h": 0.0,
            "p_game_adj": round(float(p_base), 6),
        }

    p_base_clipped = _clip_probability(p_base)
    p_shrunk = (score_a + (PRIOR_WEIGHT * p_base_clipped)) / (effective_weight + PRIOR_WEIGHT)
    delta_logit = elo_model.clip(_logit(p_shrunk) - _logit(p_base_clipped), -MAX_DELTA_LOGIT, MAX_DELTA_LOGIT)
    p_game_adj = _sigmoid(_logit(p_base_clipped) + delta_logit)
    delta_h2h = p_game_adj - p_base_clipped
    return {
        "meetings_count": int(raw["meetings_count"]),
        "effective_meeting_weight": round(effective_weight, 6),
        "weighted_record": {
            "school_a_weighted_wins": round(score_a, 6),
            "school_b_weighted_wins": round(score_b, 6),
            "weighted_ties": round(float(raw["weighted_ties"]), 6),
        },
        "sources_used": sorted(raw["season_counts"].keys()),
        "season_counts": dict(sorted(raw["season_counts"].items())),
        "season_weights": {key: round(float(value), 6) for key, value in sorted(raw["season_weights"].items())},
        "observed_rate": round(observed_rate, 6),
        "p_base": round(p_base_clipped, 6),
        "p_h2h": round(p_shrunk, 6),
        "reliability": round(effective_weight / (effective_weight + PRIOR_WEIGHT), 6),
        "delta_logit": round(delta_logit, 6),
        "delta_h2h": round(delta_h2h, 6),
        "p_game_adj": round(p_game_adj, 6),
    }


def configuration_payload() -> dict[str, Any]:
    return {
        "enabled": True,
        "mode": "residual_logit_adjustment",
        "reference_date": load_reference_date().isoformat(),
        "source_weights": SOURCE_WEIGHTS,
        "time_decay_half_life_days": TIME_DECAY_HALF_LIFE_DAYS,
        "min_effective_weight": MIN_EFFECTIVE_WEIGHT,
        "prior_weight": PRIOR_WEIGHT,
        "max_delta_logit": MAX_DELTA_LOGIT,
    }
