# 文豪智能学习平台（MindSpark）· 视觉与交互设计规范（SPEC）

## §29.19 教师课程中心（2026-10-21）

教师总览的第一屏以“我的课程”卡片为主体；卡片标题、进行中/已归档、有效学生、任务、待批阅及“进入课程空间”层级清楚，不用装饰性数据。网格使用`repeat(auto-fit, minmax(min(100%, 270px), 1fr))`，桌面自然扩列，窄屏一列；卡片中的文字链接至少44px。

教师课程详情页签顺序为课程概览、课程章节、学习任务、学生与设置；概览的真实计数链接到相应内容，不生成图表或未实现的教学功能。侧栏统一称“我的课程”；“课程资料”仅指授权共享资源。继续使用暖纸背景、奶油表面、细描边和系统蓝色主操作。加载、错误、空课程、已归档状态使用可读文字，避免错误时展示虚假0。

## §29.18 教师工作区与管理员功能分离（2026-10-21）

教师页面复用系统暖纸张背景、卡片边线和蓝色主操作，不另造高饱和品牌色。桌面侧栏有“教学总览、我的班级、作业批阅、授权课程资料、打卡与人脸”，页头显示教师昵称与退出；总览以真实本人班级/任务/待批阅数字和可直达列表为主。空班级、空任务、空待批阅分别提供符合顺序的下一步，接口失败给重试且不显示虚假的零。待批阅只显示任务摘要，进入任务后查看正式提交。

班级/作业页沿用原创建、邀请码、章节、附件、草稿、提交和批阅布局；教师端链接始终保持 `/teacher` 前缀。教师 `/teacher/attendance`复用学生的人脸模板与打卡页面，返回教师工作区；管理员登录说明提示仅使用密码，管理员不开放人脸接口。管理员侧栏保留平台管理、用户、全站签到、讨论治理，旧班级入口清楚命名“旧班级兼容入口”；共享课程管理页仅显示已发布课程治理和下架操作，不显示授权准备或发布表单。学生页面保持原布局。

移动断点下教师导航两列，主体区域按总览→班级→任务顺序堆叠，无横向滚动，关键操作至少44px。提交或批阅失败保留输入和附件草稿，状态/错误紧邻对应操作。登录或角色检查中不闪现受保护内容；无权页面提供对应工作区返回链接。

管理员账号筛选和编辑弹层的角色含「教师」，延续纸张卡、44px点击区与原错误保留输入模式。管理员旧班级列表仅列本人历史班级；教师通过专属工作区管理本人新建班级。未执行旧班级迁移，现库无旧班级。

## §29.8 智能批改与错因订正（实施交互，2026-10-20）

沿用`/homework/:id`作业暖纸卡片，不新增批改中心。仅“本人已确认”时显示题目多选（每批最多8题）、发送给Spark Lite的明确说明与开始按钮；运行态提供取消和状态刷新。报告按题展示AI建议分、建议结论、逐字依据、错因、下一步提示和可读的不确定/冲突提示；严格规则比对单独标明“规则比对”，教师正式评分单独标明且此页不写入。订正表单清楚展示原答案，成功复核以新增历史呈现，不覆盖之前报告；失败保留订正输入并允许显式重试。

同一批次页面下方展示AI报告历史。`/question-bank`增加“作业错因（AI建议）”小节，按原作业来源呈现未解决问题，链接回具体报告；不与客观练习成绩混合、不生成假题。继续使用≥44px控件、暖纸卡片、错误/状态邻近操作，宽屏可并排、≤760px堆叠且不横向溢出；没有可展示报告或错因时用明确空态。

## §29.15.3 粘贴正文与学习主线统一（2026-10-19已实施）

学习中心在上传文件/公开链接旁加入粘贴正文，标题与来源说明必填、作者未知留空；预览纯文本后另行确认保存，不访问正文内网址或调用AI。严格POST /api/text-imports preview/confirm，实际请求≤512KiB、正文20–100000字/单段≤20000字/最多20000段，预览前12000字且标总量。User锁、账号命名空间UUID/输入摘要、同事务摘要审计与删除后键墓碑保护；文件确定键补偿核对成功行，失败留输入，同键重试不双写。无新表/迁移/依赖。

复用LearningContent TXT READY/NONE及BookState可选pastedSource（含内部requestId/inputDigest），BookView剔除此字段；resource、ReadingContext、专题SourceCoverage只公开pasteSource白名单，标明本人提供、来源未经原站核验。普通资源响应统一private no-store，原版本/笔记保留。目录先就绪、选段文字与AI各自确认；章节/专题导出保留本人来源和原文/批注边界，专题冻结标注。导入三个面板切换保留挂载/草稿，编辑清旧预览/勾选，保存失败复用原键；桌面左右/窄屏堆叠44px，提示导入→选段→笔记/摘录→专题提问/导出。粘贴不再显示旧整份理解未启动作为导入失败提示。

29.15三子项按既定原文选摘边界完成，不承诺自由改写/全文语义质量；Lite有一次页面2–3段输出校验失败，保留记录且未写假笔记，缩小2–2段独立确认通过。现行权限/预算/DTO/生命周期见[27-PASTE-IMPORT.md](27-PASTE-IMPORT.md)；工程/真实模型/公开HTML/页面与数据保护分别见[本项验收](../docs/acceptance/paste-import-20261019.md)。下一编号29.4班级作业数据与权限基础，未提前实现。

## §29.15.2 专题与范围问答（2026-10-19已实施）

学习中心内部新增“专题学习”/topics，阅读器当前选段可预填来源、明确保存后才提问；没有默认全部私人来源。独立StudyTopic表以本人owner/UUID幂等/revision保护，最多8来源、20专题/人、30问答/专题，归档恢复、冻结引用及MD/TXT导出（包含指定范围原有摘录/个人批注）。只检索BookState已提取单元或既有转写/OCR；1–20页段/最多600秒、每来源1000单元/50万字、总200万字，候选元数据每页50。预览显示覆盖/缺失/版本及最多8个400字逐字窗口；显式确认一次Spark Lite、45秒/2000token/3次每分钟，90秒租约，源变化/取消/迟到拒绝。逐字依据非自由综合推理，不把词命中/JSON当作事实质量全面通过；来源删除保留本人历史快照并标不可回看，管理员无私人越权。

接口GET/POST /api/study-topics、GET /api/study-topics/candidates、GET/POST /api/study-topics/:id，16KiB严格白名单/private no-store，当前账号与本人资料逐项检查；单JSON1MiB、导出2MiB，原表/笔记不迁移改写。桌面左右、窄屏紧凑导航/堆叠/页内跳转、44px操作；失败保留输入、改问题/来源清预览。无新增依赖/训练/其它供应商/班级共享。具体数据/动作/预算与验收见[26-STUDY-TOPICS.md](26-STUDY-TOPICS.md)及[验收](../docs/acceptance/study-topics-20261019.md)。29.15父任务仍未完成，下一29.15.3粘贴正文与主线统一验收。

当前型号追加修订（2026-10-18用户明确指令）：默认SPARK_MODEL=lite，保留星火凭据和其它配置。generalv3.5真实11200阻塞不核销；本轮Lite有界原文笔记验证另记，不称通用语义推理质量全面通过。此前型号记录作为历史保留。

## §29.15.1 章节原文笔记与摘录批注（当前实施）

本次只在已有BookReader中提供选段星火原文笔记、划选高亮/个人批注与标签、移除恢复及本页Markdown/TXT导出。BookState增加可选readingJournal，bookView剔除journal，原目录/正文/个人Note和GeneratedNote保持；同一User锁及bookRevision CAS合并，生成单次45秒/4500字/2000token、90秒租约和逐字位置校验，确认前不发送模型，失败不伪造摘要。新API GET/POST /api/contents/:id/reading-notes，本人隔离/private no-store、32KiB请求、每份100条/1MiB，严格动作/冲突/取消与幂等；详见[25-READING-NOTES.md](25-READING-NOTES.md)。专题/粘贴与跨来源问答留29.15.2/29.15.3，父29.15未完成。暖纸张卡、44px操作、纯文本mark与范围/实际引用提示；折叠保留挂载和草稿，切章不重绑已选摘录。

## §29.14 公开链接预览与确认保存（2026-10-18实施）

仅HTTP(S)默认80/443端口、公开静态HTML/直接PDF；不带浏览器Cookie/Authorization/Referer，不执行JS或加载文章子资源。DNS每跳验证全部IPv4/IPv6为公开unicast，连接固定本次批准IP并复核remoteAddress，禁止环回/私网/链路本地/元数据/保留/映射特殊网段；最多3跳且HTTPS不降级HTTP，绝对总下载30秒。仅identity编码，HTML≤2MiB/PDF≤10MiB，按实际流字节限额并核对Content-Length，不能只信声明。

HTML通过htmlparser2@12转纯文本Markdown，优先article/main并移除导航/脚本/表单/隐藏和嵌入资源；正文至少200字、至多10万字/5万节点/64层，拒绝登录/视频/网盘入口及高链接密度/没有可靠正文的页面。PDF用既有PDF.js目录/真实页数与前3页文本预览，不自动OCR或AI。预览最多12000字，明确实际范围，不能称全书理解。

新增UrlImportDraft：本人+requestId幂等，FETCHING/PREVIEW/FAILED/CANCELLED/EXPIRED/COMMITTED；最多3条活跃预览、6次新获取/分钟/用户，30分钟有效，缓存净化正文/PDF快照Bytes≤10MiB，原HTML不保留。新LearningContent.urlSource为不可变来源JSON：请求/最终URL、实际标题/作者/发布日期（缺失为null）、获取时间、原始/内容SHA256、前版ID。确认只读已缓存快照，不再次抓取。用户行FOR UPDATE串行确认/取消/重复判断，原content和引用不更新；相同请求返回同一个资料ID。对象键由草稿ID确定，数据库失败在同一用户锁下补偿，过期维护可复原处理孤立对象。

