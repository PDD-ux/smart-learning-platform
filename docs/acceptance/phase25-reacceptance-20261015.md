# §25.9 新用户与双用户完整复验：本地范围通过

完成时间：2026-10-15 16:02（北京时间）。仓库：`C:\Users\qwh76\Desktop\智能学习平台`。本轮只执行25.9，25.10单项修复之后重新建立全部临时夹具并独立复验，没有新增业务代码、接口、字段、表、依赖或模型调用。首次失败记录保留于phase25-acceptance-20261014.md，不覆盖历史证据。

## 工程与真实接口

`npm test`：151文件、1184项通过；`npx tsc --noEmit`、`npm run lint`通过。日志位于`.taskbook-working/phase25-reacceptance-20261015/`。

138项已记录主流程HTTP断言通过：共享准备33、私人学习30、双用户交流管理31、严格归属44。另完成作者删除旧目标的5次接口检查及默认门控2次检查；浏览器实际请求不重复计入138。不是只检查页面200。

使用三个临时账号、三秒自建视频、两页自建PDF及自写TXT；A私人视频与管理员发布副本独立。没有重生成原资料或借用原用户成绩。自建解析夹具只证明功能，不宣称AI或ASR质量。

- 发布只选管理员本人授权素材、独立副本/快照白名单、失败回滚/版本冲突/下架媒体及PDF范围通过。私有笔记、进度、作答/复习/人脸数据不进入共享快照。
- 本人笔记创建修改、已有判断题错/对、复习与计划完成/撤销、图谱读取通过；B不能改A笔记/作答A题，计划跨owner404符合原契约。
- 其他学习者与管理员读取A私人详情、notes、resource、进度、图谱、整理笔记、理解与状态均403；跨owner改删资料、增改删笔记、导出、写进度、触发解析/整理/摘要/问答、作答及复习均403，不透传owner内部ID。阻断前后临时资料、产物、任务、进度、计划、卡及作答记录一致，没有调用模型或排入新任务。
- A发主题、B回复；通知/本人举报结果、隐藏后消息无目标和参与0、恢复、关闭写409但可读、课程下架旧Range404、恢复发布及私有内容不串入通过。作者最终删除后旧链接404、消息目标为空、参与0，管理员恢复404。

## 原生页面与可发现性

只通过页面上的输入/按钮/链接操作，登录使用本次随机临时凭据，不注入localStorage或伪造JWT；原用户标签未操作。新账号由隔离脚本建立，不将本次验收等同于注册验证码或陌生人访谈。

- A空库工作台有“导入第一份资料”及默认展开四步；Enter可收起/重开指引。侧栏八模块分组、顶栏指南/消息/设置/退出可见，指南说明个人与共享空间、AI额度和保存边界。
- 我的笔记仅1条A笔记，来源回看视频currentTime=1、paused=true、duration=3；打开个人笔记后时间仍1。取消随播放AI开关，只检查已有内容，没有发送新模型请求。
- 从学习页进入带当前资料的题库，本页两题真实提交并总结2/2、100%（只代表本组）。第一题二加二等于五选择错误，第二题等于四选择正确；反馈为中文答案，不重复提交。来源不匹配真实转写起点时明确缺少可核对定位，不造来源。
- 新增仅本次到期自测后复习1→0，本次1/1，选择忘记、次日排期及0XP；页面说明自评不等于客观判分。计划真实0/1及提醒已到、目标10分钟显示正常，未自动完成。
- 图谱2节点/1关系，点击详情显示复习2次、练习正确率75%、笔记1/闪卡2和精确练习/复习入口。助手只显示本人资料、三个草稿场景及空会话，不发送模型请求。
- A消息1未读，单条已读后页面和顶栏均0；回到同一主题及真实视频1秒暂停。B仅本人笔记，搜索PRIVATE-A-NOTE为0；B没有A主题编辑/删除入口，但可以管理自己的回复。
- B页面再次回复并举报；管理员密码登录落到/admin，独立五项管理导航、没有学习导航/XP。进入讨论与举报，填写结果明确确认成功；B重新登录看到同一处理结果，2条本人结果/2未读，没有收到A的主题回复通知；全部已读后两处计数为0，参与记录有同一主题。
- 学习中心可切换私人/共享空间，列表3门临时共享课程；打开两页PDF并翻到第2/2页，图片complete=true、naturalWidth=625。
- 1280px/900px指南、消息无横向溢出（实际scrollWidth1272/892），900px讨论与管理员讨论也无溢出；指南品牌44px，900窗可见button/a无不足44px项。键盘Tab焦点outline=solid；临时视口reset、账号退出、测试标签关闭。只代表上述窗口与页面，不概括所有页面或手机实机。

