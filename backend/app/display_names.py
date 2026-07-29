from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from .artifacts import read_versioned_json_if_exists


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DISPLAY_NAMES_PATH = ROOT / "configs" / "school_display_names.json"


def load_school_display_overrides(
    config_path: Path = DEFAULT_DISPLAY_NAMES_PATH,
) -> dict[str, dict[str, str]]:
    payload = read_versioned_json_if_exists(config_path)
    if not isinstance(payload, dict) or payload.get("schemaVersion") != "school-display-names-v1":
        return {}
    raw_overrides = payload.get("overrides")
    if not isinstance(raw_overrides, dict):
        return {}
    return {
        str(school_key): {
            str(field): str(value).strip()
            for field, value in raw_override.items()
            if field in {"displayName", "abbreviation4", "abbreviation2"} and str(value).strip()
        }
        for school_key, raw_override in raw_overrides.items()
        if isinstance(raw_override, dict)
    }


def attach_school_display_names(
    identity: Mapping[str, Any],
    *,
    overrides: Mapping[str, Mapping[str, str]] | None = None,
) -> dict[str, Any]:
    """Attach display-only names after canonical identity has been resolved."""
    school_key = str(identity.get("schoolKey") or "").strip()
    college_name = str(identity.get("collegeName") or "").strip()
    override = (overrides or load_school_display_overrides()).get(school_key, {})
    return {
        **identity,
        "displaySchoolName": str(override.get("displayName") or college_name),
        "schoolAbbreviation4": str(override.get("abbreviation4") or "") or None,
        "schoolAbbreviation2": str(override.get("abbreviation2") or "") or None,
    }

