# 当前 TS2 与胜率预测规则复盘

更新日期：2026-05-18
适用范围：当前仓库里的 RMUC TS2 研究链路、`rmuc_live` runtime 产物、后端 `mode=live` 胜率预测路径。
主要入口：

- 配置：`configs/trueskill2_full.yaml`
- 离线 TS2：`research/trueskill2/model.py`
- 区域赛前先验：`research/trueskill2/regional_pre.py`
- live 更新与发布：`research/trueskill2/fit.py`、`scripts/sync_rmuc_live.py`
- live 页面胜率：`backend/app/service.py`
- 赛区模拟/H2H：`scripts/simulate_region.py`、`scripts/head_to_head.py`
- form/robot 快照特征：`research/trueskill2/live_archive.py`

## 1. 总体分层

当前 TS2 体系分三层：

```text
published_theta
= program_base_theta
+ season_delta_mu
+ momentum_theta
```

在发布产物里对应：

```text
program_base_theta      = rmuc_program_base_theta
season_delta_mu         = 当前赛季相对长期基座的偏移
momentum_theta          = 结果残差动量，只在配置启用时加入 live state
published_rating        = 1500 + rating_scale * published_theta
```

当前 `rating_scale = 135.0`。
`miniProgramPrediction` 是观众预测 overlay，不进入 TS2 状态，也不参与模型胜率计算。

## 2. 离线 TS2 训练层

代码入口：`research/trueskill2/model.py`

训练模型用历史 RMUC/RMUL 比赛学习长期学校强度、赛季/队伍状态和赛事上下文效果。核心胜率形式：

```text
logits =
  theta_state_red
- theta_state_blue
+ alpha_stage
+ alpha_format
+ alpha_ruleset
+ alpha_side

p_match = sigmoid(logits / beta_perf)
```

局分序列似然使用 BO3/BO5 的系列胜负局数，不只是单场胜负。训练配置当前启用：

```yaml
enable_stage_effect: true
enable_format_effect: true
enable_ruleset_effect: true
enable_side_effect: true
time_bucket: day
```

离线层的主要职责是生成长期基座：

```text
rmuc_long_term_base_theta_mean
```

它不是 live 状态；2026 当前赛季比赛不会被“重放进 2025 live”，而是在 runtime live 层单独更新。

## 3. 赛季前区域先验

代码入口：`research/trueskill2/regional_pre.py`、`research/trueskill2/fit.py`

区域先验把同年赛前证据映射成当前赛季偏移：

```text
regional_prior_theta = regional_pre_offset_theta
season_delta_mu_0    = regional_prior_theta
```

当前赛前发布 rating：

```text
published_regional_pre_rating
= 1500 + rating_scale * (rmuc_program_base_theta + regional_prior_theta)
```

先验偏移 cap：

```text
prior_delta_cap
= prior_delta_cap_min
+ (prior_delta_cap_max - prior_delta_cap_min) * recent_evidence_support
```

当前配置：

```yaml
prior_delta_cap_min: 0.35
prior_delta_cap_max: 1.25
history_cap_curve: 0.80
same_year_shape_weight: 0.40
same_year_rmul_weight: 0.95
same_year_consistency_weight: 0.55
```

赛季初不确定度：

```text
season_delta_sigma_0 =
sqrt(
  pre_signal_sd^2
  + (prior_delta_sigma_weight * abs(regional_prior_theta))^2
  + (history_sigma_weight * (1 - rmuc_history_strength))^2
  + base_event_sigma^2
)
```

当前配置：

```yaml
prior_delta_sigma_weight: 0.55
history_sigma_weight: 0.30
base_event_sigma: 0.25
season_delta_sigma_floor: 0.30
```

含义：

- 赛前证据越激进，初始 sigma 越大。
- 历史覆盖越弱，初始 sigma 越大。
- 这样允许新赛季状态在早期比赛后更快被拉回。

## 4. live runtime 产物

代码入口：`scripts/sync_rmuc_live.py`

当前 live 发布目录：

```text
data/runtime/rmuc_live/published_2026/
```

关键文件：

```text
published_manifest.json  配置签名、rating_scale、beta_perf、sourceUpdatedAt
current_snapshot.json    每支学校当前 TS2 状态
live_match_ledger.json   每场比赛前后状态流水
live_state_updates.json  同 ledger，用于兼容读取
```

