from __future__ import annotations

import json
import re
import tarfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .ingest import canonicalize_school, require_dataframe_deps, school_key
from .season_delta import (
    SeasonDeltaConfig,
    adjust_form_observation_for_freshness,
    compute_form_freshness_weight,
    compute_form_observation,
    compute_robot_form_observation,
    compute_robot_gate_weight,
    robust_z,
)


SNAPSHOT_RE = re.compile(r"^(schedule|group_rank_info|robot_data)\.(\d{8}T\d{6}Z)\.json$")
FORM_OBSERVATION_COLUMNS = [
    "school_key",
    "school_name",
    "region_name",
    "group_name",
    "group_matches_played",
    "opponent_points",
    "avg_team_damage",
    "avg_base_hp_diff",
    "z_opponent_points",
    "z_team_damage",
    "z_base_hp_diff",
    "form_signal",
    "group_obs_mu",
    "group_obs_sigma",
    "obs_mu",
    "obs_sigma",
    "form_reliability",
    "form_evidence_key",
    "snapshot_name",
    "snapshot_age_minutes",
    "form_freshness_weight",
    "robot_snapshot_name",
    "robot_snapshot_age_minutes",
    "robot_family_signal",
    "robot_obs_mu",
    "robot_obs_sigma",
    "robot_form_reliability",
    "robot_gate_weight",
    "robot_signal_alignment",
    "robot_signal_missing",
    "robot_signal_conflict",
]

ROBOT_FORM_METRIC_COLUMNS = [
    "school_key",
    "school_name",
    "team_name",
    "region_name",
    "robot_count",
    "robot_output_hurt",
    "robot_output_kills",
    "robot_output_kda",
    "robot_objective_damage",
]


@dataclass(frozen=True)
class ArchiveSnapshot:
    member_name: str
    source_type: str
    fetched_at: datetime
    age_minutes: float | None = None


