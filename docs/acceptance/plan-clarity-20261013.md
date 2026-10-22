# §24.3 学习计划任务清晰度验收

完成：2026-10-13 23:45（北京时间）。范围限既有计划模块，不改学习中心、API、数据库或计时/积分规则。

页面按当前分页真实completedAt/isDue分组，完成优先；明确本页组计数和全局summary的区别。提醒已到仅指提醒时间已到，测试计划的学习时间仍在未来，页面不称逾期。目标分钟为计划值，全部显示日期显式Asia/Shanghai；已完成显示接口确认时间。资料链接保留，复习入口复用/review，空态可去学习中心。

写操作确认后status提示，旧列表移除后独立读取；写入时fieldset和冲突按钮禁用，失败保留草稿。列表失败可重试读取而不重复成功操作。分页改为使用接口pageSize。

验证命令（桌面主仓库）：

- npx vitest run tests/e2e/plans-bank.test.tsx tests/unit/api/study-plans-bank.test.ts：23项/2文件通过。
- npm run type-check：通过。
- npx next lint --file src/app/study-plans/page.tsx：无warning/error。

新增回归核对当前页计数/全局计数、完成优先、失败草稿与无虚假成功、成功写入后的刷新失败/独立重试/撤销；既有创建序列化、提交锁和删除末页回退保持。Vite CJS弃用提示为既有工具提示。

真实内置浏览器使用新建隔离学习者及原课堂视频只读副本，三条计划分别提醒已到/未来待学习/已完成。标记第一条完成后进度1/3→2/3，确认时间2026-10-13T15:43:37.807Z，工作台到时提醒移除；撤销后同条completedAt=null、进度1/3及工作台提醒恢复。DB仅3条计划，XP仍0；没有原用户计划写入或模型请求。退出登录、关闭临时标签、删除临时账号级联数据后，原媒体存在/大小未变，原学习数据及.env/.env.local指纹一致。

证据位于.taskbook-working/plan-clarity-20261013：tests.log、types.log、lint.log、grouped.txt、completed.txt、restored.txt、dashboard-completed.txt、dashboard-restored.txt、completed.json、restored.json、page.png、cleanup.json、protection.json。setup/verify/cleanup/protect脚本用于隔离复现；private.json仅为忽略目录中的临时凭据，不提交且该账号已清理。

实际浏览器本轮未重新创建或删除计划，也未验证手机、新生产构建、全量回归或站外通知；相关创建/删除/失败/分页由测试覆盖。原人脸/Ascend可达性不属于本编号，不核销历史独立阻塞。下一个编号24.4留待下一轮。
