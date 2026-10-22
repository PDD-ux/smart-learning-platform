# §29.7 作业识别与本人校对

本项仅交付第三核心的输入和校对，不调用语言模型、不产生成绩、不改正式班级提交/批阅。沿用student/admin；仅当前student可处理本人输入或本人已交版本，负责人不能借此读取学生草稿。29.8在已确认的快照基础上另行实施批改。2026-10-19用户确认“尚未启动，先使用文字／PDF校对”：29.7按文字/PDF阶段核销，真实图片OCR复验单列29.7.1，不因云端未启动强制开启资源或阻塞文字范围的后续批改。

## 输入与识别边界

入口/homework，导航称“作业识别”，明确“先校对，AI批改下一阶段”。个人可粘贴≤50000字正文或上传一个TXT/MD/PDF/PNG/JPEG，文件≤4MiB，JSON流≤6MiB，实际扩展名/大小/结构严格核对。原文件仅本次内存提取，不新存媒体对象；持久化文件名/MIME/大小/SHA256和提取文本，页面提示本人保留原文件。禁止URL/任意本机路径导入，不重新消费原视频/ASR。

也可从本人/classes/submissions/:id已交版本选择“校对本版正文”或“校对本附件”，显式选择版本/单个ATTACHED文件。服务器复核当前student和版本studentId=actor，附件必须绑定该版本且固定键/摘要/字节一致；退出学生仍只处理本人正式历史。服务器取源，不接收客户端伪造正文/对象键。不会自动处理负责人评语、同学作业或其它私人资料。

TXT/MD严格UTF8；PDF仅文本层，最多20页，超过则明确拒绝、不静默截前几页，扫描缺字页明确列出待人工补录；PNG/JPEG复用已有真实OCR网关，单图30秒。mock/降级/空结果不得算识别成功；不自动开通云OCR或改推理配置。真实OCR可用性须另外留证，无法运行时保留失败和可复现入口，手工校对流程可用不等于OCR通过。全部提取文本≤50000字，超过拒绝；图片结构检查沿用29.6，不称复杂公式/全手写支持。

## 数据、权限与并发

新增独立HomeworkDraft：id(UUID，客户端生成)、ownerId(User FK cascade)、title≤100、createDigest、source(JSON白名单快照)、state(PROCESSING/DRAFT/FAILED/CONFIRMED/ARCHIVED)、revision≥1、rawText≤50000、issues JSON、questions JSON、operations JSON、leaseExpiresAt可空、createdAt/updatedAt。无旧试卷/练习复用，无原表字段重写；User只加反向关系。状态/revision/文本长度由窄迁移CHECK限定。

创建先锁User复核角色/每人最多100条含归档，再按id核验所有者和完整输入摘要；同ID同输入只返回已存在记录，不重复OCR，相异409。PROCESSING租约90秒，网络不持DB锁，完成时再次复核当前角色和处理状态/租约，迟到不写。过期由本人读取/命令标FAILED，失败不自动重跑；新一次识别需本人明确重新创建。输入文件字节不落库、不记日志；审计只记owner/object/action。

保存/确认/归档需requestId UUID、expectedRevision；锁User→HomeworkDraft，完整输入摘要幂等先于CAS，操作日志最多100条不截断旧键。CONFIRMED和ARCHIVED不可改，确认后再次修改需新建记录；批改将来只消费冻结CONFIRMED快照。归档不删除源/历史。其它student、负责人、角色改变均404。所有响应private/no-store、当前DB身份复核，不能依靠JWT旧role。

## 逐题校对

原文左栏，右栏人工维护1–20题；不猜OCR文字中哪里是题目或学生答案。每题number(≤20字符且唯一)、type(choice/truefalse/short)、prompt1–4000、answer1–2000（未作答须明确填写）、referenceAnswer≤2000、basis≤4000、reviewed boolean。draft允许不完整，确认须每题题目/答案非空、明确参考答案或评分依据至少一种、本人逐题reviewed并总confirmed:true；复杂公式/不清晰内容须先人工补成可核对文字，不宣称自动理解。

修改任一题字段即清除该题reviewed和总确认，新增/删除题亦清总确认。先保存再确认，未保存不得确认；保存失败保留输入/相同幂等键，busy防双击，写后重读失败先重读，不自动覆盖。来源rawText只读，人工校对文字与原识别分开，低置信/缺页/失败提示一直显示，不伪造概率。确认只表示用户核对完整，页面不显示AI分数/送批改按钮。

## 接口与验收

GET /api/homework?page=1本人列表每页20；POST创建{id,title,source}，source严格联合text(text)、file(fileName,mimeType,base64)、submission(versionId,attachmentId?)。GET /api/homework/:id读取本人白名单，POST动作save(questions)/confirm(confirmed:true)/archive，均含requestId/expectedRevision。JSON有界流，创建5次/分钟、写40次/分钟。GET来源不暴露原字节/存储键/凭据/操作摘要。

验收：三文本格式实际提取、扫描PDF缺页/超页拒绝、坏MIME/大小/UTF8、OCR真实或阻塞证据；本人来源/附件归属/角色变化、重试/CAS/过期迟到、确认门禁及冻结、隔离DB迁移/原表保护；原生学生创建/校对/确认、宽窄屏、两个账号隔离及临时精确清理。按上述用户确认，文字/PDF阶段可独立完成；图片OCR仍为未通过，需29.7.1恢复云端后用原创图片验收，不以mock称完成。

## 2026-10-19 20:02 图片复验追加

上述云端离线/待验为19:36阶段历史。用户随后启动Notebook并提供31637，复用现有有界脚本恢复服务。Ascend四模型加载、mock=false、OCR后备关闭；原创PNG真实HTTP与同键重放通过，原生人工补齐题号1/断行→保存→确认冻结通过，低置信与只读原文保留。原题号漏识别，因此只完成真实链路与人工校对范围，不声称全文准确率/复杂公式/扫描PDF或AI批改完成。29.7.1据此核销，下一29.8。
