# §15.1 真实旧视频播放同步验收

验收时间：2026-10-08 18:00（Asia/Shanghai）。范围仅为 §15.1，使用桌面主仓库、本机 Next.js 与真实 PostgreSQL。

## 样本与隔离方式

来源资料：`cmuqhyf7h00027q29tijy4uer`，既有真实 30 分钟课堂视频，播放器时长 1800.032 秒、510 段已保存转写、5 个知识点及 17 处已核对时间引用。没有重新上传媒体或调用 AI、ASR、Ascend。本轮验证的是既有真实产物在播放器中的使用效果，不代表完整识别流水线复验。

通过 `scripts/acceptance/real-playback-fixture.ts` 在原资料所有者名下创建临时资料，复制既有转写、知识点与整理笔记，只读共享原媒体对象，沿用浏览器已有登录会话。补充笔记和播放进度仅写入临时资料。验收前后对原资料及其转写、识别文字、知识点、整理笔记、个人笔记、闪卡/复习记录、练习/作答、播放进度计算指纹，结果一致。清理仅删除临时数据库资料及其级联记录，不调用媒体删除接口。

## 实际浏览器结果

- 点击“能量产生和使用的特点分析 · 4:44”后，播放器跳至 284 秒并播放；约 4:55 暂停后，重点与当前真实转写随时间更新。
- 在 4:55 开始输入补充，再跳到“第七题情境分析 · 9:20”保存，数据库 Note 仍绑定 295 秒，未错误绑定保存时的 560 秒。
- “全部重点 · 17”展示既有全部时间引用；切回“跟随播放”在 9:20 显示第七题重点。
- 刷新后实际播放器恢复 560 秒并保持暂停，媒体 readyState=4、error=null；“我的笔记”仍有 4:55 的补充，数据库进度为 560 秒。
- 窄窗口单列、1440×900 桌面并排布局可用。桌面文档宽度 1432，小于视口 1440；播放器、同步重点、补充入口无横向溢出。浏览器检查时 error/warn 为空。
- 修正“我的笔记”状态提示：视频使用“绑定视频时间点/已自动保存到视频时间点”，文档仍使用页码提示。未改交互逻辑、API、数据字段或依赖，既有设计规范已包含此区分。

截图：[真实视频学习页](real-playback-20261008.jpg)。持久化读取证据：[verify](real-playback-20261008-verify.json)；最终清理证据：[cleanup](real-playback-20261008-cleanup.json)，`sourceUnchanged=true`、`remainingFixtureContents=0`、`sourceMediaDeleted=false`。

## 复现入口

在桌面仓库已配置本机环境变量及数据库的前提下，使用独立 runId（小写字母、数字、连字符，8–80 位）：

```powershell
npx tsx scripts/acceptance/real-playback-fixture.ts setup <runId>
npm run dev
```

沿用来源所有者的登录会话，在 `/study/<setup返回的contentId>` 重复上述步骤，再执行：

```powershell
npx tsx scripts/acceptance/real-playback-fixture.ts verify <runId>
# 先离开临时学习页，避免继续写入进度
npx tsx scripts/acceptance/real-playback-fixture.ts cleanup <runId>
```

状态保存在忽略目录 `.taskbook-working/real-playback-<runId>.json`；脚本固定使用本次来源资料，需要该资料仍存在。不可通过产品资料删除接口清理这个共享媒体样本，也不可删除原媒体对象。重复运行会覆盖本报告同日期 verify/cleanup 文件，应在新验收前归档既有证据。

## 工程检查与边界

全量测试 78 文件/455 项通过，TypeScript、Lint 与 Next.js 生产构建通过。既有字体、img 和可选 Valkey 依赖提示保留。没有把本次成功视作所有视频的识别质量验收：另外 7 份旧视频缺少现有知识点或有效转写，完整长视频识别与生产 JWT 等已记录限制仍未解决。
