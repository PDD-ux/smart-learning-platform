# §29.13 EPUB章节阅读验收

完成：2026-10-18 20:09（Asia/Shanghai）。仅本编号，不实施URL/章节AI/班级/批改，不训练、不换模型或重跑原资料。

## 交付

学习中心文档入口增加EPUB，上传后验证实际ZIP/OPF/spine/XHTML结构，支持EPUB3 nav及EPUB2 NCX锚点；没有可靠目录时明确spine顺序。新src/lib/books/epub-zip.ts用Node有界解压/CRC校验，epub.ts用saxes事件解析并输出纯文本；不落地解包、不执行脚本/事件、不请求外部资源。拒绝加密/DRM、ZIP64/多盘、穿越/重复名/符号链接、CRC/实际大小异常、XML实体/外部DTD/损坏/深度超限及重复锚点，输出固定错误。

限制：50MiB输入/2000条目/4MiB单条/32MiB总解压/压缩比200、XML64层10万节点、正文200万字/2万段/200阅读顺序项目和200个章节位置、单段2万字。超过目录预算明确失败，不把任意分段伪报原导航。目录建立在预算内扫描文本确定顺序和稳定段号，但不保存全书正文、不调用AI；每次明确选最多20段，累计索引50万字，原CAS/幂等/所有权沿用。

worker对EPUB只建立BookState目录/源SHA256并READY，不写全书TextBlock或自动enqueueUnderstanding；同一资料bookRevision>0的重复解析不覆盖书签/目录/位置。文档原上传/PDF/TXT/MD/视频/图像链路保留。saxes@6.0.0为新增唯一直接依赖（ISC），package-lock新增xmlchars传递依赖；README已落选型，未变其它型号或环境。

学习页复用BookReader：目录/选段/逐段续读、书签、手工校订与个人笔记；EPUB从不放iframe。pageCount=null，摘要仅EPUB带可选format=EPUB；既有document/page=1是兼容定位信封，不显示为物理页码，必需blockIndex按BookState.unitCount校验。旧格式DTO字段/引用保持。个人笔记隐藏无意义页码输入，切章保留原引用；列表和导入阶段区分“章节阅读已就绪”与“AI尚未提供”。

## 证据与失败保留

证据目录：.taskbook-working/epub-20261018/。

- full-final3.log：170文件1518项测试通过；types-final3.log非增量TS通过，lint-final3.log与tests-lint-final3.log为源码及--no-ignore测试/脚本ESLint通过。git diff --check相关实现通过。
- 新独立ZIP写入夹具产生真实EPUB字节（原创EPUB3/EPUB2结构软件样本，不是EPUBCheck合规认证），测试读取实际压缩数据、28段及1/14/26导航映射、网络调用0、危险内容去除、损坏/预算/CRC/实际解压保护，空文本/实体/外部DTD/隐藏标题/目录超量/重复锚点拒绝。worker无AI/重放及null页码引用边界补回归。
- http.json：20项真实HTTP检查通过；两个原创EPUB经真实upload-intent→预签名PUT→complete→memory CONTENT_PARSE→READY，EPUB2两目录、EPUB3三目录、28段仅选3段保存；书签/续读、有效段落笔记/越界/伪页码拒绝、跨用户书籍/笔记403、format与null页码及原文件MIME/字节一致通过。第三个伪格式包最终FAILED，understandingStatus=NONE、0全书TextBlock，没有模型请求。
- 第一轮HTTP因网页未运行，checks为空已保存http-failure-offline.json并恢复本项目网页；第二轮验收脚本对预期400仍读取成功data而中断，修脚本留http-failure-harness.json；第三轮伪包等待30秒不足现有4次重试总35秒，留http-failure-retry-timeout.json，改为60秒有界等待后完成。没有为刷成功循环模型或更改旧队列策略。原首次回归中CRLF导致worker/引用分支未插入，真实集成测试发现后修复；最初TS发现Buffer上传类型，最终均复验。
- browser.json、desktop.png、mobile.png：原会话已登录，未输入或更换用户凭据；只将本轮原创临时资料临时绑定到当前可见学习者，方便原生验收，随后精确清理该资料，不变任何原资料或账号。第一次等待预期标题与上传默认文件名不同，按页面实际标题重新核对，没有据此修改业务标题规则。章节切换/提取6/28、笔记输入在第26段后切回第一章仍保存ref.blockIndex=25；从第27段续读/书签，刷新恢复27。无iframe，390px实际documentWidth382，新书籍控件高度≥44。学习中心显示EPUB无固定页数、AI尚未整理。浏览器临时视口恢复、临时标签关闭，原登录保持。
- protection.json：原43张业务表全部列逐行摘要一致，含13张历史Exam表；两env/schema/原迁移/登录人脸页面内容哈希一致；实际uploads目录20文件的路径/大小/修改时间摘要一致。媒体未逐文件计算内容哈希，因此不是全媒体字节一致证明。cleanup.json：临时两用户/三资料/其笔记任务及登记的对象均清理；只按精确synthetic ID+storageKey+文件名前缀处理，未删除原用户。fixture.private.json随机密码已清空。

## 文件与复现

主要实现：src/lib/books/epub.ts、epub-zip.ts、source.ts/contracts.ts/service.ts，content-parse.worker.ts，content-format.ts/storage.ts/content-ref.ts/content-mapper.ts/study-location.ts，现有上传/学习页、BookReader、ContentStudyMeta、笔记创建/编辑接口及帮助。新脚本scripts/acceptance/epub-reading.ts（运行/cleanup），测试夹具与回归同名。

运行 npx tsx scripts/acceptance/epub-reading.ts 创建隔离账号并做真实上传，浏览器若不切临时账号就只做HTTP检查；运行 npx tsx scripts/acceptance/epub-reading.ts cleanup 清理精确登记对象。重复前必须清理上一轮。不要把fixture随机密码粘贴到聊天或保存进浏览器。工程命令见日志对应npm test、tsc --noEmit --incremental false及ESLint。

规格同步01/02/03/04/05/06/21/23、README与PROGRESS；没有本编号新增TODO，修改的非TODO是格式支持、引用/预算/数据协议、现行任务和使用指引，使之与实际交付一致，历史章节保留身份。

## 尚未验收/未实现

没有新生产构建/生产包启动、EPUBCheck认证或全部市售书兼容测试。本版只支持无DRM标准文本层书籍的有界子集；图片/数学公式/复杂排版不渲染，包含外部DTD或加密字体的书也可能明确拒绝。没有云OCR/ASR/大模型/LoRA训练或新书AI内容质量验收。保留星火READY=false历史质量边界。下一编号29.14公开文章/直接PDF URL，再29.15章节AI与摘录专题，班级/批改仍未实现。

依据：[W3C EPUB3.3](https://www.w3.org/TR/epub-33/)、[saxes](https://github.com/lddubeau/saxes)。
