from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np

from .ingest import require_dataframe_deps


@dataclass
class PreparedData:
    school_keys: list[str]
    school_names: list[str]
    season_team_keys: list[str]
    stage_values: list[str]
    format_values: list[str]
    ruleset_values: list[str]
    state_rows: list[dict[str, Any]]
    train_mask: np.ndarray
    arrays: dict[str, Any]
    feature_names: list[str]
    team_last_state_index: dict[str, int]


def require_bayesian_deps() -> dict[str, Any]:
    try:
        import jax.numpy as jnp  # type: ignore
        from jax import random  # type: ignore
        from jax.scipy.special import gammaln  # type: ignore
        import numpyro  # type: ignore
        import numpyro.distributions as dist  # type: ignore
        from numpyro.infer import MCMC, NUTS, Predictive, SVI, Trace_ELBO  # type: ignore
        from numpyro.infer.autoguide import AutoNormal  # type: ignore
        from numpyro.optim import Adam  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised only in missing envs
        raise RuntimeError("jax and numpyro are required for fit/predict. Install research/trueskill2/requirements.txt") from exc
    return {
        "jnp": jnp,
        "random": random,
        "gammaln": gammaln,
        "numpyro": numpyro,
        "dist": dist,
        "MCMC": MCMC,
        "NUTS": NUTS,
        "Predictive": Predictive,
        "SVI": SVI,
        "Trace_ELBO": Trace_ELBO,
        "AutoNormal": AutoNormal,
        "Adam": Adam,
    }


def _match_dates_to_ordinals(frame: Any) -> np.ndarray:
    return np.array([date.fromisoformat(value).toordinal() for value in frame["match_date"].tolist()], dtype=np.int32)