def _parse_snapshot_name(name: str) -> tuple[str, datetime] | None:
    basename = Path(name).name
    match = SNAPSHOT_RE.match(basename)
    if not match:
        return None
    fetched_at = datetime.strptime(match.group(2), "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    return match.group(1), fetched_at


def build_archive_manifest(archive_path: Path) -> list[ArchiveSnapshot]:
    snapshots: list[ArchiveSnapshot] = []
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            parsed = _parse_snapshot_name(member.name)
            if parsed is None:
                continue
            source_type, fetched_at = parsed
            snapshots.append(
                ArchiveSnapshot(
                    member_name=Path(member.name).name,
                    source_type=source_type,
                    fetched_at=fetched_at,
                )
            )
    return sorted(snapshots, key=lambda row: (row.fetched_at, row.source_type, row.member_name))


def select_snapshot_before(
    manifest: list[ArchiveSnapshot],
    *,
    source_type: str,
    cutoff: datetime,
    max_age_minutes: float | None = None,
) -> ArchiveSnapshot | None:
    cutoff_utc = cutoff if cutoff.tzinfo is not None else cutoff.replace(tzinfo=UTC)
    cutoff_utc = cutoff_utc.astimezone(UTC)
    candidates = [
        row
        for row in manifest
        if row.source_type == source_type and row.fetched_at <= cutoff_utc
    ]
    if not candidates:
        return None
    selected = max(candidates, key=lambda row: row.fetched_at)
    age_minutes = (cutoff_utc - selected.fetched_at).total_seconds() / 60.0
    if max_age_minutes is not None and age_minutes > float(max_age_minutes):
        return None
    return ArchiveSnapshot(
        member_name=selected.member_name,
        source_type=selected.source_type,
        fetched_at=selected.fetched_at,
        age_minutes=float(age_minutes),
    )


def load_archive_snapshot_payload(archive_path: Path, snapshot: ArchiveSnapshot) -> dict[str, Any]:
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile() or Path(member.name).name != snapshot.member_name:
                continue
            extracted = archive.extractfile(member)
            if extracted is None:
                break
            payload = json.load(extracted)
            return payload if isinstance(payload, dict) else {}
    raise FileNotFoundError(f"{snapshot.member_name} was not found in {archive_path}")


def _rank_items(player_row: Any) -> dict[str, Any]:
    if isinstance(player_row, dict):
        if "itemName" in player_row:
            name = str(player_row.get("itemName") or "").strip()
            return {name: player_row.get("itemValue")} if name else {}
        return dict(player_row)
    if not isinstance(player_row, list):
        return {}
    items: dict[str, Any] = {}
    for item in player_row:
        if not isinstance(item, dict):
            continue
        name = str(item.get("itemName") or "").strip()
        if name:
            items[name] = item.get("itemValue")
    return items


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _metric_value(items: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = _optional_float(items.get(name))
        if value is not None:
            return value
    return None


def _win_draw_loss(value: Any) -> tuple[float | None, float | None, float | None]:
    if value is None:
        return None, None, None
    parts = re.findall(r"-?\d+(?:\.\d+)?", str(value))
    if len(parts) < 3:
        return None, None, None
    return float(parts[0]), float(parts[1]), float(parts[2])


def _group_matches_played(items: dict[str, Any]) -> float:
    wins, draws, losses = _win_draw_loss(items.get("胜/平/负"))
    if wins is not None and draws is not None and losses is not None:
        return float(wins + draws + losses)
    explicit = _metric_value(items, "已赛场次", "场次", "比赛场次")
    if explicit is not None:
        return float(explicit)
    wins = _metric_value(items, "胜场数", "胜") or 0.0
    draws = _metric_value(items, "平") or 0.0
    losses = _metric_value(items, "负场数", "负") or 0.0
    return float(wins + draws + losses)


def _short_group_name(raw_group_name: Any) -> str:
    text = str(raw_group_name or "").strip()
    return text[:1] if text.endswith("组") else text


def _team_identity(items: dict[str, Any]) -> tuple[str, str] | None:
    team = items.get("战队")
    if isinstance(team, dict):
        college_name = str(team.get("collegeName") or "").strip()
        team_name = str(team.get("teamName") or team.get("name") or "").strip()
    else:
        college_name = str(team or "").strip()
        team_name = ""
    if not college_name:
        return None
    return college_name, team_name


def extract_group_rank_form_metrics(payload: dict[str, Any] | None) -> Any:
    pd, _ = require_dataframe_deps()
    rows: list[dict[str, Any]] = []
    if not isinstance(payload, dict):
        return pd.DataFrame(rows)
    zones = payload.get("zones", [])
    if not isinstance(zones, list):
        return pd.DataFrame(rows)
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        region_name = str(zone.get("zoneName") or zone.get("name") or "").strip()
        groups = zone.get("groups", [])
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            group_name = _short_group_name(group.get("groupName") or group.get("name"))
            players = group.get("groupPlayers", [])
            if not isinstance(players, list):
                continue
            for player_row in players:
                items = _rank_items(player_row)
                identity = _team_identity(items)
                if identity is None:
                    continue
                college_name, team_name = identity
                school_name = canonicalize_school(college_name)
                rows.append(
                    {
                        "school_key": school_key(school_name),
                        "school_name": school_name,
                        "team_name": team_name,
                        "region_name": region_name,
                        "group_name": group_name,
                        "group_rank": _metric_value(items, "排名"),
                        "group_matches_played": _group_matches_played(items),
                        "opponent_points": _metric_value(items, "对手分", "官方对手分", "对手积分"),
                        "avg_team_damage": _metric_value(
                            items,
                            "时均全队总伤害血量",
                            "局均全队总伤害血量",
                            "平均全队总伤害血量",
                            "全队总伤害血量",
                        ),
                        "avg_base_hp_diff": _metric_value(
                            items,
                            "时均总基地净胜血量",
                            "局均总基地净胜血量",
                            "平均总基地净胜血量",
                            "平均基地净胜血量",
                        ),
                    }
                )
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.sort_values(["region_name", "group_name", "school_key"], kind="stable").reset_index(drop=True)


def extract_robot_form_metrics(payload: dict[str, Any] | None) -> Any:
    pd, _ = require_dataframe_deps()
    rows: list[dict[str, Any]] = []
    if not isinstance(payload, dict):
        return pd.DataFrame(rows, columns=ROBOT_FORM_METRIC_COLUMNS)
    zones = payload.get("zones", [])
    if not isinstance(zones, list):
        return pd.DataFrame(rows, columns=ROBOT_FORM_METRIC_COLUMNS)
    for zone in zones:
        if not isinstance(zone, dict):
            continue
        region_name = str(zone.get("zoneName") or zone.get("name") or "").strip()
        teams = zone.get("teams", [])
        if not isinstance(teams, list):
            continue
        for team in teams:
            if not isinstance(team, dict):
                continue
            college_name = str(team.get("collegeName") or "").strip()
            if not college_name:
                continue
            school_name = canonicalize_school(college_name)
            robots = team.get("robots", [])
            if not isinstance(robots, list):
                robots = []
            rows.append(
                {
                    "school_key": school_key(school_name),
                    "school_name": school_name,
                    "team_name": str(team.get("name") or team.get("teamName") or "").strip(),
                    "region_name": region_name,
                    "robot_count": len(robots),
                    "robot_output_hurt": sum(
                        value
                        for value in (_optional_float(robot.get("eagHurt")) for robot in robots if isinstance(robot, dict))
                        if value is not None
                    ),
                    "robot_output_kills": sum(
                        value
                        for value in (_optional_float(robot.get("gKillCount")) for robot in robots if isinstance(robot, dict))
                        if value is not None
                    ),
                    "robot_output_kda": sum(
                        value
                        for value in (_optional_float(robot.get("eagKdaScore")) for robot in robots if isinstance(robot, dict))
                        if value is not None
                    ),
                    "robot_objective_damage": sum(
                        value
                        for value in (_optional_float(robot.get("gkDamage")) for robot in robots if isinstance(robot, dict))
                        if value is not None
                    ),
                }
            )
    frame = pd.DataFrame(rows, columns=ROBOT_FORM_METRIC_COLUMNS)
    if frame.empty:
        return frame
    return frame.sort_values(["region_name", "school_key"], kind="stable").reset_index(drop=True)


def _assign_group_zscores(frame: Any, *, value_col: str, out_col: str) -> None:
    pd, _ = require_dataframe_deps()
    frame[out_col] = 0.0
    if frame.empty:
        return
    group_cols = ["region_name", "group_name"]
    for _, group in frame.groupby(group_cols, dropna=False, sort=False):
        values = pd.to_numeric(group[value_col], errors="coerce")
        valid = values.notna()
        if not bool(valid.any()):
            continue
        if int(valid.sum()) == 1:
            frame.loc[values[valid].index, out_col] = 0.0
            continue
        frame.loc[values[valid].index, out_col] = robust_z(values[valid].to_numpy())


def _assign_region_zscores(frame: Any, *, value_col: str, out_col: str) -> None:
    pd, _ = require_dataframe_deps()
    frame[out_col] = 0.0
    if frame.empty:
        return
    for _, group in frame.groupby(["region_name"], dropna=False, sort=False):
        values = pd.to_numeric(group[value_col], errors="coerce")
        valid = values.notna()
        if not bool(valid.any()):
            continue
        if int(valid.sum()) == 1:
            frame.loc[values[valid].index, out_col] = 0.0
            continue
        frame.loc[values[valid].index, out_col] = robust_z(values[valid].to_numpy())


def _robot_alignment(group_signal: float | None, robot_signal: float | None) -> tuple[str | None, bool]:
    if robot_signal is None:
        return None, False
    if abs(float(robot_signal)) < 1e-9:
        return "neutral", False
    if group_signal is None or abs(float(group_signal)) < 1e-9:
        return "robot_only_positive" if robot_signal > 0 else "robot_only_negative", False
    if (float(group_signal) > 0) == (float(robot_signal) > 0):
        return "aligned_positive" if robot_signal > 0 else "aligned_negative", False
    return "conflict", True


def build_live_form_observation_frame(
    metrics_frame: Any,
    *,
    robot_metrics_frame: Any | None = None,
    snapshot_name: str | None = None,
    snapshot_age_minutes: float | None = None,
    robot_snapshot_name: str | None = None,
    robot_snapshot_age_minutes: float | None = None,
    config: SeasonDeltaConfig | None = None,
    apply_time_freshness: bool = True,
) -> Any:
    pd, _ = require_dataframe_deps()
    if metrics_frame is None or getattr(metrics_frame, "empty", True):
        return pd.DataFrame(columns=FORM_OBSERVATION_COLUMNS)

    frame = metrics_frame.copy()
    for column in ("group_matches_played", "opponent_points", "avg_team_damage", "avg_base_hp_diff"):
        frame[column] = pd.to_numeric(frame.get(column), errors="coerce")
    frame["group_matches_played"] = frame["group_matches_played"].fillna(0.0)
    _assign_group_zscores(frame, value_col="opponent_points", out_col="z_opponent_points")
    _assign_group_zscores(frame, value_col="avg_team_damage", out_col="z_team_damage")
    _assign_group_zscores(frame, value_col="avg_base_hp_diff", out_col="z_base_hp_diff")

    cfg = config or SeasonDeltaConfig()
    observations = [
        compute_form_observation(
            z_team_damage=float(row["z_team_damage"]),
            z_base_hp_diff=float(row["z_base_hp_diff"]),
            z_opponent_points=float(row["z_opponent_points"]),
            group_matches_played=float(row["group_matches_played"]),
            config=cfg,
        )
        for row in frame.to_dict(orient="records")
    ]
    freshness_weight = compute_form_freshness_weight(snapshot_age_minutes=snapshot_age_minutes, config=cfg)
    effective_freshness_weight = freshness_weight if bool(apply_time_freshness) else 1.0
    freshened_observations = [
        adjust_form_observation_for_freshness(
            obs_mu=obs.obs_mu,
            obs_sigma=obs.obs_sigma,
            freshness_weight=effective_freshness_weight,
            config=cfg,
        )
        for obs in observations
    ]
    frame["form_signal"] = [obs.form_signal for obs in observations]
    frame["group_obs_mu"] = [obs.obs_mu for obs in observations]
    frame["group_obs_sigma"] = [obs.obs_sigma for obs in observations]
    frame["obs_mu"] = [obs.obs_mu for obs in freshened_observations]
    frame["obs_sigma"] = [obs.obs_sigma for obs in freshened_observations]
    frame["form_reliability"] = [obs.reliability for obs in observations]
    frame["form_evidence_key"] = ""
    frame["snapshot_name"] = snapshot_name
    frame["snapshot_age_minutes"] = snapshot_age_minutes
    frame["form_freshness_weight"] = effective_freshness_weight

    frame["robot_snapshot_name"] = robot_snapshot_name
    frame["robot_snapshot_age_minutes"] = robot_snapshot_age_minutes
    frame["robot_family_signal"] = 0.0
    frame["robot_obs_mu"] = 0.0
    frame["robot_obs_sigma"] = None
    frame["robot_form_reliability"] = 0.0
    frame["robot_gate_weight"] = 0.0
    frame["robot_signal_alignment"] = None
    frame["robot_signal_missing"] = True
    frame["robot_signal_conflict"] = False

    if robot_metrics_frame is not None and not getattr(robot_metrics_frame, "empty", True):
        robot = robot_metrics_frame.copy()
        for column in ("robot_output_hurt", "robot_output_kills", "robot_output_kda", "robot_objective_damage"):
            robot[column] = pd.to_numeric(robot.get(column), errors="coerce")
        _assign_region_zscores(robot, value_col="robot_output_hurt", out_col="z_robot_output_hurt")
        _assign_region_zscores(robot, value_col="robot_output_kills", out_col="z_robot_output_kills")
        _assign_region_zscores(robot, value_col="robot_output_kda", out_col="z_robot_output_kda")
        _assign_region_zscores(robot, value_col="robot_objective_damage", out_col="z_robot_objective_damage")
        robot["robot_family_signal"] = (
            (0.45 * robot["z_robot_output_kda"].astype(float))
            + (0.30 * robot["z_robot_output_hurt"].astype(float))
            + (0.15 * robot["z_robot_output_kills"].astype(float))
            + (0.10 * robot["z_robot_objective_damage"].astype(float))
        )
        robot_columns = [
            "school_key",
            "robot_family_signal",
            "robot_output_hurt",
            "robot_output_kills",
            "robot_output_kda",
            "robot_objective_damage",
        ]
        frame = frame.merge(robot[robot_columns], on="school_key", how="left")
        blended_obs_mu: list[float] = []
        blended_form_signal: list[float] = []
        robot_obs_mu_values: list[float] = []
        robot_obs_sigma_values: list[float | None] = []
        robot_reliability_values: list[float] = []
        robot_gate_values: list[float] = []
        robot_missing_values: list[bool] = []
        alignment_values: list[str | None] = []
        conflict_values: list[bool] = []
        for row in frame.to_dict(orient="records"):
            robot_signal = row.get("robot_family_signal_y")
            if robot_signal is None or pd.isna(robot_signal):
                blended_obs_mu.append(float(row["obs_mu"]))
                blended_form_signal.append(float(row["form_signal"]))
                robot_obs_mu_values.append(0.0)
                robot_obs_sigma_values.append(None)
                robot_reliability_values.append(0.0)
                robot_gate_values.append(0.0)
                robot_missing_values.append(True)
                alignment_values.append(None)
                conflict_values.append(False)
                continue
            robot_obs = compute_robot_form_observation(
                robot_family_signal=float(robot_signal),
                group_matches_played=float(row["group_matches_played"]),
                config=cfg,
            )
            alignment, conflict = _robot_alignment(float(row["form_signal"]), float(robot_signal))
            robot_gate = compute_robot_gate_weight(
                robot_reliability=float(robot_obs.reliability),
                alignment=alignment,
                conflict=conflict,
                robot_snapshot_age_minutes=robot_snapshot_age_minutes,
                config=cfg,
            )
            blend = min(max(float(cfg.robot_form_blend_weight) * float(robot_gate), 0.0), 1.0)
            group_obs_mu = float(row["group_obs_mu"])
            candidate_obs_mu = ((1.0 - blend) * group_obs_mu) + (blend * float(robot_obs.obs_mu))
            if (group_obs_mu * float(robot_obs.obs_mu)) > 0.0 and abs(candidate_obs_mu) < abs(group_obs_mu):
                candidate_obs_mu = group_obs_mu
            blended_obs_mu.append(candidate_obs_mu)
            blended_form_signal.append(((1.0 - blend) * float(row["form_signal"])) + (blend * float(robot_signal)))
            robot_obs_mu_values.append(float(robot_obs.obs_mu))
            robot_obs_sigma_values.append(float(robot_obs.obs_sigma))
            robot_reliability_values.append(float(robot_obs.reliability))
            robot_gate_values.append(float(robot_gate))
            robot_missing_values.append(False)
            alignment_values.append(alignment)
            conflict_values.append(conflict)
        frame["obs_mu"] = blended_obs_mu
        frame["form_signal"] = blended_form_signal
        frame["robot_family_signal"] = frame["robot_family_signal_y"].fillna(0.0)
        frame["robot_obs_mu"] = robot_obs_mu_values
        frame["robot_obs_sigma"] = robot_obs_sigma_values
        frame["robot_form_reliability"] = robot_reliability_values
        frame["robot_gate_weight"] = robot_gate_values
        frame["robot_signal_missing"] = robot_missing_values
        frame["robot_signal_alignment"] = alignment_values
        frame["robot_signal_conflict"] = conflict_values
        frame = frame.drop(columns=[column for column in frame.columns if column.endswith("_y") or column.endswith("_x")], errors="ignore")

    frame["form_evidence_key"] = [
        (
            f"played={float(row.get('group_matches_played') or 0.0):.3f}"
            f"|opp={float(row.get('opponent_points') or 0.0):.6f}"
            f"|damage={float(row.get('avg_team_damage') or 0.0):.6f}"
            f"|base={float(row.get('avg_base_hp_diff') or 0.0):.6f}"
            f"|robot={float(row.get('robot_family_signal') or 0.0):.6f}"
        )
        for row in frame.to_dict(orient="records")
    ]

    return frame[FORM_OBSERVATION_COLUMNS].reset_index(drop=True)


def build_form_observation_frame(
    metrics_frame: Any,
    *,
    snapshot_name: str | None = None,
    snapshot_age_minutes: float | None = None,
    config: SeasonDeltaConfig | None = None,
    apply_time_freshness: bool = True,
) -> Any:
    return build_live_form_observation_frame(
        metrics_frame,
        snapshot_name=snapshot_name,
        snapshot_age_minutes=snapshot_age_minutes,
        config=config,
        apply_time_freshness=apply_time_freshness,
    )


def build_form_observations_from_group_rank_payload(
    payload: dict[str, Any] | None,
    *,
    robot_payload: dict[str, Any] | None = None,
    snapshot_name: str | None = None,
    snapshot_age_minutes: float | None = None,
    robot_snapshot_name: str | None = None,
    robot_snapshot_age_minutes: float | None = None,
    config: SeasonDeltaConfig | None = None,
    apply_time_freshness: bool = True,
) -> Any:
    metrics = extract_group_rank_form_metrics(payload)
    robot_metrics = extract_robot_form_metrics(robot_payload) if robot_payload is not None else None
    return build_live_form_observation_frame(
        metrics,
        robot_metrics_frame=robot_metrics,
        snapshot_name=snapshot_name,
        snapshot_age_minutes=snapshot_age_minutes,
        robot_snapshot_name=robot_snapshot_name,
        robot_snapshot_age_minutes=robot_snapshot_age_minutes,
        config=config,
        apply_time_freshness=apply_time_freshness,
    )
