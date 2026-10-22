# AI 功能间歇性失效诊断报告

排查日期：2026-10-17
排查范围：`src/lib/agent/*`、`src/lib/ai/spark.ts`、`src/app/api/assistant/agent/route.ts`、`.env.local`、历史验收文档
结论性质：只读排查，**未修改任何代码**

---

## 一、结论速览

用户反馈「有的时候用 AI 不好使」，实际上是**四个不同层面的问题叠加**，彼此独立，需要分别处理：

| # | 问题 | 性质 | 用户感受到的现象 | 修复成本 |
|---|------|------|------------------|----------|
| 1 | `AGENT_REVIEW_READY="false"` 跳过 AI 生成 | 设计决策，非缺陷 | 回答是模板话术，不像 AI 写的 | 改配置，但需先验 |
| 2 | 错误信息被统一抹平 | 可观测性缺陷 | 不知道为什么失败 | 极低，一行改动 |
| 3 | 90 秒预算 vs 最多 6 次决策调用 | 容量规划偏紧 | 时好时坏，偶发超时 | 中低 |
| 4 | `SPARK_MODEL="lite"` 弱模型格式不合格率高 | 模型能力不足 | 触发 3 的重试雪崩 | 需更换模型（有费用） |

---

## 二、主因：AI 大概率根本没有生成内容

### 证据

`src/lib/agent/learning-agent.ts:36`

```ts
const reviewEnabled = process.env.AGENT_REVIEW_READY === 'true';
```

`src/lib/agent/learning-agent.ts:70`

```ts
if (!reviewEnabled && (searchRequired || state.evidence.length)) return evidenceResult();
```

而 `.env.local:2` 配置了 `AGENT_REVIEW_READY="false"`，所以 `reviewEnabled` 恒为 `false`。

再看 `searchRequired` 的判定（`learning-agent.ts:33`）：

```ts
const searchRequired = /原文|依据|解释|混淆|概念/.test(input.message);
```

这意味着：**只要用户提问里出现「原文 / 依据 / 解释 / 混淆 / 概念」任意一个词，就必然走降级分支**。日常提问「帮我解释一下这个概念」「这段原文什么意思」命中率极高。

### 具体后果

降级分支调用 `buildEvidenceAnswer`（`src/lib/agent/evidence-answer.ts:11`），返回的是**服务端模板拼装**的文本：

```
证据模式：原文解释暂未通过核验，先提供可回看的原文和学习安排。
以下摘录保留转写原样，口误或含混处请回到资料核对。
真实学习记录：...
原文摘录 N：...
```

整个过程调用了工具、读了数据库，**但没有调用大模型生成任何解释**。用户看到的是功能正常的界面 + 一段固定腔调的文字，自然会认为「AI 不好使」。

### 这是 bug 吗

不是。这是一个**刻意的保守降级**：

- `LEARNINGS.md:297` 记载：「当前 AGENT_REVIEW_READY 默认关闭原文分析，真实 503 明确提示到学习页核对；不能单独设置开关 true 冒充解决」
- `.env.example:60` 注释：「保持 false，完成错误样本及完整请求验收后再开启」

当时关闭的理由是**忠实性审查尚未通过验收**——为了避免 AI 编造原文依据，宁可不给出解释。这个判断在当时的验收语境下是合理的。

副作用是：**只要这个开关没打开，用户就永远拿不到真正的 AI 解释。**

---

## 三、为什么不知道错在哪：错误信息被抹平

`src/app/api/assistant/agent/route.ts:22-26`

```ts
catch (reason: unknown) {
  if (!(reason instanceof AiError)) throw reason;
  taskLogger.warn('agent: model request failed', { code: reason.code, contentId: parsed.data.contentId });
  const message = reason.code === 'REVIEW_NOT_READY' ? '...'
    : reason.code === 'GROUNDING_FAILED' ? '...'
    : '学习Agent暂时无法完成分析，请稍后重试；没有保存计划或提交答案';
  return fail(ErrorCode.AI_UNAVAILABLE, message, HttpStatus.SERVICE_UNAVAILABLE);
}
```

后端实际会抛出多种语义完全不同的错误：

| 错误码 | 抛出位置 | 真实含义 | 重试有用吗 |
|--------|----------|----------|-----------|
| `MISSING_API_KEY` | `spark.ts:127` | 没配 API Key | 无用，必须改配置 |
| `TIMEOUT` | `spark.ts:180` | 超时 | 有时有用 |
| `SCHEMA_INVALID` | `spark.ts:225` | 模型输出两次都不合 JSON Schema | 有时命中会成功 |
| `OUTPUT_TRUNCATED` | `spark.ts:170` | 输出达到长度上限 | 需缩小输入 |
| `EMPTY_RESPONSE` | `spark.ts:173` | 模型返回空 | 有时有用 |
| `STEP_LIMIT` | `learning-agent.ts:63` | 工具预算内未完成必要检索 | 重试无用 |
| `UPSTREAM_ERROR` | `spark.ts:164` | 供应商错误 / 限流 | 等待后可能恢复 |

