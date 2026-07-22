from __future__ import annotations

import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

from .artifacts import clear_versioned_csv_cache, path_signature, read_versioned_csv_rows


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_elo as legacy_elo  # noqa: E402


DEFAULT_TEAM_RATINGS_PATH = ROOT / "data" / "derived" / "2026_rmuc_ts2" / "preseason_ratings.csv"


def identity_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"\s+", "", normalized)


def team_identity_key(college_name: Any, team_name: Any) -> tuple[str, str]:
    return (
        identity_text(legacy_elo.normalize_school(str(college_name or ""))),
        identity_text(legacy_elo.normalize_team(str(team_name or ""))),
    )


@lru_cache(maxsize=8)
def _load_rating_catalog(
    ratings_path_text: str,
    _mtime_ns: int,
    _size: int,
) -> dict[str, Any]:
    by_pair: dict[tuple[str, str], dict[str, str]] = {}
    school_candidates: dict[str, list[dict[str, str]]] = {}
    team_candidates: dict[str, list[dict[str, str]]] = {}
    path = Path(ratings_path_text)
    if not path.exists():
        return {"rows": [], "indexes": {"by_pair": {}, "by_school": {}, "by_team": {}}}

    rows = read_versioned_csv_rows(path)
    for row in rows:
        identity = {
            "schoolKey": str(row.get("school_key") or row.get("college_name") or "").strip(),
            "teamKey": str(row.get("team_key") or "").strip(),
        }
        school_key, team_key = team_identity_key(row.get("college_name"), row.get("team_name"))
        if school_key and team_key:
            by_pair[(school_key, team_key)] = identity
        if school_key:
            school_candidates.setdefault(school_key, []).append(identity)
        if team_key:
            team_candidates.setdefault(team_key, []).append(identity)

    return {
        "rows": rows,
        "indexes": {
            "by_pair": by_pair,
            "by_school": {
                school_key: candidates[0]
                for school_key, candidates in school_candidates.items()
                if len(candidates) == 1
            },
            "by_team": {
                team_key: candidates[0]
                for team_key, candidates in team_candidates.items()
                if len(candidates) == 1
            },
        },
    }


def load_rating_rows(ratings_path: Path = DEFAULT_TEAM_RATINGS_PATH) -> list[dict[str, str]]:
    return _load_rating_catalog(*path_signature(ratings_path))["rows"]


def clear_rating_rows_cache() -> None:
    _load_rating_catalog.cache_clear()
    clear_versioned_csv_cache()


load_rating_rows.cache_clear = clear_rating_rows_cache  # type: ignore[attr-defined]


def canonical_school_key(college_name: Any) -> str:
    return legacy_elo.make_school_key(str(college_name or ""))


def resolve_team_identity(
    college_name: Any,
    team_name: Any,
    *,
    ratings_path: Path = DEFAULT_TEAM_RATINGS_PATH,
) -> dict[str, str | bool]:
    school_name = legacy_elo.normalize_school(str(college_name or ""))
    normalized_team_name = legacy_elo.normalize_team(str(team_name or ""))
    school_lookup, team_lookup = team_identity_key(school_name, normalized_team_name)
    indexes = _load_rating_catalog(*path_signature(ratings_path))["indexes"]
    identity = (
        indexes["by_pair"].get((school_lookup, team_lookup))
        or indexes["by_team"].get(team_lookup)
        or indexes["by_school"].get(school_lookup)
    )
    if identity is not None:
        return {
            **identity,
            "collegeName": school_name,
            "teamName": normalized_team_name,
            "matched": True,
        }
    return {
        "schoolKey": legacy_elo.make_school_key(school_name),
        "teamKey": legacy_elo.make_team_key(school_name, normalized_team_name),
        "collegeName": school_name,
        "teamName": normalized_team_name,
        "matched": False,
    }
