# §10.4 桌面主仓库接入 Ascend 的本地产品验收

2026-10-08，按用户确认在 `C:\Users\qwh76\Desktop\智能学习平台` 启动本地开发网页并接入 ModelArts Ascend。仅推进 §10.4 产品接入验收，没有修改页面、接口、字段或已有内容。该结果覆盖一张图片的实际产品 API/worker 流水线，不代表全产品、长视频或生产部署通过。

## 环境和入口

- 本机 Next.js 14.2.21 开发服务 `http://localhost:3000`，PostgreSQL/Redis 使用既有配置；memory 队列在同一 Web 进程执行，不启动生产 BullMQ worker。
- ModelArts Ascend 910B4、MindSpore Lite 2.7.1/CANN 8.3.RC1；复用已验证的独立 venv。当前服务目录 `/home/ma-user/work/taskbook-demo-uPT34AXZ`，旧推理目录、全局包和模型文件未覆盖。
- 真实服务仅监听云端 `127.0.0.1:18765`，经 SSH 隧道接本机 `127.0.0.1:8001`。健康检查 `device=ascend, modelsLoaded=true, mock=false, ocrFallbackAvailable=false`。
- 上传源码 `ocr_runtime.py` 本机/云端 SHA-256 一致：`6614f5c309c61bbe62e4b0d88704a159da0c1a2c9e011bbe9a31fc8989a5351b`。
- 随机推理令牌只存进程内，通过 SSH stdin 和 Next 子进程环境传递。没有修改 `.env`；上传签名参数在演示日志落盘前遮蔽。验收临时账号密码不落盘、不输出。
- 启动/停止步骤见 [DEPLOY §8.5](../../DEPLOY.md)。入口为 `scripts/demo/run-ascend-demo.py` 与云端助手 `scripts/demo/serve-ascend-demo.py`。状态在 `.taskbook-working/ascend-demo/current.json`，本次会话日志目录为 `20261008T012940Z`。

## 实际验收

入口 `npx tsx scripts/demo/accept-local-product.ts OUTPUT.json` 创建独立临时账号，通过真实 `/api/auth/login` 获取令牌，再依次请求 upload-intent、PUT 直传、complete。轮询真实数据库任务，调用 understanding API 核对可取回产物。没有伪造既有账号 JWT，没有触发旧视频重生成。

样本为诊断目录 `frame_014.jpg`。两轮均退出码 0、内容 READY、理解 COMPLETED、两项异步任务 SUCCEEDED；各得到 **95 个 OCR 文本块、2 个知识点、2 张闪卡**。95 块文字按序与此前真实 Ascend 直调输出全部一致，日志 `degraded.infer=false`；阶段 A/B 与产物生成均完成。图片不调用 ASR，知识点/闪卡沿既有星火服务路径生成。

第一轮北京时间 09:27:38–09:28:17，第二轮 09:31:20–09:31:50；这是含登录/编译/上传/大模型/清理的功能验证窗口，不是推理 P95 或并发性能。精确时间、样本指纹、逐块文字和任务状态以原始 JSON 为准：

- [第一轮](mindspore-20261008-product.json)
- [重启后第二轮与环境证据](mindspore-20261008-product-repeat.json)
- [SSH 断开后第三轮与独立进程证据](mindspore-20261008-product-detached.json)
- [第一轮脱敏日志](mindspore-20261008-product-first.log)
- [第二轮脱敏日志](mindspore-20261008-product-repeat.log)
- [第三轮脱敏日志](mindspore-20261008-product-detached.log)

每轮结束通过产品 DELETE API 删除自己的临时内容，再删临时账号；对象清理日志确认源图片删除。对验收前已有 **18 条内容**及其转写、文本块、用户笔记、闪卡、生成笔记做前后结构化 SHA-256 比较，两轮均一致。指纹核对不覆盖所有数据库表，不当作全库审计。

## 停止与重启

第一轮停止文件触发后 controller 记录 `stopped`；本机 3000/8001 无监听，远端 `ss -ltn "sport = :18765"` 只返回表头。其服务以 SIGTERM（-15）退出，符合主动停止预期。第二轮在 09:31:03 ready 并完成产品验收，但其云端前台 SSH 服务会话于 09:36:56 被远端关闭，controller 记录 `failed/RuntimeError`，提前结束网页和隧道。产品图片验收和学习页只读检查当时已完成。

