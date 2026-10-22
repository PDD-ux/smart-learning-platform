# §22.21 standalone PDF／本地ASR运行资产 · 2026-10-13

完成：2026-10-13 10:10（北京时间）。本地Windows隔离production/standalone验收；未实测Docker、Linux运行时或公网部署。

## 改动

next.config.mjs按本机Next14.2.21的experimental.outputFileTracingIncludes对内容API明确带入pdfjs-dist legacy运行模块/worker、cmaps、standard_fonts、包元数据/许可及services/local-asr/*.py。不复制密钥、Windows venv、私有模型或学习媒体。应用原PDF路径与本地ASR脚本启动路径保持。

scripts/acceptance/production-demo-smoke.cjs快照复制加入services/local-asr；新增--runtime-assets真实资源验收，支持--output-dir新的忽略目录以保留历史报告；原生产退出补现有Origin/X-Session-Refresh契约。运行账户/签名密钥不改。测试子进程关闭所有付费模型凭据/真实Ascend，使用memory队列与0额外重试；不修改原env。

同步ARCHITECTURE/DEPLOY/TASKS/PROGRESS/LEARNINGS。没有TODO补全，非TODO同步资产交付和外置运行时边界；无新依赖/接口/数据字段。Dockerfile原runner直接复制standalone、worker保留完整源码依赖，本次不引入未验基础镜像/自动Python安装。

## 实际验收

- 全量123文件946测试通过，TS通过；Next配置与验收脚本ESLint、node --check通过。生产构建保留既有字体/原生img警告，不隐藏；最终next.config仅整理换行，配置逻辑与已验构建一致。
- 独立系统临时快照build及真正standalone/server.js运行成功，3100回环HTTP登录/认证/Secure+HttpOnly Cookie、本人资料、匿名401、学生管理403、同源退出通过。没有用next start替代standalone。
- 打包中的PDF模块、worker、中文CMap、标准字体及三份ASR脚本存在且与原文件SHA256一致；不是只看构建退出码。
- 经真实临时账号申请/上传/complete接口处理原222页中文PDF副本，READY，pageCount222、222条PDF文本块，实际包含中文。原文件只读取，临时副本在快照uploads中；不是222页完整知识点/笔记生成。
- 用原课堂535–565秒已保留真实WAV，加合成黑色视频帧制成30秒测试MP4；经standalone真实上传/解析与本地ASR适配器执行，READY、3条非空真实转写，时间合法且在31秒边界内。是运行资产/转写验收，不是课堂帧分类、ASR准确率或整课效果验收。
- 外置现有本机Python和校验模型被使用，没有把venv/模型打进生产包，不能据此宣称其它服务器环境已安装。
- 首轮在资源/实际PDF与ASR步骤之后，验收断言误要求两份理解状态都是FAILED，实际视频COMPLETED且无知识点。保留process.log/build.log失败。修改为如实记录终态和0知识点、不接受模型理解通过后，第二轮production-2.json实际成功：PDF理解FAILED，视频理解COMPLETED，generatedKnowledgePoints=0，modelUnderstandingNotAccepted=true。
- 第二轮临时账号/资料、standalone服务、快照均清理，3100无监听；原env和全部非测试学习关联数据保护指纹一致。开发.next未替换，原网页保持，普通demo:check退出0。受控无付费模型调用，未操作本人摄像头。

证据：.taskbook-working/standalone-assets-20261013下process.log/build.log（原失败）、process-2.log/build-2.log/production-2.json（成功）、tests.log/exit、types.log/exit、lint-2.log/exit、protection.json和dev-check.log/exit。一次生成第二轮临时执行文件时误用了文档变量，语法失败发生在请求/构建前，修正后重新执行；不将工具错误当模型故障。

## 复现

在桌面主仓库，3100空闲、既有强JWT/存储签名配置与数据库有效、Python/模型/ffmpeg及样例已准备时：

```powershell
node scripts/acceptance/production-demo-smoke.cjs --runtime-assets --output-dir .taskbook-working/standalone-runtime-repeat
```

输出目录必须新的.taskbook-working子目录，不加--repair-local-secrets。runtime-assets调用现有本地CPU模型并创建临时资料，不触碰原数据，结束仅清理自身数据。该输出参数在核心真实验收后添加，已做语法/ESLint检查；本次实际跑的是等价忽略副本run-2.cjs以使用独立日志，核心资源/生产代码相同。

## 仍未完成

R01打包遗漏在本地standalone已补齐并实际验收；Linux/Docker/Python模型挂载、ffmpeg/Poppler及公网HTTPS仍需目标环境验证。现有Alpine镜像不能把Windows venv挂上就称本地ASR可用，默认云ASR配置保留，不自动安装torch或切换基础镜像。

新发现：关闭/缺少大模型时，视频understandingStatus仍可COMPLETED但知识点0、product-gen跳过。这是另一个状态准确性问题，需要后续编号处理，当前没有改流水线或把它当AI成功。原§22.15完整长文档理解、模型语义质量、Ascend/人脸不可达及公网验收不因资源打包通过被核销。
