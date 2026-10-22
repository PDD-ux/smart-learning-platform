# §25.8 站内消息与参与记录验收

完成：2026-10-14 22:42（北京时间）。仓库：`C:\Users\qwh76\Desktop\智能学习平台`。仅本编号；25.9完整新用户/双用户演练留下一会话。具体实现契约先落 `spec/11-NOTIFICATIONS.md`。

## 实现

新增Notification及20261014090000_notifications迁移，本机Prisma validate/migrate deploy/generate成功，30表/16枚举；User、共享课程/主题/回复/举报删除级联，事件key唯一及SQL来源类型CHECK。既有举报结果事件按原时间/同key转未读通知，不回填旧回复。

新回复只通知主题作者，自己回复不通知；回复与通知/审计同事务。处理举报与DiscussionEvent/Notification/审计同事务，失败不留部分成功。未读、单条幂等已读、截至服务端读取时间全部已读及参与列表均只本人；当前数据库账号核对，API sharedRoute/withAuth/private,no-store，非法/重复分页400、匿名401、非本人消息404、门控关闭先404。

消息DTO固定摘要、日期/已读、本人已处理举报结果、当前可用目标；没有旧正文、作者/举报人邮箱、内部身份、存储键或私人源ID。隐藏/删除/下架时目标null，本人结果仍可核对。参与列表仅本人发布或有当前可见回复的可见共享主题。

/messages提供消息/参与文字标签、分页/刷新/真实空与读取失败、单条和全部已读。顶栏文字“消息”显示真实未读数；60秒、focus及已读后重读，失败未知，迟到响应守卫/卸载清理；无WebSocket/浏览器推送。回看链接不自动已读，进入共享课程自动打开指定主题，可按当前主题实际引用暂停回看。

主要修改：`prisma/schema.prisma`与增量迁移；`src/lib/discussions/notifications.ts`及service/moderation通知接入；notifications与discussions/participated薄API；`src/services/api.ts`；MessageWorkspace/MessageLink、AppShell、/messages、课程thread定位与CourseDiscussion来源按钮；接口/工作区/顶栏/旧Shell与主流程回归及架构路由边界。

## 验证

- 全量 **1178项/151文件通过**，日志 `.taskbook-working/notifications-20261014/regression-final.log`。最终针对性27项/5文件通过，严格TS及完整lint通过；工作区移到组件目录后再复验。
- `accept.cjs` **47项真实HTTP通过**：A发主题B回复，A一条通知；相同requestId重复回复仅一通知，自回复不发。B收件箱不含A消息、标读A消息404；单条首次readAt保持、read:false/额外owner/非法分页拒绝。
- GET读取截止后新增第三条回复，全部已读只更新截止前一条，后来消息仍未读；未来before400。参与A/B各1、无参与管理员0。隐藏目标无URL及参与0，恢复重新可用；隐藏特定回复仅该条消息失去URL。下架所有旧目标不可用，本人举报结果仍可见。
- 同一举报仅一DiscussionEvent与一Notification，重复处理409。隔离课程临时触发器强制下一回复通知失败，HTTP500且回复数量未变；finally移除触发器/函数，不影响原课程。见http.json。
- `extra.cjs`额外：原生单读/全部读落库；播种本次通知key冲突使处理500，Report仍OPEN、Event0、成功Audit0；清除自己的冲突夹具后明确重试成功。删除本次已有通知后，仅按本次课程执行迁移INSERT两次，原事件时间保持且key唯一；作者删回复/主题后旧消息无目标、参与0、原链接404。见extra.json。
- 原生内置浏览器：A从顶栏1未读进入3条消息，链接自动打开“课堂消息闭环测试”详情及真实回复；点击回看来源，video duration3/currentTime1/paused=true，链接点击前后未读保持1；单读后列表和顶栏1→0。参与标签显示真实1条。B登录后仅一条本人举报结果，无A回复消息；全部已读后1→0。两账号均为本次随机临时账号，未代用户输入密码。
- 1280/900窗口无横向溢出，可见按钮/顶栏链接≥44px，临时视口reset；消息回看链接补用现有learner-text-action的44px样式。截图messages.png/report-result.png均自建隔离素材。验收结束退出并关闭本次标签，未操作原用户标签。
- 普通demo:start恢复后notifications GET、participated GET、read-all POST均404，正式DISCUSSION_RELEASE_READY仍默认false，gate-off.json留证。原env未改；此轮不提前执行25.9开放/演练。
- 使用现有管理员删用户API，举报人删除级联通知/举报/事件；发布者删除保留共享副本，delete.json留证。清理后所有本次账号/课程/主题/回复/举报/事件/通知/审计0，临时独立副本及源夹具按绝对根路径/本次ID验证后清理，失效随机凭据文件移除，cleanup.json留证。原学习数据/.env/.env.local指纹全true，protection.json留证。
- 普通网页3000和真实本地face CPU8002保持运行，modelsLoaded=true、scan模式；只读取健康，不采集人脸/调用模型。