为避免推理服务依赖长期存活的登录 SSH shell，入口改为一次性 SSH 启动命令，然后在云端独立 session 启动有时限的服务进程；本地 controller 按 PID 停止服务。第三轮从 09:38:24 启动、09:39:45 ready；超过前次断连时间后，于 09:46 通过真实产品 API 再次上传同图成功，95 个 OCR 文本块与直调输出一致。09:47:23 复核时 controller 仍 ready、网页 HTTP 200、云端进程和 18765 监听正常。该实测越过此前故障窗口，不等于两小时上限已跑满。证据见第三轮 JSON 和脱敏日志。

浏览器只读核对当前已打开的既有学习资料页：页面标题正确，1 张图片可见，完成态显示 2 个解析要点、76 个 OCR 文本块、AI 整理笔记及摘要；转写区为 0 段。控制台无 error/warn。该资料并非本报告临时验收图片，未编辑笔记、提问或触发重新生成。

第四轮启动验证期间实际触发停止文件，controller 于 09:52:55 正常完成清理，`cleanupErrorTypes` 为空；本机 3000/8001 与云端 18765 均无监听。该轮确认修复后的停止命令可释放 Web 子进程树、SSH 隧道和云端 PID。随后重新启动，让用户继续查看页面。

09:55:31 启动的旧会话于 10:05:22 因云端连接中断退出。10:14:58 重新启动的会话于 10:16:31 ready；完成下述隔离视频尝试后于 10:22:07 主动停止，本机 3000/8001 与云端 18765 均已释放。云端设备仍须受 ModelArts Notebook 到期时间限制；重启需依照 DEPLOY，直连 IP/临时 venv 路径可能随环境变化而失效。

## 未完成和限制

- 浏览器仅核对一个已有资料的完成态展示，没有登录、点击笔记/闪卡/问答、改变学习进度或完成完整学习/复习主路径验收；本轮未额外截屏或修改页面数据。
- 只读检查数据库中 6 段既有 2.5 小时以上视频：约 2 小时 51 分内容标为 READY/理解完成并有 1,716 条转写，但没有 OCR 文本块、知识点、闪卡、练习、笔记或生成笔记；约 2 小时 46 分内容标为理解失败，最新理解任务却仍是 `RUNNING/light-filter`（3 次尝试），无任何转写/学习产物，存在状态不一致；另 4 段理解任务在 light-filter 四次尝试后以媒体解码错误失败，均无转写/产物。只读对照的一段 30 分钟视频已有 510 条转写、1,383 个 OCR 块、5 个知识点和 5 张闪卡。查询不返回视频标题/原文，也未重跑或改变任务。
- 先前浏览器用户标签页尝试打开长视频时被重定向到登录页；当时未输入或读取凭据、未更改内容。此次长视频验收停止时也释放了本机 3000/8001；继续页面检查前需依照 DEPLOY 重启演示并由用户登录。
- 对既有长视频的隔离 46 分钟剪辑已做真实产品链路尝试，但两类请求超时，视频 ASR/笔记、长时稳定性、100 用户并发及生产 worker/常规网络入口仍未通过；详细证据见文末。未对原视频或其学习记录执行操作。后续复验前需先定位 16 帧视觉请求和讯飞第二音频段超时，并关闭会重复产生外部调用的自动重试。
- OCR 遮挡、小字、Go 大小写/标点和界面噪声仍存在；参见 [OCR 修复记录](mindspore-20261008-ocr.md)，不能以此次接通宣称整体精度达标。
- 开发编译提示缺失可选 `@valkey/valkey-glide`，本次 memory 队列的上传/理解已成功；未为消除该提示引入新依赖或改动生产队列。
- 初次隐藏启动在上传 SSH 初始化超时；显式关闭初始化 stdin 并增加初始化预算后，后续两次启动成功。该超时不属于模型推理失败。

## 2026-10-08 既有长视频前 46 分钟隔离验收

用户要求使用 46 分钟样本。本机 FFmpeg 以 `-t 2760 -map 0 -c copy` 从原有 2:46:20 MKV 生成独立剪辑，没有转码或覆盖源文件。剪辑为 2760.083 秒、190,132,514 字节，H.264 1920×1080/60fps + AAC；SHA-256：`90603076e50283dfd10b5df42eef9a15cfaeb6110a70df34eb10807a37a542a3`。文件保留在 `.taskbook-working/long-video-46m/clip-46m.mkv`。

### 环境与入口