def prepare_model_data(canonical_matches: Any, school_static_features: Any, max_train_matches: int | None = None) -> PreparedData:
    pd, _ = require_dataframe_deps()
    matches = canonical_matches.copy()
    if max_train_matches is not None:
        matches = matches.iloc[:max_train_matches].reset_index(drop=True)

    schools = school_static_features.sort_values("school_key", kind="stable").reset_index(drop=True)
    school_keys = schools["school_key"].tolist()
    school_names = schools["school_name"].tolist()
    school_index = {key: idx for idx, key in enumerate(school_keys)}

    season_team_rows = []
    seen_team_keys = set()
    for row in matches[["red_season_team_key", "red_school_key", "red_school_name", "season", "event_code"]].rename(
        columns={"red_season_team_key": "season_team_key", "red_school_key": "school_key", "red_school_name": "school_name"}
    ).to_dict(orient="records"):
        if row["season_team_key"] in seen_team_keys:
            continue
        seen_team_keys.add(row["season_team_key"])
        season_team_rows.append(row)
    for row in matches[["blue_season_team_key", "blue_school_key", "blue_school_name", "season", "event_code"]].rename(
        columns={"blue_season_team_key": "season_team_key", "blue_school_key": "school_key", "blue_school_name": "school_name"}
    ).to_dict(orient="records"):
        if row["season_team_key"] in seen_team_keys:
            continue
        seen_team_keys.add(row["season_team_key"])
        season_team_rows.append(row)
    season_team_frame = pd.DataFrame.from_records(season_team_rows).sort_values(
        ["school_key", "season"], kind="stable"
    ).reset_index(drop=True)
    season_team_keys = season_team_frame["season_team_key"].tolist()
    season_team_index = {key: idx for idx, key in enumerate(season_team_keys)}
    school_idx_of_team = np.array([school_index[key] for key in season_team_frame["school_key"].tolist()], dtype=np.int32)
    season_number_of_team = np.array(season_team_frame["season"].astype(int).tolist(), dtype=np.int32)

    team_prev_idx = np.full(len(season_team_frame), -1, dtype=np.int32)
    last_team_for_school: dict[str, int] = {}
    for idx, row in enumerate(season_team_frame.to_dict(orient="records")):
        school_key = row["school_key"]
        if school_key in last_team_for_school:
            team_prev_idx[idx] = last_team_for_school[school_key]
        last_team_for_school[school_key] = idx

    state_rows: list[dict[str, Any]] = []
    state_index: dict[tuple[str, str], int] = {}
    state_prev_idx: list[int] = []
    state_delta_days: list[float] = []
    state_team_idx: list[int] = []
    team_last_state_index: dict[str, int] = {}
    for season_team_key in season_team_keys:
        team_matches = matches[
            (matches["red_season_team_key"] == season_team_key) | (matches["blue_season_team_key"] == season_team_key)
        ]
        unique_dates = sorted(team_matches["match_date"].unique().tolist())
        previous_state = -1
        previous_date_ordinal = -1
        for day in unique_dates:
            current_idx = len(state_rows)
            state_index[(season_team_key, day)] = current_idx
            state_rows.append(
                {
                    "state_index": current_idx,
                    "season_team_key": season_team_key,
                    "school_key": season_team_frame.iloc[season_team_index[season_team_key]]["school_key"],
                    "school_name": season_team_frame.iloc[season_team_index[season_team_key]]["school_name"],
                    "season": int(season_team_frame.iloc[season_team_index[season_team_key]]["season"]),
                    "date_bucket": day,
                }
            )
            current_ordinal = date.fromisoformat(day).toordinal()
            state_prev_idx.append(previous_state)
            state_delta_days.append(1.0 if previous_state < 0 else float(max(1, current_ordinal - previous_date_ordinal)))
            state_team_idx.append(season_team_index[season_team_key])
            previous_state = current_idx
            previous_date_ordinal = current_ordinal
        team_last_state_index[season_team_key] = previous_state

    match_red_state_idx = np.array(
        [state_index[(row["red_season_team_key"], row["match_date"])] for row in matches.to_dict(orient="records")],
        dtype=np.int32,
    )
    match_blue_state_idx = np.array(
        [state_index[(row["blue_season_team_key"], row["match_date"])] for row in matches.to_dict(orient="records")],
        dtype=np.int32,
    )

    stage_values = sorted(matches["stage_id"].unique().tolist())
    stage_index = {value: idx for idx, value in enumerate(stage_values)}
    format_values = sorted([f"bo{int(value)}" for value in matches["best_of"].unique().tolist()])
    format_index = {value: idx for idx, value in enumerate(format_values)}
    ruleset_values = sorted(matches["ruleset_id"].unique().tolist())
    ruleset_index = {value: idx for idx, value in enumerate(ruleset_values)}

    feature_names = [column for column in schools.columns if column.startswith("feature_") or column.startswith("missing_")]
    static_features = schools[feature_names].to_numpy(dtype=np.float32)

    arrays = {
        "school_features": static_features,
        "school_idx_of_team": school_idx_of_team,
        "season_number_of_team": season_number_of_team,
        "team_prev_idx": team_prev_idx,
        "state_prev_idx": np.array(state_prev_idx, dtype=np.int32),
        "state_delta_days": np.array(state_delta_days, dtype=np.float32),
        "state_team_idx": np.array(state_team_idx, dtype=np.int32),
        "match_red_state_idx": match_red_state_idx,
        "match_blue_state_idx": match_blue_state_idx,
        "match_red_wins": matches["red_wins"].to_numpy(dtype=np.int32),
        "match_blue_wins": matches["blue_wins"].to_numpy(dtype=np.int32),
        "match_stage_idx": np.array([stage_index[value] for value in matches["stage_id"].tolist()], dtype=np.int32),
        "match_format_idx": np.array([format_index[f"bo{int(value)}"] for value in matches["best_of"].tolist()], dtype=np.int32),
        "match_ruleset_idx": np.array([ruleset_index[value] for value in matches["ruleset_id"].tolist()], dtype=np.int32),
        "match_date_ordinals": _match_dates_to_ordinals(matches),
    }
    return PreparedData(
        school_keys=school_keys,
        school_names=school_names,
        season_team_keys=season_team_keys,
        stage_values=stage_values,
        format_values=format_values,
        ruleset_values=ruleset_values,
        state_rows=state_rows,
        train_mask=np.ones(len(matches), dtype=bool),
        arrays=arrays,
        feature_names=feature_names,
        team_last_state_index=team_last_state_index,
    )


