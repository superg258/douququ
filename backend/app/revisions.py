from __future__ import annotations

from functools import lru_cache
from typing import Any

from . import finals_live, finals_schedule, service
from .artifacts import (
    PathSignature,
    path_signature,
    read_versioned_json_if_exists,
    semantic_digest,
)


def _dict(payload: Any) -> dict[str, Any]:
    return payload if isinstance(payload, dict) else {}


def _list(payload: Any) -> list[Any]:
    return payload if isinstance(payload, list) else []


def current_model_version() -> str:
    published_dir = service._effective_published_dir()
    manifest = _dict(
        read_versioned_json_if_exists(service._published_manifest_path_for(published_dir))
    )
    return str(
        manifest.get("model_version")
        or manifest.get("source_model_dir")
        or manifest.get("schema_version")
        or "ts2-elo-simulation-v1"
    )


def _revision_input_signatures() -> tuple[PathSignature, ...]:
    published_dir = service._effective_published_dir()
    return tuple(
        path_signature(path)
        for path in (
            service.NORMALIZED_LIVE_SCHEDULE_PATH,
            service.MINI_PROGRAM_PREDICTIONS_PATH,
            service.PREDICTION_FORM_OBSERVATIONS_PATH,
            service.PRESEASON_RATINGS_CSV,
            service._published_manifest_path_for(published_dir),
            service._published_current_snapshot_path_for(published_dir),
            service._published_live_match_ledger_path_for(published_dir),
            finals_schedule.FINALS_SCHEDULE_PATH,
            finals_live.FINALS_RUNTIME_PATH,
            finals_live.FINALS_MINI_PROGRAM_PREDICTIONS_PATH,
        )
    )


def _region_school_keys(region_slug: str) -> set[str]:
    return {
        str(row.get("school_key"))
        for row in service.load_ratings_rows()
        if row.get("admitted_region") == service.resolve_region_name(region_slug) and row.get("school_key")
    }


def _regional_revision_inputs(region_slug: str) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized = _dict(read_versioned_json_if_exists(service.NORMALIZED_LIVE_SCHEDULE_PATH))
    region = _dict(_dict(normalized.get("regions")).get(region_slug))
    schedule_input = {
        "schemaVersion": normalized.get("schemaVersion"),
        "sourceStatus": normalized.get("sourceStatus"),
        "sourceKind": normalized.get("sourceKind"),
        "isSynthetic": normalized.get("isSynthetic"),
        "reason": normalized.get("reason"),
        "eventTitle": normalized.get("eventTitle"),
        "season": normalized.get("season"),
        "sourceUpdatedAt": normalized.get("sourceUpdatedAt"),
        "region": region,
    }

    published_dir = service._effective_published_dir()
    manifest = _dict(
        read_versioned_json_if_exists(service._published_manifest_path_for(published_dir))
    )
    school_keys = _region_school_keys(region_slug)
    snapshot = [
        row
        for row in _list(
            read_versioned_json_if_exists(service._published_current_snapshot_path_for(published_dir))
        )
        if isinstance(row, dict) and str(row.get("school_key")) in school_keys
    ]
    ledger = [
        row
        for row in _list(
            read_versioned_json_if_exists(service._published_live_match_ledger_path_for(published_dir))
        )
        if isinstance(row, dict)
        and (
            str(row.get("region_slug")) == region_slug
            or str(row.get("school_key")) in school_keys
        )
    ]
    rating_input = {
        "modelVersion": current_model_version(),
        "modelConfigSignature": manifest.get("model_config_signature"),
        "ratingScale": manifest.get("rating_scale"),
        "snapshot": snapshot,
        "ledger": ledger,
        "miniProgramPredictions": read_versioned_json_if_exists(
            service.MINI_PROGRAM_PREDICTIONS_PATH
        ),
        "predictionFormObservations": read_versioned_json_if_exists(
            service.PREDICTION_FORM_OBSERVATIONS_PATH
        ),
    }
    return schedule_input, rating_input


def _build_region_revisions(region_slug: str) -> dict[str, str]:
    schedule_input, rating_input = _regional_revision_inputs(region_slug)
    schedule_revision = semantic_digest(schedule_input)
    rating_revision = semantic_digest(rating_input)
    return {
        "scheduleRevision": schedule_revision,
        "ratingRevision": rating_revision,
        "dataRevision": semantic_digest(
            {"scheduleRevision": schedule_revision, "ratingRevision": rating_revision}
        ),
    }


@lru_cache(maxsize=32)
def _region_revisions_cached(
    region_slug: str,
    _signatures: tuple[PathSignature, ...],
) -> dict[str, str]:
    return _build_region_revisions(region_slug)


def region_revisions(region_slug: str) -> dict[str, str]:
    return _region_revisions_cached(region_slug, _revision_input_signatures())


