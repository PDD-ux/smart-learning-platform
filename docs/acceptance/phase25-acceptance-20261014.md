# §25.9 新用户与双用户完整验收：未通过

日期：2026-10-14，北京时间。执行仓库：`C:\Users\qwh76\Desktop\智能学习平台`。本轮只执行25.9，当前主任务保持 `[ ]`。**下一优先任务25.10：私人学习资产严格归属校验**，完成后重新核销25.9；正式讨论与消息开关仍默认关闭。

## 阻塞证据

原 `src/lib/auth/ownership.ts` 的 `assertOwnership` 对 `user.role === 'admin'` 直接return，`findForeignResources`也对admin返回空数组。这与当前“管理员不能任意读取他人私人学习资产”的边界冲突。

仅对本次新建管理员和另一名新建学习者的自建三秒素材实测：

- `GET /api/contents/:learnerOwnedId`：预期403，实际200。
- `GET /api/contents/:learnerOwnedId/notes`：预期403，实际200，确认包含该学习者的临时PRIVATE-A-NOTE正文。
- `GET /api/contents/:learnerOwnedId/resource`：预期403，实际200，存在资源URL字段。没有请求或保存原用户的资源地址。

证据 `.taskbook-working/phase25-acceptance-20261014/ownership-bug.json` 只记录匿名化路由、状态及布尔结论，不记录密码/token/资源URL或原用户内容。此次未改归属业务代码，按任务约定将新业务缺陷独立编号25.10。不能以回归通过或前端不显示他人入口替代服务端权限通过。

## 已核对和修正

指南原来仍写“评论功能尚未上线”；现在说明私人资料与共享课程、课程讨论/回复/举报、消息与参与记录路径。SharedInteractionGuide用已有messages接口确认入口，404显示“当前未开放”且不挂消息快捷链接，读取失败显示未知与重试。管理员讨论页说明课程开关不自动发布或打开平台总开关。品牌回首页链接由约40.5px补到44px，键盘焦点solid可见、Enter能回工作台。

主要修改 `src/app/help/page.tsx`、`src/components/app/SharedInteractionGuide.tsx`、`src/app/admin/discussions/page.tsx`说明、`src/app/globals.css`及指南5项回归；验收脚本、范围契约spec/12及进度/安全边界说明同步。没有新业务接口、模型字段、迁移、依赖或训练，也没有自动公开原三份。

## 验收结果

- 全量 **1180项/151文件通过**，最终严格TS和完整lint通过，见 `regression-final.log`、`typecheck-final.log`、`lint-final.log`。这些工程检查通过，整体权限验收仍未通过。
- 94项已记录真实HTTP成功断言：共享准备33、私人学习30、双学习者/管理31；另核对实际Range读取和上述3个失败权限检查，不能合称全部通过。
- 共享管理员仅授权本人自建素材准备独立副本/发布，快照不含PRIVATE-A-NOTE、PRIVATE-B-NOTE、管理员个人笔记或原私有来源ID；下架后旧媒体Range404，其他学习者不能改主题/下架课程。隐藏后消息targetUrl空、参与0，恢复后可读；关闭写入409但仍可读，原私人笔记保留。作者删除后旧链接404、消息无目标、参与0、管理员恢复404。
- 私人A/B资料与笔记隔离，B修改A笔记403、B作答A题403、B计划修改404，B计划列表0；两者只返回本人Note。资料已存在时没有重新导入或新模型生成。
- 私人笔记保存/修改；已有判断题两次HTTP错/对、页面两题组真实判分，页面总结2/2正确100%仅本组；未来复习排期、自评与计划完成/撤销、个人图谱读取均通过。
- A原生页面：新账号空库展开4步指引、八模块侧栏和顶栏指南可见；指南能到消息/两种资料空间。个人Note回看视频currentTime1/paused=true/duration3，取消随播放AI开关后只看已有内容。题库带当前资料，真实两题总结；到期复习先0，另建本次第二条自测后1，查看要点、自评忘记后0、记录1/1、次日安排、XP0。计划实际0/1且提醒已到。图谱2节点/1关系、清单与详情、练习/复习入口，详情真实练习正确率75%。助手只有本人的资料/场景草稿/空会话，没有发送请求。
- B原生页面：只见PRIVATE-B-NOTE，A笔记匹配数0；本人报告结果消息1，没有A主题回复通知；从本人消息回到主题，没有A编辑按钮。页面再回复一次并提交新举报，管理员从独立导航明确处理，B重新登录看到同一结果，2条本人处理消息/2未读。
- 最终DB回读：4条A作答记录中3条正确，2条A复习记录，XP0，1条未完成计划、1条A个人笔记。新页面回复通知唯一；新页面举报处理只有一事件、一通知、一成功审计，见 `verification.json`。该文件明确 `phaseAcceptancePassed:false`、`adminCannotReadPrivateAssets:false`，不能把其学生流程检查当作总体通过。
- 1280px及900px指南/消息无横向溢出；品牌修正后刷新再验，实际高度44且900窗可见button/a无不足44px项。原生Tab焦点、Enter导航通过；临时视口reset、验收账号退出、标签关闭。仅有限窗口与入口检查，不宣称所有页面所有手机均通过，也不是陌生人访谈。
- 全部本次临时账号/私人内容笔记题目计划、课程/主题/举报/事件/通知/审计清理为0，副本及新私有目录按精确根路径/ID验证后清理；随机凭据及临时token文件移除。原学习数据、.env/.env.local全程前后指纹一致；验收仅自建素材，7条保留资料的媒体指纹在夹具清理前后SHA256一致，见cleanup.json、protection.json、media-protection.json。
- 普通demo:start恢复，消息/参与API404，gate-off.json留证；真实face CPU8002 modelsLoaded=true、scan保持。不调用本人摄像头/AI/ASR/Ascend，不消耗模型额度。预检configured不代表余额/模型实际就绪。