POST /api/url-imports {requestId,url}获取预览；GET/DELETE /api/url-imports/[requestId]读取或取消（已保存返回冲突，不删除资料）；POST /api/url-imports/[requestId]/confirm {confirmed:true,mode:reuse|new}复用相同URL+内容摘要的本人资料或显式新版本。private no-store；请求≤4KiB，字段/错误白名单，不回显任意网络/解析异常或向日志写URL查询串。管理员不越本人范围。

确认创建READY的MD/PDF资料及已有BookState，正文/AI覆盖仍从0开始，只在阅读时选段。预览是临时缓存不计资料、确认后原快照版本不可自动刷新；从原链接显式重新预览并保存新版本才更新，旧ID/笔记不重指。主学习中心加入文件/链接切换，预览须可读、可取消/重新核对；学习页显示来源与获取时间。无章节AI/粘贴/专题/班级或训练。过期在本人下次访问时清理，另提供有界维护脚本；未安装定时任务不能称自动定时清理。协议及存储生命周期见24-URL-IMPORT.md。


## §29.13 EPUB首版实施契约（2026-10-18）

在原学习中心文档入口支持EPUB，≤50MiB。服务端验证ZIP中心目录/本地头、CRC、压缩方式、路径和预算，ZIP64/多盘/加密/DRM拒绝；不解包到磁盘、不读取包外文件。最多2000条目、单条4MiB、累计解压32MiB、压缩比200、XML深度64/10万节点、正文200万字/2万段/200个spine项目，每段≤2万字，超限整次失败而非截断成功。仅文本层阅读，不支持复杂排版/图片/公式呈现；不加载远程资源或执行脚本。

读取container.xml→OPF manifest/spine，导航EPUB3 nav优先、兼容EPUB2 NCX，真实锚点映射到全局稳定段号；无可靠导航明确按spine阅读顺序，未解析目录不猜。新增BookState.format=EPUB与epub-nav/epub-spine来源，复用已有BookState JSON/CAS与20段选取、50万字保存预算，无迁移。书籍上传验证后READY且自动建立目录；units仍空，选定范围后才保存正文，不入全书TextBlock或自动UNDERSTANDING，AI仍NONE。首版章节AI留29.15。

ContentRef沿用document+page=1+blockIndex（全书从0开始的稳定段号）兼容信封，EPUB不展示/推断固定页数，pageCount=null；ContentSummary仅EPUB增加可选format=EPUB，笔记接口以BookState.unitCount核验page=1和必需blockIndex边界，不借假页数通过校验。手工目录修改不改变段号；源哈希变化拒绝提取，需新资料ID重新导入。章节内位置可由目录范围对应；书签/引用/个人草稿与旧PDF/TXT/MD保持。EPUB笔记隐藏无意义页码编辑，明确全书段号；原始EPUB不放iframe。

仅新增saxes@6.0.0（ISC）严格XML事件解析及其xmlchars依赖；拒绝实体/外部DTD，仅允许不含外部标识的DOCTYPE html，解析错误统一固定提示，不输出书内路径/文本。ZIP采用Node zlib有界inflateRawSync与crc32，不引入ZIP解包器。详见23-EPUB-READING.md，URL/专题/章节AI均不在本编号。


§29.12书籍阅读：沿现有暖纸张卡片，在阅读区内部折叠目录/校订及书签，正文保持原宽度，不增加侧栏。页/段范围、提取、续读、书签控件≥44px，长标题换行，窄屏堆叠；已处理、有文字、待OCR用真实计数和文字标签。TXT/MD正文按原段落纯文本呈现，不执行Markdown HTML/脚本；PDF保留原页图。错误role=alert、成功role=status、加载不冒充0；校订草稿和原个人笔记区不随切章清空。

§29.3试卷旧地址：单张暖白纸张说明卡、深墨标题“试卷功能已下线”，具体说明保留数据但不提供在线查询；学习中心/工作台两个真实链接≥44px，键盘焦点清晰，内容max-width而非全屏蓝底。只显示公开说明，不带试题/答题/批阅控件或自动跳转；窄屏自然换行。不使用依赖账号读取的壳层，避免下线页触发旧业务。

§29.2导航收敛：学习者侧栏仅工作台/学习中心，保留奶油纸张、深墨文字及局部品牌强调，不改全站宽度。学习中心辅助入口使用旧名称“我的笔记 / AI 学习助手 / 练习与复习”，练习与复习子区显示“练习题库 / 复习巩固 / 知识图谱”；工作台二级入口显示“我的学习 / 学习计划”。使用可换行flex、min-width:0、44px点击高度，aria-current与细边框/浅纸张高亮，不仅依赖颜色；手机纵向自然增长，不使用固定底部栏。账号区仅昵称/身份，不再显示XP/等级；知识图谱沿用现有纸张卡及单列/双列可收缩列表，去除画布/小地图。权限、数据和原草稿状态不随视觉调整清理；新模块未实现不挂占位项。

§27.9最终窄屏修正：仅自主组卷页复用AppShell compactNavigation，640px以下保留64px图标导航，390px主阅读区318px；桌面保持完整侧栏。1280/900/390实测无横向溢出，主要控件≥44px。

§27.9 自主组卷沿student-exams暖纸张/细边框/轻底部阴影，非整页蓝底。宽窗口范围与蓝图双列，1100px以下单列，540px以下配额与字段单列；候选长文换行、折叠预览限高65vh，来源年份未知明确。所有主要按钮/输入/summary至少44px，勾选行44px、键盘焦点可见。进度用实际合格比例和柔和绿色，不以动画伪装模型进度；加载/失败/空/真实0分开。

§27.7复核：成绩页错题与待批使用不同文字状态，显示冻结题干/选项，保留暖白纸张和44px操作。批阅得分空白与显式0分区分，主按钮显示本次选中题数；最终成绩冻结后字段及提交禁用，写入期间也禁用重新读取，失败role=alert且不清输入。题源记录无真实授权跳转时只说明名称/年份/适用版本。

§27.6 作答沿用暖白纸张与局部品牌蓝；选项整行可点且52px高、radio/checkbox有文字标签，主观多行文本有10000字上限。答题卡文字状态与当前题描边区分，不仅依赖颜色；宽屏目录/正文双栏，1100px以下单栏，目录限高。未保存/失败/交卷未确认用明确文字，成功role=status、失败role=alert，写入禁用冲突操作。部分成绩与最终总分分行，主观待批不能显示总分0，后续详细解析不挂空链接。

§27.5 学生试卷页沿用暖白卡片/局部蓝色强调。宽屏目录双卡列、筛选工具条可换行；小于1100px目录及答卷阅读改为单列，题号目录限高可折叠，不压缩正文。题干保留换行，选项文本折行，主操作/分页/文字链接44px、明确label和焦点；行内题库链接也补44px点击高度。当前只读与未开放交卷说明使用浅暖黄文字提示，不伪装完整考试或评分完成。1280目录scrollWidth1272、900答卷scrollWidth892，页面内可见操作无不足44px；临时视口已reset。截图与原生证据见本编号验收记录。

§27.4 试卷管理复用exam-bank暖白纸张、圆角卡片、44px按钮/表单和焦点。蓝图、预览调题、保存版本发布、试卷列表分区；工具条自动换行，题干/选项/来源/历史长文可换行，答案藏于管理员明确展开区。手动顺序用题干文字，不将内部版本ID作为用户操作指引。配额不足用“需求/可用/选中/缺少”文字，不仅颜色；忙碌锁冲突操作，失败role=alert，确认role=status。窄窗口同卡片纵向阅读，复用已有响应式样式；原生宽窄屏实机检查尚未完成，不以CSS或组件回归冒充。

§27.3 `/admin/exam-bank` 保持暖白纸张与局部蓝色主按钮，不用大面积蓝底。分类、校订、导入三张卡片，44px控件、可换行工具条、清晰label与键盘焦点。清单/表单宽屏1:2，小于1100px上下排列；题干/选项/JSON长文换行。禁用提交期间表单，失败role=alert/确认role=status；真实空库才显示0。导入预览明确行数/合格/错误与人工确认，审核按钮区说明只操作已保存版本。模板自编标记、来源及旧版本可读，不通过颜色单独表达状态。

§26.12：题库数量选择沿用现有label/select与纸张工具条，1/3/5题、默认1，最小44px，键盘焦点与busy禁用；提示占整行，可随工具条换行，不固定宽度或新增大色块。列表、作答区及响应式断点保留。

§25.9指南增加课程交流路径，与现有纸张风格一致；品牌回首页链接补min-height44px，原生Tab聚焦outline solid且Enter能回工作台。指南/消息1280与900窗口无横向溢出；旧CSS热更新未生效时刷新后minHeight44/实际44且窄窗可见button/a无不足44px项，临时视口reset。业务权限验收未通过，不以视觉/单元测试替代权限通过。

§25.8消息沿用暖纸张/card/line/ink、文字消息入口及真实未读数；单列卡片、文字已读/未读不靠颜色，固定摘要/当前可访问链接或不可用提示，本人处理结果按纯文本折行。消息/参与标签aria-pressed，可换行44px按钮及learner-text-action链接、键盘焦点；1280/900无横向溢出、可见按钮44px，临时视口reset。无大面积蓝底/假红点/假通知。

