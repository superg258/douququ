from __future__ import annotations

from dataclasses import dataclass

from .competition import RequestParameterError


COMPETITION_GRAPH_VERSION = "competition-graph-v1.0.0"
REGIONAL_COMPETITIONS = frozenset({"south_region", "east_region", "north_region"})
FINAL_COMPETITIONS = frozenset({"repechage", "nationals"})


@dataclass(frozen=True)
class Node:
    id: str
    kind: str
    label: str


@dataclass(frozen=True)
class Edge:
    id: str
    source: str
    target: str
    advancement: str


REGIONAL_NODES = (
    Node("entry:regional-slots", "entry", "区域赛参赛名额"),
    Node("stage:swiss-a", "stage", "A 组瑞士轮"),
    Node("stage:swiss-b", "stage", "B 组瑞士轮"),
    Node("stage:qualification", "stage", "资格赛"),
    Node("stage:playoff", "stage", "主淘汰赛"),
    Node("ranking:regional-final", "ranking", "区域赛最终排名"),
    Node("exit:nationals", "exit", "晋级全国赛"),
    Node("exit:repechage", "exit", "晋级复活赛"),
    Node("exit:eliminated", "exit", "区域赛淘汰"),
)
REGIONAL_EDGES = (
    Edge("edge:slots-swiss-a", "entry:regional-slots", "stage:swiss-a", "group-a"),
    Edge("edge:slots-swiss-b", "entry:regional-slots", "stage:swiss-b", "group-b"),
    Edge("edge:swiss-a-qualification", "stage:swiss-a", "stage:qualification", "qualified"),
    Edge("edge:swiss-b-qualification", "stage:swiss-b", "stage:qualification", "qualified"),
    Edge("edge:qualification-playoff", "stage:qualification", "stage:playoff", "advanced"),
    Edge("edge:playoff-ranking", "stage:playoff", "ranking:regional-final", "placed"),
    Edge("edge:ranking-nationals", "ranking:regional-final", "exit:nationals", "national-qualified"),
    Edge("edge:ranking-repechage", "ranking:regional-final", "exit:repechage", "repechage-qualified"),
    Edge("edge:ranking-eliminated", "ranking:regional-final", "exit:eliminated", "eliminated"),
)

REPECHAGE_NODES = (
    Node("entry:repechage", "entry", "复活赛参赛队"),
    Node("stage:swiss-a", "stage", "A 组瑞士轮"),
    Node("stage:swiss-b", "stage", "B 组瑞士轮"),
    Node("stage:qualification", "stage", "国赛资格战"),
    Node("exit:nationals", "exit", "晋级全国赛"),
    Node("exit:eliminated", "exit", "复活赛淘汰"),
)
REPECHAGE_EDGES = (
    Edge("edge:entry-swiss-a", "entry:repechage", "stage:swiss-a", "group-a"),
    Edge("edge:entry-swiss-b", "entry:repechage", "stage:swiss-b", "group-b"),
    Edge("edge:swiss-a-qualification", "stage:swiss-a", "stage:qualification", "qualified"),
    Edge("edge:swiss-b-qualification", "stage:swiss-b", "stage:qualification", "qualified"),
    Edge("edge:qualification-nationals", "stage:qualification", "exit:nationals", "national-qualified"),
    Edge("edge:qualification-eliminated", "stage:qualification", "exit:eliminated", "eliminated"),
)

NATIONALS_NODES = (
    Node("entry:nationals", "entry", "全国赛参赛队"),
    Node("stage:swiss-a", "stage", "A 组瑞士轮"),
    Node("stage:swiss-b", "stage", "B 组瑞士轮"),
    Node("stage:round-of-16", "stage", "16 进 8"),
    Node("stage:quarterfinal", "stage", "8 进 4"),
    Node("stage:final-four", "stage", "四强与决赛"),
    Node("ranking:nationals-final", "ranking", "全国赛最终名次"),
)
NATIONALS_EDGES = (
    Edge("edge:entry-swiss-a", "entry:nationals", "stage:swiss-a", "group-a"),
    Edge("edge:entry-swiss-b", "entry:nationals", "stage:swiss-b", "group-b"),
    Edge("edge:swiss-a-r16", "stage:swiss-a", "stage:round-of-16", "qualified"),
    Edge("edge:swiss-b-r16", "stage:swiss-b", "stage:round-of-16", "qualified"),
    Edge("edge:r16-quarterfinal", "stage:round-of-16", "stage:quarterfinal", "winner"),
    Edge("edge:quarterfinal-final-four", "stage:quarterfinal", "stage:final-four", "winner"),
    Edge("edge:final-four-ranking", "stage:final-four", "ranking:nationals-final", "placed"),
)


def _validate(nodes: tuple[Node, ...], edges: tuple[Edge, ...]) -> None:
    node_ids = {node.id for node in nodes}
    if len(node_ids) != len(nodes):
        raise RuntimeError("competition graph contains duplicate node IDs")
    edge_ids = {edge.id for edge in edges}
    if len(edge_ids) != len(edges):
        raise RuntimeError("competition graph contains duplicate edge IDs")
    if any(edge.source not in node_ids or edge.target not in node_ids for edge in edges):
        raise RuntimeError("competition graph contains a dangling edge")


def build_competition_graph(competition: str) -> dict[str, object]:
    if competition in REGIONAL_COMPETITIONS:
        nodes, edges = REGIONAL_NODES, REGIONAL_EDGES
    elif competition == "repechage":
        nodes, edges = REPECHAGE_NODES, REPECHAGE_EDGES
    elif competition == "nationals":
        nodes, edges = NATIONALS_NODES, NATIONALS_EDGES
    else:
        raise RequestParameterError(f"Unsupported competition graph: {competition}")
    _validate(nodes, edges)
    return {
        "schemaVersion": "competition-graph-v1",
        "topologyVersion": COMPETITION_GRAPH_VERSION,
        "competition": competition,
        "nodes": [node.__dict__ for node in nodes],
        "edges": [edge.__dict__ for edge in edges],
    }