后端 live 页面优先读取 runtime 产物；不要用 `data/derived/.../published_2026` 作为当前线上状态判断。

manifest 里的 `model_config_signature` 是同步复现的核心。如果配置变了，`sync_rmuc_live.py` 会重新发布 runtime 产物。

## 5. 统一观测融合

代码入口：`research/trueskill2/season_delta.py`

所有 live 证据都转成：

```text
obs_mu     = 证据认为 season_delta 应接近的位置
obs_sigma  = 证据不确定度
```

融合公式：

```text
prior_var = max(sigma, sigma_floor)^2
obs_var   = max(obs_sigma, 1e-6)^2
gain      = prior_var / (prior_var + obs_var)

mu_new    = mu + gain * (obs_mu - mu)
mu_new    = delta_cap * tanh(mu_new / delta_cap)

sigma_new = sqrt(max((1 - gain) * prior_var + process_sigma^2, sigma_floor^2))
```

当前配置：

```yaml
season_delta_cap: 3.00
season_delta_process_sigma: 0.08
season_delta_sigma_floor: 0.30
```

解释：

- 当前 sigma 越大，越容易被新证据拉动。
- 观测 sigma 越小，证据越强。
- `delta_cap` 防止单赛季偏移无限膨胀。

## 6. 瑞士轮早期 sigma floor

代码入口：`compute_group_stage_sigma_floor`

只在 `stage_family == regional_group` 生效。当前配置：

```yaml
early_group_sigma_floor: 0.42
early_group_sigma_floor_matches: 2.0
```

规则：

```text
前 2 场区域小组/瑞士轮比赛，season_delta_sigma_floor 从 0.42 线性回落到 0.30。
```

目的：赛季早期不要因为一场比赛过快锁死状态。

## 7. form 观测

代码入口：`research/trueskill2/live_archive.py`

form 来源于赛前最近的 `group_rank_info` 快照。主要字段：

```text
avg_team_damage   时均全队总伤害血量
avg_base_hp_diff  时均总基地净胜血量
opponent_points   对手分，当前权重为 0
```

先做组内 robust z-score，然后：

```text
form_signal =
  form_team_damage_weight * z_team_damage
+ form_base_hp_weight     * z_base_hp_diff
+ form_opponent_points_weight * z_opponent_points

form_obs_mu = form_scale * tanh(form_signal / form_temperature)
```

当前配置：

```yaml
form_team_damage_weight: 0.90
form_base_hp_weight: 0.10
form_opponent_points_weight: 0.00
form_scale: 1.60
form_temperature: 1.20
form_obs_sigma_base: 0.70
```

form 可靠性：

```text
reliability = min(sqrt(group_matches_played / 2), 1)
obs_sigma   = form_obs_sigma_base / max(reliability, form_reliability_floor)
```

## 8. form 快照新鲜度

代码入口：`build_runtime_live_form_observations`

当前配置：

```yaml
form_freshness_mode: event_count_v1
form_freshness_decay_minutes: 90.0
form_freshness_floor: 0.25
```

`event_count_v1` 不只看时间，还要求快照里的已赛场次数正好等于该队赛前应有场次数：

```text
snapshot_matches_played < expected_matches_played_before  => stale，丢弃
snapshot_matches_played > expected_matches_played_before  => future_leak，丢弃
snapshot_matches_played == expected_matches_played_before => current，使用
expected <= 0                                             => no_prior_matches，丢弃
```

这避免把赛后数据泄漏进赛前预测。

## 9. 对手质量调整

代码入口：`compute_opponent_adjusted_form_observation`

form 会根据赛前强弱预期做调整：

```text
expected_form_mu =
  opponent_form_expected_scale
  * tanh((team_theta - opponent_theta) / beta_perf)

adjustment_mu = opponent_form_adjustment_weight * expected_form_mu

form_opponent_adjusted_obs_mu = form_obs_mu - adjustment_mu
```

当前配置：

```yaml
opponent_form_expected_scale: 0.75
opponent_form_adjustment_weight: 1.00
```

含义：

- 强队打出好数据，一部分视为预期内。
- 弱队打出好数据，更有信息量。
- 强队打弱队数据差，会被更明显惩罚。

## 10. 机器人数据

代码入口：`build_live_form_observation_frame`

机器人摘要信号：

```text
robot_family_signal =
  0.45 * z_robot_output_kda
+ 0.30 * z_robot_output_hurt
+ 0.15 * z_robot_output_kills
+ 0.10 * z_robot_objective_damage
```

