# §6.4 旧视频知识点安全补充时间引用

完成时间：2026-10-08 17:47（北京时间）。执行位置为用户指定的桌面主仓库。

本轮沿现有 §6.4 修复旧知识点来源定位，不新增产品功能、页面、接口、数据字段或依赖。只处理已有知识点且有可核对真实转写的两份视频：

- `cmunzyqdv0002t6x87pauda0k`（前 30 秒）：原有 1 个知识点新增 19/25 秒引用。
- `cmuqhyf7h00027q29tijy4uer`（前 30 分钟）：原有 5 个知识点新增 17 个引用。各主题首个来源为 0:42（第五题）、4:44（能量与用电）、9:20（第七题）、20:17（企业文化）、27:43（科技观念）。

总计保留原 6 个知识点 ID、标题、摘要、标签与重要度，新增 19 个视频时间引用。引用按原转写 startMs 向下取整到秒，不由正文数字推算；首个来源是已核对的支持片段，并不宣称为精确章节起点。原 AI 摘要的整体措辞/准确性没有在本轮重新生成或全面认证。

## 证据与写入保护

[核对清单](video-refs-backfill-20261008-plan.json) 保存原知识点 ID/正文以及真实转写时间与逐字摘录。先 read-only check，检查摘录仍存在、知识点正文未变、引用为空或已与方案一致、资料为就绪且理解不在 RUNNING；原有不同引用一律保留并拒绝覆盖。

apply 前在忽略目录 `.taskbook-working/video-refs-backfill/` 保存完整关联数据备份。在 PostgreSQL Serializable 事务中重新检查源数据快照，使用 ID/资料 ID/ownerId/旧 refs 精确条件更新；仅写 KnowledgePoint.refs，不删除或创建知识点，不触发流水线。提交前再次比较排除目标 refs 的数据指纹，任何其他字段变化都回滚。关联快照覆盖转写、文本块、个人笔记、GeneratedNote、闪卡与复习日志、练习与作答记录、掌握度、图节点/边、播放进度、异步任务、学习计划。

[实际写入结果](video-refs-backfill-20261008-result.json)：6 个目标引用更新；保留字段前后 SHA-256 均为 `017361188d68131b5df20285709acf8ad10f6fff3db03bdebe3aa02cff00c0bf`。备份路径记录在结果中，包含个人学习记录的完整备份仅保留在本机忽略目录。写入后再次 check：changedPoints=0，确认同一清单再次执行不会改写已补充引用。

## 验证

新增 3 项维护校验回归：原文/知识点变更、跨资料错配、越界/缺时长、保留已有不同引用，以及相同方案幂等。全量 78 个文件/455 项通过；TypeScript、Lint 通过，既有字体/img 警告保留。此次只增加维护/验收脚本，产品源码未改，未重复生产构建。

[真实读取结果](video-refs-backfill-20261008-read.json)：通过真实 localhost GET /understanding 读取两份原资料，HTTP 200；DTO 保留全部引用；运行学习页同一 playbackSections/currentPlaybackSection 逻辑，30 秒资料得到 2 个时间组、30 分钟资料得到 17 个时间组，首个来源前无重点，各引用处均命中对应原知识点。读取使用仅在内存中的受控本机 token，不打印或保存令牌，不修改登录会话；不计作密码登录或真实浏览器媒体验收。此前 §15.1 的播放/点击交互回归仍全部通过。

复现（主仓库，使用本机数据库环境变量，无外部 AI/ASR/Ascend 请求）：

```powershell
npx tsx scripts/maintenance/backfill-video-refs.ts check docs/acceptance/video-refs-backfill-20261008-plan.json
npx tsx scripts/maintenance/backfill-video-refs.ts apply docs/acceptance/video-refs-backfill-20261008-plan.json
npx tsx scripts/acceptance/verify-backfilled-video-refs.ts cmunzyqdv0002t6x87pauda0k cmuqhyf7h00027q29tijy4uer
```

check 仅验证和保存快照；apply 只更新核对清单中的空引用，已一致时无修改。若旧正文、转写或引用已变，入口失败退出，需要重新核对，不自动重跑或覆盖。

## 保留限制

另外 7 份视频没有现有知识点，或无有效转写，不在本轮补充范围。尤其完整长课已有转写但无知识点，不能仅凭转写就宣称同步笔记生成完成。未重跑媒体解析、ASR、MindSpore 或 AI；GeneratedNote 原文保留，同步重点直接读取已补充引用的知识点。长视频识别、生产 JWT 与部署等原有阻塞仍保留。
