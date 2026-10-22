# §22.5 本地演示启动与预检

2026-10-12 08:48完成。仅处理当前本地毕设演示运行入口；先明确TASKS与DEPLOY，再实现，不新增业务模块/页面/接口，不改.env.local或安装服务。

## 使用入口

- 双击桌面主仓库根目录“启动演示.cmd”，或终端执行`npm run demo:start`。批处理只定位自身仓库、切换本窗口UTF-8输出并调用既有npm；不会自动开放摄像头或替用户登录。
- `npm run demo:check`：已有资料展示档。检查Node、只读数据库/资料、三份原媒体大小、本地JWT工具及memory/local驱动；网页品牌确认。Agent与星火只检查凭据/本地额度确认，人脸只读模型健康。Redis 7/Docker不作为本档必需项。
- `npm run demo:check -- --import`：另查真实Ascend模型健康、推理功能/Token、讯飞ASR配置、星火配置及ffmpeg/ffprobe。未通过退出1，不自动启动云端、创建订单/任务或重跑资料；即使全部前提就绪也不等于完整导入或外部额度验证通过。

启动器复用已运行的文豪3000网页；其它/未确认占用者拒绝，不停止端口占用进程。空闲时只启动自己拥有的前台Next CLI、绑定回环127.0.0.1:3000，不写PID管理文件或启动生产消费者。已有网页的品牌检查不证明进程来自当前仓库/环境最新，配置修改仍需本人回原终端处理。

## 实际结果

`scripts/demo/local-demo.ts`实现只读与脱敏检查，package.json新增demo:check/demo:start；根CMD作为操作入口。DEPLOY及本地演示操作单同步当前流程，保留旧云端期限/故障为历史。无新依赖、架构/API/业务字段变化，无TODO补全；非TODO把当前MVP“Docker/5分钟全链路”改为本机已验证的memory/local资料展示口径，不删除通用生产规则。

- 最终展示/复用：`.taskbook-working/local-demo/1791766031068-75f554f1-0218-4681-abdf-98eabcbbf021/report.json`，ready=true、modelCalled=false、databaseWrites=false；Node、数据库、三份READY/COMPLETED资料与原媒体大小匹配，本地认证工具可签发/校验，当前memory/local符合。demo:start打印复用并退出0，没有重启正在使用的网页或清空助手对话。早先展示检查和start同样通过的报告也保留。
- 最终新导入前提：`local-demo/1791766090271-6dfae900-6996-47a6-a8a9-bc690d567cbf/report.json`，ready=false：Ascend健康不可达、真实ASR配置条件未通过；ffmpeg/ffprobe可运行，星火与推理Token/开关仅配置检查通过。人脸服务同样当前不可达，但不阻止密码/已有资料展示。之前单独import入口实际退出1；最后import与ESLint放在同一shell调用时整体exit0来自随后ESLint，不得当作预检通过，最终ready=false证据保持。
- 初版错误把生产JWT长度要求直接用作本地阻塞，保留`local-demo/1791765728614-3b3ca3b2-0962-4de1-b104-695a8611c628`失败报告。现按既有auth工具实际签发/校验验证开发契约，虚拟local-preflight令牌仅在内存中核对、不发送、不记录、不登录账号；没有改密钥或降低现有应用保护。此项不提供生产密钥安全结论。
- 最终`local-demo-20261012-final-checks/vitest.json`10/10通过，覆盖必需项失败不得启动、离线/占用区别、展示不依赖云端/AI/人脸、新导入单独前提及媒体越界/空路径；TS strict、两个文件ESLint通过。初版8项报告保留。未重跑与本脚本无关的全站测试。
- `local-demo-20261012-readonly-after/report.json`工具检索modelCalled=false，十类学习数据指纹仍`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`，与此前验收一致。未产生题目、学习记录、计划、ASR订单或AI调用，不改三份资料。

媒体路径解析拒绝出目录，并realpath复核符号链接；读取文件大小不等于浏览器解码通过。服务健康请求不跟随重定向、有4秒期限，网页检查8秒期限；数据库连接/池与读取事务有界。报告不含私有存储键、网址/DSN、JWT/Key、上游正文或异常消息，每次生成新时间戳+UUID目录，旧结果不覆盖。

本项脚本/文档与实际复用、成功/阻塞判定已完成；本轮没有停止正在使用的网页，因此冷启动与关闭子进程未在本人运行环境实操，未自动打开CMD新窗口。空端口/拒绝分支由回归验证，Next CLI为既有安装入口。现场新导入与人脸服务当前阻塞属于外部条件，本项不擅自恢复云端、安装依赖、启动摄像头或宣称真实识别/完整导入通过。