§25.7管理/举报沿用paper/card/line/ink与22px卡片；课程/可见/处理筛选带文字，分页分区、操作可换行，44px控件/焦点和纯文本折行。管理员没有学习XP导航，确认区用明确对象/理由/错误；学生举报折叠入口及本人结果记录不伪装消息角标。原生浏览器1280/900无横向溢出、可见操作满足44px，不重设用户视口。

§25.6课程讨论沿用paper/card/line/ink：内容/讨论文字pressed按钮、22px纸张卡片、纯文本原换行及长文折行、44px控件/键盘焦点；表单单列、fieldset min-width:0，筛选与操作可换行。作者编辑/删除确认放在主题或本人回复内；不通过大面积蓝底或假评分表示已解决。播放器及讨论面板隐藏而不卸载，引用回看和草稿切换保留。1280/900宽已验无横向溢出。

§25.5共享只读：沿用paper/card/line/ink的22px纸张卡片，学习中心资料空间为带文字的pressed按钮，共享卡片宽窗两列/窄窗自动单列，工具和授权字段换行；按钮/输入44px，复选框保留文字范围。管理员独立导航增加共享课程；准备表单→实际媒体与快照预览→确认发布/下架分区，不用大面积蓝底。CourseReader的PDF/img必须原生同源请求，不走Next图像优化缓存，以保留Cookie鉴权/no-store与下架后重查。

§25.4我的笔记：沿用paper/card/line/ink/blue令牌，22px纸张卡片、正文原换行、长标题/正文可折行；搜索/资料/导出工具flex-wrap且min-width:0。按钮/输入44px、键盘聚焦描边；删除为条目内明确确认区，编辑textarea不随请求失败消失。列表单列避免长笔记挤窄，无大面积蓝底。

§25.3学习页快捷工具放在资料标题下，三文字按钮44px，纸张底/浅线/深墨，键盘聚焦可见；文档仅个人笔记与预解析。原目标区scroll-margin-top=110px避开顶栏，按钮打开原details/个人面板而非另造浮窗。底部下一步三链接44px且可换行、22px纸张卡片；沿用既有paper/card/line/ink/blue变量，不改变原播放器与笔记网格断点或暂存状态。

§25.2当前用户导航：学习资料（我的学习/学习中心）、练习与复习（题库/复习/计划）、学习工具（AI助手/图谱），分组标签11px，原文字导航保留。顶栏指南/打卡设置/退出均至少44px，可键盘聚焦；1023px及以下隐藏搜索容器本身避免占位导致换行。新增学习指引和/help使用既有paper/card/line/ink令牌、22px纸张卡片，步骤与模块1100px以上两列、以下单列。侧栏允许纵向滚动，窄高度不藏入口；不加消息/共享假按钮。

> 面向「HTML 原型 → React/Next.js 代码还原」的设计规范文档。
> 与同级文档的边界：本 SPEC 只回答「前端怎么写组件」，**不**重复 PRD 的功能定义、**不**重复 `spec/03-ARCHITECTURE.md` 的接口契约/数据模型/部署细节。

---

## 0. 文档定位

| 文档 | 关注什么 | 不写什么 |
|------|---------|---------|
| PRD | 做什么 / 为谁做 / 做到什么程度 | 怎么做 |
| ARCHITECTURE.md（CodeArts 生成） | 数据模型 / API 契约 / 部署方案 | UI 视觉、组件细节 |
| **本 SPEC** | 页面布局 / CSS 变量 / 组件拆分 / 状态机 / 动画时长 | 后端 schema、API 字段 |
| tasks.md | 按 P0/P1/P2 拆解的编码任务 | 设计细节 |

---

## 1. 全局视觉系统

### 1.1 设计基调

**风格**：纸张学习桌 · 彩色贴纸（Paper Study Desk · Colorful Stickers）。
- 画布：奶油纸张 `#FFF9F0`，背景允许出现低对比度网格、圆点和手绘线条
- 卡片：暖白 `#FFFDF8`，22–30px 圆角，深蓝 `#20304A` 描边或浅灰线，配 4–8px 偏移阴影
- 配色：海蓝 `#4D7CFE` / 向日黄 `#F4C95D` / 珊瑚 `#EC6D66` / 薄荷 `#27B89A`
- 插图：优先使用 CSS、SVG 和几何形状构成学习桌、知识节点、便签与陪学吉祥物，不依赖外部图片资源
- 动效：卡片轻微漂浮、贴纸 hover 位移 4–7px、按钮按下回落；尊重 `prefers-reduced-motion`

**关键词**：轻松 / 有趣 / 亲切 / 纸张 / 贴纸 / 手绘 / 成长感 / 学习陪伴。
**避免**：深色科技后台感、过度玻璃拟态、冷峻渐变、营销大色块、复杂 RPG 游戏化。

> **品牌**：文豪智能学习平台（MindSpark）。视觉主色采用「纸张学习桌」体系的海蓝 `#4D7CFE`、珊瑚 `#EC6D66`、薄荷 `#27B89A`（对应 `tailwind.config.ts` 的 `brand / rose / teal` 语义色）。旧的「深空极光」深色原型（`#0A0918` / `#9381FF`）已弃用，仅保留于 `prototype/` 历史 demo。

### 1.2 设计令牌（浅色「纸张学习桌」，与 tailwind.config.ts 对齐）

> ⚠️ 本节约记录的 `:root` 为**已弃用的「深空极光」深色原型**变量（`#0A0918` / `#9381FF` / `#13DDC4`），仅作历史参考。实际界面自 2026-09-21 起已统一为浅色「纸张学习桌」主题，令牌见下表，与 `tailwind.config.ts` 的语义色一致。

| 令牌 | 值 | 用途 |
|------|-----|------|
| 画布底色 | `#FFF9F0` | 奶油纸张背景 |
| 卡片表层 | `#FFFDF8` | 暖白卡片 |
| 主色 brand | `#4D7CFE` | 主操作 / 学习状态 / 进度 |
| 主色深墨 brand-ink | `#2C54C9` | 浅底上的主色文字（满足对比度） |
| 悬停 brand-hover | `#3768EA` | 按钮 / 链接 hover |
| 蜜桃 amber | `#F49B54` | 重点高亮 / 待复习 |
| 薄荷 teal | `#27B89A` | 信息提示 / 数据可视化 |
| 珊瑚 rose | `#EC6D66` | 警示 / 弱项标识 |
| 文字三级 | `#20304A` / `#647089` / `#98A1B2` | 标题 / 正文 / 次要 |
| 卡片描边 | `#E8E1D5` | 纸张卡片描边 |

```css
:root {
  /* ⚠️ 已弃用的「深空极光」深色原型变量，仅历史参考；实际界面使用上方浅色令牌表 */
  --bg:             #0A0918;
  --bg-elevated:    #0f0e1f;
  --bg-sidebar:     rgba(10, 9, 24, 0.72);
  /* 玻璃卡片 */
  --surface:        rgba(255, 255, 255, 0.045);
  --surface-hover:  rgba(255, 255, 255, 0.075);
  --surface-active: rgba(255, 255, 255, 0.10);
  --border:         rgba(255, 255, 255, 0.10);
  --border-strong:  rgba(255, 255, 255, 0.18);
  /* 主色 —— 紫罗兰 → 青蓝渐变 */
  --primary:        #9381FF;
  --primary-2:      #7C6AE6;
  --primary-3:      #2EA7FF;
  --grad-primary:   linear-gradient(135deg, #9381FF 0%, #2EA7FF 100%);
  --grad-button:    linear-gradient(90deg, #9381FF 0%, #13DDC4 100%);
  --glow-primary:   0 0 20px rgba(147, 129, 255, 0.35);
  /* 语义色 */
  --accent:         #13DDC4;   /* 成功 / 强调 */
  --accent-soft:    rgba(19, 221, 196, 0.12);
  --warning:        #5FB8FF;   /* 警示 / 待巩固（冷色警示） */
  --warning-soft:   rgba(95, 184, 255, 0.12);
  --danger:         #FB7185;   /* 错误 / 薄弱点 */
  --danger-soft:    rgba(251, 113, 133, 0.12);
  /* 文字 */
  --text:           #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.72);
  --text-muted:     rgba(255, 255, 255, 0.48);
  /* 几何阴影 */
  --radius:         22px;
  --radius-sm:      14px;
  --radius-pill:    999px;
  --shadow-sm:      0 1px 2px rgba(0, 0, 0, 0.20), 0 4px 12px rgba(0, 0, 0, 0.28);
  --shadow-md:      0 4px 12px rgba(0, 0, 0, 0.28), 0 16px 40px rgba(0, 0, 0, 0.36);
  --shadow-lg:      0 8px 24px rgba(0, 0, 0, 0.36), 0 32px 64px rgba(0, 0, 0, 0.44);
  --shadow-glass:   inset 0 1px 1px rgba(255, 255, 255, 0.08), 0 8px 32px rgba(0, 0, 0, 0.32);
  /* 字体 */
  --font:           "Noto Sans SC", "Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
```

**强约束**：写新样式时必须引用以上变量，不发明新颜色值。

### 1.3 通用组件库