机器人观测：

```text
robot_obs_mu = robot_form_scale * tanh(robot_family_signal / robot_form_temperature)
```

当前配置：

```yaml
robot_form_blend_weight: 0.35
robot_form_scale: 1.25
robot_form_temperature: 1.20
robot_form_obs_sigma_base: 1.15
robot_form_reliability_floor: 0.35
robot_gate_conflict_weight: 0.05
robot_gate_robot_only_weight: 0.50
robot_gate_neutral_weight: 0.25
```

机器人 gate：

```text
conflict       => base = 0.05
aligned_*      => base = 1.00
robot_only_*   => base = 0.50
neutral        => base = 0.25
missing/other  => base = 0.00

robot_gate = clamp(base * robot_reliability * freshness, 0, 1)
blend      = robot_form_blend_weight * robot_gate
```

融合进 form：

```text
candidate_obs_mu =
  (1 - blend) * group_obs_mu
+ blend * robot_obs_mu
```

如果 group 和 robot 同向，但融合后绝对值反而小于 group 原值，则保留 group 原值，避免同向机器人数据把强信号削弱。

## 11. 比赛结果观测

代码入口：`compute_match_result_observations`

赛前单局概率：

```text
probability_red = sigmoid((theta_red - theta_blue) / beta_perf)
```

局分实际值：

```text
actual_red_score = red_wins / (red_wins + blue_wins)
```

结果残差：

```text
residual = beta_perf * (actual_red_score - probability_red)

red_obs_mu  = season_delta_mu_red  + residual
blue_obs_mu = season_delta_mu_blue - residual
```

结果观测 sigma：

```text
obs_sigma = result_obs_sigma_base / sqrt(total_games / 2)
```

当前配置：

```yaml
result_obs_sigma_base: 0.45
```

## 12. 预期弱队输球降权

代码入口：`compute_match_result_observations`

当前配置：

```yaml
expected_loss_sigma_multiplier: 2.50
expected_loss_probability_threshold: 0.35
```

规则：

```text
如果某队赛前胜率 < 0.35，且实际结果残差说明它按预期输了，
则只增大该输方的 result_obs_sigma。
```

影响：

- 预期内输给强队，不会被大幅惩罚。
- sigma 较高时，后续好表现仍能较快拉回来。
- 只处理输方，不对赢家做额外奖励。

## 13. 爆冷 sigma inflation

代码入口：`compute_result_sigma_inflation`、`apply_result_sigma_inflation`

当前配置：

```yaml
surprise_residual_threshold: 0.25
sweep_bonus_2_0: 0.10
max_sigma_inflation: 0.18
```

规则：

```text
surprise_residual = abs(actual_red_score - probability_red)
excess            = max(surprise_residual - threshold, 0)

如果 BO3 实际 2:0 或 0:2，则加入 sweep_bonus_2_0。

sigma_inflation =
  max_sigma_inflation
  * normalized(excess + decisive_bonus)
```

然后：

```text
sigma_after = sqrt(sigma_before^2 + sigma_inflation^2)
```

目的：爆冷或横扫说明当前状态不确定度应上升，不应马上过度自信。

## 14. 结果动量

代码入口：`compute_result_momentum_update`

当前配置：

```yaml
momentum_update_enabled: true
result_momentum_scale: 0.35
result_momentum_decay: 0.55
result_momentum_cap: 0.50
```

更新：

```text
side_residual =
  actual_red_score - probability_red        # 红方
  probability_red - actual_red_score        # 蓝方

new_signal = result_momentum_scale * side_residual * sqrt(total_games / 2)

momentum_new =
  result_momentum_decay * previous_momentum
+ new_signal

momentum_new = result_momentum_cap * tanh(momentum_new / result_momentum_cap)
```

在当前 `season_delta_fusion` 中：

```text
rmuc_live_state_theta = season_delta_mu + momentum_theta
```

## 15. 当前 live 更新顺序

代码入口：`build_published_live_state_updates`

每场已完成比赛按时间顺序处理：

1. 读取双方赛前 `season_delta_mu/sigma`、`momentum_theta`。
2. 如果有赛前 form 快照，先融合 form 观测。
3. 用融合后的赛前状态计算比赛结果概率。
4. 用实际局分生成 result observation。
5. 融合结果观测，更新 `season_delta_mu/sigma`。
6. 如启用 momentum，更新双方 `momentum_theta`。
7. 写入 `live_match_ledger.json`，记录赛前/赛后状态、form、robot、residual、sigma、rating delta。