## 可复现

本机现有依赖、数据库和本地存储，先停止自己启动的普通网页。单独测试终端：

```powershell
node .taskbook-working/demo-walkthrough-20261014/protect.cjs before
$env:DISCUSSION_RELEASE_READY='true'
npm run dev
```

另一终端：

```powershell
node .taskbook-working/shared-course-20261014/accept.cjs
node .taskbook-working/phase25-acceptance-20261014/journey.cjs seed
node .taskbook-working/phase25-acceptance-20261014/journey.cjs private
node .taskbook-working/phase25-acceptance-20261014/journey.cjs shared
node .taskbook-working/phase25-acceptance-20261014/ownership-bug.cjs
npm test
npx tsc --noEmit
npm run lint
```

共享setup现在在自身临时私密文件保留已登录的本次token供后续流程复用，避免无意义重复登录触发5次/分钟；到期仍必须正常重新登录，不能放宽限流或伪造JWT。verify.cjs有到期正常登录逻辑。测试脚本/私密文件只限本机，不打印或发送其凭据。上述ownership-bug脚本当前预期复现200缺陷；25.10修复后应改为拒绝断言，不能沿用200当成“通过”。

原生页面补录第二条本次到期自测、两题组作答、B再回复/举报及管理员处理，才能执行verify.cjs的完整DB断言；未做这些动作不要直接声称页面验收通过。夹具不是新模型推理结果。当前凭据已清理，重跑须重新setup；不得对原资料执行这些脚本。

结束临时网页，普通无继承DISCUSSION_RELEASE_READY变量的终端启动npm run demo:start，然后：

```powershell
node .taskbook-working/phase25-acceptance-20261014/media-protect.cjs before
node .taskbook-working/phase25-acceptance-20261014/gate-off.cjs
node .taskbook-working/phase25-acceptance-20261014/cleanup.cjs private
node .taskbook-working/shared-course-20261014/accept.cjs cleanup
node .taskbook-working/demo-walkthrough-20261014/protect.cjs after
node .taskbook-working/phase25-acceptance-20261014/media-protect.cjs after
node .taskbook-working/phase25-acceptance-20261014/cleanup.cjs
npm run face:status
```

清理只用本次ID/拥有者及经验证绝对目录；不通过私人源删除接口去删除共享原媒体。cleanup final会移除本次失效凭据，之后无法继续登录。

## 限制和下一项

整体因25.10权限缺陷未通过，25.9保持未勾选，正式交流不开启。未测试新上传/真实模型语义与余额、本人摄像头、手机实机、生产构建、S3、公网或大规模压力，不宣称零bug。未进行真实陌生人可用性访谈。

脚本初次重复登录429、计划拒绝预期写错、临时APItoken到期401、summary DOM角色匹配及判分后旧节点点击失败均有记录并校正，没有降低产品防护。题目夹具知识点ref与转写起点不匹配时，来源面板正确提示缺少证据，没有造OCR去冒充可回看来源。新缓存路径仅作脚本语法检查，真实成功回放用当时有效本次登录token；完整再跑时按上述顺序检查。

同步PRD/DESIGN/ARCH/DATA/VISUAL/07/12/DEPLOY/TASKS/PROGRESS/LEARNINGS非TODO验收状态与冲突权限边界；无TODO补全。无新依赖，因此README技术选型不改。