| 组件 | class | 关键样式 | 主要 props |
|------|-------|---------|-----------|
| 玻璃卡片 | `.card` | `rgba(255,255,255,0.045)` + 1px `rgba(255,255,255,0.10)` 描边 + radius 22 + `shadow-glass`；hover `surface-hover` 上浮 -2px | `{ hover?: boolean }` |
| 主按钮 | `.btn.primary` | `grad-button` + 白字 + `glow-primary`；hover 亮度 1.08 | `{ variant, size, block, disabled, loading, onClick }` |
| 次按钮 | `.btn` | 透明底 + 玻璃边框 + 白字 | 同上 |
| 危险按钮 | `.btn.danger` | `danger-soft` 底 + `danger` 字/边框 | 同上 |
| 胶囊标签 | `.tag` | radius 999px + 半透明底 + 发光文字 | `{ variant: cyan\|blue\|red\|purple\|gray }` |
| 进度条 | `.progress > span` | 8px 高 + `grad-primary` 填充 + 发光尾端 | `{ percent }` |
| 头像 | `.avatar` | 36px 圆形 + `grad-primary` + 白字首字 | `{ name }` |
| 用户徽章 | `.user-chip` | 玻璃卡片 + 头像 + 名字 | `{ name }` |
| 输入框 | `input` | 玻璃底 + 1px 描边 + radius 14 + focus 紫边发光 | 原生 |
| 统计卡 | `.stat` | 玻璃卡 + 大数字 32px + 右上角渐变图标块 | `{ num, label, icon, color }` |
| Hero 横幅 | `.hero` | 奶油纸张底 + 海蓝强调 + 深色标题文字 | `{ title, desc, actions[] }` |
| 侧边栏 | `.sidebar` | 固定左侧 240px + `bg-sidebar` backdrop-blur + 玻璃边框 | `{ active }` |
| 顶栏 | `.topbar` | 固定顶部 68px + `bg-sidebar` backdrop-blur + 搜索 + streak + XP + 头像 | — |

### 1.4 响应式断点

| 断点 | 范围 | 行为 |
|------|------|------|
| 桌面（默认） | ≥ 760px | 完整布局，侧边栏 + 主内容 |
| 移动端 | ≤ 760px | 侧边栏隐藏；`.main` padding 18/16；`.grid.cols-2/3/4` 转单列；Hero padding 缩小 |
| 学习页平板 | ≤ 900px | 主内容 + 笔记面板从 2 列转 1 列 |

> MVP 阶段按桌面端使用为主；移动端不做侧边栏替代（无汉堡菜单）。

---

## 2. 应用骨架（受保护页面的公共布局）

### 2.1 AppShell

所有受保护页面（dashboard / import / study / review / graph）统一使用：

```
.app-shell (flex, min-height: 100vh)
├─ <aside class="sidebar">   ← 232px 深色侧边栏
└─ <main class="main">       ← flex:1, padding: 30px 36px
   ├─ <div class="topbar">  ← 顶部栏（标题+crumbs + 右侧用户徽章）
   └─ 页面内容
```

**登录/注册页不使用 AppShell**（无侧边栏）。

### 2.2 Sidebar 侧边栏

§24.10底部XP采用Arial/sans-serif、13px、tabular-nums与nowrap，单位10px，沿用系统颜色。原11px JetBrains Mono的零在截图易误读为8；仅调字形可读性，不改变真实数据或计分。

```
.sidebar (var(--ink) 深色背景, padding 24/16)
├─ .brand
│   ├─ .logo  ← 38px 渐变方块圆角 11px + 单字 logo
│   └─ .name  ← 智能学习平台
├─ <a class="nav-item">工作台</a>
├─ <a class="nav-item active">内容导入</a>  ← 当前路由
├─ <a class="nav-item">学习</a>
├─ <a class="nav-item">AI 学习助手</a>
├─ <a class="nav-item">复习</a>
└─ <a class="nav-item">知识图谱</a>
```

**`.nav-item`**：高 40px + 圆角 10px + 灰紫字；hover 加 `rgba(255,255,255,.06)` 半透明白；`.active` 加 `var(--grad-primary)` 渐变 + 白字 + 紫色阴影。

**当前导航分组顺序**：学习资料（我的学习 → 学习中心）、练习与复习（练习题库 → 复习巩固 → 学习计划）、学习工具（AI学习助手 → 知识图谱）。打卡入口在顶栏，`/attendance`高亮设置而非学习计划；管理员页面保持独立AdminShell导航。

### 2.3 Topbar 顶部栏

```
.topbar (flex space-between, mb 26px)
├─ 左侧
│   ├─ <h1>{页面标题}</h1>  ← 24px / 700 / letter-spacing -.02em
│   └─ <div class="crumbs">{面包屑 / 副标题}</div>  ← 13px muted
└─ 右侧
    └─ <div class="user-chip">  ← 头像 + 姓名
```

### 2.4 受保护页面路由表

| 路由 | 原型文件 | 是否在 AppShell |
|------|---------|---------------|
| `/login` | prototype/index.html | ❌ |
| `/register` | prototype/register.html | ❌ |
| `/dashboard` | prototype/dashboard.html | ✅ |
| `/import` | prototype/import.html | ✅ |
| `/study/:id` | prototype/study.html | ✅ |
| `/assistant` | — | ✅ |
| `/review` | prototype/review.html | ✅ |
| `/graph` | prototype/graph.html | ✅ |
| `/attendance` | — | ✅ |
| `/admin` | prototype/admin-dashboard.html | ✅ AdminShell（仅管理员） |
| `/admin/users` | — | ✅ AdminShell（仅管理员） |
| `/admin/attendance` | — | ✅ AdminShell（仅管理员） |

---

## 3. 各页面设计规范

### 3.1 `/login` ← index.html

**布局**：左右两栏，**不**使用 AppShell。

```
┌─────────────────────────────────────────────┐
│ 左侧：var(--grad-hero) Hero 区               │   右侧：登录卡片 │
│ - 装饰光晕（::before/::after）              │   - 品牌标题     │
│ - 产品标题 + Slogan + 卖点列表               │   - 邮箱+密码   │
│ - （移动端隐藏）                              │   - 登录按钮     │
└─────────────────────────────────────────────┘
```

**登录卡片**：
- 暖色卡片：白底（`var(--surface)`）+ radius 16 + shadow-md，浅边框 `var(--border)`，与米白背景形成温和对比
- 字段：邮箱（`<Input label="邮箱">`）+ 密码（带"显示/隐藏"切换）
- 按钮：`<Button variant="primary" block>` 全宽（绿色渐变 `var(--grad-primary)`）
- 底部链接：「还没有账号？立即注册 →」跳 `/register`

**状态**：`idle` / `submitting`（按钮 disabled + "登录中..."）/ `error`（顶部红色 toast，输入框保留输入）

**移动端**：Hero 区隐藏，只显示登录卡片居中。

### 3.2 `/register` ← register.html

**布局**：与 login 类似，单卡片居中（Hero 可省略或减弱）。

**字段顺序**（固定）：
1. 用户名
2. 邮箱
3. 密码 + **密码强度条**（4 档：红→橙→黄→绿，对应 weak/medium/strong/very-strong）
4. 确认密码（实时校验两次一致）
5. 验证码（6 位数字，input + 「发送验证码」按钮 60s 倒计时）

**底部**：「已有账号？立即登录 →」跳 `/login`

**额外状态**：密码强度变化、验证码倒计时、两次密码不一致。

### 3.3 `/dashboard` ← dashboard.html

当前工作台采用纸张学习桌：页头目标与综合掌握度，主按钮定位今日任务；三张任务卡（到期复习存在时优先、继续学习、历史错题），学习计划提醒，紧凑打卡，五项全局概览（内容/笔记/到期项/掌握度/累计XP），最近导入最多六份资料与薄弱点摘要，最后为学习闭环说明。

三任务卡1100px起并列、窄屏单列；统计卡保留现有数字与细彩色强调。不显示虚构本周增量、今日完成率或连续天数。任务与提醒的加载/失败/真实0分开；计划提醒总数来自total，列表只显示第一页条数，目标分钟是计划值。所有操作至少44px，长资料名换行。

---

### 3.4 `/import` ← import.html

```
.topbar
.grid.cols-2
│   ├─ 左侧 card「选择导入方式」
│   │   ├─ h2「选择导入方式」 + sub
│   │   ├─ 三栏入口 .import-modes (grid 1fr 1fr 1fr)
│   │   │   ├─ 课堂视频 (mode-card.highlight + .selected) ← 默认
│   │   │   ├─ 图片资料 (mode-card)
│   │   │   └─ 文档导入 (mode-card)
│   │   ├─ btn.primary.block「开始上传 · {mode}」
│   └─ 右侧 card「解析进度」
│       └─ .stage-row（按导入方式切换）
│           ├─ 视频 × 5：上传 / 抽帧 / MindSpore 筛选 / OCR + ASR / AI 整理笔记
│           ├─ 图片 × 3：上传图片 / 图片 OCR 与内容理解 / 学习笔记已就绪
│           └─ 文档 × 3：上传文档 / 正文提取与内容理解 / 学习笔记已就绪
.card「我的内容库」(mt 22)
│   └─ .item-row × N（标题 + meta + tag.green/amber/red）
```

**三栏入口 `.mode-card` 三态**：
- **default**：白底 + 1.5px 灰边
- **hover**：紫边 + translateY(-2px) + 紫色阴影 0 10px 24px -10px rgba(80,70,200,.3)
- **`.selected`**：紫边 + 渐变背景 `linear-gradient(180deg, #f3f1ff, #efedff)`
- **`.highlight`**（课堂视频专属）：紫色边框 + 渐变背景 + **`.mode-tag`「主角能力」徽标**（顶部居中悬浮）+ **`.mode-icon-wrap.glow` 光晕** + **`.mode-tech`「→ MindSpore 课堂关键帧分类 + OCR」底部虚线分隔**

**解析进度 `.stage-icon` 三态**：
- `.done`：青底（var(--accent-soft)）+ 绿字 + ✓
- `.running`：紫底 + 紫字 + ↻ + 脉冲动画 `pulse 1.4s infinite`
- `.wait`：灰底 + 灰字 + ·

