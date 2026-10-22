# §10.2 问答引用摘录改进

2026-10-09，桌面主仓库。本轮仅处理上一轮真实视频问答中的引用重复及定位核对问题，不重跑 ASR/Ascend，不改资料或学习记录。

## 改动

原始转写在 293、300、301、303 秒分段，数据库没有上一轮摘录中重复拼接的整句。服务端此前只校验引用字段格式，未核对摘录与来源的配对关系。

现在上下文内部保留实际被选中的转写/文本块原文和定位，另保留个人笔记；问答通过 JSON 配对来源和独立笔记提供一次上下文，避免重复发送全部原文。个人笔记和被截断来源不授权引用。

摘录必须逐字对应来源的连续原文；拼接摘录只有在来源开头至少 12 字可靠匹配时才改用单段原文（短来源要求完整开头），最多 500 字。模型引用相邻时间点时，只按全体保留来源中唯一的文字匹配纠正真实定位，禁止根据近邻猜测。同页多块且未指定块号时，必须逐字唯一匹配。没有依据或存在歧义时不显示引用；所有候选均无依据时通过既有 schema 重试一次，仍失败返回 503。回答照抄已知格式示例的占位文字同样被拒绝。返回的摘录执行内容安全检查。

这项检查保证返回摘录取自原始资料，不等于自动证明回答语义正确，也不会修复源 ASR/OCR 的口语断句和识别错误。

## 真实复验与保留限制

- 将上一轮重复摘录输入改进后的纯函数，用真实 293 秒来源验证，输出为该段原文，重复拼接已消除。见 [原始问题复现及来源修复](qa-grounding-20261009-oct09-grounding-final.json) 的 originalRepetitionRepair。
- 中间实现曾直接按模型时间点取原文，真实星火把回答引用到无关的 287 秒。保留 [中间错误结果](qa-grounding-20261009-oct09-grounding.json)，不把“真实文字”当作语义通过；最终实现要求摘录匹配，加入相邻时间纠正和歧义回归。
- 中间真实星火返回了“依据资料的回答”占位答案，即使摘录和 293 秒定位匹配也不算问答通过。该结果保留在上述 final JSON，最终实现已加入占位拒绝规则。
- 最终实现真实调用仍出现两次 HTTP 503 / AI_UNAVAILABLE：[第一次](qa-grounding-20261009-oct09-grounding-done-failure-1791505290255.json)、[第二次](qa-grounding-20261009-oct09-grounding-done-failure-1791505333345.json)。脱敏服务日志为 SCHEMA_INVALID；没有放行错误摘录或占位答案。真实星火完整回答及引用稳定性仍未通过，不声称本轮解决全部模型质量问题。
- 两个最终失败均有脱敏结果，未保存响应体的其他中间校验失败只能据本机服务日志确认，不补造模型响应。
- 三份临时副本均已清理，原视频及全部关联数据指纹一致、媒体未删除：[初轮](qa-grounding-20261009-cleanup.json)、[中间](qa-grounding-20261009-final-cleanup.json)、[最终](qa-grounding-20261009-done-cleanup.json)。副本只共享只读媒体，没有新建账号或修改原账号，没有重跑识别。

## 验证

80 个测试文件、466 项通过；TypeScript、Lint、Next.js 生产构建通过。保留既有字体/img/可选 Valkey 提示。日志位于忽略目录 `.taskbook-working/qa-grounding-{tests,build}-20261009.log`。本地开发网页已重新启动。

回归覆盖逐字摘录、重复拼接、原文自身重复保持原样、唯一文字纠正相邻定位、歧义来源拒绝、资料类型和区间、文档块号、500 字上限、截断来源/个人笔记隔离，以及全无依据引用和占位回答的 schema 拒绝。

修改问答 route、context-builder，新增 qa-citations 纯函数、验收入口与回归测试；同步架构和数据规则、PROGRESS、LEARNINGS。没有新增页面、API 字段、数据库字段或依赖；没有补全 TODO，非 TODO 文档修改用于明确本次真实来源核对规则。

## 复现

在已配置本地数据库、JWT、星火及媒体的桌面主仓库启动 `npm run dev`，选新 runId，依次执行：

```powershell
npx tsx scripts/acceptance/real-playback-fixture.ts setup oct09-grounding-recheck qa-grounding-20261009-recheck
npx tsx scripts/acceptance/qa-citation-grounding.ts oct09-grounding-recheck
# 即使真实 AI 校验失败，也必须清理数据库副本；不能调用产品删除接口删除共享媒体。
npx tsx scripts/acceptance/real-playback-fixture.ts cleanup oct09-grounding-recheck qa-grounding-20261009-recheck
```

入口只向临时内容发送问答，受控令牌仅在内存中，不输出凭据；先重现原重复摘录，再调用真实 API 核对每条返回摘录是否是保留原文的连续子串。真实回答语义需人工检查。模型失败报告以时间戳保留，不覆盖此前证据。若中断，依据忽略目录 fixture 状态清理数据库，保留原视频对象。
