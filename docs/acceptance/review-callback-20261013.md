# §23.9 复习评分回调补修

完成：2026-10-13 20:33，桌面主仓库。

原rate函数每次渲染重新创建，键盘useEffect依赖它，造成监听反复解绑/绑定并产生react-hooks/exhaustive-deps警告。旧effect有清理、pending有提交锁，未证明此前存在重复评分请求，不将警告描述为已确认数据库重复写入。

rate使用useCallback，依赖当前项、revealed、cards与useReviewSession既有稳定applyReviewResponse；避免依赖每次新建的整个session对象。切换项/查看要点仍更新闭包，无关草稿输入不改变评分函数。原提交锁、失败草稿、排期、XP算法及UI不变，无接口/数据字段/架构/依赖变更。

新增行为回归：切到第二项，空格查看其答案，修改回忆草稿，输入框按4不提交；窗口连续按4仅一次review('a2',3)，完成后回到剩余第一项。既有重复评分、未查看禁用、失败保留草稿、来源/关联练习等仍通过。3文件18项测试、type-check、两改动文件定向lint均通过；复习页lint无warning/error。

证据目录.taskbook-working/review-callback-20261013/tests.log、types.log、lint.log。测试仍含既有Vite CJS弃用与旧草稿切换测试的RelatedPractice act等待警告；没有抑制它们，也不把它们混同本次Hook lint。未重复全站1024项或生产构建，本轮没有浏览器实际评分/本人数据库写入/AI调用。

复现：npx vitest run tests/e2e/review-reliability.test.tsx tests/unit/domain/review.test.ts tests/integration/review-closure.test.ts；npm run type-check；npx next lint --file src/app/review/page.tsx --file tests/e2e/review-reliability.test.tsx。

无TODO补全，TASKS/PROGRESS新增非TODO本次记录。字体/图片构建警告及其它编号保持后续处理，本次只核销复习Hook警告。
