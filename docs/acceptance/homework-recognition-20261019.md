# §29.7 作业正文识别与本人校对（文字/PDF阶段）

日期2026-10-19，桌面主仓库。用户确认ModelArts尚未启动，先使用文字/PDF校对；本阶段完成，图片真实OCR候选仍未通过并拆为29.7.1。29.8智能批改未实施，没有真实语言模型请求、分数或正式成绩写入。

## 实现与范围

协议先落spec/31-HOMEWORK-RECOGNITION.md；新增HomeworkDraft表与20261019110000窄迁移，User只加反向关系。src/lib/homework/{contracts,extract,service,routes}.ts提供严格校对字段、实际提取、本人服务和私有路由，src/app/api/homework及/:id只绑定认证适配器；services/homework.ts集中前端HTTP和4MiB文件编码。HomeworkWorkspace及/homework、/homework/:id提供列表、导入和原文/逐题校对两栏，侧栏/帮助和本人已交版本提供入口；next.config补PDF服务器追踪。

支持粘贴文字、TXT/MD严格UTF8、PDF文字层（最多20页）、本人正式班级版本正文或明确单附件。原文件只用于当前内存提取，不新存媒体对象；保存来源名称/MIME/大小/摘要、原文、缺页/低置信提示与本人逐题内容。图片接已有网关，mock/降级/空字不算成功，当前不可用明确失败，可对照原件手动录入；复杂手写公式、扫描PDF OCR和语义答案自动分离未承诺支持。

仅当前student可读取/处理自己的记录，负责人无私人校对旁路；服务端读取本人冻结版本、附件绑定/键/摘要复核。独立草稿不改班级版本、评语或成绩。每人100记录含归档、每记录100写操作、90秒处理租约与迟到拒绝，创建完整摘要幂等、保存CAS/同键核对、事务审计。确认须1–20题唯一题号、题目/答案、参考答案或评分依据及逐题/总确认，确认后冻结；依据是本人提供，未冒称权威校验。

## 自动检查与真实隔离

- `npm test -- --reporter=dot`：190文件1728项通过，净增8项；默认并行，未放宽超时/安全门槛。
- `npx tsc --noEmit --incremental false`、源码ESLint与新改测试/验收脚本`--no-ignore --max-warnings=0`通过。
- `npx tsx scripts/acceptance/homework-recognition.ts`：最终33项真实隔离PostgreSQL与认证NextRequest路由对象通过，随机临时库完整迁移后清理。文字三格式、坏文件/UTF8、私有读取/DB角色变化、幂等/CAS、空题/缺依据/未核对拒绝、冻结/归档、90秒过期/迟到、本人正式版本/真实附件与移除后历史均覆盖。控制提取适配器仅测试重试一次与迟到，未称真实OCR。
- 实际21页PDF拒绝、不静默取前20页；两页真实PDF的第2页无文字警告保留。mock健康和fallback即使返回貌似文字仍拒绝，低置信阈值0.85单独回归。
- 首次带`--apply-local`运行29项时保护原55表/env并应用唯一新增迁移；最终纯隔离复验33项保护现56表/env，客户端已生成，`prisma migrate status`显示数据库已最新。没有db push/重置原库。

原证据目录`.taskbook-working/homework-recognition-20261019/`包含tests-final.log、type-final.log、lint-final.log、lint-explicit.log、report.json、migration-status.log、ui-cleanup.json及真实服务诊断。源码/测试和验收脚本都实际检查，不把默认忽略scripts/tests当通过。

## 原生页面

临时学生一用原创函数文字实际创建，添加一题、填写题目/答案/参考答案和依据、逐题勾选、保存、总确认并冻结；原文字不变，确认后编辑禁用、确认勾选保持。1440×1000原文/校对分栏；390×844堆叠，scrollWidth1440/382，均不超过视口。全页截图一次失败后改实际视口截图，并核对图像；临时视口已reset。

从本人班级已交第2版“校对本版正文”进入，明确创建后副本的正文/第2版来源与原提交一致，未复制负责人评语当作学生答案。实际上传原创PNG，页面显示识别未完成/可手工补录，没有虚构文字。第二学生真实登录，本人列表为空，已知第一学生校对路径API404，页面不显示他人正文或题目。首次切换第二账号401后在稳定登录页重填临时凭据成功，不将第一次登录当通过；未修改登录业务。

截图：correction-1440.png、correction-390.png（确认后的当前视口），class-version-source.png、ocr-blocked-page.png、peer-empty.png、peer-denied.png。临时会话已退出关闭，原127.0.0.1用户页面保持。

## 真实OCR阻塞证据

`npx tsx scripts/acceptance/homework-ocr-diagnostic.ts`使用Next已有sharp生成原创中文作业PNG，仅作验收工具，不新增项目依赖。既有网关/health返回InferError / INFER_UNAVAILABLE / 503，ocr-diagnostic.json明确BLOCKED；未获得真实图片文字，不能称训练或OCR效果通过。

