# §20.5 题库布局验收

时间：2026-10-10 16:28（北京时间），桌面主仓库。

## 范围及结果

≥1280px使用3fr/7fr的列表和作答区，其余单列上下排列。列表两行题干，显示题型、题号和本人历史答题状态；完整题干保留换行，在作答区与选项、结果、历史解析和来源一起展示。列表在宽屏最多65vh、窄屏45vh，分页位于列表下方。长选项允许换行，列和资料选择器可收缩，关键操作至少44px高。

列表加载/失败不展示虚假0题，失败保留筛选可重试，真正没有题目才显示0。未知或忙碌时禁止分页和启动练习。保持当前普通作答、生成、练习组和来源逻辑，没有修改题干内容、答案、判分算法或数据库字段；不涉及§20.6–20.8。

## 回归验证

```powershell
npx vitest run tests/e2e/question-bank-layout.test.tsx tests/e2e/plans-bank.test.tsx tests/e2e/exercise-group.test.tsx tests/e2e/exercise-source.test.tsx tests/unit/domain/exercise-source.test.ts
npm run type-check
npx eslint src/app/question-bank/page.tsx src/components/review/ExerciseAnswerInput.tsx tests/e2e/question-bank-layout.test.tsx
```

5文件29项通过。新增6项覆盖加载未知、真实空筛选、失败保留筛选重试、完整多行题干和成功判分后来源、筛选切换/迟到请求隔离、接口pageSize及历史状态。原练习组6项、来源面板/定位9项、计划/题库8项回归通过。最后限高样式和忙碌禁用调整后重跑新增6项、TypeScript和ESLint，均通过。

没有执行生产构建以免覆盖正在运行的开发服务.next；组件测试没有验证实际浏览器CSS尺寸。

## 真实接口只读核对

```powershell
npx tsx scripts/acceptance/exercise-sources.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/question-bank-layout-20261010/read-only.json
```

本地开发服务运行时，在内存签发该资料所属账号的测试令牌，不输出凭据。当前视频题库5题，每题分别有3/3/3/4/4个有效来源，未作答列表不泄露答案/解析，匿名来源请求401。没有生成题目、调用模型、作答或写入用户记录。原始结果保存在上述JSON。

## 浏览器限制与人工复核

实际临时页访问`http://localhost:3000/question-bank`后跳转`/login`。证据`.taskbook-working/question-bank-layout-20261010/browser-login-block.txt`，临时页已关闭；不声明已登录页面、真实CSS布局或本人判分已验收，不绕过鉴权。

本人登录后可核对1440px双列约3:7及768px上下排列；检查长题干/选项不横向溢出、列表选题高亮，选题后完整题干和选项均可读。作答与总结由本人选择是否执行，本轮不代本人生成真实成绩。
