from __future__ import annotations

import csv
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable


PathSignature = tuple[str, int, int]
DEFAULT_VOLATILE_KEYS = frozenset(
    {
        "checkedAt",
        "fetchedAt",
        "fetched-at",
        "expiresAt",
        "expires_at",
        "generatedAt",
        "generated_at",
        "lastCheckedAt",
        "sourceAgeSeconds",
    }
)


def semantic_payload(
    payload: Any,
    *,
    volatile_keys: frozenset[str] = DEFAULT_VOLATILE_KEYS,
) -> Any:
    """Return a JSON-compatible payload without operational freshness fields."""
    if isinstance(payload, dict):
        return {
            key: semantic_payload(value, volatile_keys=volatile_keys)
            for key, value in sorted(payload.items())
            if key not in volatile_keys
        }
    if isinstance(payload, list):
        return [semantic_payload(value, volatile_keys=volatile_keys) for value in payload]
    return payload


def semantic_digest(
    payload: Any,
    *,
    volatile_keys: frozenset[str] = DEFAULT_VOLATILE_KEYS,
) -> str:
    """Build a stable sha256 revision from the semantic JSON content."""
    canonical = json.dumps(
        semantic_payload(payload, volatile_keys=volatile_keys),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def path_signature(path: Path) -> PathSignature:
    """Return a cheap cache key that changes whenever an artifact changes."""
    try:
        stat = path.stat()
    except FileNotFoundError:
        return str(path), 0, -1
    return str(path), stat.st_mtime_ns, stat.st_size


def artifact_version(paths: Iterable[Path]) -> str:
    """Serialize artifact signatures for API provenance and cache keys."""
    return "|".join(
        f"{Path(path_text).name}:{mtime_ns}:{size}"
        for path_text, mtime_ns, size in (path_signature(path) for path in paths)
    )


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


@lru_cache(maxsize=32)
def _read_versioned_json_cached(path_text: str, _mtime_ns: int, _size: int) -> Any:
    return read_json(Path(path_text))


def read_versioned_json(path: Path) -> Any:
    """Read a JSON artifact once per path/mtime/size version."""
    return _read_versioned_json_cached(*path_signature(path))


def read_versioned_json_if_exists(path: Path) -> Any | None:
    signature = path_signature(path)
    if signature[2] < 0:
        return None
    return _read_versioned_json_cached(*signature)


def clear_versioned_json_cache() -> None:
    _read_versioned_json_cached.cache_clear()


@lru_cache(maxsize=32)
def _read_versioned_csv_cached(path_text: str, _mtime_ns: int, _size: int) -> list[dict[str, str]]:
    return read_csv_rows(Path(path_text))


def read_versioned_csv_rows(path: Path) -> list[dict[str, str]]:
    return _read_versioned_csv_cached(*path_signature(path))


def clear_versioned_csv_cache() -> None:
    _read_versioned_csv_cached.cache_clear()


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_path.replace(path)