当前策略：

```yaml
live_update_strategy: season_delta_fusion
```

在此策略下，旧的 `confirmed_prior_theta/residual_prior_theta` 会被置为 0；赛季状态统一由 `season_delta_mu` 表达。
`online_live_update_scale` 仍保留在配置和 manifest 中，但当前 `season_delta_fusion` 主路径不使用它；它只在非 fusion 的 legacy `compute_online_match_live_deltas` 路径里生效。

## 16. current_snapshot 发布规则

代码入口：`_build_published_current_snapshot`

对每支学校取最后一条 ledger：

```text
season_delta_mu          = last.season_delta_mu_after_match
season_delta_sigma_theta = last.season_delta_sigma_after_match
rmuc_momentum_theta      = last.momentum_theta_after_match
regional_group_matches_played = last.regional_group_matches_played
current_stage_family     = last.stage_family
```

未比赛学校：

```text
season_delta_mu          = regional_prior_theta
season_delta_sigma_theta = preseason sigma
rmuc_momentum_theta      = 0
regional_group_matches_played = 0
current_stage_family     = regional_pre
```

当前发布 rating：

```text
published_theta =
  rmuc_program_base_theta
+ confirmed_prior_theta
+ residual_prior_theta
+ rmuc_live_state_theta

published_rating = 1500 + rating_scale * published_theta
```

在 `season_delta_fusion` 下，已比赛学校通常表现为：

```text
published_theta = rmuc_program_base_theta + season_delta_mu + momentum_theta
```

## 17. sim 模式胜率预测

代码入口：`scripts/simulate_region.py`

非 live 或没有 official runtime 时，预测使用 Monte Carlo：

```text
sampled_red  ~ Normal(red_theta, red_sigma)
sampled_blue ~ Normal(blue_theta, blue_sigma)

p_game_base_red =
  average(sigmoid((sampled_red - sampled_blue) / beta_perf))
```

然后裁剪：

```text
p_game_base_red = clip(p_game_base_red, 0.05, 0.95)
```

之后进入 H2H 和系列胜率计算。

## 18. live 模式胜率预测

代码入口：`backend/app/service.py`

live 页面使用 `live_payload_builder_factory`。如果某场比赛已经有官方赛果，builder 会从 `live_match_ledger.json` 读取该场赛前状态，而不是用赛后 `current_snapshot` 反推。

### 18.1 赛前 rating index

对已完成比赛：

```text
currentElo = published_rating_before_match
seasonDeltaMu = season_delta_mu_before_match
momentumTheta = momentum_theta_before_match
stageFamily = stage_family
regionalGroupMatchesPlayedBefore = regional_group_matches_played - 1
formObsMu = form_obs_mu
formOpponentAdjustedObsMu = form_opponent_adjusted_obs_mu
formObsGain = form_obs_gain
formEventFreshnessWeight = form_event_freshness_weight
formRobotFamilySignal = form_robot_family_signal
formRobotSignalConflict = form_robot_signal_conflict
```

对未完成比赛：

```text
currentElo = current_snapshot.published_rating
seasonDeltaMu = current_snapshot.season_delta_mu
momentumTheta = current_snapshot.rmuc_momentum_theta
stageFamily = current_snapshot.current_stage_family
regionalGroupMatchesPlayed = current_snapshot.regional_group_matches_played
```

### 18.2 component prediction head

当前配置：

```yaml
prediction_head_base_weight: 0.25
prediction_head_season_delta_weight: 1.00
prediction_head_momentum_weight: 0.00
prediction_head_temperature: 1.00
prediction_head_early_group_min_matches: 1.0
prediction_head_early_group_max_matches: 1.0
```

启用条件：

```text
stageFamily == regional_group
且 regionalGroupMatchesPlayedBefore 在 [1.0, 1.0] 内
```

即当前默认只对每队已有 1 场瑞士轮记录的比赛启用，主要覆盖 R2。

component head：

```text
prediction_theta =
  base_weight         * programBaseTheta
+ season_delta_weight * seasonDeltaMu
+ momentum_weight     * momentumTheta
+ process_residual_theta
+ robot_form_agreement_theta
```

