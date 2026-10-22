# §29.6 作业闭环验收（2026-10-19）

工作仓库：桌面主仓库。当前状态：2026-10-19 18:57完成，学生最终评分/窄屏及第二学生原生核对已补齐，29.6已勾选。仅本编号；29.7识别校对、29.8智能批改及新增教师角色均未实施。

## 18:57补验完成

正常localhost临时页恢复后，使用原验收夹具的新三账号/班级。新增`prepare-feedback`动作只允许明确本项负责人和新空任务，通过assignmentCommand/reviewSubmission实际服务保存、提交、退回、修改重交、人工85分，构造两版待展示数据；不直接插入伪造评分，不将本轮准备称再次原生点击整个提交链，先前原生提交退回链证据保留。

学生一从“我的提交与反馈”进入本人第二版，页面显示85/100、完整负责人评语；展开第一版能看到原正文和退回意见，未被覆盖。1440×1000及390×844实际scrollWidth分别1440/390，已查看截图确认无溢出，紧凑侧栏与版本反馈卡正常。学生二实际登录后，任务仅显示自己未提交、正文空、正式提交禁用；本人提交历史为空。直接访问已知学生一提交路径，运行中的Next API返回404，页面只显示“班级资源不存在或不可访问”，没有他人正文/评分。

新增证据：student-feedback-1440.png、student-feedback-390.png、student2-own-task.png、student2-empty-history.png、student2-peer-denied.png及ui-final.json，均位于原证据目录。仅验收夹具变更，本轮显式ESLint和非增量TS通过；业务源未改，不重复无理由的全量回归，原1720项/59项结果仍作依据。临时localhost页实际退出并关闭、视口reset，原127.0.0.1用户页未操作。独立localhost.页仍超时，未为此改Host/CSRF白名单。

本轮临时三账号/班级/提交版本/评语/操作精确清理、env保持。ui-cleanup.json的dataPreserved仍为false：仅FaceLoginChallenge由0增1，同期页面曾切回实际演示账号，保留该并发登录记录、不读取或回显人脸内容；其余54表完整摘要一致。前轮签到差异已另存ui-baseline-first.json/ui-cleanup-first.json，不覆盖首次证据，不把54表一致或分窗口隔离通过写成主库55表全程未变。该非本项表的并发新增未被删除以强行让检查变绿。

## 交付范围

先落spec/30协议并同步PRD、设计、架构、数据与视觉规格。沿用既有十表及admin/student角色，新建五个学生/负责人任务、提交历史与批阅页面，班级任务卡和列表提供入口。支持文字草稿、PDF/TXT/MD/PNG/JPEG真实字节附件、明确正式提交、不可覆盖的版本/任务快照、人工退回/重新提交/0–100整数评分和评语、当前成员及正式历史真实看板。

关键文件：src/lib/classrooms/{assignment-contracts,assignments,attachments,attachment-format,assignment-routes}.ts；src/components/classrooms/AssignmentWorkspace.tsx；src/services/assignments.ts；src/app/{classes,admin/classes}内作业页面及src/app/api/{class-assignments,class-submissions,class-attachments}；复用service/routes/access/rules授权。src/lib/storage.ts增加不可覆盖条件写及HMR缓存检查，src/services/api.ts支持原始File/Blob请求和成功Blob响应，next.config补服务端pdfjs追踪。不引入新依赖/迁移。

## 自动和隔离验证

- `npm test -- --reporter=dot`：188文件，1720项通过；本项新增11项，并更新原工作区/架构入口回归。默认并行，未调大超时或放宽规则。
- `npx tsc --noEmit --incremental false`、`npm run lint`通过。
- `npx eslint --no-ignore tests/unit/classrooms/assignments.test.ts tests/unit/classrooms/assignment-workspace.test.tsx tests/unit/classrooms/workspace.test.tsx tests/unit/architecture/p0-contract.test.ts tests/fixtures/assignment-jpeg.ts scripts/acceptance/assignment-workflow.ts scripts/acceptance/assignment-ui-fixture.ts scripts/cleanup-class-attachments.ts --max-warnings=0`通过。首次未加--no-ignore被默认忽略，未将其当检查通过，已显式重跑。
- `npx tsx scripts/acceptance/assignment-workflow.ts`：最终59项通过。新建随机前缀的本机临时PostgreSQL库并完整迁移、真实本地存储，核对结束精确清理；不向主库应用新迁移。覆盖草稿/CAS/幂等/教师与同学隔离、五格式上传/大小/摘要/并发不可覆盖、签名用途/过期、冻结与旧版本、截止/延期/任务修订、批阅并发、移除历史/角色变化/归档、附件单独提交、过期清理及失败删除墓碑重试。
- 含认证NextRequest/异步params路由对象及真实proof到字节响应检查；这是本进程真实数据库与路由对象验收，不能称全部由运行中的Next HTTP打通。

