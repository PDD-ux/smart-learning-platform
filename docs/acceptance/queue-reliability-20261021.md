# §29.23 导入与队列可靠性修复

日期：2026-10-21。工作目录：桌面主仓库。按用户给定顺序修复工程巡检A1–A4；无新功能、npm依赖、表或迁移，不重训、不调用模型或批量改旧任务。

## 1. 入队失败不再留下不可重试的解析中

新增 `src/lib/jobs/dispatch.ts`，解析和理解入队统一走 `dispatchPendingJob`。队列异常时，在资料行锁内仅取消本次仍PENDING的作业，并仅当它还是同类型最新任务时回退资料状态。固定 `QUEUE_UNAVAILABLE` 映射503，隐藏队列原始异常/凭据；保留源对象，原complete或理解重试入口可继续操作。

若worker已认领或完成，取消CAS为0，不把资料或结果回退。理解作业创建和理解RUNNING更新放在同一事务；理解投递失败已补偿时，解析worker保留READY，不重复解析或删除派生结果。旧笔记保持。

本项不是跨数据库/Redis的持久化outbox；数据库本身故障导致补偿无法落库时不伪报恢复，也不自动批量改写本轮前已存在的孤立任务。

## 2. 上传确认只允许一次状态认领

`complete/route.ts`在事务内按id、ownerId和PENDING/UPLOADING/FAILED状态 `updateMany`，只有count>0才创建AsyncJob。竞争失败409 IMPORT_IN_PROGRESS且不入队。前置校验继续提供友好错误，但不承担并发互斥。注册worker在事务前完成，初始化异常不会留下PARSING。

## 3. worker必须认领成功，正常重试仍可执行

`runStage`直接检查原子startJob返回值；false立即退出，认领数据库异常直接抛回队列，不再降级执行业务。stage更新也进入受保护try区，非终次失败通过新增retryJob将本次RUNNING恢复PENDING，正常退避重试能再次认领；终次失败仍FAILED。无asyncJobId的历史入口保持。

未新增自动回收进程崩溃后RUNNING作业的租约/心跳系统，不宣称外部模型调用或全流水线恰好一次。遗留崩溃任务须另行核对，不能直接清空全库RUNNING。

## 4. Docker显式包含视频工具

builder（worker继承）和runner的apk安装列表增加ffmpeg，构建期执行 `ffmpeg -version && ffprobe -version`。部署/技术选型说明同步，无需挂Windows二进制；原Poppler保持。

**当前Docker daemon未运行**，`docker info`报 `dockerDesktopLinuxEngine` 命名管道不存在。Dockerfile契约测试通过，但没有本轮镜像构建、Linux容器视频探测/抽帧/抽音轨实测证据。Next生产构建不能代替容器验证。

## 验证

- 全量：197个文件、1793项测试全部通过，0跳过；最终定向5文件42项通过。
- 类型、严格源码lint、Prisma schema校验通过；改动文件diff空白校验通过（仅CRLF提示）。没有把全仓原有其它文件空白告警称为已解决。
- 真实PostgreSQL专项8项通过：入队失败503/保留源键/重试、并发两请求200+409/单作业、两个worker只执行一次、非终次错误后正常重试、认领后丢失应答不回退、完成后丢失应答不回退、理解失败保持READY且原接口重试、旧作业迟到失败不覆盖新状态。
- SQL专项调用真实路由函数、真实Prisma/事务/数据库，**队列和文件metadata受控替换**，不是Redis网络断连测试或真实视频上传测试；无文件对象写入、模型调用或业务资料重跑。临时用户及级联资料清理断言均通过。
- 单元专项另覆盖认领数据库失败不执行、stage落库失败释放重试、补偿数据库失败不伪报恢复、输出脱敏、解析READY不因理解投递失败变FAILED。
- 独立生产快照构建、standalone及真实HTTP登录/本人资料/匿名401/学员管理员403/退出通过；临时账号、快照和3100端口已清理，未使用修复密钥参数。
- 本机主目录生产包随后重新构建通过，按已核对PID停止旧3000进程并启动新包；会话与数据库配置保持。独立复核queue-audit临时用户0、资料0。新启动仍沿用现有`next start`入口，有output=standalone提示；没有借此改写本机存储/ASR相对路径或切换运行目录。

## 复现入口

```powershell
npx vitest run --maxWorkers=4
npx vitest run --config scripts/acceptance/queue-reliability-vitest.config.mts
npm run type-check
npm run lint
npx prisma validate
```

数据库专项需要本机已有测试可用数据库，只创建 `queue-audit-<UUID>` 隔离用户及其资料；队列和文件metadata在测试内替换，测试结束删除该精确用户并核对清理。不要把它当作线上压测工具。

原始JSON/日志在 `.taskbook-working/engineering-audit-20261021/`：`fix-all-tests.json`、`fix-final-focused.json`、`fix-database.json`、`fix-production/production.json`及对应构建日志。初次测试因旧mock未提供事务/CAS/布尔认领而失败，已更新为当前真实契约；新数据库配置初次启动的CommonJS导入及测试语法错误已修正，最终结果以以上通过记录为准。

§29.11真人/三角色整链、§29.21正常公网DNS下新视频直链，以及开发依赖告警治理均不因本项核销。四处缺陷的代码修复完成，Docker实际环境验收明确留待引擎可用时执行。
