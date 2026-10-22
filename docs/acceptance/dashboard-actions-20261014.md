# §24.6 工作台行动与进度

完成2026-10-14 00:20，北京时间。仅整理工作台现有入口/状态/计数，不改学习中心或扩展账号管理。

修改DashboardPage、TodayLearningTasks、PlanReminders：主按钮定位任务，已确认且无错误的到期复习优先DOM排列，不用CSS改变读屏顺序；去固定序号及重复计划链接。提醒在打卡前，目标分钟为计划值，总数来自原PlanList.total，当前列表条数独立标出。部分续学错误时标题说明可用候选。页头只描述正数待办，避免0个薄弱点也说值得补强；导入资料列表与按学习时间选择的续学区分。全局掌握/累计XP和完整笔记汇总不改，不增本周/今日成绩。

命令：npx vitest run tests/e2e/dashboard-tasks.test.tsx tests/e2e/dashboard-states.test.tsx tests/e2e/plans-bank.test.tsx，最终30项/3文件通过；npm run type-check通过；npx next lint --file src/app/dashboard/page.tsx --file src/components/app/TodayLearningTasks.tsx --file src/components/app/PlanReminders.tsx无warning/error。既有Vite CJS弃用提示保留。回归覆盖确认到期/失败计数优先级、去重复入口、真实总数15与展示1、0薄弱点文案，以及既有续学/迟到/失败独立重读/笔记不完整统计和示例不读取真实数据。

内置浏览器真实页面使用隔离学习者和共享原视频只读副本，手工种1张到期卡、1条历史错误记录和1条到时计划（均非原用户真实成绩）。显示1到期/1曾经答错/1提醒，顺序到期复习→续学→错题；提醒Y348.984/打卡Y578.984，计划0/1。点击主按钮进入任务锚点，错题入口实际status=wrong筛出1道测试题，未点击作答或生成。1280px视口、1272px文档宽，正常视口desktop.png与dashboard-final.txt/layout.json/wrong.txt留证。初次等待错题链接3秒超时，随后实际DOM载入正确，不以自动化等待时限推定产品故障。

verify.cjs确认初始手工作答仍1条、到期卡1张、计划1条/完成0、笔记0、打卡0、XP0。退出登录/关闭临时标签后cleanup/protect确认临时账号副本清理、共享媒体存在且大小一致、原学习数据/.env/.env.local指纹一致。没有新AI调用、本人计划/作答/打卡操作、新API/字段/表/依赖。

证据和可复现setup/prepare/verify/cleanup/protect脚本位于.taskbook-working/dashboard-actions-20261014，private.json为已清理临时凭据，不提交。DESIGN/VISUAL/ARCH非TODO同步，TASKS/PROGRESS更新，无TODO补全。

手机、新生产、全量、真实60秒周期刷新与多页提醒本轮未重新实测；多页数量边界是组件测试证据，不称真实15条页面验收。下一编号24.7尚未实施。
