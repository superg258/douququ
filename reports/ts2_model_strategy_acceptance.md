# RoboMaster TS2 模型修改策略与验收方案

## 0. 范围说明

本文只给出 **模型层修改策略与验收标准**。

暂不包含以下内容：

- 不分析当前网页 live 数据。
- 不修改前端展示逻辑。
- 不修改后端接口结构。
- 不接入观众预测。
- 不把对手分作为模型特征。
- 暂不把机器人细分数据作为主模型均值特征。

本文的目标是：在不让模型过度复杂的前提下，解决当前 TS2 在 RoboMaster 场景中的核心问题：

> 赛前预测与实际表现明显不符的学校，尤其是历史强校今年表现显著下滑或历史弱校今年明显变强时，模型修正速度偏慢。

---

## 1. RoboMaster 赛事特性

RoboMaster 和常规体育联赛不同，不能直接套用“长赛季、多轮比赛、稳定阵容”的预测假设。

主要特性如下：

1. **样本极少**
   很多学校每年只有 3 到 5 场正式比赛。单年可观测数据非常少，不能指望慢速 Elo 更新自然收敛。

2. **年度断裂明显**
   机器人硬件、机械可靠性、视觉算法、控制策略、队员阵容、调试水平每年都可能变化很大。历史强校可能今年表现很差，历史弱校也可能因为机器人完成度提升而快速变强。

3. **赛前证据有价值，但不稳定**
   完整形态、RMUL、报名排序、赛前排名等证据有信息量，但这些证据不是直接比赛结果。它们可以大幅改变均值判断，但也必须同步提高不确定性。

4. **瑞士轮表现证据较强**
   “时均全队总伤害血量”和“时均总基地净胜血量”是更接近赛场实际表现的强证据。根据本地分析，全队伤害和胜率相关性更高，因此应作为瑞士轮阶段的主要表现信号。

5. **部分数据只在瑞士轮更新**
   全队伤害和基地净胜血量通常只在瑞士轮排名快照中更新，淘汰赛阶段不持续更新。因此模型只能在瑞士轮阶段使用这些观测，淘汰赛阶段不能假设有新的同类数据。

---

## 2. 当前模型问题抽象

当前 TS2 离线模型已经有合理的分层结构：

```text
theta_state
= 学校长期项
+ 赛季项
+ 队伍项
+ 日期漂移项
```

问题主要出现在发布/在线更新层：

1. 赛前先验更多体现为均值修正，但没有充分同步增加不确定性。
2. live 更新主要依赖局分残差，更新速度不足以快速修正明显失准的历史强校。
3. 瑞士轮强表现指标尚未作为当前赛季状态观测进入模型。
4. 历史强度在部分逻辑中会压低先验修正空间，这不完全适合 RoboMaster 年度变化大的场景。

---

## 3. 统一建模思路

不要为历史强校、爆冷、赛前先验冲突、瑞士轮表现差分别写大量条件特判。

建议统一为一个队伍级状态：

```text
theta_current_i = program_base_theta_i + season_delta_i
```

其中：

```text
program_base_theta_i = 学校长期历史基座
season_delta_i       = 当前赛季相对历史基座的偏移
```

每支队伍维护：

```text
season_delta_mu_i
season_delta_sigma_i
```

含义：

```text
season_delta_mu_i     = 当前赛季偏移均值
season_delta_sigma_i  = 当前赛季偏移不确定性
```

最终 rating：

```text
rating_current_i = 1500 + rating_scale * (program_base_theta_i + season_delta_mu_i)
```

所有 2026 证据都只更新 `season_delta`：

```text
赛前先验        → 初始化 season_delta
比赛局分结果    → 更新 season_delta
瑞士轮表现指标  → 更新 season_delta
```

这样模型统一、解释清晰，也能自然处理“历史强但今年弱”与“历史弱但今年强”的情况。

---

## 4. 统一证据融合公式

所有证据统一表示为：

```text
obs_mu     = 证据认为 season_delta 应该接近的值
obs_sigma  = 该证据的不确定性
```

使用统一融合函数：