def _finals_revision_inputs(
    *,
    reference: dict[str, Any] | None = None,
    runtime: dict[str, Any] | None = None,
    runtime_loaded: bool = False,
    mini_program_predictions: dict[str, dict[str, Any]] | None = None,
    predictions_loaded: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    reference = reference or finals_schedule.load_finals_schedule()
    if not runtime_loaded:
        runtime = finals_live.load_finals_runtime()
    if not predictions_loaded:
        mini_program_predictions = finals_live.load_finals_mini_program_predictions()
    published_dir = service._effective_published_dir()
    manifest = _dict(
        read_versioned_json_if_exists(service._published_manifest_path_for(published_dir))
    )
    rating_input = {
        "runtime": runtime,
        "modelVersion": current_model_version(),
        "modelConfigSignature": manifest.get("model_config_signature"),
        "ratingScale": manifest.get("rating_scale"),
        "snapshot": read_versioned_json_if_exists(
            service._published_current_snapshot_path_for(published_dir)
        ),
        # Audience votes are presentation-only.  They participate in the
        # revision so clients refresh, but finals probability construction
        # never reads this field.
        "miniProgramPredictions": mini_program_predictions,
    }
    schedule_input = {
        "reference": reference,
        # Runtime match times, official IDs, assignments, statuses and scores
        # are part of the served finals schedule.  In particular, an official
        # reschedule must invalidate scheduleRevision/dataRevision even though
        # the immutable reference file did not change.
        "runtime": runtime,
    }
    return schedule_input, rating_input


def finals_revisions(
    *,
    reference: dict[str, Any] | None = None,
    runtime: dict[str, Any] | None = None,
    runtime_loaded: bool = False,
    mini_program_predictions: dict[str, dict[str, Any]] | None = None,
    predictions_loaded: bool = False,
) -> dict[str, str]:
    if (
        reference is None
        and runtime is None
        and not runtime_loaded
        and mini_program_predictions is None
        and not predictions_loaded
    ):
        return _finals_revisions_cached(_revision_input_signatures())
    return _build_finals_revisions(
        reference=reference,
        runtime=runtime,
        runtime_loaded=runtime_loaded,
        mini_program_predictions=mini_program_predictions,
        predictions_loaded=predictions_loaded,
    )


def _build_finals_revisions(
    *,
    reference: dict[str, Any] | None = None,
    runtime: dict[str, Any] | None = None,
    runtime_loaded: bool = False,
    mini_program_predictions: dict[str, dict[str, Any]] | None = None,
    predictions_loaded: bool = False,
) -> dict[str, str]:
    schedule_input, rating_input = _finals_revision_inputs(
        reference=reference,
        runtime=runtime,
        runtime_loaded=runtime_loaded,
        mini_program_predictions=mini_program_predictions,
        predictions_loaded=predictions_loaded,
    )
    schedule_revision = semantic_digest(schedule_input)
    rating_revision = semantic_digest(rating_input)
    return {
        "scheduleRevision": schedule_revision,
        "ratingRevision": rating_revision,
        "dataRevision": semantic_digest(
            {"scheduleRevision": schedule_revision, "ratingRevision": rating_revision}
        ),
    }


@lru_cache(maxsize=16)
def _finals_revisions_cached(
    _signatures: tuple[PathSignature, ...],
) -> dict[str, str]:
    return _build_finals_revisions()


def _build_live_revisions_payload() -> dict[str, Any]:
    regions: dict[str, Any] = {}
    for region_slug in service.REGION_SLUG_ORDER:
        status = service.summarize_live_status(region_slug)
        regions[region_slug] = {
            **region_revisions(region_slug),
            "sourceStatus": status.get("sourceStatus"),
            "sourceKind": status.get("sourceKind"),
            "isSynthetic": status.get("isSynthetic") is True,
            "sourceUpdatedAt": status.get("sourceUpdatedAt"),
            "completedOfficialMatches": status.get("completedOfficialMatches", 0),
            "confirmedOfficialMatches": status.get("confirmedOfficialMatches", 0),
            "syncMode": "automatic-30s",
        }

    runtime = finals_live.load_finals_runtime()
    finals_status = {
        "sourceStatus": str((runtime or {}).get("sourceStatus") or "missing"),
        "sourceKind": (runtime or {}).get("sourceKind"),
        "isSynthetic": (runtime or {}).get("isSynthetic") is True,
        "sourceUpdatedAt": (runtime or {}).get("sourceUpdatedAt"),
    }
    payload = {
        "schemaVersion": "rmuc-live-revisions-v1",
        "regions": regions,
        "finals": {
            **finals_revisions(),
            "sourceStatus": finals_status.get("sourceStatus"),
            "sourceKind": finals_status.get("sourceKind"),
            "isSynthetic": finals_status.get("isSynthetic") is True,
            "sourceUpdatedAt": finals_status.get("sourceUpdatedAt"),
            "syncMode": "automatic-30s",
        },
    }
    payload["etag"] = semantic_digest(payload)
    return payload


@lru_cache(maxsize=16)
def _live_revisions_cached(
    _signatures: tuple[PathSignature, ...],
) -> dict[str, Any]:
    return _build_live_revisions_payload()


def build_live_revisions_payload() -> dict[str, Any]:
    for _attempt in range(2):
        before = _revision_input_signatures()
        payload = _live_revisions_cached(before)
        if before == _revision_input_signatures():
            return payload
    raise RuntimeError("revision inputs changed while building the live revision payload")


def clear_revision_caches() -> None:
    _region_revisions_cached.cache_clear()
    _finals_revisions_cached.cache_clear()
    _live_revisions_cached.cache_clear()
