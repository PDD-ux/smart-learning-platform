# §26.4 本地毕设最终检查：检查完成，仍有待修问题

完成：2026-10-15 21:57（北京时间），桌面主仓库。用户要求最后检查，后续“继续”沿用同一检查。只执行26.4，没有更改业务功能、依赖、原资料或运行配置。不能据本次检查宣称项目无bug或已具备公网生产安全。

## 已通过的本轮检查

- `npm test`：152文件、1195项，退出0，约27秒；严格`npm run type-check`及完整lint退出0，无lint告警。
- `prisma validate`通过，`prisma migrate status`显示13个迁移已应用、schema up to date；没有执行迁移/reset/seed。
- 既有production-demo-smoke以`--watched-notes`及全新输出目录执行：隔离快照真实生产构建/standalone/3100登录、Secure/HttpOnly Cookie、本人读取200、匿名401、学生管理403及退出通过。随看接口拒绝他人资料/来源、未来片段；禁用模型时503且不写笔记，旧/live-notes正确跳转。打包运行资产哈希一致。临时生产账号、快照、3100服务已清理，不替换3000开发构建。
- 46项隔离真实HTTP断言：登录、本人资料/理解/笔记读写、媒体Range206/128字节、进度、错答/答对、计划创建/完成/撤销、图谱/掌握度读取；其它学习者及管理员读取私人详情/笔记/资源/理解/进度/图谱403；普通用户管理403；正式消息/参与仍404。
- 原生浏览器：工作台真实数据、笔记1条及来源入口、视频30秒媒体实际播放至8.8秒且error=null；1280px桌面页面scrollWidth1272，无横向溢出。自动整理先关闭，无模型请求。题库两题逐题判断/反馈/切题与本组2/2总结；复习先看要点才可自评，提交“忘记”后待复习1→0、显示次日安排及0XP；计划列表0/1、助手资料/模式/草稿入口、管理员独立总览及讨论空态可见。助手未发送，正式交流未打开。

主证据在`.taskbook-working/final-check-20261015/`：tests/types/lint.log、production/production.json、http.json、playback.json、practice/review/notes/plans/assistant/admin文本及study/graph截图。页面检查是当前人工算术夹具，不是原课堂AI生成质量或完整30分钟播放验收。

## 待修一：依赖安全（高优先级，26.5）

官方npm注册表的`npm audit --omit=dev --registry=https://registry.npmjs.org --json`报告**3个受影响依赖项：1 critical、2 high**。这里是受影响包计数，不是只有3条独立漏洞：next（直接依赖）、其内嵌postcss、source-map-js。实际安装Next14.2.21，审计建议包含跨大版本变更，不能直接运行audit fix --force当作安全修复完成。

已向上游维护者核对[Windows服务未认证远程代码执行公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)：受影响范围包含14.2.21，公告修复版本为15.5.24/16.3.3。该公告修复不等于其它全部告警也已清除，后续选型必须重新核对完整审计与迁移兼容性。另有[Middleware授权绕过公告](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw)。本项目私人API有路由内owner校验并经真实403核对，不能因此忽略框架漏洞，也不能仅根据包告警声称每条漏洞均已成功利用。

当前3000和8002仅监听127.0.0.1；这减少外部暴露，不是上游漏洞修复。不要把当前构建直接暴露到局域网/公网。下一任务需先落版本迁移方案、同步README/约束，升级后重跑测试/生产构建/权限/媒体及完整依赖审计。本次没有执行攻击、更新package-lock、改npm全局源或扩大端口。

最初默认npmmirror安全接口返回404 NOT_IMPLEMENTED，不能视作无漏洞；只在第二条命令临时指定官方registry后成功取得报告。原始结果分别保留dependency-audit.json、dependency-audit-official.json。

## 待修二：总图谱遗漏只有练习的记录（26.6）

真实页面中“测试乘法”已经作答正确，综合掌握画像也统计了记录，但总图谱卡片显示“暂无学习记录”。新HTTP请求与数据库独立回读确认：Mastery.score=1、correctRate=1、reviewCount=0，有1条实际作答；总图谱响应mastery=1、correctRate=null、reviewCount=0、lastReviewedAt=null。

原因在`src/app/api/graph/overview/route.ts`聚合正确率时额外要求`mastery.reviewCount > 0`，用复习次数作权重；`hasGraphLearningRecord`据reviewCount/correctRate/lastReviewedAt判断后，只有练习的节点被误判无记录。不是缓存或学习记录没落库，`graph-defect.json`与graph.png/text留证。

本轮只定位未改业务。后续需按真实练习证据定义聚合/权重并对齐单资料/总图谱口径，测试只有作答、只有复习、正确率0、别名合并及无记录情形；不伪造复习次数或把未知正确率当0。

## 过程中的失败和未验边界

第一轮HTTP脚本误把进度请求写成ref包装，接口正确400；按现有contentType/positionSec契约修脚本，清理并新建夹具。短时间多次登录正确触发429，保留失败并等待原窗口，不放宽限流；最终46项通过。

补充DB统计脚本误查不存在的ReviewLog.learnerId，执行失败；随后临时夹具已经清理，未重新生成数据来冒充该统计通过。脚本已改为经flashcard.ownerId查询，但修后未执行，不提供完整“四次作答/一次复习”DB汇总通过结论。页面判分/自评、46项接口、独立图谱DB证据和清理后的全库保护各自仍有实际证据，不用其中一项替代另一项。

继续时原3000/8002均无监听，浏览器连接拒绝；用原demo:start及face:start恢复。没有证据确定它们此前为何停止，不归因云额度/本次构建。最终展示预检通过、真实CPU人脸健康；未采摄像头、不查余额、不调用AI/ASR/Ascend或重跑长视频，没测公网/异机/手机/全部功能的所有组合。共享正式关闭，222页与自由解释Agent仍未核销。

## 清理与原数据保护

两轮临时学习者/管理员、内容、笔记/卡/作答/复习/计划和审计级联清理；独立媒体目录按已验证绝对root和精确final-content ID删除，未删引用原文件。临时private.json已移除，浏览器临时账号退出并关闭正常验收标签；连接失败的临时错误标签未标记保留，也未绕过data URL策略。

最终31张public表全部行数/排序哈希与检查前一致，原媒体哈希、.env及.env.local指纹一致，changedTables=[]；见protection.json与cleanup.json。原三份、原账号/成绩/人脸模板未变。生产验收进程3100已停，3000网页及8002人脸恢复运行。

`git ls-files`未列出.env/.env.local/pem/key；工作区仍约300个既有变更/未跟踪项，本轮不提交、回滚、删文件或把它们认作本轮改动。正式交付需要包含必要未跟踪源码，排除私有备份/媒体/凭据，按既有检查单打包。

本轮只新增忽略目录验收工具/证据、本文，更新TASKS/PROGRESS/LEARNINGS的非TODO状态与教训，没有TODO补全、功能/表/API/交互/技术选型变更。检查任务完成，但两项发现仍未修复；下一优先26.5，再处理26.6。
