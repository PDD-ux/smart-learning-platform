# §10.4 真实 MindSpore/Ascend 验收预检（2026-10-08，北京时间）

## 结论与任务边界

本报告记录最初的本机/私网环境阻塞。随后用户提供 ModelArts SSH 入口，已完成真实 Ascend 模型直调及隔离 HTTP 单帧/批次执行；最新结论见 [真实 Ascend 验收记录](mindspore-20261008-ascend.md)。OCR 质量与完整产品链路仍未验收通过。未重跑视频、ASR、星火或数据库产物。按用户确认在桌面主仓库记录；当前 Codex worktree 是旧快照，缺少指定诊断目录及后续推理实现。

主仓库 `spec/05-TASKS.md` 的 121 项均已勾选，实际上没有“唯一未勾选任务”。本次仅继续 `PROGRESS.md` 断点指定的 **§10.4 P1 真实推理环境验收**；不新增产品功能，不把历史代码完成勾选理解为真实部署验收通过。

## 本次实测证据

- 当前解释器 `D:\python\python.exe`，Python 3.9.13、Windows；`mindspore` 与 `mindspore_lite` 均未安装。新入口原生退出码 **2**、`status=blocked`、`results=[]`，没有生成假推理结果。详见 [本机预检 JSON](mindspore-20261008-local.json)。
- `.env.local` 配置的服务为 `http://192.168.228.129:8001`。关闭 HTTP 代理直连时 TCP 成功，但 `/health` 报 `RemoteDisconnected: Remote end closed connection without response`。无法读取设备或模型状态，不能判定当前服务是否运行 Ascend、CPU、mock 或后备 OCR，也不能据此定位模型故障。
- 本机 `127.0.0.1:8000` TCP/HTTP 均报 WinError 10061（连接被拒绝）。WSL 列表退出码 1，提示未安装 WSL；Docker CLI 存在，但 `docker info` 退出码 1、找不到 `dockerDesktopLinuxEngine` 管道。本次未启动或安装这些环境。详见 [网络与工具证据 JSON](mindspore-20261008-environment.json)。
- 可见浏览器库存没有 ModelArts/Notebook 页；当前没有已连接的 Notebook 执行入口。历史 ModelArts 成功记录予以保留，但不当作本次环境可用证据。

## 诊断样本与现有改动检查

`.taskbook-working/video-infer-diagnostic-20261003` 有 `frame_001.jpg` 至 `frame_016.jpg`，16/16 JPEG 解码校验通过；目录只有图像，没有采样时间戳清单、人工类别标签或 OCR 标准答案。第一张有 OBS 遮挡课堂画面，不能默认全部帧都应判为有效课件。本次没有编造标签、时间或 OCR 准确率。

四个 MindIR 与字典齐全：三分类文件 1,025,078 字节；DBNet 101,491,841 字节；CRNN 90,567,490 字节；方向分类器 6,386,103 字节；字典 26,250 字节。OCR 三模型与字典的 SHA-256 均与仓库下载脚本固定值一致，样本、模型与核心源码指纹全部记录在本机预检 JSON。文件完整性不能替代 Lite 构建/执行验证。

代码已包含：Lite 模型锁、构建失败缓存、末尾 blank 的 CTC 解码、识别黑色补白、检测框纵向扩边及 Ascend 启动四模型预热。`/health` 的 `modelsLoaded` 仍基于文件和运行时条件；OCR 路由可能转用 Tesseract，分类异常可返回 `unknown`。因此健康检查或返回文字块不充分证明实际 MindSpore 后端。

既有 `real-mindspore.py` 对健康检查的连接提前关闭漏捕 `http.client.HTTPException`，本次已补捕该异常。复跑对上述私网地址正常打印阻塞原因、原生退出码 2；未进入图片推理。

## 可复现入口

新增 `scripts/performance/accept-mindspore-frames.py`，在**目标主机新 Python 进程**运行。需复制项目推理服务、该脚本、上述 16 帧及全部五项模型资产，保留目录结构；或显式给定目录。使用现有已验证的 Lite 2.7.1 + CANN 8.3.RC1 + Python 3.11 aarch64 环境，按部署文档加载 CANN：

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
timeout 600s python -u scripts/performance/accept-mindspore-frames.py \
  --device ascend \
  --frames-dir .taskbook-working/video-infer-diagnostic-20261003 \
  --model-dir services/mindspore-infer/models \
  --rounds 2 --output docs/performance/mindspore-target-result.json
