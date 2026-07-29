from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    """Validate stable API fields while preserving endpoint-specific detail."""

    model_config = ConfigDict(extra="allow")


class HealthResponse(ApiModel):
    status: Literal["ok"]


class ReadinessCheck(ApiModel):
    ok: bool
    required: bool = True
    detail: str


class ReadinessResponse(ApiModel):
    status: Literal["ready", "not-ready"]
    checks: dict[str, ReadinessCheck]
    revisions: dict[str, Any] | None = None
    sync: dict[str, Any]


class RevisionEntry(ApiModel):
    scheduleRevision: str
    ratingRevision: str
    dataRevision: str
    sourceStatus: str | None = None
    sourceKind: str | None = None
    isSynthetic: bool
    sourceUpdatedAt: str | None = None
    syncMode: str


class LiveRevisionsResponse(ApiModel):
    schemaVersion: Literal["rmuc-live-revisions-v1"]
    regions: dict[str, RevisionEntry]
    finals: RevisionEntry
    etag: str


class SimulationMeta(ApiModel):
    regionSlug: str
    regionName: str
    seed: int
    generatedAt: str
    samplesPerMatch: int
    nationalSlots: int
    repechageSlots: int
    scheduleRevision: str
    ratingRevision: str
    dataRevision: str
    modelVersion: str
    topologyVersion: str


class SimulationResponse(ApiModel):
    meta: SimulationMeta
    slots: list[Any]
    groupRankings: dict[str, list[Any]]
    matches: list[Any]
    finalRankings: list[Any]
    summary: dict[str, Any]


class FinalsSnapshotResponse(ApiModel):
    schemaVersion: int
    season: int
    mode: Literal["live", "sim"]
    scheduleRevision: str
    ratingRevision: str
    dataRevision: str
    modelVersion: str
    topologyVersion: str
    runtimeArtifactVersion: str
    events: dict[str, Any]


class FinalEventResponse(ApiModel):
    schemaVersion: int
    season: int
    timezone: str
    timezoneLabel: str
    verifiedAt: str
    event: dict[str, Any]


class OverviewResponse(ApiModel):
    generatedAt: str
    regions: list[Any] | dict[str, Any]


class PrematchCenterResponse(ApiModel):
    seed: int
    generatedAt: str
    timezone: str
    targetDate: str
    source: dict[str, Any]
    timelineBuckets: dict[str, Any]


class CommandCenterResponse(PrematchCenterResponse):
    pass


class TeamProfileResponse(ApiModel):
    seed: int
    mode: Literal["live", "sim"]
    generatedAt: str
    team: dict[str, Any]
    region: dict[str, Any]
    matchPath: list[Any]


class CompetitionGraphNode(ApiModel):
    id: str
    kind: Literal["entry", "stage", "ranking", "exit"]
    label: str


class CompetitionGraphEdge(ApiModel):
    id: str
    source: str
    target: str
    advancement: str


class CompetitionGraphResponse(ApiModel):
    schemaVersion: Literal["competition-graph-v1"]
    topologyVersion: str
    competition: str
    nodes: list[CompetitionGraphNode]
    edges: list[CompetitionGraphEdge]
