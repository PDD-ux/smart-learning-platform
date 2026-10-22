# §27.8.1 星火JSON接入复核

2026-10-16，桌面主仓库。用户展示Spark Lite余量无限截图后，要求定位出题失败。本轮仅回到27.8修复/诊断，不执行27.10或扩大其他功能。

## 结论与修复

项目确有接入缺陷：`spark.ts`原来只在百炼/智谱的jsonMode请求中发送`response_format`，星火漏发。讯飞[官方HTTP文档](https://www.xfyun.cn/doc/spark/HTTP调用文档.html)列出`response_format: {type: "json_object"}`，并要求消息中明确指示生成JSON。本轮补齐星火参数与JSON文字约束，普通文本请求保持不变，没有切换服务商、修改凭据或放宽候选校验。

`generation-worker.ts`原提示仅用简写列字段，真实基线返回中文type、题目字段平铺在questions项，缺position/body/difficulty/evidence。现在补完整且有效的根结构/四题型模板、确切英文枚举、必填字段与原文ID/摘录约束，模板内容不能照抄，干扰项不能把实际正确事实随意判错。

**接入参数修复不代表Lite自动编题已经可用。** 本轮修复后的响应依然出现JSON语法错误，实际worker单题两次均拒绝，保存0题。没有通过删非法字符、猜字段、无限重试或自动切换模型制造成功。

## 四次真实调用证据

只用自编数学短文“偶数是能被二整除的整数……二加三等于五……”；没有读取或上传用户的课程、账号资料或笔记。

1. 现有请求基线1次：HTTP200、业务code=0；未发送response_format。返回545字符、238输出tokens，围栏内JSON可以解析，但字段结构不符合schema，QUALITY_REJECTED、0合格。还观察到选项D为数学上正确事实而解释将其判错，因此不能仅将JSON问题修好就声称语义质量通过。
2. 修复后对照1次：HTTP200、业务code=0；实际发送json_object。返回439字符、224输出tokens，却含非法左括号及错置evidence，INVALID_JSON、0合格。finish_reason两次均未返回，不能虚构stop/length状态；本次输出token均远低于请求4000上限，没有观察到额度/并发错误，当前样本不支持“额度用完导致失败”的判断。
3. 实际隔离worker单题任务，最多2次：最终FAILED，requestedCount=1、usedCalls=2、acceptedCount=0、failureCode=INVALID_JSON，candidates为空。88项工程检查与原资产保护/清理通过不等于真实题目质量通过。

总计4次，达到本轮预设上限后停止。基线与对照在`.taskbook-working/spark-json-diagnostic-20261016/baseline.json`、`corrected.json`；worker证据在`.taskbook-working/exam-generation-20261016/run-1792150095537/live.json`。脱敏摘录仅为自编内容，保存在忽略目录；没有记录请求头、密钥或用户原文。

当前配置只核对到官方HTTPS域名、lite及凭据已配置；真实调用成功说明当前密钥可访问Lite。API响应没有提供可用于匹配控制台“智能学习平台2”应用名的字段，不能据此替用户确认密钥属于截图的哪一个应用，也没有更换密钥。

## 工程验证

- 20文件166项AI/试卷/架构专项通过；165文件1279项全量、非增量TypeScript、lint通过。新增JSON请求参数/不修改原消息/一次调用/普通文本保持原样测试，旧“不发送response_format”断言改为验证官方JSON契约，供应商仍保持Spark。
- 最终无模型生产复验：`.taskbook-working/exam-generation-page-20261016/run-1792150162897/`，119项真实隔离DB、28项真实生产HTTP、干净生产构建/standalone/鉴权与私人权限。模型凭据在生产子进程禁用，不会因该复验追加真实模型调用。
- 各轮临时库/账号/生产快照与服务清理，原44物理表/媒体/两env指纹一致。没有新迁移/表/字段/依赖；原3000网页未被生产构建替换。
- 新`scripts/acceptance/spark-json-diagnostic.ts`保留单请求复现入口，只发送同一自编原文，使用现有worker提示，最多1次fetch且无JSON修复重试，输出文件必须在项目.taskbook-working且不得覆盖已有证据。重复指定已有corrected.json的拒绝路径已验证，无新网络调用。它是诊断命令，不会自动执行，也不是网页测试后门。

## 复现与限制

```powershell
node --import tsx scripts/acceptance/spark-json-diagnostic.ts
```

此命令会真实调用现有星火一次，生成新的忽略证据文件；本轮4次上限已用完，没有为了测试新入口再追加调用。模型输出不确定，下一次结果可能不同，不能承诺必现同一字符串。真实worker复现沿`node scripts/acceptance/exam-students.cjs --generation --live`，该入口最多2次真实请求，需单独计入模型用量。

当前可用的是已验证的审核题库组卷/私人答卷流程。Lite对本项目严格结构的遵从仍不稳定，不能保证20/50题自动生成成功；完整学科语义与真实整卷教育质量依然未通过。上次INVALID_JSON历史保留，本轮基线出现QUALITY_REJECTED不能倒推上次也是相同原因。无需凭当前证据充值或重训模型。

本轮没有补TODO；修改非TODO为05新增/核销用户授权的27.8.1、17诊断边界、03网关实际行为、PROGRESS和LEARNINGS；PRD能力与公开DTO/页面不变，不额外修改02/04/06或README技术选型。
