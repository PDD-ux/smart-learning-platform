# §22.12 项目系统测试（2026-10-12）

完成时间：2026-10-12 17:42，Asia/Shanghai。桌面主仓库、本地毕设演示。任务只测试与记录，不批量修改业务模块。

## 结论

当前项目不能判定为全部正常。全量自动回归通过，真实系统测试仍发现登录同源判断、出题质量、长PDF覆盖、启动预检和失败上传残留问题；standalone打包另有缺失风险。环境未启动与产品缺陷分别记录。

## 已验证

- 118个测试文件、874项自动回归最终全部通过；初次873/874，唯一失败是旧集成测试把相对上传URL直接传给NextRequest。按已修改的同源URL契约补base后重验并全量通过，未放宽断言或业务鉴权。
- TypeScript严格检查通过；全项目ESLint无错误、3条既有字体/img性能建议。新增系统测试入口也通过TS/ESLint。
- scripts/acceptance/system-test.ts使用临时2学习者/1管理员和人工课件，真实HTTP/PostgreSQL最终85/86检查通过。原资料及关联产物指纹前后相同，账号/内容/文件清理完成。
- 登录成功、外站续期403、普通用户访问管理接口403、未登录读取401、跨账号读写403；管理员创建/查询/编辑/删除、自删/自降级限制通过。
- 笔记创建/修改/删除、版本增加、旧版本覆盖明确isOverwritten=true、越权拦截通过。该项目契约是后写覆盖提示，不是旧版本409，测试预期已校正。
- 复习XP/下次日期、非法评分、越权拦截；普通打卡幂等，同一天一条，通过。
- 既有learner-reliability入口真实验证55资料与55到期卡分页、未来卡排除、改名/级联删除/归属保护，使用本轮输出副本，不覆盖旧验收报告。
- study-plans-bank真实26检查通过：计划创建/到期/完成/恢复/删除/归属保护，题库未答不泄露正确答案、错题/正确判分/筛选。
- 人工Markdown真实上传、complete、异步理解、知识点/生成笔记/原文资源字节核对通过。不是222页或长视频新的全量验收。
- 真实百炼Agent回答链式法则，导数6(3x+1)与人工资料一致，引用第1页正确；没有写入原学习者计划或答案。不是整体语义准确率声明。
- 真实星火生成2道选择题，接口200/9921ms，质量审查发现1道不可用，详见缺陷B02。保留原始响应，HTTP成功不计质量通过。
- 本地FunASR真实30秒音频3段、7883ms，通过；7项Python时间/VAD回归通过，无云ASR调用。
- Edge当前PDF第218页加载成功、宽1241像素；桌面1560×901没有横向溢出。另开临时工作台标签实际复现续期导致多模块读取失败，未调整用户页面尺寸或在原账号提交答题/计划。
- 两轮隔离生产快照构建通过，未替换运行网页的.next。standalone启动、真实登录200、Secure/HttpOnly Cookie、授权内容200、匿名401、普通用户管理403通过；退出403，未判完整生产验收通过。临时生产账号/服务器/快照已清理。

## 确认的问题与修复顺序

### B01 高：127.0.0.1续期/退出失败

同一临时学习者、同一refresh Cookie，Origin=localhost且URL=localhost时200；Origin=127.0.0.1且URL=127.0.0.1时403。外站Origin仍403。真实Edge工作台显示多个读取失败和“请求来源无效”。生产3100的合法Origin/X-Session-Refresh退出也403。

复现：用127.0.0.1网页登录，等待access即将到期，进入工作台或题库；不能可靠恢复会话。原因指向src/lib/auth/same-origin.ts按request.url.origin比较，客户端访问源与服务端构造URL不一致。修复应明确可信外部源，继续拒绝外站，不应取消来源检查。

证据：http-final/report.json、dashboard-renewal-failure.png、production-build-final.log及第二轮stdout。优先修此项，避免所有模块表现成随机读取失败。

### B02 高：生成选择题允许纯字母占位选项

真实2题中一题“链式法则内容是什么？”的options=[A,B,C,D]；具体选项文字只在explanation中，仍被正常保存。该题学生无法据题面选择有意义的答案。另一题有完整文字。

