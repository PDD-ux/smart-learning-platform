# §25.7 管理员讨论管理与举报验收

完成：2026-10-14 22:10（北京时间）。执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。仅本编号；25.8消息与25.9完整新用户验收未实施。

## 已实现

管理员独立 `/admin/discussions`“讨论与举报”：课程选项分页、主题可见状态/举报处理状态筛选、真实分页、置顶/取消、关闭/开启课程讨论、隐藏/恢复主题及回复、查看当前举报对象与指定回复。管理动作必须填写理由和明确确认，失败保留输入与版本；处理举报单独填写结果，不自动隐藏。管理员只能管理曾发布且prepared的共享讨论，不能代写用户正文或读取私人学习资产。

学生可举报当前可见主题/回复，关闭课程讨论仍允许举报；本人记录独立刷新/分页核对结果。隐藏/下架后仅可读自己的原因和结果，不返回旧正文、举报人或处理人的内部身份。作者删除/删号清正文，管理恢复仅移除隐藏，不复活删除。

新增 `DiscussionReport`/`DiscussionEvent` 与 `20261014080000_discussion_moderation`，本机 Prisma validate/migrate deploy/generate成功，共29张表。部分唯一索引限制一个本人目标只有一个OPEN举报；全局本人requestId去重、CAS、当前数据库角色、父链锁、限流、no-store。处理、结果事件、审计同事务；事件仅保存关联及固定类型，25.8通知/未读尚未实现。

主要代码：`prisma/schema.prisma`及迁移；`src/lib/discussions/moderation.ts`、`moderation-contracts.ts`；`src/app/api/admin/{discussions,discussion-replies,discussion-reports}`、管理员课程discussion路由与学生举报路由；`src/services/api.ts`、`AdminShell`、`src/app/admin/discussions/page.tsx`、`DiscussionReports`及`CoursePage/CourseDiscussion`接入。现有管理员课程DTO返回真实discussionEnabled，学生仍正式门控。

## 验证结果

- 全量 **148文件/1163项通过**，见 `.taskbook-working/moderation-20261014/regression-final.log`。针对管理契约、实际客户端请求格式、管理页面、学生举报与既有讨论/架构共28项通过；TypeScript严格检查、完整Next lint通过。
- `.taskbook-working/moderation-20261014/accept.cjs` 核心 **76项真实HTTP** 通过：匿名401/学生越权403、错误参数400、当前角色降级、私密字段白名单、隐藏计数/恢复、版本冲突、关闭可读可举报、下架无正文、待处理唯一/重复payload、分页及第六次举报429。
- 并发处理一200一409，最终唯一事件与唯一审计；故意制造本次临时举报事件唯一冲突后请求500，举报仍OPEN、无成功审计，移除临时故障后明确重试成功。仅操作本次隔离数据。
- `extra.cjs`：原生页面提交真实落库、原生处理只写一事件/审计、跨课程相同requestId并发一200一409且仅一行、作者删回复清正文及管理员恢复404均通过，见 `extra.json`。
- 原生内置浏览器：管理员查看举报对象/处理结果、讨论关闭与恢复成功；学习者B仅本人5条记录并看到同一处理结果，学习者A提交另一条举报成功。1280px/900px无横向溢出、可见操作至少44px，视口已恢复。截图均自建临时课程：`admin-result.png`、`learner-result.png`。
- 原生页面首轮发现新API方法提前JSON.stringify，统一请求层再次编码使服务端收到字符串而400。修正5个方法传对象、补实际fetch请求体过Zod回归后，真实页面提交/处理/开关均成功。mock领域服务及直接HTTP不能替代这个检查。
- 普通demo:start下学生举报GET/POST均404，管理员仍可管理，见 `gate-off.json`。未改 `.env/.env.local`；正式 `DISCUSSION_RELEASE_READY` 默认false。
- 使用现有管理员删用户API：举报人删除级联本人举报/事件、回复清正文；发布者删除仍保留共享副本，旧已删除管理员JWT401。见 `delete-compatibility.json`。
- 本次临时账号/课程/主题/回复/举报/事件/审计均0，原媒体未触碰；副本和来源夹具仅按验证后的绝对根路径及本次ID清理，随机凭据文件已移除。`cleanup.json`及`protection.json`显示原学习数据、.env、.env.local指纹全true。网页普通演示已恢复，face CPU8002 modelsLoaded=true、scan模式已恢复。

## 可复现入口

在桌面主仓库、有效本地数据库及现有依赖下执行。夹具为本次新建账号及自生成媒体，禁止换成原三份资料。测试时仅给临时网页进程设置门控，不修改env文件，也不启用云资源。先停止自己启动的普通网页，保留未知/用户进程。

```powershell
node .taskbook-working/demo-walkthrough-20261014/protect.cjs before
$env:DISCUSSION_RELEASE_READY='true'
npm run dev
```

另一个终端：

```powershell
node .taskbook-working/shared-course-20261014/accept.cjs
node .taskbook-working/moderation-20261014/accept.cjs
npm test
npx tsc --noEmit
npm run lint
```

`extra.cjs`包含原生页面结果断言，必须先完成页面指定提交/处理，不能直接冒充页面已验。当前 `extra.json` 为本次真实证据。结束临时网页后在无继承DISCUSSION_RELEASE_READY变量的新终端启动 `npm run demo:start`，再执行：

```powershell
node .taskbook-working/moderation-20261014/accept.cjs off
node .taskbook-working/moderation-20261014/accept.cjs final
node .taskbook-working/shared-course-20261014/accept.cjs cleanup
node .taskbook-working/demo-walkthrough-20261014/protect.cjs after
node .taskbook-working/moderation-20261014/cleanup-proof.cjs
npm run face:status
```

final会删除本次夹具账号，之后不能再登录它们。cleanup-proof仅读取本次ID确认0并移除失效凭据；重跑须重新setup。公开记录/日志不含密码/token/密钥。

## 范围与未完成项

未新增模型/ASR/Ascend请求、训练、依赖或生产构建，未公开原三份私人资料。新生产/S3/公网、手机实机、正式传播授权及大规模压力未验；当前没有正式共享素材，所以正式管理列表为空。站内消息、真实未读和回复事件仍是25.8，不以本次事件表冒充通知闭环。

续轮开始发现临时网页已退出，恢复后额外验收成功，最后切回普通demo:start。临时浏览器标签清理时工具的URL策略拒绝绑定“无法访问此站点”页面，未绕过；该临时管理员标签可能仍在，失效测试账号已删除，可直接关闭。未操作用户原有标签。

文档同步PRD/DESIGN/ARCH/DATA/VISUAL/07/09/10/DEPLOY/TASKS/PROGRESS/LEARNINGS：更新非TODO现状、29表及接口/交互契约，保留历史验收范围；本轮未补TODO，无新依赖，因此README选型不改。
