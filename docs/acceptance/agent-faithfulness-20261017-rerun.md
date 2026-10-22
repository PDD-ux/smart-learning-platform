# §21.3 Agent 忠实性验收复跑（2026-10-17 14:47）

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。本轮为**复跑**，目的：确认 `AGENT_REVIEW_READY` 在 2026-10-10 判定为「lite 不可靠」之后，经过 7 天开发，当前配置下的审查器是否已有改善，从而为「能否开启原文解释」提供当前证据。

本轮未修改任何生产配置、提示词或模型；未开启 `AGENT_REVIEW_READY`；未写本人学习数据；未执行下一个编号任务。

## 结论：未通过，维持关闭

`replayPassed: false`。**三个错误样本全部被审查器判定为 supported（通过）**，只有纯摘引正例按预期通过。这与 2026-10-10 的结论完全一致——**7 天后 lite 的语义审查能力没有改善**。

| 样本 | 预期 | 实际判定 | 结果 |
|------|------|----------|------|
| `model-final` | rejected | **supported** | ❌ 错误解释被误认可 |
| `model-subject` | rejected | **supported** | ❌ 错误解释被误认可 |
| `real-quote-wrong-explanation` | rejected | **supported** | ❌ 真实摘引 + 错误解释被误认可 |
| `literal-positive-control` | supported | supported | ✅ 正例按预期通过 |

关键在于第三行：即使解释是**错的**，只要配上一段真实的原文摘录，审查器就给出 supported。也就是说审查器只核对了「摘录是否逐字匹配原文」，没有核对「解释是否被摘录支持」。这正是当初关闭该功能的直接原因，复跑证明该缺陷依然存在。

`recordsUnchanged: true`，保护指纹前后一致（`e7407c51…d64753ca`），本轮验收没有污染任何学习数据。

## 对「Agent 只回原文」的定性

用户反馈「Agent 只能回答原文，问其他学习问题也一样」。本轮验收确认：**这不是缺陷，是保护生效**。

`learning-agent.ts:70` 的 `if (!reviewEnabled && (searchRequired || state.evidence.length)) return evidenceResult();` 会在两种情况下返回证据模式：①提问命中 `/原文|依据|解释|混淆|概念/`；②模型实际检索到原文片段（`state.evidence` 非空）。学习类提问通常触发②，因此绝大多数实质性问题都会落在证据模式。

证据模式只输出原文摘录、真实学习记录、已有练习与建议安排，**不含任何模型撰写的解释**。这是刻意的：既然审查器拦不住错误解释，就不产出解释。

## 复跑的关键前提：模型未变

`.env.local:12` 仍为 `SPARK_MODEL="lite"`，`AGENT_MODEL_PROVIDER="spark"`，与 2026-10-10 验收失败时**完全相同**。因此本轮属于「同条件下的再次确认」，而非对新模型的评估。

按 §21.3 既有结论，开启原文分析需同时满足：三项错误样本被拒绝、纯摘引正例通过、原问题真实完整调用与人工主体核对、权限及只读保护通过。当前第 1 项明确失败。

## 证据

- 报告：`.taskbook-working/faithfulness-rerun-20261017/report.json`
- 样本明细：`model-final.json`、`model-subject.json`、`real-quote-wrong-explanation.json`、`literal-positive-control.json`
- 检索输入：`evidence.json`
- 前后保护指纹一致，`recordsUnchanged: true`

## 复现

```powershell
npx tsx scripts/acceptance/agent-faithfulness.ts cmuqhyf7h00027q29tijy4uer <新证据目录> replay
```

要求资料为 `contentType=VIDEO` 且 `durationSec=1800`（本轮使用「阿里木江7.10-前30分钟」`cmuqhyf7h00027q29tijy4uer`，状态 READY，仍在库中）。**当前预期结果为 replay 失败**，不应为了让它通过而擅自把 `AGENT_REVIEW_READY` 设为 true。

## 可选项与代价

若要让 Agent 真正生成解释，唯一被既有文档认可的路径是换成更强的模型（§21.3 建议星火 Ultra，沿用自写客户端改动最小），拿到服务后重新执行本验收，四项全过才可开启。这需要额度/费用，由用户决策，本轮未做任何采购或配置变更。

在此之前，演示建议：避开设解释类提问，或主动说明「原文解释功能因忠实性验收未通过而默认关闭」。后者反而是工程严谨性的证据——有验收脚本、有失败样本、有可复现结论，比「AI 回答得很流畅但可能是编的」更有说服力。
