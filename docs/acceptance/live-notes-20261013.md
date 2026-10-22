# §23.1 实时课堂笔记验收（2026-10-13）

## 实现范围

用户确认麦克风课堂/会议输入。新增/live-notes、AppShell导航、src/services/live-notes.ts、src/lib/live-notes.ts及domain/media/asr-live模块、五类live-notes API、public/audio/live-pcm-worklet.js、services/local-asr/live_worker.py；Prisma新增LiveSession/LiveChunk与20261013150000_live_notes迁移。本机已generate/migrate deploy，原数据/env保留。无新npm或Python依赖，无新增模型下载。

5秒16k单声道PCM16，短尾补至100ms；本地固定模型离线常驻、顺序处理。每6片自动滚动重点，手动支持尾窗口。重点必须绑定真实ASR片段且引用正文来自服务端；AI标题标记待核对。结束确定性整理全部已保存转写/重点，不再调用最终总结模型。原视频功能独立保留，无说话人识别/会议平台接入。

容量、归属、hash幂等、乱序、失败手动重试、30分钟上限、2条LIVE/用户、临时WAV删除；模型失败停止自动请求、无其它服务fallback。结束等尾片/队列/在途整理，失败不伪报完整；支持明确不完整保存。DB token防过期提交，2分钟中断租约仅显式写操作恢复。历史可读及重新授权接录，页面未发送音频无法在刷新后恢复。

## 验证结果

- 129文件1002项全量测试通过，新增域/WAV、AudioWorklet、接口逻辑和页面故障测试；有效租约不能提前结束、中断租约恢复均覆盖。类型检查与新增模块/路由定向lint通过。
- scripts/acceptance/live-notes.ts真实接口22项通过：30秒已授权课堂样例按6个5秒文件片段顺序送达，本地真实ASR、权限401/403、校验400、乱序与字节冲突409、幂等、当前星火重点、正文来源、完整Markdown、静音及完成后拒绝新片段。热分片[224,184,193,174,171,162]ms，平均177ms；并非按实时节奏发送，也没有采集真人麦克风。
- 第一轮6片转写成功，首次冷片约3686ms，随后热片156—170ms；重点接口503失败，原输出未保存详细上游原因，不能推断额度或审核。改进验收失败证据采集后，仅受控再跑一轮成功，不循环请求/换模型。证据保留real与real-2。
- Edge页面用真实验收产物的临时记录进行读回，显示6段/30秒、3重点与完整笔记。未点击录音或代为授予麦克风。截图ui-desktop.png；浏览器导出实际958字节Markdown，与真实接口最终笔记UTF-8完全相等。下载事件观察超时不算产品导出失败，实际文件核对见download.json。
- 隔离生产构建/standalone真实登录、读取、401/403、退出通过；production-2证据liveNoteRuntimeAssetsMatched=true，转写live_worker/assets/timing与public worklet实际打包哈希相等。仅验证构建/资源/基础HTTP，不等于生产麦克风或ASR环境执行通过；既有study图片性能lint警告仍存在。
- 真实接口两临时账号清理；UI临时账号/会话/片段级联清理，浏览器调试连接断开后未再验证UI退出，不伪报。原用户标签未操作。两次生产临时账号/服务/快照清理，开发.next不替换。原学习数据、.env与.env.local指纹一致。

## 复现与局限

使用docs/live-notes.md操作，本人登录点击开始并授权，录30—60秒、暂停/继续/结束，核对字词/来源/下载。接口入口：`npx tsx scripts/acceptance/live-notes.ts .taskbook-working/live-notes-repeat`，新输出目录，需既有样例/本地模型、运行网页和星火配置，会实际调用一次模型。生产入口：`node scripts/acceptance/production-demo-smoke.cjs --output-dir .taskbook-working/live-notes-production-repeat`。

私有日志与样例产物位于.taskbook-working/live-notes-20261013，不提交凭据/临时账号/音频。测试不代表逐字ASR、摘要准确率、真人麦克风、手机布局、30分钟持续/多用户压力、Docker/Linux或公网HTTPS验收。重点有真实引用不保证标题语义忠实；本人麦克风端到端仍待。MVP单Web进程，跨副本模型请求去重后续增强，不扩展此编号。