```

脚本仅在自身进程设置 `INFER_MOCK=false`、`OCR_FALLBACK_ENABLED=false`，先验证资产与 Lite，再预热并直调分类器/真实 OCR 引擎，逐帧保存两轮分类、OCR 原文/框/置信度和耗时，以及规则筛帧结果。OCR 不跳过 `invalid`，便于检查误删风险；`unknown` 可能来自 0.95 门槛，不能自动认作模型未执行。无运行时/资产返回 2，模型异常返回 1，全部执行结束返回 0、`status=executed`；**0 仅代表执行完成，不代表精度或性能通过**。执行中更新 `stage` 和当前帧；`timeout` 返回 124 或进程被中断、JSON 仍为 `running` 时均不算完成。

该入口是逐帧模型诊断，**不验证 HTTP 多线程、16 帧路由批次、重复帧状态或 Next.js 网关**。模型直调完成后，应按 `services/mindspore-infer/README.md` 启动真实 Ascend Uvicorn（`INFER_PREWARM=true`、验收时禁用 OCR 后备），等 `Application startup complete` 后，用仅保存在环境变量中的令牌运行既有 HTTP 基准：

```bash
python scripts/performance/real-mindspore.py \
  --url http://127.0.0.1:8000 \
  --image .taskbook-working/video-infer-diagnostic-20261003/frame_003.jpg \
  --require-device ascend --no-proxy \
  --samples 30 --request-timeout 60 \
  --output docs/performance/mindspore-http-single.json
```

`ASCEND_INFER_TOKEN` 须与目标服务一致，不要通过命令行 `--token` 留下凭据。HTTP 基准不识别服务实际 OCR 后备，必须另行保留服务后备关闭配置和启动/运行日志。随后再独立验证有界批次、跨机网关与完整视频链路；这些本次均未执行。

## §10.4 继续处理：HTTP 批次验收入口

2026-10-08 继续本任务时，用户确认有 Linux／Ascend 服务，但尚未提供具体新地址或 SSH 入口。复查原配置地址先出现 `RemoteDisconnected`，随后复查为 `URLError`、底层 `ConnectionRefusedError` / WinError 10061；最近一次原生退出码 2，停在健康检查，没有提交任何图片。最新证据见 [HTTP 复查 JSON](mindspore-20261008-http.json)。网络状态变化不能证明模型本身失败。

完善现有 HTTP 脚本，支持下列独立复测步骤：

```bash
timeout 600s python -u scripts/performance/real-mindspore.py \
  --url http://127.0.0.1:8000 --require-device ascend --no-proxy \
  --frames-dir .taskbook-working/video-infer-diagnostic-20261003 \
  --samples 2 --request-timeout 60 \
  --output docs/performance/mindspore-http-batch.json
```

每轮向三个接口各提交完整批次；输入最多 120 帧、每帧 5 MiB、合计 20 MiB，与服务限额一致。分类和 OCR 响应须覆盖全部输入帧且无重复序号；筛帧须覆盖全部输入并保留 `timestampMs`，同时检查分类、OCR 框/置信度及筛帧字段。目录没有视频时间戳，因此请求全部使用明确标注的合成零时间戳，不能据此验收视频时间轴。`--image` 和 `--frames-dir` 二选一。

输出逐次响应原文、耗时、当前阶段、失败类型和原生退出码；即便 HTTP 200 但契约错误也返回 1，保留失败响应；连接中断保留已完成的前序结果。健康状态必须显式 `mock=false`、运行时及模型条件为 true，`--require-device ascend` 拒绝健康声明为 CPU/GPU 的服务。设备字段仍只是服务声明，不能替代服务启动日志及禁用 OCR 后备的配置证明。合法的 `unknown` 或空 OCR 会被保留以便人工核对，执行结束标记 `executed`，不标记精度通过。

批次模式的 `first_screen` 数值是整批三个 HTTP 调用的合计耗时；单帧模式才可作为单帧接口基准，两者均不包含 Next.js、ASR、生成或页面渲染时间。本次未执行真实批次、跨机网关或完整视频；不会用本地替身测试代替这些验收。

- `python -m unittest discover -s scripts/performance -p test_real_mindspore.py`：8/8 通过（HTTP 替身回归，非真实模型）。覆盖健康/推理连接中断、CPU 设备门禁、缺失 mock 状态、缺帧、重复索引、非有限 OCR 置信度和完整双帧结果保存。
- Python 语法编译通过；本次不改服务接口、模型、依赖或业务流水线。

## 本地验证与剩余项

- `python -m unittest test_warmup.py test_model_runtime.py test_vision_rules.py test_classifier_inference.py`：20/20，通过；其中模拟预热失败日志为预期测试输出。
- `python smoke_test.py`：通过（mock 服务契约，不是模型验收）。
- HTTP 连接提前关闭的健康预检/推理阶段两个定向替身回归通过；分别返回 2/1。两份性能脚本语法编译通过。
- [x] 2026-10-08：完成本次环境预检、诊断素材核对、可复现入口和阻塞证据记录。
- [ ] 真实 Ascend 多样本执行、人工 OCR 质量核对、HTTP/批量稳定性与跨机首屏验收。需恢复可执行的目标环境或已连接的 ModelArts Notebook 后继续。
