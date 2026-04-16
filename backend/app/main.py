from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .service import build_overview_payload, build_simulation_payload


app = FastAPI(title="RMUC Results API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    return build_overview_payload()


@app.get("/api/regions/{region_slug}/simulation")
def simulation(region_slug: str, seed: int = Query(20260414, ge=1)) -> dict[str, Any]:
    try:
        return build_simulation_payload(region_slug, seed)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown region: {region_slug}") from exc