**这七种情况在前端呈现为一模一样的一句话。**

其中 `MISSING_API_KEY`（配置缺失）和 `STEP_LIMIT`（逻辑未满足）属于**重试一万次也不会好转**的情形，却被引导用户「稍后重试」。

值得肯定的是，`code` 已经通过 `taskLogger.warn` 写入日志（`task-logger.ts:22`，console 输出，dev 环境落在 `.next/dev/logs/next-development.log`）。问题只在于**没有透传给调用方**。

---

## 四、为什么是「有时候」：时间预算与重试雪崩

### 实测基线

数据来源：`docs/acceptance/agent-latency-20261012.md §22.4`（真实请求，非估算）

| 阶段 | 耗时 |
|------|------|
| 三次决策 | 2 482 + 1 077 + 1 201 = 4 760 ms |
| 生成 | 5 901 ms |
| 审查 | 12 822 ms |
| 术语核对 | 10 137 ms |
| **串行合计** | **33 642 ms** |
| 审查+术语并行后 | 26 008 ms（少 22.7%） |
| 真实 HTTP 实测 | **30 409 ms** |

### 预算上限

- `src/lib/config.ts:30` → `AGENT_TOTAL_MS: 90_000`（后端总时限）
- `src/services/api.ts:415` → 前端 `AGENT_REQUEST_MS`（100 秒）
- `learning-agent.ts:27` → 单次调用 `timeoutMs = min(20_000, (deadline - now) / 2)`

### 雪崩机制

`src/lib/ai/spark.ts:199` 的 `extractJson` 允许 2 次尝试。第 218-222 行显示，失败时会把上一轮的**错误输出和纠正指令 append 回 messages**：

```ts
messages = [
  ...messages,
  { role: 'assistant', content: content.slice(0, 1_000) },
  { role: 'user', content: `上一轮输出不符合 JSON Schema 要求，错误为：${lastError}。请严格重新输出...` },
];
```

于是形成正反馈：

```
模型输出不合规
  → 重试
  → prompt 变长
  → 单次推理变慢
  → 剩余预算变少（options() 的 min(剩余/2) 进一步压缩单次超时）
  → 更容易失败 / 超时
  → 逼近 90 秒天花板
```

`learning-agent.ts:40` 的 decision 循环最多 3 轮，每轮内部 `extractJson` 最多 2 次 → **单个 decision 阶段最多 6 次模型调用**，全部共享 90 秒预算。

因此结果呈现概率性：

- 一次通过 → 30 秒左右 → ✅ 正常
- 决策阶段重试 2 次 → 约 60 秒 → ⚠️ 险过
- 多处重试叠加供应商波动 → 超过 90 秒 → ❌ TIMEOUT

验收文档自己也承认这一不确定性：「仍可能遇到供应商波动、真实格式错误或 90 秒期限；没有保证秒回或宣称全部间歇性故障消除」。

---

## 五、根子上的问题：模型能力

`.env.local:12` → `SPARK_MODEL="lite"`，即讯飞星火最轻量的免费档。

`LEARNINGS.md:309` 已经记载了它的具体失效模式：

> 真实星火 lite 会将工具动作与 plan/answer 混合输出、重复状态读取或返回数组。

Agent 链路要求模型**严格输出单个合法 JSON 对象**（见 `learning-agent.ts:15` 的 BOUNDARY 提示词），而 lite 恰恰不擅长稳定遵守结构化输出。这就是第四节「重试雪崩」的触发源。

补充配置问题：

- `.env.local` **未设置** `SPARK_TIMEOUT_MS`，因此走 `spark.ts:17` 的 `defaultTimeoutMs()` = 60 秒；而 `.env.example:52` 建议的是 30 秒（更早失败、更快重试，反而整体更快）
- `rate-limit.ts:98` → AI 限流默认 10 次/分钟/用户，连续追问会触发 `RATE_LIMITED`

---

## 六、修复建议（按性价比排序）

### 建议 1：透传错误码 —— 改动最小，收益最大

在 `route.ts` 的 catch 中按 code 返回不同文案，让用户/开发者立刻知道是配置问题还是临时故障。特别是 `MISSING_API_KEY` 必须明确提示「未配置密钥」而非「稍后重试」。

风险：极低。不改变业务逻辑，只改返回文案。

### 建议 2：决策阶段降级为单次尝试

decision 每轮已经是「选一个下一步动作」的简单输出，失败重试的收益不高，反而吃掉总预算。可改为失败即降级：`StepLimit` 或直接用 `search_material` 兜底。

