# §29.3.2 星火 Agent 证据模式响应优化

日期：2026-10-19。实际修改目录：`C:\Users\qwh76\Desktop\智能学习平台`。旧 worktree 的 DeepSeek 输出预算修改属于另一份快照，不作为本项星火验收结果。

## 问题与改动

原循环在证据模式完成必要工具后，仍请求模型选择下一动作（通常为 finish），或额外挑选并未要求的练习。证据答案实际由服务端从工具结果构建，该末尾请求不参与解释质量校验。

仅在 `AGENT_REVIEW_READY !== 'true'`、必要的检索/练习均有实际执行记录，并且目标明确要求原文或已经取得原文时，执行完工具便结束决策循环。工具参数继续经过原模型/schema，所有读工具仍复核本人归属与截止时间，随后使用原 `buildEvidenceAnswer` 和内容安全检查。

只要求原文的目标不再附加未要求的练习；明确要求练习时仍必须先执行练习工具。检索成功但为空时明确没有依据；工具抛错不能转换为成功。首次模型请求、缺凭据错误、纯状态无原文路径，以及已开启的解释生成/独立审查路径保持原行为。无请求/响应 DTO、表、依赖、配置或模型变更。

## 验证

- `npm test -- tests/unit/agent tests/unit/api/agent.test.ts`：实际匹配 Agent 目录 8 文件 / 110 项通过；末尾路径没有匹配文件，接口测试由下条准确路径单独执行。
- `npm test -- tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx tests/unit/ai/agent-provider.test.ts`：3 文件 / 65 项通过。合计 175 项相关回归，未称全量项目测试。
- `npm run type-check -- --incremental false`：通过。
- `npx eslint --no-ignore src/lib/agent/learning-agent.ts tests/unit/agent/learning-agent.test.ts --max-warnings=0`：通过。首次未带 no-ignore 时测试文件被忽略，修正命令后重新验证。
- 本地实际 `POST /api/assistant/agent`（无 Cookie / Authorization，空对象请求）：401 `UNAUTHENTICATED`，验证运行中的路由仍保持登录边界。

固定工具/模型回放中，检索并推荐练习的既有动作队列从 search / select / finish 三次模型决策收敛为 search / select 两次；只需原文时仅一次决策，模型参数逐项保持。新增必要练习未执行拒绝、检索失败抛错回归；原空检索、未知掌握记录、不复用旧解释、总超时、已开启审查及错误映射仍通过。

## 限制与保护范围

本项没有发起真实星火请求，不查询或消费额度；调用次数减少不等于已经测得真实毫秒提速，也不证明模型语义质量通过。没有新增 SSE / 逐字输出或改页面布局；原文解释验收开关仍按现有配置。未进行生产构建、远端部署或真人交互验收。

执行命令没有迁移、改写原资料/笔记、配置或人脸数据，没有操作用户的未提交改动；只修改本项实现/测试及同步文档。下一编号仍为 29.4 班级课程和作业数据/权限基础，本轮未提前实施。