**内容库 `.item-row` 三态**：
- `已就绪`：tag.green，点击进入 `/study/:id`
- `解析中`：tag.amber，不可点击，hover 显示进度
- `解析失败`：tag.red + 红色 hover + 「重试」按钮

**互动行为**：
- 点击任一 mode-card → 移除其他 `.selected` + 当前加 `.selected` + 上传按钮文案变为「开始上传 · {label}」
- 「开始上传」点击 → 按所选资料类型显示对应流水线；仅课堂视频触发 5 阶段流程并每 2–5 秒抽帧，MindSpore 将视频画面标为板书 / 屏幕教学内容 / 无效，只有前两类进入 OCR。图片直接进入图片分类与 OCR，不显示抽帧或 ASR。
- 不提供 URL 抓取、公共内容订阅或伴生学习入口；上传区显示「请仅导入本人拥有或获授权的资料」。

### 3.5 `/study/:id` ← study.html

播放同步笔记采用现有纸张卡片、brand-soft 时间标签和海蓝当前项描边；放置在视频右侧首张卡片，窄窗口自然转为单列。跟随/全部按钮标注 aria-pressed；时间点按钮与保存按钮至少 44px 高。当前时间用等宽数字；重点摘要保留换行，转写注明“原文”并与 AI 摘要分区。补充输入提供关联 label、5000 字限制、绑定时间和保存状态；失败使用 role=alert，不在每次播放时间更新时反复播报。

```
.topbar（含视频标题「数据结构 · 第 3 讲 二叉树」+ meta「视频 · 45:12 · 已就绪」）
.pipeline-badge (4 个 tag 横排)
│   ├─ tag.green「✓ MindSpore 有效帧筛选完成」
│   ├─ tag.green「✓ OCR + ASR 证据已融合」
│   ├─ tag.purple「AI 笔记已生成」
│   └─ tag.purple「知识点 × 12」
.grid.cols-2
│   ├─ 左侧
│   │   ├─ .player (深色渐变 + 中央 ▶ + 底部进度条 + 时间)
│   │   └─ .card 含 .tabs（AI 整理笔记 / 我的笔记 / 知识点 / 转写）+ 当前 tab 内容
│   └─ 右侧 .card「AI 问答 + 解析证据」
```

**视频播放器 `.player`**：
- `aspect-ratio: 16/9`，`var(--grad-hero)` 深色渐变背景
- 中央 ▶ 玻璃按钮（`backdrop-filter: blur(4px)` + 圆形 68px），hover 放大
- 底部进度条：4px 高 + 渐变填充 + 左右时间显示
- 点击 ▶ → 实际播放（接 video.js / hls.js）
- 5s 心跳 `PUT /api/contents/:id/progress` 上报位置
- 暂停/退出时瞬时报一次

**`.pipeline-badge`**：仅展示状态，不可点击；4 个 tag 横排间距 8px，wrap。展开「查看解析证据」时展示各类关键帧数量；无效帧只计数，不展示 OCR 结果。

**`.tabs`**：底部 1px border + 当前 tab 加 `.active`（紫字 + 紫下边框 2px）。

**tab 内容**：
- **AI 整理笔记**：`<GeneratedNotePanel>` 默认 Tab，渲染服务端生成 Markdown；每个章节显示可点击的时间点与证据来源，并提供「重新生成 / 复制 / 导出」。生成失败时保留手动笔记，展示可重试说明而不伪造内容。
- **我的笔记**：`<NoteItem>` 列表，按 timestampSec 升序；新笔记实时插入顶部（黄色高亮 2s 后褪色），与 AI 笔记完全独立。
- **知识点**：`<KnowledgePointItem>` 列表，序号 + 标题 + 摘要 + 掌握度 + 「复习此点」按钮
- **转写**：`<TranscriptItem>` 列表，时间戳徽标 + 段落文本，点击跳到对应播放位置

**实时笔记交互（核心）：详见 §4**。

### 3.6 `/review` ← review.html

```
.topbar（含「数据结构 · 今日待复习 8 张」）
.game-bar（三栏状态）
#achievement-toast（hidden，fixed top-right）
#particles（fixed inset:0，z-index 99）
.progress-text「第 N / M 张」
.flashcard（perspective 1000px，3D 翻面）
│   ├─ .face.front（白底 + .rarity 稀有度 + q-tag「问题」+ 问题 + hint）
│   └─ .face.back（var(--grad-primary) 渐变 + 白字 + q-tag「答案」+ 答案 + 解释）
.text-center mt-14「点击卡片查看答案」
.rating（4 个评分按钮：忘记/模糊/犹豫/记住）
.due-info「下次复习：X 天后」（评分后更新）
.card「薄弱知识点」（每行 tag + 知识点 + 练习按钮）
```

**闪卡 `.flashcard`**：
- 翻面：`.flipped` 触发 `transform: rotateY(180deg) 0.5s`
- 正面右上角 **`.rarity` 稀有度徽标**（绝对定位 top 14/right 14）

**稀有度 `.rarity` 四态**（由 SM-2 easeFactor 决定）：

| class | 条件 | 背景 | 字色 | 边框 |
|-------|------|------|------|------|
| `.r-hard` | ease < 1.7 | #f3e6ff 紫 | #6a1b9a | #c79cff |
| `.r-confirm` | ease < 2.0 | #fff7d6 黄 | #ad7e00 | #f3d97a |
| `.r-easy` | ease < 2.5 | #e0f5e9 绿 | #00875a | #88d8a3 |
| `.r-mastered` | status=graduated | 蓝渐变 | #1d4e89 | #91b4ff |

**评分按钮**：4 个均分（flex 1），第 4 个（记住）`.btn.primary`。点击触发粒子飞字 + streak 变化 + XP 累加 + 成就检测（详见 §5.3/5.4）。

**游戏化组件详见 §6.5**。

### 3.7 `/graph` ← graph.html

```
.topbar
.tabs（我的图谱 / 薄弱点看板）
├─ 我的图谱 tab：React Flow 交互画布 + .graph-canvas-node（文字=学习状态，等尺寸阅读卡片）
└─ 薄弱点看板 tab：内容 / 学科标签筛选 + list（tag + 知识点 + 内容标题 + 关联闪卡数 + 「复习」按钮）+ 全内容掌握度环形画像
```

**节点 `.graph-node` 视觉**：
- 固定208×120px阅读卡片（§24.5），状态以文字说明，无记录不显示默认0%
- 状态条使用低饱和色并辅以文字，选中品牌边框，无记录灰色
- hover：完整标题与记录分数；复习/正确率/关联信息在详情读取

**边样式**：实线 = 前置关系；虚线 = 相关关系。

**互动**：hover tooltip / 点击右侧纸张卡显示详情（关联笔记 / 闪卡 / 进度）。

实现补充：默认请求 `/api/graph/overview`；选择单一内容后请求 `/api/contents/:id/graph`。节点点选后在右侧详情卡显示复习次数、练习正确率、最近复习时间、定位匹配的笔记数和关联闪卡数，并可跳转来源内容。空图使用导入解析引导；画布提供缩放、平移、控制和小地图。

### 3.8 管理员专属管理中心

`/admin`、`/admin/users` 和 `/admin/attendance` 共用 AdminShell。整体沿用品牌和纸张学习桌风格，导航只显示管理总览、用户管理和签到记录，不出现学习者导航、内容搜索、XP 或 streak。管理员登录后默认进入 `/admin`；学习者仍进入 `/dashboard`。

#### `/admin` 管理总览

- 页头显示「平台管理中心」、当前管理员昵称和退出登录；首屏提供刷新概况、用户管理和签到记录入口。刷新中按钮禁用并显示进度；失败时保留上次数据并给出重试。
- 4 张统计卡依次显示账号总数、学习者、管理员、上海时区今日签到；签到卡注明人脸核验/普通打卡/历史待确认分项。
- 下方两列卡片显示常用管理、管理范围与隐私提示；底部显示最近账号和签到方式汇总，提供进入对应管理页的链接。
- 数值、角色和时间均来自 `/api/admin/overview`；示意数字只能出现在原型且必须标明，不得进入正式 UI。
- 加载用 skeleton，零记录展示真实 0 和明确空状态，失败提供重试；无权限时显示返回工作台的说明。
- 窄窗口（≤760px）将三项管理导航排在顶部，指标双列，其他卡片单列；焦点可见且所有按钮/链接至少 44px 高。

#### `/admin/users` 用户管理

- 页面主色保持品牌蓝紫，表格卡片使用浅纸张背景和细边框。
- 顶部使用「用户管理」标题、搜索框、角色筛选和蓝色「新增用户」按钮。
- 用户列表以卡片化表格呈现：头像、账号、昵称、角色胶囊、创建时间和操作按钮。
- 新增 / 编辑使用右侧滑入抽屉；删除使用带风险色的二次确认弹窗。
- 学习者不渲染管理员入口；服务端权限校验必须独立存在。
- `/admin/users`、`/admin/attendance` 延用专属 AdminShell 的管理员身份标识与导航，不再加载学习者 AppShell。

### 3.9 /attendance 登录与打卡设置

顶部纸张卡片提供返回工作台，独立今日打卡卡片从接口读取上海日期、方式和时间；成功 role=status，失败 role=alert，未知状态不可显示已打卡，加载/提交中禁用重复按钮。工作台共用该组件，免登录示例不调用真实接口。学习计划入口沿用 dashboard-section。

人脸两列区域使用原生 details/summary 默认折叠，摘要“可选：人脸登录与模板管理”。展开不启动摄像头，独立同意才能开启录入；旧授权提示重新同意。预览保持 aspect-video，按钮最低44px高，窄屏上下排列。

