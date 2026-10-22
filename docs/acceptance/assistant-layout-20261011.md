# §22.3 AI助手信息布局

## 2026-10-12 08:09续验完成

用户要求“继续修改”，本轮仍只收尾§22.3。发现本机3000开发服务已停止，恢复`npm run dev`，当前开发服务session60843保留。没有修改密钥、模型/审查开关、输出校验或超时配置；上次TIMEOUT/SCHEMA_INVALID本轮三次完整Agent运行未复现，不能称已经定位根因或消除间歇性故障。

长引用补为>240字时显示160字原文预览，明确标“摘录预览”，默认收起完整原文；回看链接始终显示。短摘录完整展示，全文不改写，展开不调用AI。代码仅改助手page；先同步DESIGN/VISUAL/TASKS，既有AgentActions状态逻辑未改。无TODO补全，非TODO增补为已授权布局续修。

- `assistant-layout-20261012-diagnostic-1`：完整真实诊断成功；`assistant-layout-20261012-http-1`：本人HTTP200、匿名401、跨用户admin403，真实引用在第七题8:55，1题及20分钟方案正常。保存的诊断/HTTP回答已人工核对来袭方饱和成片、防御方单目标/单独应对限制和系统集合方向，噪声保持原样；只证明这个固定样本，不证明普遍准确。没有通过HTTP成功替代语义核对。
- 本人已登录实际浏览器运行成功（后台200/41013ms；独立HTTP200/50094ms），学习记录5个知识点/最近0作答/无掌握记录，三段原文编号摘引、8:55引用、1道真实题及8+7+5分钟方案分区显示。443字引用可展开全文并收起，工具详情默认收起。
- 日期控件自动化`fill`先显示2026-10-13T09:30，但返回练习后恢复初值，此证据不作为成功。改用控件原生键盘修改，DOM value属性更新后记录2027-10-12T08:10，进入未作答练习再返回仍为同一值；`time-preserved.json`保存对比。最后用原生键盘还原测试年份并改到明日2026-10-13T08:10，仍仅为页面草稿，未保存。两次练习均0/1、未选择/提交答案；返回仅预填反馈问题，未自动再调用Agent。页面隐藏的问答/方案不进练习可访问树。日期fill方法与原生操作的差异保留，不凭一次DOM改值误判业务状态。
- 390×844有内容页面planWidth230、scrollWidth382，长步骤与标题换行、方案和时间草稿保持。临时viewport设置/检查/截图/finally reset在同一个工具步骤完成，立即恢复电脑窗口；最终`desktop-final.png`显示正常电脑侧栏与练习/方案，`mobile-plan.png`留存窄屏证明。
- `assistant-layout-20261012-checks-1/vitest.json`：修改后默认并行114文件838/838通过；TS严格检查、助手page/AgentActions ESLint通过。不改测试超时、重试、并行设置或模型。只读`assistant-layout-20261012-after-1`及前两次报告十类学习数据保护指纹仍`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`；未改变XP、练习记录、计划或三份资料。最后只读检查modelCalled=false。

页面证据在`.taskbook-working/assistant-layout-20261012-page-1`：`source-expanded.txt`、`returned.txt`（首次fill返回的原始结果）、`time-preserved.json`、`narrow.json`、`http-status.txt`及截图。后端日志只有预期的200/401/403/200四次Agent HTTP；无计划保存、作答写请求。§22.3必需布局与真实有内容状态验收已完成，下文2026-10-11失败及当时剩余项作为历史保留。本轮没有开展其他编号任务。

2026-10-11 22:05记录：页面布局已实现，相关回归和全量回归通过；真实有回答内容的浏览器验收被模型请求故障阻塞，编号任务保留未完成。用户反馈测试时页面像手机，已立即清除临时viewport并恢复正常电脑窗口；不是将产品改为移动端。

## 改动与边界

仅修改`src/app/assistant/page.tsx`和`src/components/assistant/AgentActions.tsx`的呈现：紧凑页头、最大960px阅读宽度、资料/模式/预算控制区；学习记录、学习建议、原文依据、下一步行动分区，练习卡先于独立复习方案，工具详情默认折叠置末尾。对话移除50vh限高和内部滚动，输入随页面正常滚动；建议按钮、引用和工具摘要至少44px，日期输入可收缩。沿用原Tailwind语义色，无新增CSS、依赖、接口或字段。

