# §25.4 我的笔记聚合验收

2026-10-14，桌面主仓库，本次只执行25.4。新增/notes和GET /api/notes契约，现有Note不迁移；编辑/删除/导出与引用复用原服务。侧栏学习资料组、/help都可发现入口；创建在学习页，只有已保存个人笔记进入聚合，不把预解析或临时随看草稿当资产。

工程：50项/7文件笔记列表、原CRUD/搜索/导出、页面失败草稿/迟到响应、导航/指南测试通过；47项/5文件助手、计划、播放笔记、保存可靠性与资料预选回归通过，共97项/12文件。类型首轮发现Next新生成页面参数包含undefined，修两处默认值后复验通过；完整lint通过。未运行本轮全量或新生产构建。

真实HTTP：自建两个watched-ui隔离学习者，复制原媒体只读引用，账号A有视频21条和文档1条，账号B一条专属笔记。A跨两页22条无重复，关键词/资料筛选正确，video247/document7引用保留；编辑version1→2、旧expectedVersion覆盖提示true/version3保留原契约；DELETE本人笔记后21条。A对B资料列表404、PATCH/DELETE笔记403，A搜索B内容0条，B总数1；匿名401。Markdown/TXT文件均包含本人链式法则与00:04:07、不含B内容，私有笔记回读未变。证据.taskbook-working/notes-library-20261014/http.json及accept.cjs。

真实内置浏览器：独立账号密码登录，侧栏直达notes；关键词链式1条，编辑成功并显示新正文；引用回看视频currentTime=247/paused=true，文档PDF第7/222页、图片complete且naturalWidth1241。导出在关键词1条时仍明确按该资料全部笔记，实际生成限时下载链接；文件下载字节由HTTP核验，未额外做浏览器下载。删除确认取消不删除、全部21条分页第2/2页一条。第二账号切换后只有自己一份资料和一条笔记，无A内容。

布局：1280窗口documentWidth1272、900窗口892，均无横向溢出，笔记按钮最小44px；截图notes-final.png。视口reset，已登录验收标签退出并关闭。初始网页无监听，恢复npm run demo:start后复验；失败标签的data URL被工具策略拒绝绑定/关闭，未绕过，未标保留。原用户标签未操作。

清理：两隔离账号、资料、笔记、其actor审计清理；仅删除经绝对路径验证的三个隔离contentId/exports目录，原共用媒体大小不变。原学习数据指纹及.env/.env.local哈希一致（demo-walkthrough/protection.json）。本地网页与face CPU服务恢复，无AI调用/训练/云端启动/新费用。

复现：npm run demo:start；node .taskbook-working/demo-walkthrough-20261014/protect.cjs before；node .taskbook-working/notes-library-20261014/accept.cjs setup；自行使用脚本生成的本机private.json隔离账号核对/notes（不要公开凭据）；完成后accept.cjs cleanup，再protect.cjs after并检查三项true。原共享媒体勿删除，setup只限本地隔离验收。部署、手机完整适配、本人摄像头、模型语义/余额本轮未验。

同步PRD/DESIGN/ARCH/DATA/VISUAL/07/TASKS/PROGRESS/LEARNINGS的非TODO实现状态/交互/契约；无TODO补全、无新依赖。下一项25.5共享课程尚未实施，不自动发布原三份资料；评论、消息保留后续编号。