```python
def soft_clip(value: float, cap: float) -> float:
    return cap * tanh(value / cap)


def fuse_observation(
    mu: float,
    sigma: float,
    obs_mu: float,
    obs_sigma: float,
    *,
    process_sigma: float = 0.08,
    sigma_floor: float = 0.30,
    delta_cap: float = 3.00,
) -> tuple[float, float, float]:
    prior_var = max(sigma, sigma_floor) ** 2
    obs_var = max(obs_sigma, 1e-6) ** 2

    gain = prior_var / (prior_var + obs_var)

    mu_new = mu + gain * (obs_mu - mu)
    mu_new = soft_clip(mu_new, delta_cap)

    sigma_new = sqrt(max((1.0 - gain) * prior_var + process_sigma ** 2, sigma_floor ** 2))

    return mu_new, sigma_new, gain
```

解释：

```text
sigma 越大       → gain 越大 → 更新越快
obs_sigma 越小   → gain 越大 → 证据越强
obs_sigma 越大   → gain 越小 → 证据越弱
```

这相当于一个简化版 Kalman / Glicko / TrueSkill 风格更新。

---

## 5. 赛前先验策略

### 5.1 不应过低限制赛前 prior cap

RoboMaster 的年度变化很大，赛前证据充分时，需要允许较大修正。

建议将 prior cap 改为由赛前证据支持度控制，而不是由历史强度强压：

```text
prior_delta_cap = 0.35 + 0.90 * recent_evidence_support
```

其中：

```text
recent_evidence_support = 0.0  → cap = 0.35 theta ≈ 47 rating
recent_evidence_support = 0.5  → cap = 0.80 theta ≈ 108 rating
recent_evidence_support = 1.0  → cap = 1.25 theta ≈ 169 rating
```

含义：

- 赛前证据不足时，不允许大幅跳动。
- 赛前证据充分时，可以允许 150 分量级修正。
- 历史强度不再直接压低 cap，而是用于不确定性计算。

### 5.2 赛前先验初始化

赛前初始化：

```text
season_delta_mu_0 = regional_prior_delta_theta
```

不确定性初始化：

```text
season_delta_sigma_0 =
sqrt(
    pre_signal_sd^2
    + (0.55 * abs(regional_prior_delta_theta))^2
    + (0.30 * (1 - rmuc_history_strength))^2
    + 0.25^2
)
```

各项含义：

```text
pre_signal_sd                          = 赛前证据模型残差
abs(regional_prior_delta_theta)         = 先验变化越大，不确定性越大
1 - rmuc_history_strength               = 历史覆盖越弱，不确定性越大
0.25                                    = RoboMaster 小样本基础不确定性
```

核心原则：

> 赛前先验可以大幅改变均值，但先验变化越大，模型越应提高不确定性。

这避免了模型在赛前就过度自信。

---

## 6. 比赛结果更新策略

比赛结果继续使用 `actual - expected` 的思想，但不再使用固定 K，而是作为一个 observation 融合进 `season_delta`。

对一场红蓝比赛：

```text
p_red = sigmoid((theta_red - theta_blue) / beta_perf)

actual_red = red_wins / (red_wins + blue_wins)

residual = beta_perf * (actual_red - p_red)
```

红方观测：

```text
obs_mu_red = season_delta_mu_red + residual
```

蓝方观测：

```text
obs_mu_blue = season_delta_mu_blue - residual
```

观测不确定性：

```text
obs_sigma_result = 0.60 / sqrt(total_games / 2)
```

示例：

```text
BO3 2:0  → total_games=2 → obs_sigma≈0.60
BO3 2:1  → total_games=3 → obs_sigma≈0.49
BO5 3:0  → total_games=3 → obs_sigma≈0.49
BO5 3:2  → total_games=5 → obs_sigma≈0.38
```

统一更新：

```python
season_delta_mu, season_delta_sigma, gain = fuse_observation(
    mu=season_delta_mu,
    sigma=season_delta_sigma,
    obs_mu=obs_mu_result,
    obs_sigma=obs_sigma_result,
)
```

优势：

- 赛前不确定性高的队伍自动更新更快。
- 赛前 prior 变化大的队伍自动更新更快。
- 不需要额外写“强校失准加大 K”的特判。

---

## 7. 瑞士轮表现更新策略

暂时只使用两个强指标：

```text
时均全队总伤害血量
时均总基地净胜血量
```

暂时不使用：

```text
对手分
观众预测
机器人细分数据
```

理由：

- 对手分与 TS2 / Elo 的对手强度修正存在信息重叠。
- 观众预测不确定性较高，不纳入模型。
- 机器人细分数据当前分析为弱证据，先作为诊断，不进入均值。

### 7.1 标准化

对同一赛区或同一瑞士轮小组做 robust z-score：