/login 两个等宽方式按钮使用 brand 选中态和 aria-pressed；选择人脸方式时提示仅教师/学生可用、管理员使用密码；账号保持可读，采集时禁用修改，预览和动作提示紧随人脸说明，不显示分值；服务不可用不启动摄像头。


### 3.10 `/assistant` AI 学习助手

- §22.3续验：长引用（>240字）用160字预览与默认收起的完整原文details；时间/页码链接保持至少44px可点，展开摘要至少44px，全文保留换行、允许长词折行；不请求模型或重读资料。

- 延续工作台的纸张卡片、蓝色主按钮和圆角标签；紧凑页头之后为资料与目标控制区、对话记录及文档流中的问题输入区，不使用限高嵌套对话滚动或固定遮挡输入层（§22.3）。
- 资料选择器只显示本人已就绪且理解完成的内容。加载时显示状态；没有可用资料时显示说明和前往导入按钮；加载失败时提供重试。
- 空会话展示简短提问建议；用户与助手消息左右区分，助手回答下方列出引用摘录，并将时间点/页码与学习页链接放在同一引用卡片。
- 切换资料后立即清空对话与输入内容；回答中显示忙碌状态，错误以表单上方提示呈现。会话不写入本地存储或服务端。
- 桌面端内容宽度限制在阅读舒适范围，移动端单列；输入框随文档流可达，按钮满足触控尺寸。
- §22.3：页面最大阅读宽度960px，Agent消息使用分区标题和留白区分学习记录、建议、原文依据、下一步行动；练习、方案分别用浅纸张边框卡片，工具详情默认折叠放在末尾。控制区≥900px资料与模式/预算并列，其余上下排列；44px触控尺寸，长标题/引用换行，日期输入min-width:0。沿用现有Tailwind语义色，不引入色值或视觉依赖；进入练习仅隐藏对话，不卸载方案组件。

---

## 4. 实时笔记交互（学习页核心）

### 4.1 触发

用户在「笔记面板」输入笔记正文 + 当前视频 timestamp（或文档 page+blockIndex）→ 点击「保存」。

### 4.2 客户端时序

1. 第一笔输入固定视频时间点或文档定位；停止输入1秒自动保存，也可点击立即保存。
2. 自动/手动保存共用同步互斥；请求期间禁用输入和编辑/删除，避免未保存草稿被覆盖。
3. 使用现有POST新增或PATCH编辑接口；正式列表等待服务端成功响应更新。
4. 成功更新列表与版本；isOverwritten提示覆盖；失败显示错误并保留正文和编辑状态。自动失败停止重试，用户编辑或主动点击后再尝试。
5. 未加载到笔记时禁止写入，展示重新加载；401遵循原登录跳转。

### 4.3 客户端状态机

idle → editing → submitting → success / overwrite / error；error保留草稿，重试再次进入submitting。切换contentId重新初始化工作区。

### 4.4 UI 表现

保存中按钮与编辑器禁用并显示保存状态；成功显示已保存；覆盖显示冲突说明；失败使用role=alert且输入不丢失。取消编辑仅在没有待完成请求时可用。

---
## 5. 状态机总览

### 5.1 内容状态机

```
待导入 → 上传中 → 解析中 → 已就绪
                 ↘         ↘
                   失败 ←────┘（失败可重试）
```

UI 表现：见 §3.4 内容库 `.item-row` 三态。

### 5.2 解析流水线（5 阶段）

| 阶段 | 名称 | 预期时长 | stage-icon |
|------|------|---------|-----------|
| 1 | 上传完成 | 秒级 | done（秒后变 done） |
| 2 | 视频解析（ffprobe + 封面） | < 5s | running→done |
| 3 | MindSpore 三类关键帧筛选 | 10-30s | running→done |
| 4 | OCR + ASR 证据提取 | 30s-2min | running（带进度条） |
| 5 | AI 整理课堂笔记 | 10-60s | running→done |

**轮询策略**：每 2s 调用 `GET /api/jobs/:id` 获取当前阶段，UI 渲染对应 `.stage-row` 状态。

### 5.3 闪卡评分（4 档）

| rating | 含义 | 下次复习 | XP | streak |
|--------|------|---------|----|----|
| 0 | 忘记 | 10 分钟后 | 0 | 重置 |
| 1 | 模糊 | 1 天后 | 2 | 重置 |
| 2 | 犹豫 | 3 天后 | 5 | 重置 |
| 3 | 记住 | 7 天后 | 10 | +1 |

### 5.4 复习游戏化状态

**streak**：评分=3 时 +1，<3 时归零；streak>0 时 `.flame` 火焰 `flicker 1.5s infinite` 发光。

**XP**：累加，按 `levelFor(xp)` 算等级：

| 阈值 | 等级 | 标签 |
|------|------|------|
| ≥ 1000 | Lv.5 | 学神 |
| ≥ 600 | Lv.4 | 大师 |
| ≥ 300 | Lv.3 | 高手 |
| ≥ 100 | Lv.2 | 进阶 |
| < 100 | Lv.1 | 新手 |

**成就触发**（6 种）：

| key | 条件 | 文案 |
|-----|------|------|
| STREAK_3 | streak == 3 | 连续答对 3 张闪卡！ |
| STREAK_7 | streak == 7 | 连续答对 7 张 · 火力全开！ |
| STREAK_10 | streak == 10 | 连续答对 10 张 · 无敌！ |
| XP_100 | xp_total ≥ 100 | 累计 100 XP · 进阶！ |
| XP_300 | xp_total ≥ 300 | 累计 300 XP · 高手！ |
| XP_500 | xp_total ≥ 500 | 累计 500 XP · 大师！ |

**UI**：右上角 `.achievement-toast` 滑入（cubic-bezier(.34,1.56,.64,1) 0.4s）+ 3.2s 后滑出 + 紫色 shadow-lg + 🏆 图标。

**去重**：客户端 Set 记录已展示 key；服务端 `UserAchievement` 表 `@@unique([userId, key])` 兜底。

### 5.5 通用 UI 状态

| 状态 | 表现 |
|------|------|
| 空 | 居中插画 + 一句话文案 + 主行动按钮 |
| 加载 | skeleton 占位 + 渐变扫光动画 |
| 错误 | 顶部红色 toast + 「重试」按钮 |
| 权限不足 | 全屏 401 页 + 跳回 `/login` |
| 未登录 | 受保护页面跳 `/login` |

---

## 6. 组件清单（最小拆分 · TypeScript 接口）

### 6.1 布局组件

```ts
interface AppShellProps {
  user: User;
  currentRoute: 'dashboard' | 'import' | 'study' | 'assistant' | 'review' | 'graph';
  children: React.ReactNode;
}

interface SidebarProps {
  currentRoute: AppShellProps['currentRoute'];
}

interface TopbarProps {
  title: string;
  crumbs?: string;
}

interface UserChipProps {
  name: string;
  avatar?: string;
}
```

### 6.2 通用组件

```ts
interface ButtonProps {
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  size?: 'sm' | 'md';
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

interface CardProps {
  hover?: boolean;
  children: React.ReactNode;
}

interface TagProps {
  variant: 'green' | 'amber' | 'red' | 'purple' | 'gray';
  children: React.ReactNode;
}

interface ProgressBarProps {
  percent: number; // 0-100
  color?: string;
}

interface InputProps {
  type: 'text' | 'email' | 'password';
  label?: string;
  placeholder?: string;
  error?: string;
  helper?: string;
  value: string;
  onChange: (v: string) => void;
}

interface StatCardProps {
  num: number | string;
  label: string;
  icon: string;       // emoji 或 SVG key
  color: 'purple' | 'teal' | 'amber' | 'red';
}

interface HeroBannerProps {
  title: string;
  desc?: string;
  actions?: Array<{ label: string; href?: string; onClick?: () => void; variant?: 'primary' | 'white' }>;
}
```

### 6.3 导入页组件（/import）

```ts
type ImportMode = 'video' | 'image' | 'document';

interface ImportModeCardProps {
  mode: ImportMode;
  icon: string;
  title: string;
  desc: string;
  meta: string;
  highlight?: boolean;   // 拍照识别为 true
  selected?: boolean;
  onClick: (mode: ImportMode) => void;
}

interface StageRowProps {
  state: 'done' | 'running' | 'wait';
  name: string;
  desc?: string;
  progress?: number; // running 时显示 0-100
}

interface ContentListItemProps {
  id: string;
  title: string;
  meta: string;          // e.g. "视频 · 45:12"
  status: 'ready' | 'parsing' | 'failed';
  onClick?: () => void;
  onRetry?: () => void;
}
```

### 6.4 学习页组件（/study/:id）

