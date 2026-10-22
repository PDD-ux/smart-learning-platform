# §23.8 原文精选新版本生产构建复验

完成时间：2026-10-13 19:55，桌面主仓库。仅对§23.7最终代码复验，不部署公网。

## 结果

使用现有production-demo-smoke.cjs --watched-notes，复制当前源码及实体依赖到系统临时快照，next build通过编译、类型检查及lint阶段。standalone监听127.0.0.1:3100启动成功，随看接口编译产物存在，真实PostgreSQL和HTTP检查通过。

- 临时学习者登录200，响应Cookie带Secure/HttpOnly；本人资料读取200、匿名401、学习者管理接口403、退出200。
- 临时视频使用原视频一条实际转写，匿名随看401、非本人视频403、尚未结束来源400、其它视频来源400。
- 合法请求在测试子进程模型凭据禁用时503/AI_UNAVAILABLE；Note及GeneratedNote均未写入。
- 学习页HTTP200；旧/live-notes为307，Location正常指向127.0.0.1:3100/import，无查询参数。
- 既有内部ASR/worklet资源打包哈希匹配；未执行ASR或录音流程。
- 临时账号/视频/转写、3100服务及系统快照已清理。原3000/.next未替换，原学习数据与.env/.env.local指纹保持一致，没有轮换密钥。

本轮无业务代码、接口、字段、依赖或架构修改，无需重复§23.7的1024项测试。脚本node --check通过；生产构建本身包含编译/TS/lint。已有字体规则、复习rate Hook依赖、学习页img性能warning仍存在，不宣称零告警。没有新失败或放宽验收条件。

## 证据与复现

证据目录.taskbook-working/watched-extract-production-20261013：run/build.log、run/production.json、run/retired-entry.json、protection.json。production.json最终三项临时清理标志均true；protection.json三项原数据/配置保护均true。未公开凭据正文。

```powershell
node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/watched-extract-production-repeat
```

须使用不存在的新输出目录，3100空闲、当前依赖和PostgreSQL可用；不要添加--repair-local-secrets或--runtime-assets。本入口禁用测试子进程的星火/智谱/百炼密钥，不影响原env或运行中3000服务。

## 验收边界

这是新版本生产构建及HTTP/数据库前置、错误处理验收。actualModelGenerationTested=false、actualProductionBrowserPlaybackTested=false；模型成功生成和实际浏览器播放已有§23.7开发环境证据，不能冒充本次生产成功请求。Secure Cookie的HTTP响应标志通过不代表公网HTTPS或浏览器认证部署完成。Docker/Linux、公网HTTPS、生产浏览器实播、全30分钟连续及语义/ASR准确率仍未验。

无TODO补全；TASKS/PROGRESS只新增非TODO本轮完成记录，不改产品范围或其它契约。
