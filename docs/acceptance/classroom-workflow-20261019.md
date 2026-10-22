# §29.5 班级创建、加入与章节任务发布验收

完成：2026-10-19 14:05（Asia/Shanghai）。实施仓库：桌面主仓库。仅本编号；不实施29.6提交批阅/附件、29.7–29.8 OCR/AI批改。

## 交付

新增classrooms/contracts、service、routes与services/classrooms：严格JSON、真实数据库身份/班级权限、账号→班级锁、班级/实体版本、完整摘要幂等及同事务审计。新增/api/classes、/join、/:id、/:id/sources；创建、编辑、邀请码旋转/撤销、明确加入、成员移除/恢复/退出、章节与任务发布/撤回、未来截止时间、班级归档/恢复。邀请码原码只在首次成功响应显示，不进数据库/日志/重放。

新增四个/classes、/admin/classes列表与详情页面，复用ClassroomWorkspace和两个Shell；修改LearningNavigation、AdminShell和help入口。宽屏内容/编辑分栏，学生只读已发布内容，来源只绑定现有授权共享课，未开放作业提交不显示假按钮。失败保留输入/原UUID，重复操作busy保护；409手动重新读取，切换或离页有草稿确认，重新读取同步更新受控来源选值。

同步spec/01–06和新增29实施协议；PROGRESS记录本项，下一29.6。无新迁移、依赖、角色、环境或模型修改。

## 工程与数据库

- 最终全量：186文件1709项通过；非增量TypeScript通过；全源码ESLint及新改测试/验收脚本显式ESLint通过。第一次全量4项旧导航数量/委托路由断言失败，按实际新增契约修订后通过，不降低鉴权/数据断言。
- `npx tsx scripts/acceptance/classroom-workflow.ts`：61项真实隔离PostgreSQL/认证路由对象检查通过，全迁移临时库清理。创建与幂等/不同输入键冲突、账号当前角色、跨班/跨管理员拒绝、邀请码末次额度并发、过期/撤销/旋转、已移除旧重放拒绝、退出重入/恢复、草稿/隐藏章节任务过滤、版本竞争单赢家、同班章节限制、来源授权/撤回、关闭任务可读、归档/恢复均通过。
- 路由对象使用真实NextRequest与签名JWT、异步params、当前数据库角色，验证私有响应、重复分页拒绝和无效加入5次每分钟计数。这里不是独立部署HTTP压力测试；真实网页写入/加入另见下文。
- 隔离验收前后主库55表行数与内容摘要一致，两env摘要一致。无提交、评语、附件写入或AI调用。记录：`.taskbook-working/classroom-workflow-20261019/report.json`。

## 实际网页

使用localhost域名临时负责人/学生账号，原127.0.0.1学习者会话未替换。通过原生浏览器实际登录、导航创建“高等数学·临时验收班”、明确发布“第一章：函数与映射”、关联章节并发布任务（2026-10-21 18:00本机时区截止）、确认生成邀请码；退出后临时学生明确勾选并加入，读到相同章节/任务和截止。学生没有负责人编辑、成员管理或虚构提交按钮。

1440×1000负责人双栏/学生只读宽屏、390×844两侧单列核对通过。窄屏documentElement.scrollWidth=382≤innerWidth390，宽屏1440=1440；保存桌面及窄屏证据。切换视口最初截图抓到过渡帧，最终等待新AX状态后重存完整桌面截图。隐藏浏览器的JS confirm曾阻塞焦点操作，显示页面并处理原弹窗后恢复，没有重发创建。

- 桌面负责人：`.taskbook-working/classroom-workflow-20261019/admin-wide.png`
- 窄屏负责人：`.taskbook-working/classroom-workflow-20261019/admin-narrow.png`
- 桌面学生：`.taskbook-working/classroom-workflow-20261019/student-wide.png`
- 窄屏学生：`.taskbook-working/classroom-workflow-20261019/student-narrow.png`

临时学生/负责人已退出，临时页关闭、视口override恢复，保留原127.0.0.1/classes页面。`npx tsx scripts/acceptance/classroom-ui-fixture.ts cleanup`精确清理两账号、本人临时班级/章节/任务/成员/邀请码/操作与测试审计；前后55表完整内容摘要及env相同，`ui-cleanup.json`中cleaned/dataPreserved/envPreserved均true。截图中的班级为已清理的临时验收数据，不是替用户预建的班级。

## 复现与限制

本地已配置依赖/数据库时执行`npx vitest run`、`npx tsc --noEmit --incremental false`、`npx eslint src --max-warnings=0`及上面的隔离脚本。隔离脚本只允许本地数据库，随机安全前缀创建/清理独立库，不reset主库。网页测试夹具setup/cleanup仅供本地验收，两个固定qa-class账号不得用于真实管理；cleanup遇真实成员或提交会拒绝清理。

现有公开课程仅列为授权候选，绑定/下架在隔离数据库验证；此次网页发布原创章节说明，没有重新播放既有共享课媒体或测云存储故障。未构建新生产包、部署云端、压测多进程限流/大量班级、调用模型/NPU/ASR/人脸，不能据本项声称全作业中心、AI批改或项目全部完成。开发依赖既有告警仍按上一记录留待上游，非本编号修复范围。
