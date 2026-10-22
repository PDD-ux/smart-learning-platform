# §29.17 教师身份与班级权限验收（2026-10-21）

## 结果

- 桌面主仓库业务库只读盘点：`Classroom=0`、`AssignmentReview=0`、原教师账号=0。用户指定由本次新建教师接收管理员旧班级，但当前库没有可移交的旧班级；实际移交数为0，未修改任何班级负责人、成绩或附件。若旧班级位于其他数据库，先定位来源库，再按单班级显式移交设计处理。
- 新建本地演示教师 `teacher-demo@wenhao.local`，角色为`teacher`。随机密码只在被Git忽略的 `.taskbook-working/teacher-account-20261021.json`，不在本报告、仓库代码或日志中显示；bcrypt校验通过。账号没有班级。
- 临时启动127.0.0.1:3101真实网页，密码登录200，返回`role=teacher`及`redirect=/classes`；携该账号令牌读取`/api/classes`200、`canCreate=true`；访问`/api/admin/users`和`/api/admin/attendance`均403。临时服务已停止，不影响既有3000端口。
- 隔离真实PostgreSQL：`classroom-workflow.ts`64项通过，覆盖教师创建/他教师隔离、旧管理员本人班级可读且不能新建、学生加入、章节任务与旧JWT越权；`assignment-workflow.ts`59项通过，覆盖教师正式提交看板、草稿保密、退回重交、批阅、附件和其他管理员拒绝。两份隔离测试库已删除，原业务库摘要与环境文件未变。
- 定向7文件80项、全量192文件1738项、TypeScript、ESLint、Prisma schema validate均通过。全量后增补共享课程关联账号删除与旧管理员班级列表回归，相关2文件24项复验通过。`npm run build`成功，保留BullMQ对可选`@valkey/valkey-glide`的既有解析告警。

## 范围和后续

教师专属`/teacher`页面和管理员导航分离归§29.18。当前教师暂经`/classes`进入，正式批阅后端权限已验，教师专属页面尚未验。当前`AssignmentReview(classroomId, reviewerId)`复合外键约束旧负责人；若将来其他库有已批阅旧班级，需要先做保留历史reviewerId的窄迁移，再执行受控单班级移交，不能直接覆盖负责人。
