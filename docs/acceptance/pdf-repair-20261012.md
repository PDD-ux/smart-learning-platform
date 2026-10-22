# §22.11 PDF真实分页与阅读修复

2026-10-12 17:09（上海）。仅处理PDF导入→阅读→旧错误产物修复。

根因一：旧document-parser按PDF内部BT文本对象顺序分配页码，缺少页面树/中文字体映射。222页资料第一条正文只有www、第二条只有.wenchaoedu.com，AI产物仅一条泛化结构化知识点。改用固定pdfjs-dist 4.10.38按真实页面getTextContent、CMap/标准字体资源、isEvalSupported=false。损坏/加密不伪造正文；扫描空页仍交由视觉OCR。内部parseDocument改为异步，两处流水线调用同步修改。

根因二：用户网页进程未配置pdftoppm且其PATH无法找到工具，真实第7页接口500；在忽略.env.local配置已有Poppler绝对路径后，第7页200/image/png/335589字节。并将local阅读URL改为同源相对路径、S3不变。页面加载失败有重试本页及打开原文件入口。

实测正文222页、每页有文字、总113799字符。抽查第7页与渲染一致：类比推理定义及例题。保存extracted.json与render/page-7-007.png，非逐字准确率声明。

用户资料cmv50hdl7001lzh2svs7pjypg旧正文/知识点/笔记/闪卡先保存before.json、before-retry.json。正文替换为真实分页后重新入队真实理解，单次27130ms/SUCCEEDED/COMPLETED，产出4知识点、4闪卡、笔记sourceCount4，标题涉及立体图形基础/截面/拼合。原手动笔记0条，未修改；三份保护演示资料指纹不变。详见.taskbook-working/pdf-repair-20261012/report.json、final-progress.json、repair-start.json。

明确剩余：当前文档上下文6k预算选取来源，这4条主要来自末尾章节，不能代表222页全文。PDF笔记界面已说明摘要不代表逐页覆盖；按章节批次整理另编号，不在本次顺手扩展。Edge页面当前不能通过已连接浏览器核对，用户刷新后可查看修复结果；实际接口与页面组件回归均已验。

49项回归通过（PDF解析3/resource7/object8/light-filter15/study-focus12/study-text-blocks4），TS通过；ESLint无错误，study原生img两条性能建议警告。最初新增UI测试误用未安装的jest-dom匹配器，改用已有Chai后通过，未加测试依赖。

同步package/lock、README、DEPLOY、ARCH/DATA/DESIGN、TASKS/PROGRESS/LEARNINGS；无TODO补全，非TODO改动为实际分页、异步契约、同源阅读、失败提示与依赖说明。Next服务端外置pdfjs-dist；生产standalone字体/worker资源打包另待部署验收，不宣称已通过。