- ModelArts 真实 Ascend 910B4；远端 Python 导入 MindSpore 2.7.1，预热后的 `/health` 报告 `device=ascend`、`modelsLoaded=true`、`mock=false`、`ocrFallbackAvailable=false`。本地 Next.js 页面 HTTP 200。
- 用随机临时用户通过实际登录、upload-intent、PUT 和 complete 上传剪辑；内容解析成功，`CONTENT_PARSE` 用时 494ms。理解任务由本地 memory worker 执行。
- 可复现入口为 `.taskbook-working/long-video-46m/accept-video.ts`，执行命令：`node node_modules/tsx/dist/cli.mjs .taskbook-working/long-video-46m/accept-video.ts`。启动真实推理隧道的方式见 `DEPLOY.md §8.5`。入口会调用真实讯飞 ASR 和既有星火产品生成服务；重跑会产生外部请求和耗时，须先排障并避免自动重试。
- 摘要、轮询进度与脱敏日志：`.taskbook-working/long-video-46m/product-acceptance-summary.json`、`product-progress.json`、`.taskbook-working/ascend-demo/20261008T021458Z/web.log`。演示状态见 `.taskbook-working/ascend-demo/current.json`。

### 实测阻塞

- UNDERSTANDING 第一次尝试的 `light-filter` 对 16 帧 `selectFrames` 请求触发 30 秒网关 `TIMEOUT`；日志记 `framesProcessed=16`、`retainedTextBlocks=0`，之后视觉被标记 `visualComplete=false`，OCR/文本块为 0。随后本地 `/health` 请求在 5 秒内也未返回；云端 Python 服务仍监听 18765。健康预检不能代表视频批量推理可完成。现有证据没有确定超时根因。
- 同一尝试的讯飞 ASR 第 1 个 5 分钟段成功并返回 81 个片段；第 2 段（视频 300 秒起）在 60 秒超时。阶段记录保留 81 个片段、把 ASR 标记为不完整并跳过语义阶段，所以知识点、闪卡、练习和生成笔记均为 0。UNDERSTANDING 第一次尝试耗时 147,968ms 后失败。
- memory worker 随即开始自动重试；停止时数据库观察到第 2 次尝试仍为 RUNNING。为避免再次调用讯飞，主动停止本地 Web/worker、SSH 隧道和独立云端服务，没有等待重试耗尽。该产品验收结论为**未通过/阻塞**，不能将健康检查、上传成功或首段 ASR 成功描述为 46 分钟推理通过。
- 临时账号、内容、任务级联记录及其源视频/封面对象已清理，确认删除两个对象；剪辑文件保留供复现。原视频和既有学习内容未作为测试输入或写入目标。

### 超时后的隔离复测（2026-10-08）

- 复现入口 `.taskbook-working/long-video-46m/diagnose-select-frames.py` 从同一剪辑抽取首 16 帧，经 SSH 隧道连接隔离的真实 Ascend 910B4/MindSpore 2.7.1 服务；按产品网关实际字段 `strategy=quality` 直接请求 `/select_frames`。1/4/8/16 帧均 HTTP 200、返回数量匹配，健康检查仍 HTTP 200。16 帧请求体约 4.75 MB，多轮耗时 6.7–21.2 秒。该路由执行 CPU 图像质量计算，并非 MindSpore 模型推理。此结果没有复现产品 worker 的 30 秒超时，也未排除其运行时、并发或 SSH 网络波动。
- 单段复现入口 `.taskbook-working/long-video-46m/retry-asr-chunk2.ts` 只提取视频 300–600 秒音轨，以 120 秒请求上限和最多 12 次、间隔 5 秒的轮询直调讯飞一次，不启动产品队列/自动重试。该次等待 116.8 秒后返回 `fetch failed`、0 段，临时 WAV 已清理；这说明单纯将预算从 60 秒增至 120 秒仍未通过，但没有足够信息区分讯飞端、网络链路或 fetch 层原因。
- 最新推理复测数据保存在 `.taskbook-working/long-video-46m/select-frames-diagnostic.json`；ASR 单段结果在 `asr-chunk2-diagnostic.json`；剪辑及产品原日志/进度仍保留在本目录。最后清理核对时，SSH 分别通过服务域名和先前验证的公网地址连接均被远端关闭；本机 3000/8001 已释放，云端诊断服务本身有 600 秒上限，但当前无法即时确认其 PID/监听是否已退出。当前仍不应重跑完整视频：需先在产品 worker 中复现/诊断真实网关超时，并取得讯飞端请求阶段的安全错误证据。不要记录请求签名、API 凭据或课堂转写正文。