```text
z = clip((x - median) / (1.4826 * MAD), -2.5, 2.5)
```

得到：

```text
z_team_damage
z_base_hp_diff
```

### 7.2 构造表现观测

由于本地分析中全队伤害与胜率相关性更高：

```text
form_signal = 0.75 * z_team_damage + 0.25 * z_base_hp_diff
```

转成 season_delta 观测：

```text
obs_mu_form = 1.25 * tanh(form_signal / 1.20)
```

这里 `1.25 theta` 约等于 `169 rating` 的观测幅度。注意这不是直接加 169 分，实际更新幅度由 `gain` 决定。

### 7.3 表现证据不确定性

```text
form_reliability = min(sqrt(group_matches_played / 2), 1.0)

obs_sigma_form = 0.75 / max(form_reliability, 0.35)
```

解释：

```text
1 场后：证据可用，但不满权重
2 场后：证据基本可用
淘汰赛阶段：如果没有新的瑞士轮表现快照，就不更新
```

更新：

```python
season_delta_mu, season_delta_sigma, gain = fuse_observation(
    mu=season_delta_mu,
    sigma=season_delta_sigma,
    obs_mu=obs_mu_form,
    obs_sigma=obs_sigma_form,
)
```

---

## 8. 推荐参数表

| 模块 | 参数 | 建议值 |
|---|---:|---:|
| 赛前 prior cap 下限 | `prior_delta_cap_min` | `0.35 theta` |
| 赛前 prior cap 上限 | `prior_delta_cap_max` | `1.25 theta` |
| prior 改动引入不确定性 | `prior_delta_sigma_weight` | `0.55` |
| 历史弱覆盖不确定性 | `history_sigma_weight` | `0.30` |
| 小样本基础不确定性 | `base_event_sigma` | `0.25 theta` |
| season_delta 软 cap | `delta_cap` | `3.00 theta` |
| sigma 下限 | `sigma_floor` | `0.30 theta` |
| 每次更新过程噪声 | `process_sigma` | `0.08 theta` |
| 比赛结果 obs_sigma | `0.60 / sqrt(total_games / 2)` | 连续公式 |
| 全队伤害权重 | `team_damage_weight` | `0.75` |
| 基地净胜血量权重 | `base_hp_weight` | `0.25` |
| form 观测幅度 | `form_scale` | `1.25 theta` |
| form 观测温度 | `form_temperature` | `1.20` |
| form obs_sigma 基础值 | `form_obs_sigma_base` | `0.75 theta` |

---

## 9. 模型层落地步骤

### 第 1 步：修改赛前先验 cap

将 prior cap 改为证据支持度控制：

```text
prior_delta_cap = 0.35 + 0.90 * recent_evidence_support
```

不要再让历史强度直接压低 prior cap。

### 第 2 步：新增有效不确定性

生成赛前 rating 时新增：

```text
season_delta_mu
season_delta_sigma
effective_sigma_theta
effective_sigma_rating
```

其中：

```text
season_delta_mu = regional_prior_delta_theta
season_delta_sigma = effective_sigma_theta
```

### 第 3 步：替换固定 K live 更新

将固定 `online_update_scale` 更新替换为统一 observation fusion：

```text
比赛结果 → obs_mu_result, obs_sigma_result → fuse_observation
```

### 第 4 步：加入瑞士轮表现 observation

将：

```text
时均全队总伤害血量
时均总基地净胜血量
```

转成：

```text
obs_mu_form
obs_sigma_form
```

并融合进 `season_delta`。

### 第 5 步：保留机器人数据为诊断

机器人数据暂不进入 `season_delta_mu`，只保留为后续分析字段：

```text
robot_signal_alignment
robot_signal_missing
robot_signal_conflict
```

暂时不参与 rating 计算。

---

## 10. 验收方案

## 10.1 单元测试

### 测试 1：prior 越大，sigma 越大

输入：

```text
prior_delta = 0.2, 0.8, 1.2
history_strength 固定
pre_signal_sd 固定
```

验收：

```text
effective_sigma_theta 单调递增
```

### 测试 2：历史覆盖越弱，sigma 越大

输入：

```text
history_strength = 0.9, 0.5, 0.1
prior_delta 固定
```

验收：

```text
effective_sigma_theta 单调递增
```

### 测试 3：高 sigma 队伍更新更快

输入两支队伍：

```text
mu 相同
obs_mu 相同
obs_sigma 相同
sigma 不同
```

验收：

