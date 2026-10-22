# §29.4 班级课程与作业数据/权限基础验收

完成日期：2026-10-19。实际目录：`C:\Users\qwh76\Desktop\智能学习平台`。范围以spec/28-CLASSROOM-FOUNDATION.md为准，本次只执行29.4。

## 已交付

- prisma/schema.prisma：新增十个独立实体与六个枚举，User/SharedCourse只加反向关系。迁移20261019053000_classroom_foundation只新建表/索引/外键/CHECK，不更新或删除原业务行，不复用旧试卷、练习、笔记或人脸数据。
- src/lib/classrooms/rules.ts：输入长度、附件白名单/单个20MiB/最多5个及总50MiB、确定性私有对象键、128bit随机邀请码/SHA256、期限/撤销/限次、提交状态/严格截止和revision规则；JSON摘要256KiB覆盖完整中文正文。格式、预算、数量及无效JSON规则分开验。
- src/lib/classrooms/access.ts：当前DB身份与班级成员/负责人权限，章节/任务发布范围、本人提交历史及草稿字段分离、最新尚未批阅版本的负责人授权、附件就绪/冻结/归属授权。学生无同伴作业权限，另一管理员也无全局旁路。已发布共享课需已准备和授权，撤回后不再提供学习链接；不改共享课本来的访问范围。
- 既有管理员删号接口：先锁目标User并核对班级关系再清理照片/账号，关系存在返回409 CLASSROOM_CONFLICT；没有班级关系的原成功/照片清理503行为保留。默认保留成员/提交历史，不提供自动硬清理。

只读服务提供后续路由复用，本次没有班级HTTP入口、创建/加入/发布页面、上传/签名下载端点或自动清理任务。正式写操作的班级锁、CAS、幂等、提交固定版本和批阅同事务要求已定义，尚属29.5/29.6实现范围。

## 工程与真实数据库验证

最终命令：

```powershell
npm test
npm run type-check -- --incremental false
npx eslint --no-ignore src/lib/classrooms src/lib/api/errors.ts "src/app/api/admin/users/[id]/route.ts" tests/unit/classrooms tests/unit/api/admin-users.test.ts scripts/acceptance/classroom-foundation.ts --max-warnings=0
npx prisma validate
npx tsx scripts/acceptance/classroom-foundation.ts --apply-local
```

- 全量184文件/1697项通过，新增34项规则测试和3项关联删除保护。非增量TS、改动文件显式lint、Prisma schema校验通过。
- 实际临时PostgreSQL数据库应用全迁移，使用一名负责人、另一名管理员、两名学生和外班成员；67项检查通过。包含草稿/未发布内容不泄露、跨班/同伴/其他管理员404、数据库角色撤销、退出/移除后仅本人正式历史、归档只读、已批阅/旧版本拒绝、真实0分区别于未知、授权附件与过期草稿、邀请码限次、同班复合FK、CHECK/唯一约束、CAS和幂等前提。
- 第一次隔离阶段60项通过且未应用本地；补正式0分/已批阅拒绝、User历史保留和未准备共享课边界后，最终67项通过并复核本地迁移。暂存报告为.taskbook-working/classroom-foundation-20261019/report.json；失败会覆盖为FAILED，不复用旧成功报告。脚本默认仅隔离验收，显式--apply-local才在隔离通过后执行本地部署；无reset。
- 隔离库名由安全前缀及随机UUID生成，与主库明确不同；disconnect后仅清理这个受控名称，最终确认清理完成。临时数据只在临时库，演示库十新表均为空。

CAS、邀请用量和幂等使用真实并发/唯一约束核对基础能力，未实现业务写API，不将这些基础检查称用户已经完成加入、提交或批阅。

## 本地保护与运行恢复

- 演示库原45张业务表逐表行数及排序行内容MD5摘要前后一致（包括原用户/成绩/人脸等表），.env和.env.local的SHA256摘要一致；新增10表为空，现有业务表总数55。只记录摘要结论，不输出私人正文、照片、向量或凭据。
- 迁移SQL事务内仅新增对象；没有旧表/历史迁移文件的DDL/DML修改，没有云端数据库更新。User删除相关代码经模拟存储回归，本项未对真实账号、人脸照片或媒体发起清理，不声称做了媒体全量字节审计。
- 首次生成遇EPERM，确认3000端口PID及父进程均属于桌面主仓库Next，停止这两个进程后generate成功，并以相同dev参数隐藏恢复。没有停止数据库、人脸、推理服务或其他项目进程。
- 恢复后实际GET /login为200，匿名DELETE /api/admin/users/classroom-foundation-nonexistent为401 UNAUTHENTICATED。未使用用户凭据进行真实删号或人脸采集。

## 未覆盖与下一项

未进行生产构建、Docker/公网/远端部署、班级页面浏览器验收、真实附件上传下载/清理或AI/OCR/NPU调用。冻结提交与评语的追加规则为后续业务服务约束，不能只靠FK替代权限/截止/最新版本/CAS；数据实体存在不代表班级模块可以演示。

下一编号29.5：负责人创建管理班级、邀请码加入、章节和任务发布的真实页面/接口。29.6提交/批阅/退回/重交及29.7–29.8智能批改保持待办。
