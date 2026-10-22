# §23.6 随看笔记原文忠实性保护

完成时间：2026-10-13 19:20（桌面主仓库，本地毕设演练）。

## 问题与修改

真实5:39—5:47转写为“低成本大规模的储能系统可以突破可再生能源，”“即发即用不能存储的瓶颈。”旧页面摘要却写成“即实现发即用且无需存储的限制”。来源编号合法不能证明这种改写忠实。修复前反例测试实际返回200，期待503，失败证据保留在before.log。

本次改为提取式笔记：模型只返回1—3项keyword/sourceNumbers，关键词必须逐字出现在所选来源中。服务端从最小到最大所选编号连续摘录，并保留请求窗口内前后各一条来源，不省略中间否定；不生成自由标题或摘要。未知字段/来源、改写关键词、不安全或超过4500字符的结果拒绝，不截断冒充完整。模型仍用现有星火，maxTokens500、单次25秒/总30秒和最多两次格式尝试，不增加语义裁判调用。

响应新增可选mode=source-extract（兼容本页旧批次），无新表/迁移。新批次提示“AI精选原文 · ASR转写待核对”，显式保存前缀注明原文摘录；旧批次标历史未核验，正文、已存笔记和导出原Markdown不批量改写。

## 验证

- 133个测试文件、1023项测试全通过；TypeScript与定向lint通过。新增关键词/自由字段拒绝、连续上下文、非法编号、预算、真实否定保留和新保存前缀回归。首次完整测试仅保存前缀1项失败，修复后全量重跑通过，tests.log与tests-final.log分别留证。
- 两次受控真实接口回放：storage用5:39附近3条真实转写，保留“不能存储”且无“无需存储”；uncertainty保留“我的声音还正常。吧”，没有改成确定判断。两次均验证匿名401、未来来源400、生成不自动入库、显式保存及临时清理；未换模型、重跑ASR或训练。
- 两份report.json生成时temporaryFixtureCleaned仍为false，最终应以相应cleanup.json为准：临时账号/资料已清理，共享原媒体保留。protection.json确认原学习数据及两份env指纹不变。
- 原用户页面只读核对：7批历史摘要、17个标题、1批已保存保留；8:52暂停，媒体无error。各历史批次已有未核验文字，没有刷新、播放、生成或保存。此页面没有新摘录批次，不冒充新模式实际浏览器生成验收。

复现入口（会使用现有星火额度；请用新输出目录）：

```powershell
npx tsx scripts/acceptance/watched-notes.ts .taskbook-working/watched-quality-repeat/storage --storage
npx tsx scripts/acceptance/watched-notes.ts .taskbook-working/watched-quality-repeat/uncertainty
```

证据目录：.taskbook-working/watched-quality-20261013，含source.json、before.log、tests.log、tests-final.log、types.log、lint.log、storage/、uncertainty/、protection.json、legacy-ui.json。密钥和令牌不写入报告。

## 保留限制

逐字摘录防止自由改写，不能保证ASR正确、选点完整或跨批上下文充分。多个重点可能引用重叠原文；本编号不追加去重策略。旧错误摘要仍保留供用户核对，不因加提示变成准确结果。没有重新验新版本生产构建、整30分钟语义或新模式浏览器播放；§23.4历史生产证据不替代本次新策略的生产验证。

文档无TODO补全：同步非TODO生成策略、接口mode、页面提示与用法，使契约符合本次原文保护；无新依赖。