def make_model(config: dict[str, Any], structure: dict[str, Any]):
    deps = require_bayesian_deps()
    jnp = deps["jnp"]
    numpyro = deps["numpyro"]
    dist = deps["dist"]
    gammaln = deps["gammaln"]

    enable_stage = bool(config["model"].get("enable_stage_effect", True))
    enable_format = bool(config["model"].get("enable_format_effect", True))
    enable_ruleset = bool(config["model"].get("enable_ruleset_effect", True))
    enable_side = bool(config["model"].get("enable_side_effect", True))
    priors = config["priors"]

    def series_log_prob(prob: Any, red_wins: Any, blue_wins: Any) -> Any:
        prob = jnp.clip(prob, 1e-5, 1.0 - 1e-5)
        total = red_wins + blue_wins
        high = jnp.maximum(red_wins, blue_wins)
        low = jnp.minimum(red_wins, blue_wins)
        log_coeff = gammaln(total) - gammaln(high) - gammaln(low + 1)
        return log_coeff + (red_wins * jnp.log(prob)) + (blue_wins * jnp.log1p(-prob))

    team_prev_idx = [int(value) for value in structure["team_prev_idx"]]
    state_prev_idx = [int(value) for value in structure["state_prev_idx"]]
    state_delta_days = [float(value) for value in structure["state_delta_days"]]
    stage_count = int(structure["stage_count"])
    format_count = int(structure["format_count"])
    ruleset_count = int(structure["ruleset_count"])

    def model(data: dict[str, Any]) -> None:
        school_features = data["school_features"]
        school_count, feature_count = school_features.shape
        season_team_count = data["school_idx_of_team"].shape[0]
        state_count = data["state_team_idx"].shape[0]
        match_count = data["match_red_state_idx"].shape[0]

        school_feature_weights = numpyro.sample(
            "school_feature_weights",
            dist.Normal(0.0, 0.35).expand([feature_count]).to_event(1),
        )
        school_sd = numpyro.sample("sigma_school", dist.HalfNormal(priors["school_sd"]))
        season_sd = numpyro.sample("sigma_season", dist.HalfNormal(priors["season_sd"]))
        team_sd = numpyro.sample("sigma_team", dist.HalfNormal(priors["team_sd"]))
        drift_sd = numpyro.sample("sigma_drift", dist.HalfNormal(priors["drift_sd"]))
        beta_perf = numpyro.sample("beta_perf", dist.HalfNormal(priors["perf_sd"])) + 0.05
        rho = numpyro.sample("rho", dist.Beta(priors["rho_alpha"], priors["rho_beta"]))

        school_prior_mean = jnp.matmul(school_features, school_feature_weights)
        u_school = numpyro.sample("u_school", dist.Normal(school_prior_mean, school_sd).to_event(1))

        season_noise = numpyro.sample("season_noise", dist.Normal(0.0, season_sd).expand([season_team_count]).to_event(1))
        season_effects = []
        for idx in range(season_team_count):
            previous = team_prev_idx[idx]
            if previous < 0:
                season_effects.append(season_noise[idx])
            else:
                season_effects.append((rho * season_effects[previous]) + season_noise[idx])
        u_season = jnp.stack(season_effects) if season_effects else jnp.zeros((0,))
        numpyro.deterministic("u_season", u_season)

        u_team = numpyro.sample("u_team", dist.Normal(0.0, team_sd).expand([season_team_count]).to_event(1))
        state_noise = numpyro.sample("state_noise", dist.Normal(0.0, 1.0).expand([state_count]).to_event(1))
        drift_values = []
        for idx in range(state_count):
            previous = state_prev_idx[idx]
            scale = drift_sd * jnp.sqrt(state_delta_days[idx])
            innovation = state_noise[idx] * scale
            if previous < 0:
                drift_values.append(innovation)
            else:
                drift_values.append(drift_values[previous] + innovation)
        g_match = jnp.stack(drift_values) if drift_values else jnp.zeros((0,))
        numpyro.deterministic("g_match", g_match)

        theta_state = (
            u_school[data["school_idx_of_team"][data["state_team_idx"]]]
            + u_season[data["state_team_idx"]]
            + u_team[data["state_team_idx"]]
            + g_match
        )
        numpyro.deterministic("theta_state", theta_state)

        if enable_stage:
            alpha_stage = numpyro.sample(
                "alpha_stage",
                dist.Normal(0.0, priors["stage_sd"]).expand([stage_count]).to_event(1),
            )
        else:
            alpha_stage = jnp.zeros((stage_count,))
        if enable_format:
            alpha_format = numpyro.sample(
                "alpha_format",
                dist.Normal(0.0, priors["format_sd"]).expand([format_count]).to_event(1),
            )
        else:
            alpha_format = jnp.zeros((format_count,))
        if enable_ruleset:
            alpha_ruleset = numpyro.sample(
                "alpha_ruleset",
                dist.Normal(0.0, priors["ruleset_sd"]).expand([ruleset_count]).to_event(1),
            )
        else:
            alpha_ruleset = jnp.zeros((ruleset_count,))
        if enable_side:
            alpha_side = numpyro.sample("alpha_side", dist.Normal(0.0, priors["side_sd"]))
        else:
            alpha_side = 0.0

        logits = (
            theta_state[data["match_red_state_idx"]]
            - theta_state[data["match_blue_state_idx"]]
            + alpha_stage[data["match_stage_idx"]]
            + alpha_format[data["match_format_idx"]]
            + alpha_ruleset[data["match_ruleset_idx"]]
            + alpha_side
        ) / beta_perf
        p_match = jnp.clip(1.0 / (1.0 + jnp.exp(-logits)), 1e-5, 1.0 - 1e-5)
        numpyro.deterministic("p_match", p_match)
        numpyro.factor(
            "series_obs",
            jnp.sum(series_log_prob(p_match, data["match_red_wins"], data["match_blue_wins"])),
        )

    return model