如果不满足 component head 条件：

```text
prediction_theta = (currentElo - 1500) / rating_scale
```

但如果仍处于 `regional_group`，会额外加入 `robot_form_agreement_theta`。

## 19. prediction head residual 修正

代码入口：`_live_process_residual_theta`

当前配置：

```yaml
prediction_head_process_residual_weight: 0.35
prediction_head_process_residual_cap: 0.40
```

启用条件：

```text
weight > 0
cap > 0
formOpponentAdjustedObsMu 存在
seasonDeltaMu 存在
formObsGain > 0
freshness > 0
```

计算：

```text
residual =
  clamp(formOpponentAdjustedObsMu - seasonDeltaMu, -cap, cap)

process_residual_theta =
  weight * freshness * residual
```

注意：这个 residual 只在 component head 内加入，不作为全局强信号。当前权重从 `0.25` 提到 `0.35`，含义是早期已有完整赛后快照时，允许“对手校正后的表现”比单纯赛季偏移多一点发言权。

## 20. prediction head robot/form agreement 修正

代码入口：`_live_robot_form_agreement_theta`

当前配置：

```yaml
prediction_head_robot_form_agreement_weight: 0.15
prediction_head_robot_form_agreement_cap: 0.30
```

启用条件：

```text
weight > 0
cap > 0
formObsMu 存在
formRobotFamilySignal 存在
formObsGain > 0
formRobotSignalConflict != true
formObsMu 和 formRobotFamilySignal 同号
freshness > 0
```

计算：

```text
agreement =
  sign(formObsMu)
  * min(abs(formObsMu), abs(formRobotFamilySignal), cap)

robot_form_agreement_theta =
  weight * freshness * agreement
```

作用范围：

- component head 内：直接加入 component prediction theta。
- regional_group 但非 component head：加到 `(currentElo - 1500) / rating_scale` 后。
- 非 regional_group：不加入。

这个修正是当前候选版本，目的是只在 form 和机器人数据同向时做小幅置信度校准。

## 21. 单局胜率到系列胜率

live deterministic 路径：

```text
p_game_base_red =
  sigmoid((prediction_theta_red - prediction_theta_blue) / beta_eff)

beta_eff = beta_perf * prediction_head_temperature
p_game_base_red = clip(p_game_base_red, 0.05, 0.95)
```

随后进入 H2H：

```text
p_game_adj_red = H2H_adjust(p_game_base_red)
```

BO3 分布：

```text
P(2:0) = p^2
P(2:1) = 2 * p^2 * (1-p)
P(1:2) = 2 * p * (1-p)^2
P(0:2) = (1-p)^2
```

BO5 分布：

```text
P(3:0) = p^3
P(3:1) = 3 * p^3 * (1-p)
P(3:2) = 6 * p^3 * (1-p)^2
P(2:3) = 6 * p^2 * (1-p)^3
P(1:3) = 3 * p * (1-p)^3
P(0:3) = (1-p)^3
```

系列胜率：

```text
p_series_red = sum(red_games > blue_games 的 scoreline_probability)
p_series_blue = 1 - p_series_red
```

页面的胜负预测以 `p_series_red >= 0.5` 判断红方胜。

## 22. H2H 修正

代码入口：`scripts/head_to_head.py`

H2H 输入来源：

```text
2024 RMUC
2025 RMUC
2026 RMUL
当前 runtime 已完成对战
```

历史权重：

```text
BASE_SOURCE_WEIGHTS:
  RMUC = 1.0
  RMUL = 0.45

HISTORICAL_SEASON_WEIGHT_MULTIPLIER = 0.65
TIME_DECAY_HALF_LIFE_DAYS = 365
```

当前赛季 runtime H2H：

```text
CURRENT_SEASON_MATCH_WEIGHT = 0.75
```

最小有效权重：

```text
MIN_EFFECTIVE_WEIGHT = 0.35
```

如果有效权重不足，只返回 `delta_h2h = 0`。

H2H shrink：

```text
p_shrunk =
  (score_a + PRIOR_WEIGHT * p_base)
  / (effective_weight + PRIOR_WEIGHT)

PRIOR_WEIGHT = 3.5
```

logit 修正：

```text
delta_logit =
  clip(logit(p_shrunk) - logit(p_base), -MAX_DELTA_LOGIT, MAX_DELTA_LOGIT)

p_game_adj = sigmoid(logit(p_base) + delta_logit)
delta_h2h  = p_game_adj - p_base
```