复现：在有链式法则原文的临时资料上POST /api/exercises/generate，pointIds为该资料知识点、count=2、type=single_choice。该样本具有随机性，不承诺每次同样失败。当前options校验只做格式/数量等结构约束，未充分阻止占位选项。应增加选项内容与正确答案一致性门禁，并拒绝存储不可用题。

证据：exercise-generation.json原始题面/答案/解析、exercise-quality-review.json（transportPassed=true，businessQualityPassed=false，1/2不可用）。本次保留模型失误，不把200当出题质量合格。

### B03 高：长PDF只有末尾章节摘要

222页正文已正确提取113799字，但知识点/笔记4条只引用209、213、216、218页，判断推理前部章节未覆盖。当前上下文预算约6k并选取来源，页面已提示不是逐页覆盖；属于功能覆盖不足。下一任务应按章节/页窗分批整理，不通过反复点“重新整理”冒充全篇。

证据：上一任务pdf-repair-20261012/report.json、final-progress.json，以及本轮Edge实际显示。

### B04 中：启动预检误报本地ASR未配置

直接运行local-demo.ts check --import时ASR_PROVIDER在loadEnvConfig前为空，加载后仍为空，但本地Python/模型路径已填入；报告blocked。先加载环境再动态导入inspectDemo时provider=funasr-local、报告configured；实际转写也通过。入口静态导入导致部分.env值先进入进程，.env.local未按预期覆盖，必须统一环境加载顺序，不能仅让用户反复填密钥。

证据：preflight-order.log、preflight-env.ts的实际stdout、asr.json。旧auth-session脚本也在本地验签阶段报invalid signature；与真实HTTP登录/localhost续期成功不同，列为验收入口配置不一致，不据此宣称业务JWT失效。

### B05 中：失败上传留下重复待导入资料

原数据库有8条该PDF的PENDING记录，8条均无对应原文件。前端失败后重新创建意图，旧记录未回收或复用，会污染资料列表。应提供失败意图取消/有界回收或恢复策略。未删除这些原记录。

证据：pending-and-cleanup.json及上传意图/导入页面代码。不要按文件名盲目删除成功资料。

### R01 部署风险：standalone未包含PDF/ASR运行资产

隔离生产包实测pdfjs-dist的CMap、PDF worker与services/local-asr/transcribe.py均不在预期运行路径。构建成功不证明新的PDF或本地ASR能在独立服务器处理。须补资源打包及路径，再用真正standalone完成新PDF/ASR请求。当前只实测资产缺失，不冒充已执行完整生产导入。

证据：standalone-assets.json。当前本地开发环境已经有这些文件，不意味着部署包也有。

## 环境阻塞及未覆盖

- Ascend当前不可达，本轮不启动收费Notebook、不重新做长视频全流程或训练；视频视觉完整链路当前不能验收。
- 人脸服务8002未运行，本轮不采集/传输真实人脸，不重置模板；实际扫码识别准确率未验。
- 页面HTTP200只验证页面可达，不等于管理员/手机/所有交互验收。真实Edge会话被B01阻塞，其余交互用组件回归及隔离真实接口覆盖。
- 未做公网HTTPS、跨设备、长时并发、离线恢复、噪声/多人ASR、所有AI问题语义准确率测试。
- 当前演示不是“所有bug已修完”，业务缺陷修复另编号。本任务仅补测试入口及失败集成测试的相对URL兼容。

## 复现入口

在桌面主仓库执行，输出目录必须为新目录，禁止覆盖本轮证据：

```powershell
npx vitest run --reporter=json --outputFile=.taskbook-working/<新目录>/vitest.json
npx tsc --noEmit
npm run lint
npx tsx scripts/acceptance/system-test.ts .taskbook-working/<新目录>/http
npx tsx scripts/acceptance/local-asr-product.ts .taskbook-working/<新目录>/asr.json
D:\python\python.exe -m unittest scripts/acceptance/test_local_asr_sample.py
```

system-test会做限定的真实文档理解与Agent请求，使用既有云额度；不要频繁循环。它只允许本地地址和自建临时账号，不记录凭据；缺陷存在时返回非零。复制旧验收脚本产生的中间失败全部保留，没有用放宽业务断言将失败改成成功。

原始证据位于.taskbook-working/system-test-20261012；完整源码在scripts/acceptance/system-test.ts。此次无TODO补全，非TODO只更新TASKS/PROGRESS/LEARNINGS和测试说明，不改PRD、业务架构、表字段或页面。
