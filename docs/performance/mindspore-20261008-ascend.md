# §10.4 真实 Ascend 验收（2026-10-08，北京时间）

## 结论

用户提供 ModelArts SSH 入口后，真实 Ascend 环境已可执行。16 帧两轮直调和预热后的 HTTP 单帧/批次调用均执行完成。**OCR 内容质量与完整产品链路仍未通过验收**；运行完成不等于识别准确。

本次只处理 §10.4，在桌面主仓库记录；不改业务功能、推理服务源码、模型、数据库或既有服务配置。不执行 ASR、LLM 或视频重生成。

## 连接与隔离环境

- SSH 主机 `dev-modelarts-cnsouth1.huaweicloud.com:31637`，用户 `ma-user`。私钥使用本机已有文件，未复制进仓库或云端。本机 DNS 返回 `198.18.0.69`，SSH 在密钥交换前断开；Google DNS HTTPS 查询返回 `139.159.152.36` 和 `110.41.14.167`，本次通过 SSH 的 `HostName=139.159.152.36`、保留原域名 `HostKeyAlias` 成功连接。未改系统 DNS 或代理配置；IP 是本次解析结果，后续可能变化。
- 目标为 aarch64、Python 3.11.10、Ascend 910B4；`npu-smi` 报健康 OK，驱动工具版本 25.5.1，CANN 目录 8.3.RC1。真实运行时观察到测试 Python 进程使用 NPU。
- 原解释器无 Lite/FastAPI/Uvicorn；本次在 `/home/ma-user/work/taskbook-accept-20261008-eNe960/.venv` 建立带 `--system-site-packages` 的诊断环境，使用目标机已有 wheel 离线安装 Lite 2.7.1、FastAPI 0.142.2、Uvicorn 0.54.0 等已有推理依赖，复用 NumPy 1.26.4/Pillow。未改全局环境或运行 Notebook 内核。pip 提示预装 `modelarts 1.5.0` 的既有依赖冲突，本次未为消除提示修改全局包。
- 将本地主仓库服务 Python 源码、两个性能脚本和 16 帧打包上传至独立目录；五个模型/字典直接使用 `/home/ma-user/work` 资产。模型 5 项、核心源码 5 项、样本 16 项的 SHA-256 均与本机预检 JSON 一致。

## 真实执行结果

- [模型直调原始结果](mindspore-20261008-ascend-direct.json)：退出码 0，`executed`，16 帧 × 2 轮 = 32 条；`INFER_MOCK=false`、`OCR_FALLBACK_ENABLED=false`，直接调用 Lite 分类器和 OCR 引擎。预热 204.242 秒；预热后分类 P95 25.779 毫秒，OCR P95 1076.890 毫秒。32 次均为 `screen`；两轮同帧 OCR 文字及框一致，每帧检出 10–89 块。本样本没有人工完整标签，不能由类别一致计算准确率。
- [HTTP 单帧](mindspore-20261008-ascend-http/http-single.json)：`frame_003.jpg`，30 次完整三接口序列，退出码 0。P95：分类 44.406 毫秒，OCR 968.140 毫秒，筛帧 62.682 毫秒，序列合计 1344.239 毫秒。
- [HTTP 批次](mindspore-20261008-ascend-http/http-batch.json)：每批全部 16 帧，2 次完整三接口序列，退出码 0；响应数量/序号/字段校验通过。P95（仅 2 个样本，取较大值）：分类 597.164 毫秒，OCR 14575.436 毫秒，筛帧 862.731 毫秒，序列合计 16258.148 毫秒。**16 帧 OCR 超过平台默认 8000 毫秒超时**，不能认为这个批次大小已满足平台使用要求。
- [HTTP 启动记录](mindspore-20261008-ascend-http/http-run.json)：新 Uvicorn 进程的预热后 readiness 用时 89.108 秒；绑定 `127.0.0.1:18765`，随机临时令牌仅保存在子进程环境，后备 OCR 关闭。启动/请求日志见同目录 `http-service.log`。诊断完成后该服务已退出；未重启或替换既有服务。
- `first_screen` 是三个推理 HTTP 调用的合计；不包含 Next.js 页面、ASR、LLM 或产品生成。批次的该值是整批耗时，不能除以帧数宣称真实页面首屏指标。

## 人工质量核对

查看原图与原始 OCR，记录具体错漏，未编造完整标准答案或字符准确率：