```ts
interface VideoPlayerProps {
  url: string;
  initialPositionSec?: number;
  onProgress: (positionSec: number) => void;   // 每 5s 上报
  onTimestampClick: (sec: number) => void;     // 点击转写触发
}

interface PipelineBadgeProps {
  frameFilterDone: boolean;
  evidenceDone: boolean;  // OCR + ASR
  generatedNoteReady: boolean;
  frameCounts: { blackboard: number; screen: number; invalid: number };
  pointCount: number;
}

学习页解析进度处于失败态时使用薄弱色提示条展示服务端 `failureReason`；提示不得遮挡播放器或手动笔记，原资料的播放与笔记功能保持可用。

interface TabsProps {
  tabs: string[];
  active: number;
  onChange: (i: number) => void;
}

interface NoteItemProps {
  note: {
    id?: string;
    body: string;
    contentRef: ContentRef;
    isOverwritten?: boolean;
    isOptimistic?: boolean;
  };
  onJump?: (ref: ContentRef) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

interface KnowledgePointItemProps {
  kp: { id: string; title: string; summary?: string; mastery: number; isWeak: boolean };
  onReview: (id: string) => void;
}

interface TranscriptItemProps {
  segment: { text: string; timestampSec: number };
  onClick: (sec: number) => void;
}

interface NoteEditorProps {
  contentRef: ContentRef;
  onSubmit: (body: string) => Promise<{ isOverwritten: boolean }>;
  onCancel?: () => void;
}

interface GeneratedNotePanelProps {
  markdown: string | null;
  sourceCount: number;
  isGenerating: boolean;
  onRegenerate: () => Promise<void>;
  onJumpTo: (timestampSec: number) => void;
}

interface FaceAttendancePanelProps {
  templateStatus: { enrolled: boolean; enrolledAt: string | null };
  onEnroll: (captures: string[], consentVersion: string) => Promise<void>;
  onVerify: (challengeId: string, captures: string[]) => Promise<void>;
  onDeleteTemplate: () => Promise<void>;
}
```

### 6.5 复习页组件（/review）

```ts
interface GameBarProps {
  streak: number;
  xp: number;
  level: string;            // 'Lv.1 · 新手' 等
  todayProgress: { done: number; total: number };
}

interface StatPillProps {
  kind: 'streak' | 'xp' | 'today';
  num: number | string;
  label: string;
  active?: boolean;         // streak>0 时为 true
}

interface FlashCardProps {
  front: { q: string; hint?: string; rarity: RarityKind };
  back: { q: string; hint?: string };
  flipped: boolean;
  onFlip: () => void;
}

type RarityKind = 'hard' | 'confirm' | 'easy' | 'mastered';

interface RarityBadgeProps {
  kind: RarityKind;
  label: string;            // e.g. "待巩固 · 复习间隔 3 天"
}

interface RatingBarProps {
  onRate: (rating: 0 | 1 | 2 | 3) => Promise<ReviewResponse>;
}

interface XpParticleProps {
  text: string;             // "+10 XP" / "🔥 x3"
  kind: 'xp' | 'streak';
  originRect: DOMRect;      // 从评分按钮位置发射
  onDone: () => void;       // 1.1s 后回调
}

interface AchievementToastProps {
  achievement: { icon: string; title: string; desc: string } | null;
  onHide: () => void;       // 3.2s 后或手动
}

interface ReviewResponse {
  xpGain: number;
  newStreak: number;
  newXpTotal: number;
  levelUp: { from: string; to: string } | null;
  unlockedAchievements: Array<{ key: string; title: string }>;
}
```

### 6.6 图谱页组件（/graph）

```ts
interface GraphCanvasProps {
  nodes: Array<{
    id: string;
    label: string;
    mastery: number;     // 0-1, 控制节点大小
    isWeak: boolean;
    lastReviewedAt?: string;
  }>;
  edges: Array<{ source: string; target: string; relation: 'prereq' | 'related' | 'example'; weight?: number }>;
  onNodeClick: (id: string) => void;
}

interface GraphNodeProps {
  point: { title: string; mastery: number; isWeak: boolean };
}

interface WeakPointDashboardProps {
  items: Array<{
    id: string;
    title: string;
    contentTitle: string;
    reviewCount: number;
    score: number;
  }>;
  onPractice: (id: string) => void;
}
```

---

## 7. 动画时长与曲线总览

| 元素 | 时长 | 曲线 | 触发 |
|------|------|------|------|
| 卡片 hover 上浮 | 0.18s | ease | hover |
| 按钮 hover 上浮 | 0.15s | ease | hover |
| 闪卡翻面 | 0.5s | ease | click |
| 闪卡闪光特效 | 0.6s | ease-out | 评分=3 |
| streak bump | 0.4s | ease | 评分=3 |
| 火焰 flicker | 1.5s infinite | ease-in-out | streak>0 |
| 粒子飞字 float-up | 1.1s | ease-out | 评分 |
| 成就弹窗滑入 | 0.4s | cubic-bezier(.34, 1.56, .64, 1) | 触发成就 |
| 成就弹窗滑出 | 0.4s | ease | 3.2s 后 |
| stage-icon pulse | 1.4s infinite | ease-in-out | running 状态 |
| 渐变按钮 hover | 0.15s | ease | hover |

> **禁止使用**：未列出的 `transition` 时长需评审；动画时长超过 0.6s 的需要明确业务理由。

---

## 8. 原型 → 路由 → React 组件 映射表

| 原型文件 | 路由 | AppShell | 主要 React 组件 |
|---------|------|---------|----------------|
| — | /assistant | ✅ | AssistantPage、ContentSelector、AssistantMessageList、CitationLink、AppShell |
| prototype/index.html | /login | ❌ | `<LoginPage>`, `<HeroPanel>`, `<LoginCard>`, `<EmailInput>`, `<PasswordInput>`, `<Button>` |
| prototype/register.html | /register | ❌ | `<RegisterPage>`, `<RegisterCard>`, `<PasswordStrengthBar>`, `<VerifyCodeInput>`, `<Button>` |
| prototype/dashboard.html | /dashboard | ✅ | `<DashboardPage>`, `<HeroBanner>`, `<StatCard>`×4, `<WeakPointList>`, `<QuickEntry>`×4, `<ContinueLearningList>`, `<AppShell>`, `<Sidebar>`, `<Topbar>` |
| prototype/import.html | /import | ✅ | `<ImportPage>`, `<ImportModeCard>`×3, `<StageRow>`×5, `<ContentListItem>`×N, `<AutoNotesExplainer>`, `<AppShell>` |
| prototype/study.html | /study/:id | ✅ | `<StudyPage>`, `<PipelineBadge>`, `<VideoPlayer>`, `<Tabs>`, `<NoteEditor>`, `<NoteItem>`, `<KnowledgePointItem>`, `<TranscriptItem>`, `<AppShell>` |
| prototype/review.html | /review | ✅ | `<ReviewPage>`, `<GameBar>`, `<StatPill>`×3, `<FlashCard>`, `<RarityBadge>`, `<RatingBar>`, `<XpParticle>`, `<AchievementToast>`, `<WeakPointItem>`×N, `<AppShell>` |
| prototype/graph.html | /graph | ✅ | `<GraphPage>`, `<Tabs>`, `<GraphCanvas>`, `<GraphNode>`, `<WeakPointDashboard>`, `<AppShell>` |

> 所有受保护页面顶部都包一层 `<AppShell user={user} currentRoute={...}>`。

---

## 9. 配套素材清单

- `prototype/prototype.css` — 所有 CSS 变量 + 通用组件样式
- `prototype/*.html` — 7 个页面原型，可直接对照视觉
- `spec/01-PRD.md` — 需求层（做什么、为谁做）
- `spec/03-ARCHITECTURE.md` — 技术架构层（数据模型、API、部署）
- `spec/05-TASKS.md` — 编码任务清单（按 P0/P1/P2）

## 18. 学习计划、题库与学习中心（2026-10-08）

§19 真实服务动作提示沿用登录状态说明样式，明确闭眼再睁眼/转向本人左右再回正；不新增弹窗或自动开启摄像头。

§19真人补修：采集约4秒，原status区显示剩余秒数，后两秒提醒睁眼回正；采集结束显示核验中，仍不自动开启摄像头。

§19用户改为scan：保持原登录卡片，单一“扫描人脸并登录”按钮，主动点击才开摄像头；就绪自动取帧、展示扫描中并可取消，完成立即关摄像头，无准备/动作提示。小字说明便捷扫描不做活体、有照片冒用风险；原动作提示只供action配置。
/study-plans 使用 AppShell：上方新建计划表单（资料、标题、目标分钟、学习时间、提醒时间），下方计划列表和完成进度；提供完成/撤销、删除确认、分页、加载/空/失败状态。站内提醒在工作台显示到时未完成计划，链接到资料和计划管理。
/question-bank 使用 AppShell：资料、题型、全部/未作答/曾经答错筛选与分页；题目卡选择后在作答区答题，提交后显示答案和解析，可重新作答。生成题目时基于所选资料已有知识点，不跨资料混入。
/import 命名为学习中心，资料区提供标题搜索及视频/图文筛选，导入区与继续学习在同一页面；侧栏不再分设内容库与学习空间，进入具体学习页时保持学习中心高亮，并显示返回入口。

## 10.4 用户端补修表现（2026-10-09）

学习中心资料卡提供修改标题、保存/取消、删除入口；删除对话框列明关联笔记、闪卡、题目与计划的影响，只有明确确认才发请求。加载/提交时禁用重复操作，失败展示role=alert与重试。搜索明确为资料搜索，不承诺未实现的笔记搜索。
工作台只展示真实到期闪卡数；综合掌握度不标成周统计，移除无数据来源的连续学习0天。本次复习计数不标成今日累计。新卡和learning卡不因初始easeFactor而显示已熟练；graduated为已掌握、低easeFactor为困难，其余新学习卡为待巩固。
学习页笔记保存中禁用输入和其它写操作，编辑失败保留正文与编辑态，加载失败有明确重试入口。AI助手失败恢复本次问题。复习和计划失败/空态不无限显示加载。

### 10.4 图谱失败状态补修（2026-10-09 18:38）

图谱、资料和薄弱点错误使用role=alert，重试按钮沿用brand边框/纸张卡片并有加载禁用状态；掌握度加载使用role=status，失败提示与重试替代百分比/分布统计，无记录以说明替代0%。薄弱点未加载/失败/为空时不提供一键复习。局部节点详情显示当前资料来源入口；画布保留默认React Flow标识。图谱切换时不显示上一范围的节点与详情。