最终数据库回读：A练习4条/正确3条、复习2条、XP0、未完成计划1条、私人笔记1条；页面新增回复只生成一条作者通知，页面举报处理只有一个事件、一条通知、一条成功审计。verification.json与ui.json留证，所有判分仅限本次自建夹具。

## 恢复与保护

临时交流进程已停止，普通`npm run demo:start`恢复，消息/参与API均404，正式开关默认关闭。真实本地CPU人脸8002：modelsLoaded=true、scan模式；没有访问本人摄像头或新录入模板。

临时账号、私有资料/笔记/题目/计划、共享课程、讨论、举报、事件、通知、审计回读全0。自建媒体/副本目录按绝对根路径和临时ID核验后删除，凭据文件移除。原学习数据、.env与.env.local前后指纹一致，7条保留资料媒体SHA256一致。原三份未自动发布。final-proof.cjs汇总上述证据及工程日志、凭据已删除检查，result.json为本轮最终结论。

## 复现入口

仅在本机现有依赖/数据库/本地存储下，对新建临时数据运行。先停止自己启动的普通网页并记录保护基线：

```powershell
node .taskbook-working/demo-walkthrough-20261014/protect.cjs before
node .taskbook-working/phase25-reacceptance-20261015/media-protect.cjs before
$env:DISCUSSION_RELEASE_READY='true'
npm run demo:start
```

另一终端先运行共享准备：

```powershell
node .taskbook-working/shared-course-20261014/accept.cjs
```

用临时A正常登录，按界面核对空库指引、八模块、帮助及键盘，然后：

```powershell
node .taskbook-working/phase25-reacceptance-20261015/journey.cjs seed
node .taskbook-working/phase25-reacceptance-20261015/journey.cjs private
node .taskbook-working/phase25-reacceptance-20261015/journey.cjs shared
node .taskbook-working/phase25-reacceptance-20261015/privacy.cjs
node .taskbook-working/phase25-reacceptance-20261015/seed-review.cjs
```

按上文执行原生A两题组/复习、B新增回复/举报与管理员处理，再核对B结果/全部已读。verify.cjs要求这批真实动作及完全匹配的测试文本：回复“页面验收：第二位同学补充了课堂理解。”、举报“完整演练页面举报：请管理员核对课程交流。”、处理“完整演练处理完成：已核对内容，保留讨论并告知举报人。”。未做对应页面动作不能直接声称页面通过。随后运行verify.cjs（会在检查后删除本次测试主题），并执行全量测试/TS/lint、保存对应日志与ui.json。脚本会复用本次正常登录token，过期正常重登，不放宽限流。

结束测试进程，在没有继承临时开关的终端恢复普通demo:start，然后依次：

```powershell
node .taskbook-working/phase25-reacceptance-20261015/gate-off.cjs
node .taskbook-working/phase25-reacceptance-20261015/cleanup.cjs private
node .taskbook-working/shared-course-20261014/accept.cjs cleanup
node .taskbook-working/phase25-reacceptance-20261015/cleanup.cjs
node .taskbook-working/demo-walkthrough-20261014/protect.cjs after
node .taskbook-working/phase25-reacceptance-20261015/media-protect.cjs after
npm run face:status
```

复制保护脚本的protection.json和共享准备http.json至当前证据目录，再运行final-proof.cjs。夹具流程不是幂等脚本，重跑须先清理再新建；失败也应清理本次数据，不能替换为原用户ID或删除原媒体。

## 当前边界

Phase25已实现模块的本地功能、权限与关键页面复验通过，没有新增业务缺陷。本轮没有复验重新上传/真实AI语义与余额、本人摄像头、注册验证码、手机实机、生产构建、S3、公网、大规模压力或陌生人访谈。历史模型忠实性/外部环境限制不因这次通过而消失，不宣称全项目零bug。正式交流保持关闭，真正发布前仍需管理员选择具备传播授权的素材并预览确认。

本轮仅更新验收脚本/证据、PROGRESS与任务/PRD/设计/部署/验收范围的非TODO状态，修正历史未上线/禁止所有评论的冲突说明；没有TODO补全或新依赖，README技术选型不改。