原请求/失败草稿、资料/模式切换、真实引用地址、练习隐藏不卸载、手动保存、不确定结果核对及原尝试时间逻辑均保留。没有修改模型配置或客户端/服务端超时，没有提交本人答案、创建计划或改学习数据；没有新增持久聊天、重新解析或训练。

先更新TASKS编号与DESIGN §17、VISUAL §3.10。无TODO补全；非TODO修改是本项授权布局调整，并把原50vh/固定可见输入描述与现行Agent1000字、资料问答500字限制对齐。无架构/契约变化，不需更新ARCHITECTURE、DATA-MODEL或README。

## 验证

- `.taskbook-working/assistant-layout-20261011-checks-1/vitest.json`：助手12、会话2、练习组6，共20/20通过；涵盖失败草稿、防重复、引用、练习返回保留选定时间/已保存/不确定状态，以及仅本人点击才能保存和作答。此次未新增镜像实现的视觉断言。
- `assistant-layout-20261011-full-1/vitest.json`：默认并行114文件838/838通过。`npx tsc --noEmit`和两份修改文件ESLint通过。运行中的Next开发服务支持HMR，本轮未运行build覆盖其`.next`。
- 本人已登录的真实页面正常读取三份演示资料与22XP。1440×1000布局读取宽度1440、scrollWidth1440，资料选择器537.125px；对话overflowY=visible、maxHeight=none。390×844窄屏资料选择器264px、scrollWidth382，没有横向溢出；控制区和失败状态实际检查。截图采用浏览器原生视图，截图API与临时视口的缩放行为不等同于CSS尺寸读数，不以缩放截图宣称完整1440画面。
- 用户反馈后立即reset临时视口；正常窗口innerWidth952、scrollWidth944，对话maxHeight仍none，预算20和31字失败草稿保持。未重新加载或退出登录。最终标签保留，`assistant-layout-20261011-page-1/desktop-restored.png`为恢复后的页面，`desktop-error.png`/`mobile-error.png`为失败状态证据。
- 两次只读tools检索分别留在`assistant-layout-20261011-before-1`和`assistant-layout-20261011-after-1`，均modelCalled=false；本人三份演示与十类学习数据保护指纹前后仍为`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，不包含缓存播放/登录元数据。

## 真实模型阻塞（不得称有内容状态已通过）

只进行了两次真实Agent请求，使用30分钟演示视频`cmuqhyf7h00027q29tijy4uer`、20分钟预算，未自动重试：

1. “我有20分钟，请结合真实学习记录，安排复习并挑选已有练习，给出原文依据。”服务端POST `/api/assistant/agent`返回503，耗时90364ms，日志`2026-10-11T14:01:10.955Z`、code=`TIMEOUT`。
2. “我有20分钟，请围绕第七题安排复习和已有练习，并给出原文出处。”服务端返回503，耗时54990ms，日志`2026-10-11T14:02:58.833Z`、code=`SCHEMA_INVALID`。

证据来自运行中Next服务session14709当轮输出和实际浏览器错误区；UI明确显示“AI服务暂时不可用，请稍后重试”，恢复本次草稿，没有假回答/题目/计划。第二次返回格式不符合服务端校验，不凭此断言模型语义错误；当前故障也不等于额度耗尽。本轮不扩大范围修模型网关。实际成功回答的分区、方案和练习切换只能由既有组件回归证明，尚不能宣称本轮真实浏览器验收通过。

## 可复现入口与剩余项

桌面主仓库运行开发服务后，登录本人学习者账号，打开`http://localhost:3000/assistant`，选择“阿里木江7.10-前30分钟”，保持学习Agent/20分钟并发送上述第二个目标。成功返回时检查学习记录、建议、原文依据、实际推荐练习、复习方案和末尾工具详情；修改本页学习时间但不保存，进入练习后直接返回，核对时间保持、没有自动发送或写入。完成有内容状态的电脑/窄屏核对后才核销§22.3；调整临时viewport必须在同一验证步骤结束后立即reset，不留给用户日常页面。

自动回归复现：`npx vitest run tests/e2e/assistant.test.tsx tests/e2e/session-page.test.tsx tests/e2e/exercise-group.test.tsx`；默认全量`npx vitest run`，类型`npx tsc --noEmit`，规范`npx eslint src/app/assistant/page.tsx src/components/assistant/AgentActions.tsx`。
