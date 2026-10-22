# §24.10 侧栏XP可读性与账号状态核对

完成：2026-10-14 08:35，桌面主仓库。仅此编号，无本人账号写入/模型调用。

24.9将截图零字形看作8而报告疑似XP不同；本轮复现同场景，真实sidebar textContent是0 XP、字符码[48,32,88,80]、顶栏0，computed font是JetBrains Mono/11px。零字形在截图看作8可复现，未证实缓存/串账号或积分错误。对此明确更正，保留历史观察。CSS只改侧栏Arial/sans-serif、13px、单位10px、tabular-nums/nowrap，沿用颜色/数据源，不改计分/会话/API/数据库。

12项/3文件相关回归（app-shell-states、gamification-profile、profile-updates）、TS、完整lint退出0。CSS可读性直接真实浏览器核对，不新增镜像CSS测试或重复上一轮全量。

新建隔离学生复制原视频只读存储键，测试点/卡片为手工算术样本。页面初始两处0；实际查看要点并自评3，侧栏/顶栏/复习页同步10，真实API和DB10、1复习日志。退出后同标签登录第二新账号：侧栏/顶栏/DB0，无旧10残留，截图零清晰。没有通过脚本修改XP或本人评分。

两个临时会话退出关闭，归属验证后账号/级联数据清理；共享原媒体保留，原学习数据与.env/.env.local指纹一致。证据位于.taskbook-working/profile-consistency-20261014：initial-dom/style.json、initial.png、review-dom.json/review.png、switch-zero.json/png、verification.json、second-verification/cleanup.json、cleanup/protection.json及tests/types/lint.log。fixed-zero.png捕获重载中的占位，不作为零值通过证据，最终switch-zero.png为实际通过截图。忽略目录private凭据不输出，账号已删除。

修改globals.css、DESIGN/VISUAL字形说明及TASKS/PROGRESS/LEARNINGS/演练和两份验收记录；非TODO更正历史误判，无TODO补全/新依赖/API/字段/架构变化。多标签长期状态、手机、新生产/公网和模型额度本轮未验。