def fit_numpyro_model(prepared: PreparedData, config: dict[str, Any]) -> dict[str, Any]:
    deps = require_bayesian_deps()
    jnp = deps["jnp"]
    random = deps["random"]
    SVI = deps["SVI"]
    Trace_ELBO = deps["Trace_ELBO"]
    AutoNormal = deps["AutoNormal"]
    Adam = deps["Adam"]
    Predictive = deps["Predictive"]
    MCMC = deps["MCMC"]
    NUTS = deps["NUTS"]

    structure = {
        "team_prev_idx": prepared.arrays["team_prev_idx"],
        "state_prev_idx": prepared.arrays["state_prev_idx"],
        "state_delta_days": prepared.arrays["state_delta_days"],
        "stage_count": len(prepared.stage_values),
        "format_count": len(prepared.format_values),
        "ruleset_count": len(prepared.ruleset_values),
    }
    model = make_model(config, structure)
    arrays = {key: jnp.asarray(value) for key, value in prepared.arrays.items()}
    training = config["training"]
    seed = int(training["seed"])
    rng = random.PRNGKey(seed)
    inference_mode = training["inference_mode"]

    if inference_mode == "svi":
        guide = AutoNormal(model)
        svi = SVI(model, guide, Adam(float(training["learning_rate"])), Trace_ELBO())
        result = svi.run(rng, int(training["num_steps"]), arrays)
        latent_samples = guide.sample_posterior(
            random.PRNGKey(seed + 1),
            result.params,
            sample_shape=(int(training["num_samples"]),),
        )
        posterior = Predictive(model, posterior_samples=latent_samples)(random.PRNGKey(seed + 2), arrays)
        losses = [float(value) for value in np.asarray(result.losses).tolist()]
        diagnostics = {"final_loss": losses[-1] if losses else None, "loss_history": losses}
    elif inference_mode == "nuts":
        warmup = int(training.get("num_warmup", 50))
        samples = int(training.get("num_samples", 50))
        kernel = NUTS(model)
        mcmc = MCMC(kernel, num_warmup=warmup, num_samples=samples, progress_bar=False)
        mcmc.run(rng, arrays)
        latent_samples = mcmc.get_samples()
        posterior = Predictive(model, posterior_samples=latent_samples)(random.PRNGKey(seed + 2), arrays)
        diagnostics = {"num_warmup": warmup, "num_samples": samples}
    else:  # pragma: no cover - config validation should prevent this
        raise ValueError(f"Unsupported inference mode: {inference_mode}")

    out = {key: np.asarray(value) for key, value in latent_samples.items()}
    out.update({key: np.asarray(value) for key, value in posterior.items()})
    out["diagnostics"] = diagnostics
    out["inference_mode"] = inference_mode
    return out


def summarize_rows(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return (
        values.mean(axis=0),
        values.std(axis=0),
        np.quantile(values, 0.05, axis=0),
        np.quantile(values, 0.50, axis=0),
        np.quantile(values, 0.95, axis=0),
    )


def build_prediction_frame(prepared: PreparedData, posterior: dict[str, Any], matches: Any, split_name: str) -> Any:
    pd, _ = require_dataframe_deps()
    probs = posterior["p_match"].mean(axis=0)
    records = []
    rows = matches.to_dict(orient="records")
    for idx, row in enumerate(rows):
        p_red = float(probs[idx])
        p_blue = 1.0 - p_red
        outcome = 1.0 if row["winner_side"] == "red" else 0.0
        log_loss = -(outcome * math.log(max(p_red, 1e-9)) + ((1.0 - outcome) * math.log(max(p_blue, 1e-9))))
        brier = (p_red - outcome) ** 2
        records.append(
            {
                "match_id": row["match_id"],
                "event_code": row["event_code"],
                "match_date": row["match_date"],
                "p_red_win": p_red,
                "p_blue_win": p_blue,
                "log_loss": log_loss,
                "brier": brier,
                "split_name": split_name,
            }
        )
    return pd.DataFrame.from_records(records)


def build_state_summary_frames(prepared: PreparedData, posterior: dict[str, Any]) -> tuple[Any, Any]:
    pd, _ = require_dataframe_deps()
    theta = posterior["theta_state"]
    mean, sd, q05, q50, q95 = summarize_rows(theta)
    summary_rows = []
    timeline_rows = []
    for idx, state in enumerate(prepared.state_rows):
        summary_rows.append(
            {
                **state,
                "mean": float(mean[idx]),
                "sd": float(sd[idx]),
                "q05": float(q05[idx]),
                "q50": float(q50[idx]),
                "q95": float(q95[idx]),
            }
        )
        timeline_rows.append(
            {
                **state,
                "theta_mean": float(mean[idx]),
                "theta_sd": float(sd[idx]),
            }
        )
    return pd.DataFrame.from_records(summary_rows), pd.DataFrame.from_records(timeline_rows)
