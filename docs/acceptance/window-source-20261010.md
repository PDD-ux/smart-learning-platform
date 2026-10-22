# §10.4 有解析内容的窗口不能被当成空窗

2026-10-10，仅继续长视频分窗知识抽取这一项。发现并修复窗口来源被截断丢失后仍可跳过的缺口；代码验证通过，46分钟真实完整验收仍阻塞，任务不标完成。

## 问题与修复

现有上下文预算会保留首尾完整段落。若唯一段落或首尾段落超过预算，保留结果可能仅含省略号，sourceRefs为空，但数据库实际有转写/OCR。原长视频分支以无保留来源判断跳过，其他窗口成功后即可写入部分知识点；空白文本同样在校验前被跳过。因此“空窗跳过”不能只看截断后的文本或引用。

`src/lib/jobs/pipeline/deep-extract.stage.ts`先检查查询得到的transcriptCount/textBlockCount与类型/全片范围有效的保留来源。有解析记录但无可引用来源，或上下文为空，抛SCHEMA_INVALID，不调用模型、不删除原知识点。确实没有解析记录的空窗仍可跳过，后面的正常窗口继续抽取。短视频/文档契约、请求预算和模型次数均不变；不新增依赖、字段、公开接口或页面。

此次是阻止静默漏段的校验修复，没有改写段落或自动提高上下文预算；超长段落仍可能需要进一步处理，不能说该问题已恢复完整语义覆盖。

## 验证

- 新增4个用例：后续有内容但为空白/仅省略号时保留旧产物、真正空窗允许后续正常抽取、全部引用超出全片范围时拒绝。有内容丢来源的两个用例修复前失败，修复后三个相关文件30项通过。
- 全量92文件562项通过，TypeScript与改动文件ESLint通过，没有和运行中的开发服务共用.next构建。
- 实际PostgreSQL创建临时账号/660秒元数据/一条合成超长转写/一个待保留知识点；真实查询结果transcriptCount=1、truncated=true、retainedSources=0，新阶段SCHEMA_INVALID且旧知识点仍存在。终态清理账号及资料，原18份资料、转写/OCR/知识点/闪卡/笔记/整理笔记指纹不变。该项仅为合成边界故障验证，不是真实视频、ASR、Ascend或模型总结质量验证。

## 当前外部阻塞与复现

使用本机现有密钥及独立known_hosts连接110.41.14.167:31637仍返回Connection closed。检查时3000/8001/8002均不可达；随后仅恢复本地Next网页，登录页200。Ascend未恢复，人脸服务未在本编号任务启动。未改账号密码、环境文件或启用mock；此前失败证据保留，不重跑旧视频或处理遗留任务。

完整46分钟10窗及45分钟定位验收仍须先恢复ModelArts实例与SSH，再按DEPLOY的隔离真实演示入口复跑。可复现入口及昨晚结果见[分窗验收](video-windowed-20261009.md)。本次状态、计数和服务检查见[脱敏证据](window-source-20261010.json)。

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
npx vitest run tests/unit/jobs/context-builder.test.ts tests/unit/jobs/deep-extract.stage.test.ts tests/unit/jobs/product-gen.stage.test.ts
npm run type-check
```

同步ARCHITECTURE、DATA-MODEL、TASKS、PROGRESS和LEARNINGS的非TODO说明，明确空窗和来源丢失的区别；没有补全TODO或扩大功能范围。
