from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import JSONResponse

from .competition import RequestParameterError, UnknownResourceError
from .finals_schedule import (
    build_final_event_payload,
    build_finals_snapshot_payload,
)
from .revisions import build_live_revisions_payload
from .service import (
    build_command_center_payload,
    build_live_state_payload,
    build_overview_payload,
    build_prediction_recap_payload,
    build_prematch_center_payload,
    build_simulation_payload,
    build_team_profile_payload,
)


app = FastAPI(title="RMUC Results API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestParameterError)
def invalid_request_parameter(_request: Request, exc: RequestParameterError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(UnknownResourceError)
def unknown_resource(_request: Request, exc: UnknownResourceError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": exc.detail})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/live-revisions")
def live_revisions(request: Request, response: Response) -> Any:
    payload = build_live_revisions_payload()
    etag = f'"{payload["etag"]}"'
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": "no-cache"},
        )
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return payload


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    return build_overview_payload()


@app.get("/api/finals/{event_slug}")
def final_event(event_slug: str, mode: str = Query("live")) -> dict[str, Any]:
    return build_final_event_payload(event_slug, mode=mode)


@app.get("/api/finals")
def finals_snapshot(mode: str = Query("live")) -> dict[str, Any]:
    return build_finals_snapshot_payload(mode=mode)


@app.get("/api/prematch-center")
def prematch_center(
    seed: int = Query(20260414, ge=1),
    mode: str = Query("live"),
    date: str | None = Query(None),
) -> dict[str, Any]:
    return build_prematch_center_payload(seed=seed, mode=mode, date=date)


@app.get("/api/command-center")
def command_center(
    seed: int = Query(20260414, ge=1),
    mode: str = Query("live"),
    date: str | None = Query(None),
) -> dict[str, Any]:
    return build_command_center_payload(seed=seed, mode=mode, date=date)


@app.get("/api/prediction-recap")
def prediction_recap(seed: int = Query(20260414, ge=1), mode: str = Query("live")) -> dict[str, Any]:
    return build_prediction_recap_payload(seed=seed, mode=mode)


@app.get("/api/teams/{team_key}")
def team_profile(team_key: str, seed: int = Query(20260414, ge=1), mode: str = Query("live")) -> dict[str, Any]:
    return build_team_profile_payload(team_key, seed=seed, mode=mode)


@app.get("/api/regions/{region_slug}/simulation")
def simulation(region_slug: str, seed: int = Query(20260414, ge=1), mode: str = Query("sim")) -> dict[str, Any]:
    return build_simulation_payload(region_slug, seed, mode)


@app.get("/api/regions/{region_slug}/live-state")
def live_state(region_slug: str) -> dict[str, Any]:
    return build_live_state_payload(region_slug)
