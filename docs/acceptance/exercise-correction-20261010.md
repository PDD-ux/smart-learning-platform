# §20.9 演示题人工校订

2026-10-10 17:41，桌面主仓库，本地毕设演示。只处理§20.8发现的四道题及两条必要摘要；未重新调用模型，没有新增页面、接口、字段或依赖。

## 实际修正

目标资料：`cmuqhyf7h00027q29tijy4uer`（阿里木江7.10-前30分钟）。以校订前只读审计及数据库中的原始转写核对，不把结构合法或有引用视为语义正确。

1. 直播打赏题 `cmv21zesd001jdubgxxyuslxv`：去掉未展示的填空和“上述”，明确问遏制诱骗直播打赏的目的；答案为C“行业长远发展”。选项去掉自带编号，重写解析。依据42.490、103.420、238.570秒的诱骗、刑法介入与行业长远发展论述，摘要不变。
2. 防空导弹题 `cmv21zesd001ndubgpct5nc3o`：明确单一目标防空导弹与来袭方的区别，答案为B“一次只能应对一个目标，难以应对多个目标”；原“单一目标造成饱和打击”答案错误。同步题干、选项、解析和摘要，依据560.670、568.110、585.140秒讲解。防御方不能被改写成饱和袭击的发动方。
3. 企业文化题 `cmv21zesd001pdubggvv1sbz0`：明确学习模仿之外的要求，答案为D“探索自身的企业文化实践经验，并关注兼容匹配”。三项干扰分别是复制保证成功、忽视兼容、否定探索，避免近似重复。依据1217.630、1223.770、1251.030秒；摘要不变。
4. 科技观念题 `cmv21zesd001rdubgydd1toqn`：明确考查引用论述转折后的观点，答案为A“中国传统并不排斥科学技术”；同步解析及摘要，区分晚清保守派例子与转折后结论，删去当前片段不能确认的“早期学者”细节。依据1663.190、1685.370、1700.380秒。

能源题 `cmv21zesd001ldubgd4bywow5` 不变。四题均为尚未作答的单选；没有新增作答、改变成绩或代用户提交。

## 数据保护与执行证据

入口：`scripts/acceptance/correct-demo-exercises.ts`，内容及四题ID固定，必须显式指定模式。预览核对原值、五题集合、知识点归属、无目标作答、无运行中后台任务及12处原始转写锚点；选项唯一且标准答案存在。发现旧值不符、已有作答、来源变化即停止。

2026-10-10 17:33:32事务执行成功：4题文字和2条摘要修改。事前以独占创建方式保存 `backup.json`，不会覆盖已有备份。修改先确认本地3000端口停止，避免接口读取旧标准答案后再写作答的在途竞争；事务为Serializable，并按旧值与无作答条件更新。网页随后恢复，最新启动状态见 `local-web.json`（PID76048），没有生产构建覆盖开发 `.next`。

前后保护SHA256均为 `6a77030c390403d9a00c37a114530b14e8cb66a1fe1fbbf36f2dda5b29bc2474`。仅排除允许修改的文字字段，其余题目及目标ID、类型、知识点ID、引用、创建时间参与核对；还覆盖本人资料、个人笔记、进度、作答、掌握度、XP，以及目标转写、文本、闪卡、生成笔记和图谱。未顺手修改其它AI产物。

实际保护分支：网页运行时apply被拒绝、无写入；完成后再次preview因旧值不符被拒绝。恢复预览在真实校订后和浏览器核对后通过，显示4题/2摘要、`dataWritten:false`；恢复还核对原审计、备份文字/归属/范围及保护指纹。**没有实际执行restore**，不把恢复预览记成数据库恢复实测。以后若新增作答或保护数据变化，恢复应停止，不覆盖用户记录。

首轮预览遇到BigInt不能直接JSON序列化，发生在任何数据写入之前，改为哈希序列化时转为字符串；首次类型检查的只读选项联合类型问题已修复，两次失败不计成功。

证据目录：`.taskbook-working/exercise-correction-20261010/`，包含preview、backup、apply-result、restore-preview、after-quality、state-after、local-web及实际页面截图。原审计 `.taskbook-working/exercise-quality-20261010/real-questions.json` 保留，不要用校订后读取结果覆盖它。

## 验证

- 四文件51项相关测试通过：判分接口28、来源回看6、练习组6、计划/题库11。新加5项防空导弹题判分回归，B字母/带前缀文字/准确选项文本判对，A及旧错误答案判错；使用测试mock，没有真人作答写入。
- TypeScript及脚本/判分测试定向ESLint通过；恢复校验加强后再次通过。
- 真实只读题库接口读取5道未作答题；题目结构、关联知识点、共17处原引用有效，未作答响应不提前暴露标准答案。记录指纹不变，未调用模型。
- 真实状态接口确认本人仍有3份演示资料，XP22、个人笔记0、掌握度无记录、到期卡8、计划0/0，长视频续学位置247秒；匿名请求401，数据未写入。该脚本的`browserAuthenticatedVerified:false`只表示脚本不承担浏览器验证。
- 用户重新登录后，在真实题库依次核对四道新题的题干与选项，仍显示5题，未选择或提交答案；截图 `browser-corrected.png` 展示防空导弹题。页面显示核对与真实用户判分实测严格区分。

复现（从桌面主仓库执行；本机环境提供数据库/认证配置，不输出凭据）：

```powershell
# 首次校订前预览；原值已被校订后此命令应拒绝，不能重复apply
npx tsx scripts/acceptance/correct-demo-exercises.ts preview .taskbook-working/exercise-correction-20261010
# 维护窗口停止本仓库网页、确认没有在途作答后，首次才执行apply
npx tsx scripts/acceptance/correct-demo-exercises.ts apply .taskbook-working/exercise-correction-20261010
# 校订后只读恢复预览；保留backup.json及原审计文件
npx tsx scripts/acceptance/correct-demo-exercises.ts restore-preview .taskbook-working/exercise-correction-20261010
# 仅在确需恢复原错误数据且网页停止、所有保护校验通过时执行（本次未执行）
npx tsx scripts/acceptance/correct-demo-exercises.ts restore .taskbook-working/exercise-correction-20261010
# 当前网页运行时的只读检查；写入新的证据文件，不覆盖原审计
npx tsx scripts/acceptance/exercise-quality.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/exercise-correction-20261010/after-quality.json
npx tsx scripts/acceptance/state-accuracy.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/exercise-correction-20261010/state-after.json
npx vitest run tests/unit/api/mastery-exercises.test.ts tests/e2e/exercise-source.test.tsx tests/e2e/exercise-group.test.tsx tests/e2e/plans-bank.test.tsx
npx tsc --noEmit
npx eslint scripts/acceptance/correct-demo-exercises.ts tests/unit/api/mastery-exercises.test.ts
```

## 边界

本次完成指定演示题校订，不能推断所有旧AI产物或未来生成题都正确；闪卡/生成笔记未做语义校订。新提示的真实模型效果、真人浏览器简答判分、语义判分升级仍未验收，简答仍为规范化文字匹配。原云端连接、生产部署限制保留。没有给题目计算虚构的AI正确率。

修改文件：校订入口、判分回归测试、本记录、前项验收追记、TASKS/PROGRESS/LEARNINGS；实际数据库限定4题文字/2摘要。文档无TODO补全，新增非TODO执行证据及恢复规则，保留前项历史失败；产品交互、数据字段/API契约、架构和依赖不变，因此无需修改DESIGN/DATA-MODEL/ARCHITECTURE/README。
