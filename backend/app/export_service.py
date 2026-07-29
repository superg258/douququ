from __future__ import annotations

import os
from threading import BoundedSemaphore
from typing import Any

import httpx

from .revisions import build_live_revisions_payload
from .service import REGION_SLUG_ORDER


REGION_STAGES = {
    "slots",
    "swiss-a",
    "swiss-b",
    "qualification",
    "playoff",
    "final-rankings",
}
FINALS_STAGES = {
    "repechage": {"swiss-a", "swiss-b", "qualification"},
    "nationals": {"swiss-a", "swiss-b", "round-of-16", "quarterfinal", "final-four"},
}
EXPORT_WORKER_URL = os.getenv("RMUC_EXPORT_WORKER_URL", "http://127.0.0.1:3010/render")
EXPORT_WORKER_TOKEN = os.getenv("RMUC_EXPORT_WORKER_TOKEN", "")
MAX_PNG_BYTES = 50 * 1024 * 1024
_EXPORT_CAPACITY = BoundedSemaphore(value=2)


class ExportRequestError(ValueError):
    pass


class ExportVersionConflict(RuntimeError):
    pass


class ExportBusyError(RuntimeError):
    pass


class ExportTimeoutError(TimeoutError):
    pass


def validate_export_request(
    *,
    competition: str,
    stage: str,
    mode: str,
    seed: int | None,
) -> None:
    if competition in REGION_SLUG_ORDER:
        allowed_stages = REGION_STAGES
    elif competition in FINALS_STAGES:
        allowed_stages = FINALS_STAGES[competition]
    else:
        raise ExportRequestError("unsupported competition")
    if stage not in allowed_stages:
        raise ExportRequestError("unsupported stage")
    if mode not in {"live", "sim"}:
        raise ExportRequestError("unsupported mode")
    if mode == "sim" and (seed is None or seed < 1):
        raise ExportRequestError("simulation export requires a positive seed")


def current_export_revision(competition: str) -> str:
    revisions = build_live_revisions_payload()
    if competition in REGION_SLUG_ORDER:
        return str(revisions["regions"][competition]["dataRevision"])
    return str(revisions["finals"]["dataRevision"])


def _render_once(payload: dict[str, Any]) -> bytes:
    headers = {"X-Export-Token": EXPORT_WORKER_TOKEN} if EXPORT_WORKER_TOKEN else {}
    try:
        response = httpx.post(
            EXPORT_WORKER_URL,
            json=payload,
            headers=headers,
            timeout=httpx.Timeout(35.0, connect=2.0),
        )
    except httpx.TimeoutException as exc:
        raise ExportTimeoutError("export worker timed out") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"export worker unavailable: {exc}") from exc
    if response.status_code == 409:
        raise ExportVersionConflict("export revision changed during rendering")
    if response.status_code == 429:
        raise ExportBusyError("export worker queue is full")
    if response.status_code == 504:
        raise ExportTimeoutError("export worker timed out")
    if response.status_code != 200:
        raise RuntimeError(f"export worker failed: {response.status_code}")
    if response.headers.get("content-type", "").split(";", 1)[0] != "image/png":
        raise RuntimeError("export worker returned a non-PNG response")
    if len(response.content) > MAX_PNG_BYTES:
        raise RuntimeError("export image exceeds the response size limit")
    return response.content


def render_canvas_png(
    *,
    competition: str,
    stage: str,
    mode: str,
    seed: int | None,
    highlight: str | None,
    requested_revision: str | None,
) -> tuple[bytes, str]:
    validate_export_request(
        competition=competition,
        stage=stage,
        mode=mode,
        seed=seed,
    )
    if not _EXPORT_CAPACITY.acquire(blocking=False):
        raise ExportBusyError("export capacity is busy")
    try:
        revision = current_export_revision(competition)
        if requested_revision and requested_revision != revision:
            raise ExportVersionConflict("requested revision is no longer current")
        for attempt in range(2):
            png = _render_once(
                {
                    "competition": competition,
                    "stage": stage,
                    "mode": mode,
                    "seed": seed,
                    "highlight": highlight,
                    "revision": revision,
                }
            )
            after_revision = current_export_revision(competition)
            if after_revision == revision:
                return png, revision
            if requested_revision or attempt == 1:
                raise ExportVersionConflict("data revision changed during rendering")
            revision = after_revision
        raise ExportVersionConflict("data revision changed during rendering")
    finally:
        _EXPORT_CAPACITY.release()
