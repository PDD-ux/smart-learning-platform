# §20.3 工作台今日任务验收

完成时间：2026-10-10 16:08（Asia/Shanghai）。本轮仅执行§20.3；§20.4–20.8保持待办。

## 修改与口径

工作台增加三张优先任务卡，顺序为继续学习、到期闪卡和错题巩固；打卡收为紧凑状态栏，保留手动普通打卡、方式与时间、未知状态和重读入口。学习提醒、概览、我的学习资料及薄弱点放在任务之后。完整/attendance设置页继续使用原卡片。

继续学习读取本人全部资料中的已就绪项及各自已有进度，按有效lastStudiedAt选最近学习资料，展示视频分秒或文档页码；点击普通学习页链接，由既有播放器/阅读器恢复进度。无历史则明确从头开始。类型、范围、时间不合法或读取失败不猜位置；部分失败保留成功候选并警示其可能不是完整列表中的最近一项，支持独立重读。非就绪资料不推荐进入学习。

到期闪卡沿用due=true总数。错题使用status=wrong接口的total，明确“曾经答错”包括之后答对的题；有记录时链接/question-bank?status=wrong，题库首轮请求即应用筛选，无记录则进入普通题库。三项分别显示加载/失败/真实为空，失败不能冒充0，并提供对应重试；不会自动生成题目、评分或完成计划。

修改dashboard页面、新TodayLearningTasks、DailyCheckInCard的compact变体、question-bank查询落点、相关测试和只读验收入口。复用现有services，无新增表、字段、公开API、依赖、奖励或连续天数。DESIGN §5非TODO布局与旧原型示意数字已更新，TASKS/PROGRESS记录结果，无TODO补全。全站掌握度/笔记/XP等既有状态缺陷仍归§20.7，不在本轮宣称全部修复。

## 验证

- 新增8项测试（任务组件7项、题库直接错题筛选1项），既有主路径追加任务区先于打卡/概览断言。5文件31项相关测试通过，TypeScript严格检查和本轮全部TS/TSX文件ESLint通过。
- 真实HTTP/PostgreSQL只读：当前账号3份已就绪资料、8张到期闪卡、0道曾经答错、尚未打卡。30分钟视频positionSec=247且有学习历史；其余一份视频为0且无历史，图片为第1页且无历史。匿名错题读取401，无数据库写入、模型请求或代本人打卡/作答。脱敏结果见同名JSON。
- 实际浏览器/dashboard-preview确认三张任务卡显示在概览之前，示例数据明示，任务操作全部进入注册。1280像素窗口三列；768像素窗口三张卡依次单列，左右边界228–742、页面scrollWidth=760≤768，无横向溢出。预览不展示真实打卡组件，紧凑打卡操作由组件测试覆盖。
- 浏览器常规viewport接口调用后实际仍1280像素，未将那张截图认作窄屏证据；改用临时标签页CDP Emulation设置768像素后才核实单列。结束撤销模拟、恢复视口并关闭临时预览页，未修改用户原页面。
- 原浏览器临时登录验收已失效，本次只做免登录布局及真实认证HTTP读取，不能宣称本人重新登录后的点击流程全部实测。未重建运行中的.next、改变密码或环境配置。

宽屏/窄屏截图保存在本机被忽略目录.taskbook-working/dashboard-tasks-20261010/preview-wide.png及preview-narrow.png；均为明示的免登录示例数据。

## 复现

在桌面主仓库、已启动本地网页及原数据库时运行：

```powershell
npx tsx scripts/acceptance/dashboard-tasks.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/dashboard-tasks-20261010/read-only.json
npx vitest run tests/e2e/dashboard-tasks.test.tsx tests/e2e/plans-bank.test.tsx tests/e2e/exercise-group.test.tsx tests/e2e/learner-main-path.test.tsx tests/e2e/face-attendance-pages.test.tsx
npx tsc --noEmit
npx eslint src/components/app/TodayLearningTasks.tsx src/components/app/DailyCheckInCard.tsx src/app/dashboard/page.tsx src/app/question-bank/page.tsx tests/e2e/dashboard-tasks.test.tsx tests/e2e/plans-bank.test.tsx tests/e2e/learner-main-path.test.tsx scripts/acceptance/dashboard-tasks.ts
```

现场展示：本人登录/dashboard，查看30分钟视频4:07续学入口、8张到期闪卡和无错题说明；曾经答错的记录数量会随本人实际作答变化。可选择普通打卡或进入人脸设置，均由本人主动操作。现有任务读取与题库练习无需开启云端推理，新增导入/生成仍依赖对应服务。