- `frame_002.jpg`：原始 JSON 已包含“言语理解与表达”“基础理论”“第十天”“主讲人：阿里木江”。2026-10-08 继续诊断时逐框复跑确认大标题正确；此前“标题未出现”的人工核对结论有误，现更正。
- `frame_003.jpg`：画面中“基础理论”被识别为“基础理诊”；课件画面本身有横向裁切，另有浏览器、页码和任务栏文字混入。
- `frame_014.jpg`：原始 JSON 已包含“依次填入画横线部分最恰当的一项是：”，此前“未识别”的结论有误，现更正。实际问题是第二正文行严重乱码、第一行“诱/遏/效”错字、第三行“打赏”错成“打发”，侧栏和任务栏噪声大量保留。

因此仍不能按课堂内容准确提取验收；本次不调参或修改 OCR 算法，以便保留现有实现的真实基线。

## 可复现入口

在截图中的 JupyterLab **Terminal** 可直接执行；本次 SSH 执行的就是同一台实例：

```bash
cd /home/ma-user/work/taskbook-accept-20261008-eNe960
source /usr/local/Ascend/ascend-toolkit/set_env.sh
timeout 600s .venv/bin/python -u scripts/performance/accept-mindspore-frames.py \
  --device ascend --model-dir /home/ma-user/work --rounds 2 \
  --output direct-retest.json
timeout 1200s .venv/bin/python -u scripts/performance/accept-mindspore-http.py \
  --model-dir /home/ma-user/work --output-dir http-retest
```

HTTP 入口检查端口空闲、生成临时令牌、等待四模型预热、跑单帧 30 次及批次 2 次，保存结果并在 finally 中停止自己启动的服务。启动等待最多 600 秒；整个脚本用外层 timeout 限定。模型执行日志有 `Ascend custom operator path not found` 及 NumPy 次正规数告警，但这轮完成；不因告警自行替换 CANN 或模型。

## 跨机 TypeScript 网关核对

调用仓库现有 `getInferenceGateway()`，Windows → SSH 本地端口转发 → ModelArts loopback HTTP，保持默认 `ASCEND_INFER_TIMEOUT_MS=8000`、真实推理开关开启。临时令牌由桥接脚本直接读入内存并注入 Node 子进程环境，不输出到控制台或结果文件。此次隧道路径不能代替常规公网/私网入口验收。

原始证据见 [网关 JSON](mindspore-20261008-gateway.json) 和 [对应服务运行记录](mindspore-20261008-ascend-gateway-service/http-run.json)。6 个请求中，5 个无降级，16 帧 `detectText` 出现 `TIMEOUT`：

- 单帧分类 1990 毫秒、OCR 1812 毫秒（80 个文字块）、筛帧 652 毫秒，均无 fallback。
- 16 帧分类 2399 毫秒、筛帧 4541 毫秒，均覆盖 16 帧且无 fallback；OCR 在 8004 毫秒降级，返回 16 个空文字块条目。桥接诊断原生退出码 1，`status=degraded`，没有把 HTTP 结构成功误记为真实 OCR 取回成功。
- 第二次新服务启动用 60.082 秒。服务运行有 `Acl store env context failed` 警告；单帧及另外两个批次接口仍成功，本次不能把该警告认定为超时根因。服务端 loopback 基准本身的批次 OCR 已约 14.6 秒，证明当前整批时长与 8 秒预算不匹配；本次没有定位到底层每个模型/线程的独立成本，也没有修改超时或批次策略。
- 诊断窗口自然结束，服务和本机 SSH 隧道均已退出，云端 18765 端口已不再监听；保留独立目录供复测。

复测时，先在云端开启有界诊断窗口（服务在 120 秒后自行退出）：

```bash
.venv/bin/python -u scripts/performance/accept-mindspore-http.py \
  --model-dir /home/ma-user/work --output-dir gateway-results \
  --skip-benchmark --hold-seconds 120
```

等 `gateway-results/http-run.json` 的 `stage=gateway-window` 后，在桌面主仓库运行（密钥参数仅为本机路径）：

```powershell
python scripts/performance/check-ssh-gateway.py `
  --host ma-user@dev-modelarts-cnsouth1.huaweicloud.com `
  --ip 139.159.152.36 --ssh-port 31637 `
  --key C:\Users\qwh76\Downloads\KeyPair-e0aa.pem `
  --remote-root /home/ma-user/work/taskbook-accept-20261008-eNe960 `
  --output docs/performance/mindspore-gateway-retest.json
