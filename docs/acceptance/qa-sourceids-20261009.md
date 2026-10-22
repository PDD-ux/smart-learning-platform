# §10.2 问答修复与下一步网页验收

2026-10-09，桌面主仓库。延续同一编号任务，解决上一轮真实模型校验失败，再完成网页问答和引用回看的下一步验收；未开始其他编号功能。

## 修复

将模型内部输出从答案/定位/摘录改为 answer/sourceIds。后端为实际保留且满足内容类型、时长/页数的原文编号，按模型选择读取精确定位与原文前 500 字，去重形成原 API citations。未知编号和已知占位答案仍经既有最多两次模型调用校验，失败明确返回 503。精简提示，不再把可被照抄的占位答案放入格式示例；外部 API、数据表、前端和依赖不变。

实测编号协议最初仍有失败，提示精简后恢复成功，但中间 repeat-2 选择了无关尾部来源，浏览器也曾误判断句资料不足；这些结果保留，没有算作最终语义验收通过。

进一步在合法有界上下文中按问题文字二元组选择最多三个高分主题锚点，保留锚点及后三段，视频限定 25 秒、文档同页；避免跨 303→1481 秒截断缺口以及主题前的无关口语过渡。匹配不足时沿用原有有界上下文。额外最多 3000 字连续阅读文本帮助理解分段转写，最终引用仍取单段原文。

## 最终实测

- 最终实现连续两次真实星火 API 返回正常回答，说明天气、地理位置与间歇性影响；引用全部逐字来自 293/300/301/303 秒中的真实段落：[第一次](qa-grounding-20261009-oct09-sourceids-bounded-1.json)、[第二次](qa-grounding-20261009-oct09-sourceids-bounded-2.json)。按真实原文核对，未出现无关尾部引用、拼接摘录或占位回答。
- 实际浏览器使用临时账号选择真实视频副本、提交原始问题，得到正常回答及 4:53、5:03 引用。点击 4:53 后实际 video.currentTime=293、paused=true、duration=1800.032、readyState=4、error=null：[网页会话记录](qa-sourceids-20261009-browser-answer.json)、[实际播放器证据](qa-sourceids-20261009-browser-jump.json)、[截图](qa-sourceids-20261009.jpg)。会话记录保留中间不充分回答和多余过渡引用，只有最后一次是最终实现验收。
- 临时资料和账号已清理；原 30 分钟视频、510 段转写、5 个知识点及其他关联数据完整指纹一致，媒体未删除：[清理记录](qa-sourceids-20261009-cleanup.json)。没有重跑 ASR/Ascend，没有改原账号。
- 原编号协议失败证据、提示精简后的原始成功、repeat-2 无关引用，以及 focused/final 两组中间结果继续保存在本目录 `qa-grounding-20261009-oct09-sourceids*`，不覆盖前轮失败证据。

## 验证与复现

81 文件/468 项回归、TypeScript、Lint、Next.js 生产构建通过；保留既有字体/img/可选 Valkey 提示。本地日志在忽略目录 `.taskbook-working/qa-sourceids-{tests,build}-20261009.log`。网页构建结束后重新启动。

修改 qa route、新增 qa-sources 纯函数和测试、调整 API 回归、验收入口支持独立 probe 标签；同步架构、数据规则、LEARNINGS、PROGRESS。无新增/补全 TODO；非 TODO 文档用于说明内部编号协议及来源选取，外部字段不变。

```powershell
# 主仓库已有本地 DB、JWT、星火和原视频配置，网页先 npm run dev。
npx tsx scripts/acceptance/real-playback-fixture.ts setup oct09-sourceids-recheck qa-sourceids-20261009-recheck
npx tsx scripts/acceptance/qa-citation-grounding.ts oct09-sourceids-recheck probe-1
npx tsx scripts/acceptance/qa-citation-grounding.ts oct09-sourceids-recheck probe-2
# 无论模型成功或失败，清理数据库副本，不能通过产品接口删除共享视频媒体。
npx tsx scripts/acceptance/real-playback-fixture.ts cleanup oct09-sourceids-recheck qa-sourceids-20261009-recheck
```

浏览器复验可在 setup 后使用 `assistant-browser-account.ts setup <runId>` 创建临时账号，密码仅临时设于本机 UI_ACCEPTANCE_PASSWORD 环境变量。登录 localhost，选择临时资料、提问、点击引用，退出会话后先清理资料再执行该脚本 cleanup。凭据不写入报告。已删除的临时资料链接不能继续打开。

## 剩余边界

本例模型校验阻塞已解除，下一步网页验收通过。原 ASR 的口语断句保持原样；文字匹配不是同义词检索，既有首尾截断也不能覆盖整片所有问题。资料不足仍可返回无引用说明，不保证所有问答语义稳定。全片长视频处理、其他缺少产物的视频和生产部署配置仍是其他既有验收边界，本轮未执行。