## 发现与修正

初轮全量12项失败原因是旧AppShell/主流程测试服务替身没有新增messages方法与ApiClientError；补齐正式关闭404/真实空消息场景后全量通过。异构RouteHandler联合context及Response|Promise的测试签名需显式async包装，TS复验通过。Next首次生成/messages路由类型后发现page不能额外导出自定义MessageWorkspace，移到组件目录，页面只默认导出；移后27项及TS/lint通过。顶栏effect请求序号移为effect内变量，移除ref清理警告。原生退出异步编译期间一次3秒等待未到登录表单，检查当前状态和服务日志后确认正常完成，不注入浏览器存储/认证状态。

数据库CURRENT_TIMESTAMP是事务开始时间，会让尚未提交的通知落在旧截止以内。这里消息列表/已读先独占本人User行，与发送方接收人共享锁串行，等待先前提交后再取clock_timestamp；新通知时间加1ms防止毫秒ISO截点与后续写相等。全部已读不使用客户端时间，也不吞新到达消息。

## 可复现

在桌面主仓库，现有依赖及PostgreSQL有效。先停止自己启动的普通网页，不杀未知进程。在独立临时终端执行：

```powershell
node .taskbook-working/demo-walkthrough-20261014/protect.cjs before
$env:DISCUSSION_RELEASE_READY='true'
npm run dev
```

另一个终端：

```powershell
node .taskbook-working/shared-course-20261014/accept.cjs
node .taskbook-working/notifications-20261014/accept.cjs
npm test
npx tsc --noEmit
npm run lint
```

extra.cjs首段断言原生页面已标读：先在页面用仅本次生成的学习者A单读/B全部读，然后执行该脚本；不能未操作就声称页面通过。当前随机凭据已删，重跑须重新setup；勿把密码/token输出或贴到公开记录。extra.cjs只修改本次课程/报告/通知，故障注入有finally清除，不得对原三份资料执行。

临时网页Ctrl+C结束后，在不继承DISCUSSION_RELEASE_READY的普通新终端运行npm run demo:start，然后依次：

```powershell
node .taskbook-working/notifications-20261014/accept.cjs off
node .taskbook-working/notifications-20261014/extra.cjs delete
node .taskbook-working/shared-course-20261014/accept.cjs cleanup
node .taskbook-working/demo-walkthrough-20261014/protect.cjs after
node .taskbook-working/notifications-20261014/cleanup.cjs
npm run face:status
```

delete会删除本次临时账号，之后不能再登录；cleanup确认本次ID为0后移除失效凭据。不要对原账号或原媒体应用这些夹具清理。

## 边界

未调用AI/ASR/Ascend或训练，不增加依赖/额外服务/私信/推送权限，不公开原三份。正式共享素材仍为空，消息正式门控维持默认关闭；25.9完整新用户/双用户发现性验收待下一项。新生产构建、S3、公网、手机实机和大规模并发压力本轮未验，不宣称全项目无bug。

PRD/DESIGN/ARCH/DATA/VISUAL/07/09/10/11/DEPLOY/TASKS/PROGRESS/LEARNINGS同步非TODO现状与接口，表数30、枚举16，修复既有模型清单表格断开；历史范围保留。无TODO补全或新依赖，README选型未改。
