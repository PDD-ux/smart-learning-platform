# §21.2 Agent检索修复验收（2026-10-10 22:47）

执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。仅本编号检索修复，不训练、引入依赖、部署或修改本人学习数据。§21.3只列待办，不在本轮继续实现。

## 结果与实现

第七题检索不再混入154秒“分析出来的”及1417秒“全文分析”。真实工具输出535秒一个连续摘录，涵盖537秒高效空袭体系、560秒单目标防空导弹、585秒难以单独应对多目标及602秒防空系统升级方向。拼接仅按真实相邻转写换行，回看起点为首段535秒，保留ASR噪声；没有改写原转写或生成假来源。

`src/lib/agent/retrieval.ts`负责请求词拆分、明确题号优先评分、窗口合并及安全上下文分组；`tools.ts`仍绑定本人当前资料，题号先精确查询候选，避免旧知识点中段引用560/573/585秒遮住题干。其它词可自动匹配唯一完整知识点名或使用模型提供的pointNumber。图文先在数据库筛引用页，结果仍经类型/范围/安全检查。无命中不补泛化原文。

初始转写/文本各≤2000条，额外附近转写≤2000；最佳至多2处命中，题号后90秒，其它关键词前15/后90秒，钳制视频时长。相邻段按≤500字、≤10秒间隔组合，空白/不安全段断开；连续转写最多6段，补同窗口命中OCR后总≤8段。截断标记与原文局限说明提供给模型。候选和窗口有界，不代表全课覆盖或语义章节边界。

`learning-agent.ts`提示保留题号、使用实际知识点编号，来源遗漏纠正显示实际可用编号；增加主体/能力/限制与短句摘引提示，**并未新增通用语义校验**。权限、公开请求/响应、数据库、页面交互及架构调用链不变，因此无需新增PRD需求或修改公开数据/页面规格；细节以本记录为准。没有TODO补全。TASKS/PROGRESS/LEARNINGS同步真实结果。

## 检查与真实证据

- 22:44最终9文件69项相关回归、`npm run type-check`、定向ESLint通过。新增8项检索回归和1项遗漏引用拒绝，扩展工具归属检查；覆盖泛词/题号、晚段候选、旧引用在中段、上下文/空隙/危险原文、页码/无命中、截断及原Agent闭环。未运行覆盖开发`.next`的生产构建。
- `.taskbook-working/agent-retrieval-20261010-verified/{retrieval,report}.json`：只读工具通过，535秒连续原文含攻防相关论述，未调用模型。`checks.txt`与`types.txt`保存最终回归及类型输出；ESLint退出0无输出。
- 初次`.taskbook-working/agent-retrieval-20261010-tools/retrieval.json`为0段失败，首次脚本在断言前未保存指纹，不能据此声称完整验收。`...-probe/report.json`独立确认失败时保护记录保持；旧证据保留，未覆盖。
- `...-model/model.json`：503/AI_UNAVAILABLE，服务端日志SCHEMA_INVALID；`...-diagnostic/diagnostic.json`明确两次遗漏实际原文编号。随后增强当轮编号纠正，不自动补编号或放宽校验。
- `...-model-final/model.json`：200，实际535秒来源/1题/5分钟方案，人工发现来袭方和防御方倒置，**语义失败**。
- `...-model-subject/model.json`：加强主体核对提示后200、实际535秒来源/1题/5分钟方案；正确保留单目标防空导弹限制，但仍把“高效空袭体系”称为“防空能力”，**语义仍未通过**，也未遵循先摘引短句的提示。标题20分钟是输入预算，实际步骤5分钟，不是完成时长。两轮中工具曾挑3题，最终响应只映射第七题1题，并未提交答案。
- 两个HTTP200轮次的匿名401、跨用户即使admin也403；保护指纹前后均`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`。保护范围包括原XP、资料标题/状态、个人笔记、掌握度、作答、计划、自动笔记、知识点、转写和OCR，不包含正常浏览器进度元数据或其它未列资源。没有用户数据写入、题库生成、作答或计划保存。

本轮没有操作浏览器，组件回归及HTTP验证不写成新页面回答验收；原助手页可能仍保留§21.1历史回答。原本地开发服务持续运行（127.0.0.1:3000，监听PID79192），未重启、改配置或代输凭据。

## 复现

桌面仓库既有数据库与网页可用、真实Spark环境变量配置保持。本入口仅针对已有1800秒视频，使用新目录，拒绝覆盖历史；签名令牌仅在本机进程中用于API检查，不注入浏览器/打印/落盘。tools无模型调用、model检查真实HTTP及隔离，diagnostic直接执行真实模型并将Schema原因保存在本机忽略目录。结构与定位检查不自动判断回答语义，需人工审阅`model.json`。

```powershell
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-retrieval-new-tools tools
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-retrieval-new-model model
npx tsx scripts/acceptance/agent-retrieval.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/agent-retrieval-new-diagnostic diagnostic
npx vitest run tests/unit/agent tests/unit/api/learning-agent.test.ts tests/e2e/assistant.test.tsx tests/e2e/exercise-group.test.tsx tests/unit/api/ai-qa.test.ts tests/unit/api/study-plans-bank.test.ts tests/e2e/app-shell-states.test.tsx
npm run type-check
npx eslint src/lib/agent tests/unit/agent scripts/acceptance/agent-retrieval.ts
```

本人正常登录助手后，可输入同一验收问题：“我有20分钟，请检索第七题的原文依据，解释来袭方与防御方的区别，挑选该知识点已有练习，返回不超过20分钟的复习方案。只解释原文能确认的内容，说明真实掌握记录。”当前仍可能产生上述语义问题，不能作为无需核对的正确答辩文本。

## 未完成

检索问题已修复；回答忠实性按§21.3待处理，不把提示增强或合法引用宣称为已解决。AI偶发格式/上游故障、ASR噪声、全课语义覆盖、真人完整答题、新版浏览器展示、会话续期及既有云端/公网部署仍未全部验收。本轮不扩大为模型训练或更换收费模型。
