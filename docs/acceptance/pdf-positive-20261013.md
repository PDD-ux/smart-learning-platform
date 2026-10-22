# §22.25 三页PDF正向流程验收

完成时间：2026-10-13 14:08（北京时间），桌面主仓库。结论：技术流程通过，内容质量未通过。

## 样本与边界

从现有原PDF复制前三页为独立隔离测试PDF；使用PDF技能的pypdf生成，Poppler渲染三页逐页视觉检查，没有新增缺字/裁切/排版缺陷。原PDF未编辑、替换或增加到原账号资料列表。该样本是首页、目录及题量介绍，不能代表后续逻辑推理例题或完整222页。

新增scripts/acceptance/pdf-positive-smoke.ts，使用实际登录、上传意图、PUT媒体、complete、异步解析与理解接口/任务；不是复制预解析文本代替导入，也没有空操作阶段或mock大模型。采用当前配置星火，未切换、重试整份或绕过内容审核。没有修改业务页面/API/表/模型配置或新增依赖。

## 技术验证通过

- 实际约36371ms完成：READY、理解COMPLETED，3页/3文本块、5知识点、5复习卡片、GeneratedNote sourceCount=5。
- 每个知识点有合法本样本1—3页引用，卡片与知识点数量匹配。知识点接口、AI笔记接口及复习卡片接口返回与数据库一致。
- 读取签名原资源成功，返回字节与上传PDF完全一致；匿名理解接口401。未增加第二账号交叉归属或真人浏览器操作验收，不扩展成所有权限通过。
- 临时账号与关联数据、临时上传媒体均清理，原资料/笔记/成绩/计划及.env/.env.local指纹一致。三页本机测试副本和渲染证据保留于忽略目录。
- TypeScript和新增脚本ESLint通过；项目125文件979项全量回归通过、demo:check退出0，记录见full.log、demo-check.log。

## 人工内容核对未通过

产物已留products.json，不能因为结构/引用合法就算忠实性通过。摘要及对应复习卡片把题量占比数据扩展为“命题难度分布”，原样本没有支持这个结论；另有框架摘要表述偏宽泛、后两条知识点重复考查同一比例公式。没有修饰或改写模型产物掩盖失败，semanticAccuracyAccepted保持false。

本次仅在临时账号进行生成，不发布这些质量未通过的产物给原学习者。后续需要独立加强原文忠实性与去重验收；不是放宽审核、跳过原被拒页段或声称星火复杂解释可靠。

## 复现与未完成

npx tsx scripts/acceptance/pdf-positive-smoke.ts .taskbook-working/pdf-positive-replay-新时间 .taskbook-working/pdf-positive-20261013/first-three-pages.pdf

需要当前本地网页、PostgreSQL、本机星火配置和三页样本；必须使用新输出目录。工具默认清理临时账号/媒体，不改原账号；输出在.taskbook-working/pdf-positive-20261013/real/report.json、products.json及同级protection.json、types.log、lint.log、run.log、full.log、demo-check.log。输入样本渲染page-1至page-3.png保留，可用extract.py从原PDF复现。

§22.25只完成本轮技术链路与质量检查。§22.15的完整222页AI理解/原PDF补修仍未完成：原被拒页段仍10013，本轮没有重试它，也未恢复Ascend/人脸、生产Docker/Linux或公网验收。

