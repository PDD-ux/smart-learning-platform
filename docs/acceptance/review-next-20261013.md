# §24.2 复习巩固下一步指引

完成：2026-10-13 23:35（北京时间），桌面主仓库，仅此编号。

## 修改

此前评分成功后项目移出清单，完成页仅提供通用入口，刚才自评忘记/模糊的项目失去对应衔接。ReviewWorkspace现在只在api.review成功后保留card/rating/nextReviewAt页面快照，清单完成后交ReviewNextSteps呈现：优先列忘记/模糊项、原资料回看与精确知识点题库入口；全部成功记录与实际下次安排可展开。没有知识点时仅浏览该资料题库；时间无效显示排期暂不可用，日期显式Asia/Shanghai，不猜日期或可用题数。

说明这是熟悉度自评，不是客观测验/已掌握证明，不自动出题或创建计划。失败不追加成功记录，提交锁、原SM-2/XP/判分、范围切换重挂载与旧ReviewLog保留；本页指引离开/刷新不持久化。没有新API/表/公开字段或依赖。

## 验证

4文件22项相关回归、TS、定向lint通过；覆盖成功忘记项保留/精确链接/真实日期、失败不生成指引、无知识点/坏日期、记住熟练不冒充弱点及原提交保护。首轮1项因为优先列表和记录详情出现相同项目文案而测试选择器不唯一失败，明确两处显示后重跑通过，tests.log/tests-final.log保留。既有测试的RelatedPractice act等待及Vite弃用警告未抑制，不当产品故障核销。

本轮发现Edge不再连接、本机3000停止；已有npm run demo:start恢复本地网页，配置不改，进程保留给用户演示。内置浏览器首次localhost连接拒绝，错误页的data URL绑定被工具阻止；不绕过限制，服务恢复后新建允许的127标签成功验收。开局没有可用原用户标签，未声称重新核对历史7批页面。人脸/Ascend仍不可达，非本编号，不启动云服务或调用AI。

真实内置浏览器临时账号/明确标注算术测试自测项，查看要点→自评忘记→完成指引，回看/对应知识点练习链接显示；展开下次安排为2026/10/14 23:32:31北京时间，与DB nextReviewAt=2026-10-14T15:32:31.742Z一致。DB仅1条ReviewLog/rating0，XP0，原算法排期未改。点击对应练习链接落到同资料/知识点2道既有题目，未生成或作答练习。没有代原学习者评分。

退出临时账号、关闭自己的标签、清理临时资料/自测项/记录/知识点/题目；共享媒体及原学习数据/.env/.env.local指纹不变。网页恢复进程仍运行，不把其保留当清理失败。

## 证据与边界

.taskbook-working/review-next-20261013含tests.log/tests-final.log、types.log、lint.log、ui.txt、page.png、verification.json、cleanup.json、protection.json及隔离setup/verify/cleanup入口；private.json只在忽略目录，账号已清理，凭据不公开。页面/数据库证据区分自评成功与真实练习判分，未调用AI。

复现：npx vitest run tests/e2e/review-next-steps.test.tsx tests/e2e/review-reliability.test.tsx tests/unit/domain/review.test.ts tests/integration/review-closure.test.ts；npm run type-check；npx next lint --file src/app/review/page.tsx --file src/components/review/ReviewNextSteps.tsx。

无TODO补全，DESIGN/ARCH/VISUAL非TODO补充页面状态/反馈契约，TASKS/PROGRESS记录完成；公开DATA与PRD模块边界不变。未新生产构建/全量/手机实测或学习效果评估，24.3及其它编号保持待办。