```text
sigma 高的队伍 gain 更大
sigma 高的队伍 mu_new 更接近 obs_mu
```

### 测试 4：form 指标方向正确

输入：

```text
z_team_damage 高
z_base_hp_diff 高
```

验收：

```text
obs_mu_form 为正
```

输入：

```text
z_team_damage 低
z_base_hp_diff 低
```

验收：

```text
obs_mu_form 为负
```

### 测试 5：form reliability 随场次增加

输入：

```text
group_matches_played = 0, 1, 2, 3
```

验收：

```text
form_reliability 单调递增，并在 2 场左右接近 1
```

---

## 10.2 回测验收

至少比较四个版本：

```text
A. 当前 TS2
B. 当前 TS2 + 新 sigma0
C. 当前 TS2 + 新 sigma0 + 统一比赛结果更新
D. 当前 TS2 + 新 sigma0 + 统一比赛结果更新 + 瑞士轮 form observation
```

### 主指标

```text
log loss
Brier score
accuracy
ECE / calibration error
```

### 重点分桶

必须单独统计：

```text
prior_delta_abs 高的学校
history_strength 高但实际表现差的学校
赛前 rating >= 1650 的强校
一年样本数 <= 5 的学校
瑞士轮 form_signal 绝对值高的学校
赛前预测概率 >= 0.70 但实际失利的比赛
```

---

## 10.3 验收标准

### 总体不得明显变差

```text
overall log loss 不得比当前 TS2 劣化超过 2%
overall Brier 不得比当前 TS2 劣化超过 2%
```

### 重点桶必须改善

在以下桶中：

```text
prior_delta_abs 高
history_strength 高但实际表现差
赛前强校失准
```

要求：

```text
log loss 改善 >= 5%
Brier 改善 >= 5%
```

如果样本太少，可放宽显著性要求，但不能出现系统性劣化。

### 修正速度必须改善

对“赛前强但前两场表现明显差”的队伍：

```text
correction_after_2 = rating_pre - rating_after_2
```

验收：

```text
新模型 correction_after_2 >= 当前模型 correction_after_2 * 1.25
```

同时要求：

```text
如果后续表现恢复，新模型能通过比赛结果回调
```

防止模型只会单向快速下修。

---

## 10.4 时间泄漏验收

瑞士轮 form observation 必须严格避免时间泄漏。

规则：

```text
预测第 1 场：不能使用任何瑞士轮累计 form
预测第 2 场：最多使用第 1 场后的快照
预测第 3 场：最多使用前两场后的快照
预测淘汰赛：可以使用瑞士轮结束后的最终 group rank 指标
```

如果没有历史快照，只能做：

```text
1. 不含 form observation 的逐场回测
2. 瑞士轮结束后预测淘汰赛的 form observation 验证
```

禁止用瑞士轮最终累计指标回测瑞士轮早期比赛。

---

## 11. 预期效果

修改后模型应具备以下行为：

1. **赛前先验能大幅修正强校或弱校**
   赛前证据充分时，允许约 100 到 170 分量级修正。

2. **赛前先验变化大会同步提高不确定性**
   大 prior shift 不再意味着模型更自信，而意味着模型承认当前赛季存在较大变化风险。

3. **实际比赛开始后修正更快**
   高不确定队伍在前 1 到 2 场后会快速靠近实际表现。

4. **瑞士轮强表现信号进入模型**
   全队伤害和基地净胜血量不再只是排序或解释字段，而是成为 season_delta 的观测。

5. **模型结构仍然统一**
   没有大量针对历史强校、弱校、爆冷、淘汰赛的条件特判。

---

## 12. 最终摘要

最终模型可以概括为：

```text
长期历史决定 program_base。
2026 所有证据统一更新 season_delta。
season_delta 同时维护均值和不确定性。
不确定性越高，比赛结果和瑞士轮表现修正越快。
```

采用证据：

```text
赛前先验：使用，并允许较大 cap
比赛局分：使用
瑞士轮全队伤害：使用，主权重
瑞士轮基地净胜血量：使用，辅助权重
```

暂不采用：

```text
对手分
观众预测
机器人细分数据
```

这套方案适合 RoboMaster 的核心原因是：

```text
样本少 → 需要高不确定性机制
年度变化大 → 赛前 prior cap 不能太低
强校可能失准 → live 更新必须由 sigma 控制
瑞士轮表现强 → 全队伤害和基地净胜血量应作为观测进入模型
```