原始证据在`.taskbook-working/assignment-workflow-20261019/`：tests-final.log、type-check-final.log、lint-final.log、lint-scripts-final.log、report.json、real-final.log。最终report记录55业务表完整行摘要和环境一致，隔离数据库已清理，没有模型调用。

## 原生页面完成的实际操作

独立localhost测试源使用三个人工临时账号（负责人、学生一、学生二），不输入或修改实际用户密码。学生一从班级任务进入，保存原创函数正文、上传71字节原创TXT、勾选正式提交；浏览器下载成功，下载文件与上传文件SHA256一致。负责人看板显示2有效成员、1正式提交、1未交，正式提交详情退回“唯一对应/定义域”评语。学生一收到退回正文和评语，保存补充内容并明确重交第二版；第一版正文、附件和评语保留。负责人对第二版人工给85分及评语，状态已批阅，真实看板待批阅0/退回0/已批阅1。

1440×1000及390×844负责人批阅页截图已核对：scrollWidth分别等于1440和390，无横向溢出；暖纸色、版本/反馈卡与宽屏左右/窄屏堆叠保留。截图owner-review-1440.png、owner-review-390.png、owner-board-1440.png保存于证据目录。

首次失败保留：旧全局Storage实例缺putObjectIfAbsent导致上传503，按原配置重建后同意图重试200，无额外意图；下载proof曾误用hex64 schema导致400，改为真实base64url43；动态node:stream在实际网页仍503，静态Readable导入后HTTP200并核对下载字节。权限/条件写/大小检查没有关闭。

## 首次未完成的页面核对与恢复入口（18:57已补齐）

原生验收期间localhost页面切到了实际“演示学员”，显示18:36人脸签到，遂停止操作该会话，没有再次退出实际账号。尝试独立localhost.以及127.0.0.2:3001临时回环桥页面，CUA创建/读取连续30–60秒超时，未继续无限重试；桥已停止，临时视口已恢复。不把第二学生未操作或负责人页面显示评分当作学生最终评分页面通过。

当时计划仍收尾29.6：确认浏览器可读、运行fixture setup，补学生一评分/390px和学生二隔离，cleanup后再核销。此计划现已执行完毕，见顶部补验；首次ui-baseline.json/ui-cleanup.json在新setup前另存first版本，未覆盖差异证据。

复现：桌面主仓库执行`npx tsx scripts/acceptance/assignment-ui-fixture.ts setup`；如只补验反馈展示，再运行同脚本`prepare-feedback`，否则按原生提交批阅流程操作。用脚本中明确标注的临时账号，任务路径`/classes/assignments/qa-assignment-task-20261019`，负责人对应`/admin/classes/assignments/qa-assignment-task-20261019`。完成后退出临时会话并执行`npx tsx scripts/acceptance/assignment-ui-fixture.ts cleanup`。禁止使用实际账号的私人内容做测试或删除实际记录以匹配基线。

## 清理与保护

三临时账号、临时班级/成员/任务/提交版本/评语/操作/测试审计和精确固定键对象已清理，非递归清理仓库或媒体目录。两env摘要保持。长时间UI前后对比ui-cleanup.json的dataPreserved为false：仅AttendanceRecord由8增9，与页面实际账号签到相符，保留该行；其余54表行数及完整内容摘要一致。不能称这个时间窗口55表全部未变。清理后独立最终隔离验收的另一个窗口55表完整摘要一致，二者分别记录。

临时TCP桥进程已停止，原Next3000服务保留。没有从本项调用人脸、ASR、NPU或大模型，没有重跑原资料，没有更改密钥/实际用户身份或生产构建/部署。未完成S3/OBS真实故障验收、全像素JPEG解码或杀毒认证；附件结构校验不能代替这些验证。教师工作区仍需单独确认角色/权限规格。