```

若服务域名 IP 变化，重新解析后替换 `--ip`；该选项不修改系统配置。`real-mindspore-gateway.ts` 只调用推理网关和进程内指标，不连接数据库或调用其他 AI 服务。Python 脚本编译及 `npm run type-check` 通过。

## §10.4 超时修复与真实复验

用户授权修复后，先检查实际调用路径：视频已按关键帧单张 OCR 并使用 60 秒超时，不能把此前“通用网关 16 帧”失败等同于当前视频路径失败。扫描 PDF 和通用调用直接共用 `InferenceGateway.detectText`；本次修复放在该网关。

- 修改 `src/lib/ai/gateway.ts`：OCR 输入按最多 4 帧顺序请求，不增加并发或全局超时。每个子请求沿用调用者超时（默认 8 秒），原 frameIndex/时间戳随请求保留；响应必须完整覆盖该子批且无重复/额外序号，合并结果按输入顺序返回。
- 任一子请求失败即停止后续子批，整次逻辑调用沿用空 OCR 降级，`onFallback` 与不可用指标只上报一次。不会把部分成功结果当作完整的扫描 PDF OCR 返回。视频单帧 60 秒路径保持现有策略。
- `tests/unit/ai/gateway.test.ts` 新增顺序/尾批/索引及时间戳映射、响应乱序、后续子批失败、异常序号回归；与轻筛选阶段测试合计 31/31，通过。TypeScript 类型检查通过。架构 §2.2.2-(8) 同步记录分批及失败语义；无新字段、依赖或模型修改。
- 网关性能入口新增每个 `/detect_text` 子请求的帧数、序号、HTTP 状态和耗时记录；桥接入口支持 `--remote-report` 选择本次隔离服务元数据。临时令牌仍仅保存在内存/环境变量，结果不含凭据。

同一 Ascend 服务、同一组 16 帧、默认 8000 毫秒超时，Windows 经 SSH 隧道执行两轮：

- [修复后第一轮](mindspore-20261008-gateway-fixed.json)：6 个逻辑调用均无降级，原生退出码 0。16 帧 OCR 分为 4×4 帧，子请求记录为 4661/5946/5369/5735 毫秒，均返回 HTTP 200；合并逻辑调用 22604 毫秒，返回全部 16 帧、1209 个文字块。
- [修复后第二轮](mindspore-20261008-gateway-fixed-repeat.json)：6 个逻辑调用均无降级，原生退出码 0。4 个子请求记录为 3790/4569/5088/5036 毫秒；逻辑调用 19529 毫秒，同样返回全部 16 帧、1209 个文字块。
- 两轮文字及检测框均逐帧与此前真实模型直调基线一致。子请求耗时记录在 fetch 获取响应时结束；逻辑调用包含响应解析/合并，且实际 8 秒 AbortController 均未触发。这些是本次两轮观测值，不是新的 P95 压测指标或对其他图片/负载的保证。

关键区别：**每次 HTTP 请求满足 8 秒预算，整组 16 帧的 OCR 仍需约 19.5–22.6 秒**。这是可靠取回原有 OCR 结果的分批修复，不宣称模型计算提速或页面首屏达标。服务端直接收到 16 帧仍需原先约 14.6 秒；改动在平台网关，本次无需替换云端模型或服务源码。

复验服务元数据位于云端 `gateway-fixed-results/http-run.json`，已回收至 [本地服务记录](mindspore-20261008-ascend-gateway-fixed-service/http-run.json)；同目录保留请求及退出日志。在原桥接命令加 `--remote-report gateway-fixed-results/http-run.json` 并使用新的输出文件即可复现。诊断服务自然退出且 18765 端口已不再监听，本机隧道也已退出。现有产品 worker 未部署或重启，本次未重跑数据库产物、ASR、LLM 或长视频。

## 尚未完成

- 原通用网关 16 帧 OCR 超时降级问题已按四帧子请求修复，本组样本两轮真实复验通过；其他负载与常规网络入口仍需实际部署验收。
- 完整 OCR 质量标注与改进、常规网络入口、实际长视频及页面首屏仍未验收；本次不标记整体真实环境验收完成。