### §22.16 复习巩固呈现
/review沿用纸张学习桌，桌面列表/自测3:7，窄屏单列，列表最多45vh窄屏/65vh宽屏。要点/来源独立纸张卡，回忆输入带关联label，四档按钮至少44px，尚未查看要点时禁用，使用aria-pressed标识所选条目。以阅读内容、来源和本次记录为主，去除翻卡、稀有度、粒子及streak强调；不删除其余页面或底层游戏化记录。保持错误/加载/真实空，所有文字可换行，不产生横向溢出。

### §23.1 实时笔记组件

复用AppShell/dashboard-section/section-title/品牌按钮；录音状态用文字与红点并列，不能只靠颜色；暂停/失败/排队明确。桌面两列、手机单列，转写列表内部滚动，重点附时间与原文，不自动抢焦点或滚动打断用户阅读。所有录音/结束/重试按钮至少44px，运行中禁用冲突操作，页面只通过服务层请求。

### §23.2 随看笔记组件
播放器旁纸张卡显示开关、当前播放位置、真实段数和独立分段正文；来源回看、待核对与保存状态明确。操作至少44px，错误role=alert、进度role=status，长文本换行，沿用桌面65/35与窄屏上下。预解析重点及补充details不改原草稿保存规则。

### §23.5 随看正文层级
使用纸张卡片：批次/真实时间范围为小号眉标，标题h3深色加粗，正文行高舒展，列表使用标准圆点；来源说明用低饱和品牌底色，保存状态明确文字。段落长文换行，来源原文仍折叠，正文不显示###符号。桌面/窄屏沿用当前布局，不自动抢焦点或滚动。

### §23.6 原文精选提示
批次正文前以可换行文字注明“AI精选原文 · ASR转写待核对”；无新mode的历史批次明确显示“历史AI摘要 · 未按原文摘录规则核验”。沿用纸张卡片与当前正文层级，不仅用颜色表示可信度，不自动覆盖历史文字或抢焦点。

### §23.10 全局字体加载
Noto Sans SC 400/500/600/700与JetBrains Mono 400/500保持现有设计，通过globals.css最前面的Google Fonts CSS @import作为全局样式加载，display=swap及系统回退不变；根布局仅保留预连接，不放外部字体stylesheet link。浏览器仍依赖外网字体可达，无法加载时系统字体可读；不新增构建阶段字体下载，不宣称离线自托管或更快首屏。

### §23.11 认证页纸张配色
AuthShell介绍区以var(--paper)奶油底为主，暖黄rgba(244,201,93,.10)径向光斑仅局部低对比点缀，右侧边界var(--line)，装饰圆环使用深墨8%透明度。保留标题/按钮的小面积品牌色，禁止恢复整块蓝色背景；登录注册共用，表单与窄屏隐藏介绍区规则不变。

### §23.12 私有阅读图片
PDF页图与上传图片由Next Image unoptimized直读原鉴权URL；CSS width/height均auto，PDF最大高760px，上传图片最大高620px，两者最大宽100%，保留原图比例。loading=eager/decoding=async用于主要阅读图，PDF错误后保留重试和原文件入口。1200×1600为组件尺寸提示，非服务端真实元数据，不宣称CLS已消除或图像压缩优化。

### §24.1 错题重练呈现
总结的错题重练为品牌按钮，显示实际错题数，至少44px并支持换行；第二轮起顶部品牌浅底卡以文字显示轮号、上一轮统计和当前轮范围，不仅用颜色区别。沿用纸张布局和来源面板，不增加成绩提升动画、虚假掌握标签或默认AI生成。

### §24.2 复习完成指引
完成区继续使用纸张卡片，优先巩固列表显示知识点/资料/自评分档及两条44px链接，长文字换行；自评与客观判分差异用文字说明，不以颜色表示已掌握。本次记录/实际下次安排收为details，时间注明北京时间，无效时间显示排期未知，空优先项不虚构弱点。

### §24.3 学习计划分组
沿用纸张卡片与品牌浅色标签，分组标题带“本页”计数，状态必须使用文字，不仅靠颜色。计划名称与资料名可换行；目标分钟、实际日期分行阅读，操作至少44px。成功反馈role=status，失败role=alert；空态链接学习中心，列表下保留分页及已有复习入口，不新增计时或积分显示。

### §24.4 助手引导卡片
三个入口使用现有纸张描边卡，宽屏三列、窄屏单列，标题深墨、说明次级文字，按钮至少44px并允许换行。明确提示“只填入草稿，确认后发送”，状态用文字表达；无引用说明沿用纸张边界和资料链接，方案未保存为浅品牌标签。不改变960px阅读宽度或添加默认模型请求。


### §24.5 图谱卡片视觉
取代掌握度决定圆点直径：卡片固定208×120px，浅奶油底、细描边、低饱和状态条，标题14px/两行预览且详情完整显示；选中品牌边框，无记录灰色文字，状态不只靠颜色。布局间距280×190，宽屏画布与详情并列，窄屏上下且控件可换行，节点列表提供44px键盘入口。画布控制按钮44px，保留React Flow标识与小地图；连线文字/箭头只反映既有关系，位置不表示课程顺序。


### §24.6 工作台任务呈现
三张任务卡在1100px起并列，窄屏单列；以实际DOM顺序呈现已确认的到期复习优先，不用CSS order造成读屏顺序差异。去除固定序号与重复计划入口，动作至少44px。计划提醒为独立纸张卡，实际总量/当前展示量、计划目标分钟用文字说明，错误与未知保留，位于紧凑打卡之前。


### §24.7 管理操作反馈
用户写入期间禁用筛选、其它写入、编辑字段和关闭入口；失败在编辑弹层内显示role=alert并保留输入，成功role=status。编辑/删除/关闭按钮至少44px；用户搜索/角色及签到筛选有可读名称，既有纸张管理布局不扩展业务范围。


### 学习中心并排布局（27.9.1）

复用暖纸色背景、surface卡片、品牌色操作与现有边框。视口≥1200px时主内容采用两列minmax(0,1.1fr)/minmax(0,1fr)，间距24px；左列资料卡单列、右列导入和进度上下排列；其余宽度堆叠。所有列min-width:0，长文件名/标题换行，控件触控高度至少44px，手机沿用compactNavigation，恢复桌面视口后应自然恢复并排。

§29.14 窄屏验收补充：学习页启用已有 compactNavigation，640px以下保留64px图标入口，避免210px侧栏挤压来源卡和正文；桌面侧栏宽度保持。

### §29.5 班级课程视觉

沿用暖纸背景、奶油卡片、深墨标题、低饱和绿色状态及适量品牌色主按钮。列表/管理详情≥1100px为minmax(0,1.45fr)/minmax(300px,1fr)两栏，24px间距；其余单列，390px16px卡片内边距、长名称/邀请码换行。学生详情单列，管理员沿用原管理Shell手机导航。控件至少44px，标签关联输入，状态同时显示文字；失败role=alert、保存/归档role=status。无悬空操作入口和假统计，未保存/发布确认可读可操作。

### §29.6 作业与版本反馈

复用ClassroomWorkspace.module.css纸张卡片，学生要求/正文、负责人正式版本/批阅表单在宽屏分栏；窄屏按正文→反馈→操作堆叠，长附件名/评语换行。任务负责人看板独立整行，真实人数与状态文字同时呈现；历史按版本折叠、最新默认展开，得分与评语用低饱和绿色反馈卡。作业正文和评语有显式标签，正式提交与人工批阅需可读复选确认；busy/未保存/重读失败时禁用对应写操作。下载为44px按钮且错误紧邻附件区，不展示签名地址。1440/390px负责人及学生最终反馈页面均已实际核对无横向溢出，学生评分、旧退回评语同时保留，截图与视口恢复留证。

### §29.7 作业校对视觉
复用暖纸色ClassroomWorkspace卡片、44px控件、宽屏原文/逐题编辑两栏、窄屏堆叠与紧凑学生侧栏。状态用文字区分识别失败/待校对/本人已确认，警告不随保存消失；确认不使用“已评分”样式或虚构分数。

§29.7宽窄实测：1440px scrollWidth1440，390px scrollWidth382（小于视口，无溢出）；右侧字段依次堆叠，冻结后的逐题和总确认保持勾选且表单只读。截图证据位于homework-recognition-20261019验收目录，保留真实OCR失败页。

§29.7.1 20:02追加：原生真实OCR低置信提示、原文和冻结逐题表单核对，截图ocr-real-corrected.png；沿用暖纸色，未改视觉规则。

### §29.11 三主线入口文案

工作台新手指引保持原三张纸张卡与数字步骤布局，内容分别指向学习中心、班级课程、智能批改；侧栏仅将原“作业识别”标为“智能批改”，仍使用原图标、间距、active规则与44px点击区域。帮助页沿用现有模块卡，不增加新的独立功能菜单。宽窄屏需在最终演练时再核对，不以文案回归代替原生视觉验收。

公开首页沿用原有暖纸张、彩色贴纸、三张能力卡和三级阶梯布局，文字依次对应资料学习、班级作业、智能批改；插画只呈现示例笔记与可回看来源，不显示虚构百分比或已退居辅助的闪卡主线。保留首页原响应式断点与登录/注册/预览链接，改文案后须复核窄屏换行与构建。
## §29.21 公开链接视频模式（2026-10-21）

沿用链接输入卡片、纸面背景与品牌按钮，两种输入模式使用可访问按钮组（aria-pressed），44px触区。视频授权提示与额度说明在开始按钮前可见；下载中可取消并读取状态，完成给学习入口。窄屏按钮换行、URL长文本断行，不额外增加侧栏页面。
