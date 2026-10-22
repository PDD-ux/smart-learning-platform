# §20.11 演示完整AI笔记同步

2026-10-10 18:09，桌面主仓库、本地毕设演示。仅同步原30分钟资料 `cmuqhyf7h00027q29tijy4uer` 已保存的自动笔记中两段旧摘要，没有调用模型或重新运行解析。

## 修改范围

笔记 `cmurz9orw00ev57hutgiqr3ez` 第3段“第七题情境分析”改为§20.9已校订摘要，明确来袭方实施饱和袭击、防空导弹只能命中单一目标，不能混淆攻防主体。核对原转写560.670、568.110、585.140秒。

第5段“中国科技观念辨析”改为已校订摘要，明确转折后观点为“中国传统并不排斥科学技术”，区分晚清保守派的例子，去除当前片段无法确认的“早期学者”细节。核对1663.190、1685.370、1700.380秒。

其余正文、段落顺序、标题、标签和旧笔记的五条“来源：当前解析资料”完全保留；知识点原有17处时间引用及页面解析证据入口不变。本次不补造旧笔记的时间来源。`sourceCount`仍5，笔记ID不变，个人补充独立保存。任务仅校订指定两段，不证明其它旧产物都语义正确。

GeneratedNote没有独立version字段，因此使用完整旧markdown、ID、contentId、sourceCount及`generatedAt`作为条件更新。`generatedAt`是Prisma的更新时间字段，本次从2026-10-03T07:08:22.929Z变为2026-10-10T10:04:08.432Z，表示维护修改，不表示本次调用模型生成。

## 入口与保护

`scripts/acceptance/sync-demo-generated-note.ts` 固定资料和两个知识点ID，提供preview/apply/restore-preview/restore/verify。读取§20.9原备份，核对当前五知识点、两个新摘要、标题/标签/引用与六处真实转写；按旧自动整理结构核对完整旧正文，只有两次明确替换才能达到预期新正文。遇到个人编辑、旧值不符、资料归属/来源变化或后台任务则停止。

apply/restore要求本仓库3000端口停止，防止在途重新整理；备份独占创建，不覆盖已有文件。Serializable事务中的updateMany包含旧正文与旧更新时间，更新数量必须1，前后保护指纹一致。保护本人资料、个人笔记、学习进度、掌握度、成绩、XP、计划，以及目标知识点、原文、题目、闪卡、图谱和其它资料的整理笔记。

2026-10-10 18:04:08实际apply成功，仅两个正文段落和笔记更新时间改变。保护SHA256前后均为 `cf4ce3e44101adb83905af6c62050a93e1717355879877015367fbfba7ef1837`。备份见 `.taskbook-working/generated-note-sync-20261010/backup.json`。原题目审计和§20.9备份保留。

真实保护分支：网页在线apply拒绝，重复preview因正文/版本不符拒绝；修改后、浏览器访问前restore-preview通过，未执行restore。另用复制到独立证据子目录的备份文件，把预期更新时间改为2000年，restore-preview正确拒绝；这只验证版本参数守卫，未在数据库伪造编辑或模拟真实并发竞争。

浏览器随后访问学习页，正常页面可能同位置上报进度元数据；访问后恢复预览因保护指纹变化拒绝，原成功预览保留。当前恢复入口会停止，不能放宽守卫后直接覆盖。需要恢复时先人工核对之后的记录变化；本次没有恢复原错误正文。247秒位置及成绩/XP/个人笔记数量仍经接口确认保持，不能将事务指纹扩大解释为整场浏览器访问所有元数据不变。

## 验证与展示

- TypeScript与入口ESLint通过。既有产物生成阶段11项、笔记保存可靠性4项回归共15项通过，均为测试环境，不是真实模型调用或真人新笔记保存。
- 真实GET `/api/contents/:id/generated-note` 返回200，与数据库新正文、五来源及新更新时间完全一致；匿名GET401。浏览器核对后再次通过，读取期间保护指纹一致、无脚本数据写入。
- 真实只读题库5题与§20.9校订后审计完全一致，仍未作答；3份演示资料、个人笔记0、XP22、掌握度无记录、计划0/0、到期卡8、长视频247秒保持。
- 本人已登录的原用户页从学习中心进入30分钟学习页，实际完整笔记显示两段新正文，旧攻防混淆及“早期学者”表述均消失。未点击重新整理、出题、播放、提交答案或保存补充。保留原标签页，未代输登录信息。
- 保存 `browser-corrected.png`（两段及周围正文）、`browser-full-page.png`及`browser-verification.json`。网页使用常规`npm run dev -- -H 127.0.0.1`托管会话恢复，状态见`local-web.json`，本次未执行生产构建。

验收入口首次误按`data.markdown`读取响应，实际契约为`data.note.markdown`，已修正并复验；失败发生在只读验收，不影响已完成数据修正。没有为了验收修改产品API。

![真实校订后的完整笔记](../../.taskbook-working/generated-note-sync-20261010/browser-corrected.png)

## 复现

从桌面主仓库执行，本机环境提供数据库/认证配置，不输出凭据：

```powershell
# 原值已同步后preview应拒绝，不要再次apply；首次维护前才可预览/写入
npx tsx scripts/acceptance/sync-demo-generated-note.ts preview .taskbook-working/generated-note-sync-20261010
# 首次维护窗口停止本仓库网页后执行；独占备份及旧值条件必须通过
npx tsx scripts/acceptance/sync-demo-generated-note.ts apply .taskbook-working/generated-note-sync-20261010
# 只读恢复预览；保护记录已变化时拒绝，不覆盖历史或同期编辑
npx tsx scripts/acceptance/sync-demo-generated-note.ts restore-preview .taskbook-working/generated-note-sync-20261010
# 确需恢复原文且停止网页、全部守卫通过后才执行；本次未执行
npx tsx scripts/acceptance/sync-demo-generated-note.ts restore .taskbook-working/generated-note-sync-20261010
# 当前网页运行时可执行的真实只读接口检查
npx tsx scripts/acceptance/sync-demo-generated-note.ts verify .taskbook-working/generated-note-sync-20261010
npx tsx scripts/acceptance/state-accuracy.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/generated-note-sync-20261010/state-reread.json
npx vitest run tests/unit/jobs/product-gen.stage.test.ts tests/e2e/note-save-reliability.test.tsx
npx tsc --noEmit
npx eslint scripts/acceptance/sync-demo-generated-note.ts
```

修改入口、本记录、TASKS/PROGRESS/LEARNINGS，并在§20.10验收追记处理结果。无TODO补全；非TODO内容补充限定修改、恢复及真实验收证据。没有产品交互/API/字段/架构/依赖变更，故不修改DESIGN/DATA-MODEL/ARCHITECTURE/README。

本编号任务已完成。真人完整作答/简答、新提示真实模型质量、会话续期、云端稳定性和生产部署边界仍保留。关于学习Agent的咨询只依据现有代码说明：当前问答读取资料/笔记并返回带引用的回答，没有模型选择工具并循环执行任务的控制层；本次未新增Agent功能或训练任务。