读取已有受校验连接配置，SSH BatchMode/严格主机键/8秒连接上限，在12秒进程限时内未就绪，未输出凭据；独立TCP探测保存目标5秒连接超时，见ssh-probe.json/tcp-probe.json。未启动/变更ModelArts资源、推理服务或连接配置。用户明确确认“尚未启动，先使用文字／PDF校对”，因此图片复验延后29.7.1，不要求为当前阶段开启付费NPU。

恢复云端后运行同诊断，须同时验证原创文字准确性和低置信处理，再核销29.7.1。不能仅health在线即标图片验收通过，也不能把本地文字校对等同全OCR能力。

## 首次失败与保护

新增导航/帮助入口后，原测试固定3链接/6帮助卡的期望已对齐新增真实入口并保留href核对；架构适配器检查曾误放在源类型检查循环，已移回认证路由检查，类型检查不跳过新模块。冻结表单HTML fieldset禁用继承，测试改核对fieldset语义，真实浏览器已确认编辑器禁用，没有为断言改业务允许编辑。隔离附件夹具曾用过期时间早于创建时间违反既有CHECK，改用合法创建/过期组合，未放松数据库约束；首次failure.json作为历史保留，最终复验通过。

临时三账号、班级/正式版本/评语、3条校对记录（文字确认、图片失败、班级副本）、相关操作/审计已精确清理；HomeworkDraft随仅这些测试账号cascade删除。清理后56表行数/完整内容摘要及两env与本次UI基线一致，无需删除任何真实签到或人脸记录。隔离存储对象按确定键删除，原媒体未重跑/改写，未作全媒体字节哈希认证。

复现页面夹具：`npx tsx scripts/acceptance/homework-ui-fixture.ts setup`，可选同脚本`prepare-feedback`准备本人已交版本；使用脚本内明确临时账号，在/homework完成校对。结束退出测试会话，再执行同脚本`cleanup`并核对摘要。不要使用实际私人资料、删除实际账号或覆盖旧失败证据。无生产构建/部署、新语言模型、ASR或人脸调用。

## 20:02追加：用户启动云端后的真实图片复验（29.7.1完成）

上文离线证据为19:36阶段历史，未覆盖。用户启动Notebook并提供31637后，SSH旧记录提示主机指纹变化；按用户提供的连接方式建立独立known_hosts接受新键，保留旧文件，不关闭全局校验。910B4健康OK，已存Python/模型目录可用。复用run-ascend-demo.py（3600秒），既有源码上传/远程监督/回环转发，停止已核验本仓库Next父子PID后恢复网页。未启动新云资源/训练/调用ASR或文本模型，env/JWT未改。冷启动约219秒，readyAtUTC11:56:11；本次控制器预计20:52结束。

ocr-restored-health.json记录Ascend、MindSpore及四模型/词典已加载、mock=false、OCR后备/Tesseract关闭。新增homework-ocr-http.ts使用临时学生正常登录，通过实际网页POST上传原创PNG，1642ms返回DRAFT/source.method=ocr；同键重放id/revision/rawText一致。没有输出/持久化令牌。报告ocr-http.json、ocr-http-replay.json；先setup临时夹具→该脚本→cleanup。新控制器令牌仅在网页子进程，独立CLI加载.env的旧令牌不等同当前网页配置，因此本次使用实际网页认证HTTP链路验收。

返回“.什么是函数”等正文，原题号1漏识别且长句断行。函数/唯一对应内容可读，不代表完整准确率：报告明确PIPELINE_PASSED_MANUAL_REVIEW_REQUIRED、originalQuestionNumberPreserved=false、fullAccuracyVerified=false，没有循环改图刷通过。两条OCR风险/低置信警告真实显示。原生临时学生手动补齐题号1/题目/答案/参考答案/课堂依据→逐题勾选→保存→总确认冻结。DB复核CONFIRMED、原文不变、题号1、reviewed=true及两警告仍在，见ocr-ui-confirmation.json/ocr-real-corrected.png。此前失败恢复为新建成功记录，旧失败不自动覆盖。29.7.1仅完成真实链路与人工校对的有限范围，自动题号准确率、扫描PDF、复杂手写/公式、AI批改未称通过。

新HTTP脚本显式lint和非增量TS通过；无业务代码新增改动，1728项/33项为29.7业务回归依据。三临时账号/班级/本轮真实校对与审计精确清理，56业务表完整摘要和env一致，见ocr-ui-cleanup.json；临时原生页面退出关闭。保存连接仅更新非敏感knownHostsPath指向独立记录，旧记录保留，密钥/env未变。下一29.8，未提前实施。
