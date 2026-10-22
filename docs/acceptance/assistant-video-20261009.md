# §10.2 真实视频 AI 助手与引用回看验收

验收时间：2026-10-09 08:00–08:10（Asia/Shanghai）。本轮仅续验 §10.2，在桌面主仓库运行本地网页、真实 PostgreSQL 和已配置的讯飞星火；没有重跑 ASR、MindSpore 或 Ascend，也没有开始其他编号任务。

## 真实数据与隔离方式

来源为既有 30 分钟视频 `cmuqhyf7h00027q29tijy4uer`：510 段真实转写、5 个知识点、17 处时间引用，浏览器实际媒体时长 1800.032 秒。使用数据库临时副本共享只读媒体，复制转写、知识点和整理笔记，没有复制 OCR、闪卡或习题。原登录凭据已过期，因此创建临时账号登录，不修改原账号密码。

临时资料 `cmv074qg7000175vqycbqlfna` 仅供本轮验收，现已删除，历史截图与 JSON 中的链接不能再打开。清理只删除临时数据库资料及其关联记录，随后删除临时账号；不得通过产品删除接口清理共享媒体。清理结果为 sourceUnchanged=true、remainingFixtureContents=0、sourceMediaDeleted=false，见 [清理证据](assistant-video-20261009-cleanup.json)。

## 结果及修复

实际浏览器提交一次问题：“资料中为什么说可再生能源发电具有波动性？请引用转写原文说明。”真实星火回答指出天气、季节、地理位置以及间歇性，附视频 4:53 引用。语义与已有转写相符，但引用摘录出现“不同存在不同时间尺度”的重复拼接；本轮保留此质量限制，没有把摘录当作已验证的精确逐字引用，亦不能代表所有视频问答稳定。

原引用链接只打开学习页，未携带时间点。修复后链接为 `/study/:id?t=293`；真实浏览器点击、刷新均定位到 293 秒，播放器 paused=true、readyState=4、error=null。无效 `t=99999` 被忽略，继续使用保存的 293 秒进度。整数秒定位与转写的毫秒起点可能有不足一秒差异，不保证点击瞬间显示相应转写段。

同时支持文档引用 `/study/:id?page=N`，有效定位优先于保存进度；视频等待媒体元数据就绪后定位，保持暂停。空值、负数、小数、重复参数、错误资料类型与越界定位退回既有进度。文档页码由组件回归验证，本轮没有另做真实 PDF 浏览器验收。

产品改动为助手链接、学习页定位及纯函数 `study-location.ts`；同步 DESIGN §17 的既有交互说明，没有新增 API、数据库字段或依赖。文档没有新增或补全 TODO，本次修改非 TODO 内容是为了明确已有引用回看行为。

## 证据与验证

- [真实回答及链接](assistant-video-20261009-answer.json)、[实际播放器定位](assistant-video-20261009-jump.json)、[越界回退](assistant-video-20261009-invalid.json)。
- [真实浏览器截图](assistant-video-20261009.jpg)。
- 全量 79 文件、459 项测试通过；TypeScript、Lint、Next.js 生产构建通过。既有字体、img 与可选 Valkey 提示保留。本地测试/构建日志位于忽略目录 `.taskbook-working/assistant-{tests,build}-20261009.log`。
- 自动化覆盖视频及文档 URL、定位上下界、非法参数、视频元数据就绪后跳转并暂停、文档引用覆盖保存页码。测试替身使用稳定路由对象和实际扁平 progress 字段，避免模拟路由重复加载覆盖播放器时间。

## 可复现入口

在桌面主仓库配置现有数据库、JWT、星火与本地媒体环境变量，启动 `npm run dev`。选择新的 runId，避免覆盖已有 fixture 状态。原视频必须存在。

```powershell
npx tsx scripts/acceptance/real-playback-fixture.ts setup oct09-assistant-recheck assistant-video-20261009-recheck
# 在本机临时设置 UI_ACCEPTANCE_PASSWORD（至少 12 字符），不要写入仓库或验收报告。
npx tsx scripts/acceptance/assistant-browser-account.ts setup oct09-assistant-recheck
```

使用输出的临时邮箱和本机设置的密码登录，打开 AI 助手、选择临时视频，提交上述问题。核对回答来源，点击时间引用，检查播放器实际 currentTime 和 paused；刷新后再次检查。将 t 改为超出媒体时长的整数，确认回退到保存进度。真实 AI 输出可能变化，摘录需人工复核，不能仅按存在引用判定质量合格。

退出临时会话后按顺序清理；本脚本只清理数据库，保留共享媒体：

```powershell
npx tsx scripts/acceptance/real-playback-fixture.ts cleanup oct09-assistant-recheck assistant-video-20261009-recheck
npx tsx scripts/acceptance/assistant-browser-account.ts cleanup oct09-assistant-recheck
Remove-Item Env:UI_ACCEPTANCE_PASSWORD -ErrorAction SilentlyContinue
```

若运行中断，应检查忽略目录 `.taskbook-working/real-playback-<runId>.json` 中的 cloneId/ownerId 后按上述步骤清理，不删除来源视频或媒体对象。报告前缀参数用于保留历次验收证据。

## 保留限制

引用摘录重复、完整长视频识别、其他缺少有效产物的视频和既有生产配置阻塞继续保留。本轮验证已有预解析真实视频的助手问答及引用回看，不代表完整课程理解质量、推理环境本次健康状态或生产上线验收。
