# 本地源码交付包

§26.8，2026-10-15。该包只包含当前源码、配置样例、全部迁移、规格/原型、必要脚本/测试和文字验收记录，不包含演示账号、数据库、原三份教材/视频、上传文件、人脸数据、真实环境配置、模型权重或Python环境。代码包不是当前演示环境的完整备份。

## 重新生成

在桌面主仓库、已安装项目依赖的Node24环境运行：

```powershell
node scripts/delivery/package-source.cjs
```

成功后只在本机`.taskbook-working/source-delivery/<唯一目录>/`输出源码ZIP、对应暂存源码、delivery-report.json；不会上传、改库或清理原文件。可用`--output-dir .taskbook-working/自定新目录`指定目录，目录已存在则失败，不覆盖旧包。仅存在ZIP不代表通过，必须同时存在成功报告且`allEntriesDecompressedAndHashesMatched=true`。

收集Git已跟踪及未忽略的未跟踪文件，另外应用独立允许/拒绝清单，不依赖.gitignore单独保密。遗漏必要入口、迁移、spec或prototype，发现符号链接/本机真实长密钥/私钥正文会失败。原始验收图片/JSON/TXT、私有工具目录和二进制模型/原媒体均不导出，文字报告中的本机证据路径不代表随包附送。只读检查本机已有环境中的敏感值是否混入源文，不把密钥写进报告；这不是所有可能历史凭据的通用泄密保证。

ZIP内`DELIVERY-MANIFEST.json`列出每个源文件的路径/长度/SHA256。压缩后逐条解压读取、核对条目集合、长度与哈希，检查重复或越界路径；外部报告另给ZIP与manifest哈希。没有安装新的打包依赖，使用Node与Windows现有PowerShell/.NET压缩组件（优先PowerShell7，未安装时尝试Windows PowerShell；也可用`--powershell`指定准确可执行文件）。失败产物留在本机忽略目录排查，未标记为通过。

## 接收者使用

1. 解压后进入“智能学习平台”目录，核对报告中的ZIP SHA256，保留DELIVERY-MANIFEST.json用于逐项检查。
2. 安装匹配Node（推荐24 LTS），执行`npm ci --ignore-scripts`和`npm run prisma:generate`。仓库已有Next16/React19及CSS解析器修复，不能换用旧Next14锁文件。
3. 根据`.env.example`自行创建本机环境文件，设置新数据库/存储和本人的密钥，遵循DEPLOY。示例不是可共享的真实账号密码，生产密钥须满足现有校验。
4. 对指定的新数据库执行`npx prisma migrate deploy`，确认目标后再按DEPLOY初始化自己的管理员；不在已有学习库执行seed/reset或导入不明dump。学习者可从注册页建立。
5. `npm run dev`启动空库网站。`demo:check/start`针对原三份固定演示资料，新安装没有原数据库/媒体时其固定资料预检失败是正常边界，不应改归属或公开别人的教材来补齐。

模型权重/许可证、Python环境、PostgreSQL/Redis/对象存储按DEPLOY另行准备。原媒体与私有数据库只按[备份恢复说明](demo-backup-restore.md)在本人受控环境交接，不能和源码公开混发；有授权的自编讲义可重新导入。

目前运行依赖审计0，开发依赖仍有braces链7个受影响包且无官方补丁，详见[开发依赖验收](acceptance/dev-dependencies-20261015.md)。打包不代表修复该告警，也不替代异机安装、Docker/公网部署、在线AI质量或本人录屏验收。