当前最大概率影响：

```text
MAX_DELTA_PROBABILITY = 0.10
MAX_DELTA_LOGIT = 4 * atanh(0.10)
```

## 23. 页面 live 路径

代码入口：`build_simulation_payload(..., mode="live")`

live 模式流程：

1. 读取 `normalized_schedule.json` 和 runtime published 产物。
2. 如果官方 live source active，则使用官方落位、官方瑞士轮对阵、官方已完成赛果。
3. 对每一场比赛调用 `live_payload_builder_factory`。
4. builder 对已完成比赛使用 ledger 赛前状态，对未完成比赛使用 current snapshot。
5. 生成 `pGameRed/pGameBlue/pSeriesRed/pSeriesBlue/deltaH2H`。
6. 再附加 `redCurrentElo/blueCurrentElo/redLiveDelta/redPriorDelta` 等展示字段。

当前页面实际评判路径应以：

```text
/api/regions/south_region/simulation?seed=...&mode=live
```

返回的 `predictionBasis` 为准。

## 24. 当前关键参数快照

来自 `configs/trueskill2_full.yaml`：

```yaml
rating_scale: 135.0

live_update_strategy: season_delta_fusion
online_live_update_scale: 0.50

result_obs_sigma_base: 0.45
expected_loss_sigma_multiplier: 2.50
expected_loss_probability_threshold: 0.35

surprise_residual_threshold: 0.25
sweep_bonus_2_0: 0.10
max_sigma_inflation: 0.18

early_group_sigma_floor: 0.42
early_group_sigma_floor_matches: 2.0

momentum_update_enabled: true
result_momentum_scale: 0.35
result_momentum_decay: 0.55
result_momentum_cap: 0.50

live_form_update_enabled: true
form_freshness_mode: event_count_v1
form_team_damage_weight: 0.90
form_base_hp_weight: 0.10
form_opponent_points_weight: 0.00
form_scale: 1.60
form_temperature: 1.20
form_obs_sigma_base: 0.70

opponent_form_expected_scale: 0.75
opponent_form_adjustment_weight: 1.00

robot_form_blend_weight: 0.35
robot_form_scale: 1.25
robot_form_temperature: 1.20
robot_form_obs_sigma_base: 1.15
robot_gate_conflict_weight: 0.05
robot_gate_robot_only_weight: 0.50
robot_gate_neutral_weight: 0.25

prediction_head_base_weight: 0.25
prediction_head_season_delta_weight: 1.00
prediction_head_momentum_weight: 0.00
prediction_head_temperature: 1.00
prediction_head_early_group_min_matches: 1.0
prediction_head_early_group_max_matches: 1.0
prediction_head_process_residual_weight: 0.35
prediction_head_process_residual_cap: 0.40
prediction_head_robot_form_agreement_weight: 0.15
prediction_head_robot_form_agreement_cap: 0.30
```

## 25. 当前评估边界

当前规则有几个重要边界：

1. 观众预测只用于对比，不进入模型。
2. residual 在全局方向性较弱，因此只保留为 component head 的小修正。
3. robot/form agreement 是小幅候选校准，不应继续靠南部错局单独调大。
4. `event_count_v1` 是防泄漏关键规则，不能为了覆盖更多场次随意放宽。
5. R2-R4 的后续优化应优先走跨快照、跨区域、跨赛季 replay，而不是手写南部场次特判。

## 26. 复盘时建议检查的字段

单场错误复盘优先看 `live_match_ledger.json`：

```text
published_rating_before_match
season_delta_mu_before_match
season_delta_sigma_before_match
result_obs_mu
result_obs_sigma
result_obs_gain
surprise_residual
sigma_inflation
momentum_theta_before_match
momentum_theta_after_match
form_obs_mu
form_opponent_adjusted_obs_mu
form_obs_gain
form_event_freshness_status
form_robot_family_signal
form_robot_signal_alignment
form_robot_signal_conflict
published_rating_after_match
```

胜率复盘优先看 API match payload：

```text
pGameRed
pSeriesRed
deltaH2H
redCurrentElo / blueCurrentElo
redLiveDelta / blueLiveDelta
redPriorDelta / bluePriorDelta
miniProgramPrediction
```

其中 `miniProgramPrediction` 只能用于人群对比，不能解释模型自身状态变化。