风险：低。但会略微降低复杂问题的处理成功率。

### 建议 3：放宽总时限或缩短大 Burgundy Stage 的工作量

把 `AGENT_TOTAL_MS` 提到 120 秒并同步前端超时，或者让审查阶段在剩余预算不足时跳过。

风险：低到中。用户等待变长。

### 建议 4：开启 `AGENT_REVIEW_READY`

**这一项不建议现在做。** `.env.example:60` 和 `LEARNINGS.md:297` 都明确要求先完成错误样本与完整请求验收。贸然打开会让未经验证的 AI 解释进入生产，可能出现编造原文依据的问题——那比「不好使」严重得多。

### 建议 5：更换更强的模型

这才是根治弱 JSON 的办法（`lite` → `Pro` 或改用已配置的 ZHIPU / 阿里百炼）。但会产生费用，且 `ALIYUN_AGENT_QUOTA_CONFIRMED` 目前为 `false`，需要用户主动决策是否投入额度。

---

## 七、待办清单

- [x] 透传错误码（建议 1）— 已于 2026-10-17 完成，见第九节
- [ ] 是否调整决策阶段重试策略（建议 2）
- [ ] 是否放宽 90 秒预算（建议 3）
- [ ] 是否投入额度更换更强模型（建议 5，需用户决策）
- [ ] `AGENT_REVIEW_READY` 保持 false，待忠实性验收通过后再议

---

## 八、方法论备注

本次排查未采用「猜测 - 验证」模式，而是：

1. 精读 Agent 全链路源码（`learning-agent.ts` 从工具调用到审查的完整流程）
2. 交叉比对实际运行配置（`.env.local`）而非文档宣称
3. 引用既有验收文档中的**真实实测数据**作为时间预算依据
4. 区分「缺陷」与「刻意设计」——第四节的降级机制是有正当理由的工程取舍，不应按 bug 处理

区分「哪里坏了」和「为什么当初这样设计」，是这次诊断最重要的产出。

---

## 九、建议 1 实施记录（2026-10-17）

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/ai/failure-message.ts` | 新增。集中映射 13 个 AiError code 到用户文案 |
| `src/app/api/assistant/agent/route.ts` | 用映射替换三元表达式，并在 `details.reason` 返回错误码 |
| `src/app/assistant/page.tsx` | `AI_UNAVAILABLE` 不再被覆盖成固定文案，改用后端精确文案 |
| `tests/unit/ai/failure-message.test.ts` | 新增 22 个用例 |
| `tests/unit/api/learning-agent.test.ts` | 新增 2 个用例，覆盖 reason 透传与配置类文案 |

### 映射表

统一后缀为「；没有保存计划或提交答案」，下表省略。

| code | 文案要点 | 用户该做什么 |
|------|----------|--------------|
| `MISSING_API_KEY` | 未配置模型密钥 | 改配置，文案明确写「重试无效」 |
| `QUOTA_NOT_CONFIRMED` | 免费额度未确认 | 去云端确认额度 |
| `MODEL_CONFIG_INVALID` | 模型配置无效 | 检查环境变量 |
| `TIMEOUT` | 超过时间限制 | 缩小问题范围 |
| `SCHEMA_INVALID` | 返回格式不合格 | 可重试；反复出现需换更强模型 |
| `OUTPUT_TRUNCATED` | 输出达到长度上限 | 缩短问题或减少范围 |
| `EMPTY_RESPONSE` | 返回空内容 | 稍后重试 |
| `UPSTREAM_ERROR` | 服务不可用或已达限额 | 稍后重试 |
| `STEP_LIMIT` | 工具预算内未完成检索 | 换更明确的关键词 |
| `GROUNDING_FAILED` | 未通过原文核对 | 回看资料或缩小问题 |
| `REVIEW_NOT_READY` | 原文解释核验未通过 | 到学习页回看原文 |
| `INSUFFICIENT_EVIDENCE` | 原文依据不足 | 补充资料或缩小范围 |
| `SOURCE_CHANGED` | 资料已变更 | 刷新页面 |

未登记的 code 回落到「AI 服务暂时不可用，请稍后重试」。

### 安全边界

- 只输出固定文案，不透传上游报文、原始错误消息或凭据。已有测试断言响应体不含 `AiError.message` 的私有内容。
- `details.reason` 仅含错误码枚举值，不含消息正文。

### 顺带发现的死分支

`REVIEW_NOT_READY` 在 `src/` 中**没有任何抛出点**，只有 route.ts 在消费它——即这是一条永不触发的分支。映射表保留该 code 作为防御，但不应视为已实现的路径。

### 回归验证

tsc 0 错误、eslint 0 警告、166 个测试文件 / 1317 个用例全部通过（新增 34 个）。
