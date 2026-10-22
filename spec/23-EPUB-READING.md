# §29.13 EPUB安全阅读

## §29.13 EPUB首版实施契约（2026-10-18）

在原学习中心文档入口支持EPUB，≤50MiB。服务端验证ZIP中心目录/本地头、CRC、压缩方式、路径和预算，ZIP64/多盘/加密/DRM拒绝；不解包到磁盘、不读取包外文件。最多2000条目、单条4MiB、累计解压32MiB、压缩比200、XML深度64/10万节点、正文200万字/2万段/200个spine项目，每段≤2万字，超限整次失败而非截断成功。仅文本层阅读，不支持复杂排版/图片/公式呈现；不加载远程资源或执行脚本。

读取container.xml→OPF manifest/spine，导航EPUB3 nav优先、兼容EPUB2 NCX，真实锚点映射到全局稳定段号；无可靠导航明确按spine阅读顺序，未解析目录不猜。新增BookState.format=EPUB与epub-nav/epub-spine来源，复用已有BookState JSON/CAS与20段选取、50万字保存预算，无迁移。书籍上传验证后READY且自动建立目录；units仍空，选定范围后才保存正文，不入全书TextBlock或自动UNDERSTANDING，AI仍NONE。首版章节AI留29.15。

ContentRef沿用document+page=1+blockIndex（全书从0开始的稳定段号）兼容信封，EPUB不展示/推断固定页数，pageCount=null；ContentSummary仅EPUB增加可选format=EPUB，笔记接口以BookState.unitCount核验page=1和必需blockIndex边界，不借假页数通过校验。手工目录修改不改变段号；源哈希变化拒绝提取，需新资料ID重新导入。章节内位置可由目录范围对应；书签/引用/个人草稿与旧PDF/TXT/MD保持。EPUB笔记隐藏无意义页码编辑，明确全书段号；原始EPUB不放iframe。

仅新增saxes@6.0.0（ISC）严格XML事件解析及其xmlchars依赖；拒绝实体/外部DTD，仅允许不含外部标识的DOCTYPE html，解析错误统一固定提示，不输出书内路径/文本。ZIP采用Node zlib有界inflateRawSync与crc32，不引入ZIP解包器。详见23-EPUB-READING.md，URL/专题/章节AI均不在本编号。

## 验收

原创标准EPUB3与EPUB2包验证spine顺序与导航锚点、纯文本净化、书签续读/手动分章不改段号。真实上传/完成/READY、目录/20段索引/笔记引用回看/跨用户拒绝；损坏、伪格式、CRC、重复路径/穿越、加密、ZIP64/压缩炸弹、XML实体/深度/缺spine/空文本独立拒绝，无包外网络请求。宽窄屏原生阅读验证，临时账号/对象/记录清理。不能以软件PDF样本替代EPUB包；生产构建/真实下载阅读器/复杂排版和AI质量未验则明确记录。
