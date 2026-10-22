# §10.4 ModelArts 真实推理复验（2026-10-09）

本次仅继续既有 §10.4，在桌面主仓库核对当前推理改动并使用用户提供的 SSH 连接做真实验收。没有增加功能、改数据库、重跑 ASR/大模型、安装全局依赖或覆盖旧服务与模型。

## 连接与环境

本机原域名解析为 `198.18.0.45`，旧直连地址 `139.159.152.36:31637` 也在 SSH 握手阶段断开。密钥能被本机读取，不是已证实的账号认证失败。阿里公共 DNS 的 HTTPS 查询返回两个 A 地址，另一个 `110.41.14.167:31637` 实际完成 publickey 认证；该地址是本次观测，不是永久地址。

SSH 返回的 RSA 指纹为 `SHA256:BtE0Fqc6c12m3bCE9U45vupfVAVMpjN429YD4Sy9nKU`，与旧 known_hosts 记录不同。本次遵照用户提供的 `StrictHostKeyChecking=no` 选项继续，未删除或覆盖旧记录；连接成功不等于独立确认新主机身份。

远端为 aarch64 Linux，Ascend 910B4、npu-smi/驱动 25.5.1、设备健康 OK。复用 Python 3.11.10 / MindSpore Lite 2.7.1 环境和现有 CANN；四个 MindIR 及中文字典齐全。模型保留 `/home/ma-user/work`，本次源码与帧上传至 `/home/ma-user/work/taskbook-accept-20261009-DBKBN5Mk`。

## 实际结果

- 真实直调退出 0：16 张诊断帧、16 条分类/OCR/筛选结果，类别均为 screen，共 1,246 个文字块。mock=false、OCR fallback=false；预热 196,893.435ms，分类累计 348.013ms、OCR 累计 15,177.519ms。
- 上传源码 SHA-256 与桌面主仓库一致；与 10 月 8 日修复报告共有的 OCR 模型/字典指纹一致。16 帧 OCR 文本、bbox、置信度与此前修复后第一轮逐帧完全一致。这里验证结果可复现，不新增整体精度结论。
- 独立 HTTP 服务预热启动 90,134.897ms；30 次单帧和 2 次 16 帧批量的 classify/detect_text/select_frames 全部完成、退出 0，health 明确 Ascend、模型已加载、mock=false、后备 OCR 不可用。单帧经验 P95：分类 42.789ms、OCR 981.292ms、筛选 64.234ms、三个串行接口整组 1,356.139ms。16 帧批量两次观测的经验 P95：OCR 14,866.055ms、整组 16,408.757ms；两次样本不能当稳定统计保证。
- Windows TypeScript 实际网关经 SSH 隧道，单帧/16 帧三个操作均通过，6 项逻辑调用无 fallback、退出 0。默认单请求预算保持 8,000ms。16 帧 OCR 拆为四个 4 帧请求，HTTP 200，分别 3,630/4,176/4,679/5,041ms；整体 OCR 18,333ms。整组超过 8 秒，但每个请求未超预算。批量返回完整 16 帧/1,246 块且逐帧与本次直调完全相同。

原始[直调](ascend-resume-20261009/direct.json)、[HTTP 服务运行](ascend-resume-20261009/http-run.json)、[单帧](ascend-resume-20261009/http-single.json)、[批量](ascend-resume-20261009/http-batch.json)、[网关](ascend-resume-20261009/gateway.json)、[HTTP 日志](ascend-resume-20261009/http-service.log)与[NPU 占用证据](ascend-resume-20261009/npu-during-direct.txt)已归档。控制器在被忽略目录保留，status=executed、两阶段 exitCode=0。

机器可读[汇总与证据SHA-256](ascend-resume-20261009/summary.json)保留完成项、连接边界和未验收项；状态/真实health/无fallback断言以及git diff --check通过。

首轮网关桥接在旧主机记录下 RuntimeError、隧道未建立；改用隔离 known_hosts 后通过，记录的新 RSA 指纹与本次 SSH 所见一致。新选项 `--known-hosts` 使用 accept-new，只接受新记录并拒绝后续变化；不修改原 known_hosts，也不代表已独立确认新主机身份。首次失败保留在记录中，不算通过。

单独复核旧记录下 SSH 转发退出255，明确返回“Port forwarding is disabled”与“host key check failure”，见[阻塞证据](ascend-resume-20261009/old-hostkey-forwarding.log)。两个独立 HTTP 服务均已退出0；[网关窗口清理记录](ascend-resume-20261009/gateway-window.json)与[最终NPU/端口检查](ascend-resume-20261009/npu-after.txt)确认NPU无运行进程、18765可绑定，本机隧道已随桥接退出。保留远端新目录，不修改旧服务/资产。

## 复现入口

先核对当前实例的公开解析和现有解释器路径，然后在桌面主仓库 PowerShell 执行：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
D:\python\python.exe scripts/acceptance/resume-ascend.py `
  --host ma-user@dev-modelarts-cnsouth1.huaweicloud.com `
  --ip 110.41.14.167 `
  --key 'C:\Users\qwh76\Downloads\KeyPair-e0aa.pem' `
  --python /home/ma-user/work/taskbook-accept-20261008-eNe960/.venv/bin/python
```

入口每次建立新目录、上传当前 Python 推理代码和诊断帧，关闭 mock/后备 OCR，先直调再启动独立回环 HTTP 服务，运行 30 次单帧和 2 次 16 帧批量三接口检查。HTTP 入口结束时只停止自身服务。输出在被忽略的 `.taskbook-working/ascend-resume/<UTC时间>/`，包含控制器状态、SSH 日志、逐帧/HTTP 结果；不上传密钥、令牌、环境文件或模型。新入口使用 Python 标准库，无新增依赖。

`executed` 只代表真实执行与响应契约通过；`running`/`failed`/超时不得标成功。SSH 私钥只作为本机文件使用；临时服务令牌在子进程环境中，不写结果。

网关复验额外启动独立窗口：在上述远端隔离目录中加载 CANN，用同一解释器执行 `scripts/performance/accept-mindspore-http.py --model-dir /home/ma-user/work --output-dir evidence/gateway-window --skip-benchmark --hold-seconds 120`。报告 stage=gateway-window 时，本机执行：

```powershell
D:\python\python.exe scripts/performance/check-ssh-gateway.py `
  --host ma-user@dev-modelarts-cnsouth1.huaweicloud.com --ip 110.41.14.167 `
  --ssh-port 31637 --key 'C:\Users\qwh76\Downloads\KeyPair-e0aa.pem' `
  --known-hosts .taskbook-working/ascend-resume/20261009T110013Z/known_hosts `
  --remote-root /home/ma-user/work/taskbook-accept-20261009-DBKBN5Mk `
  --remote-report evidence/gateway-window/http-run.json `
  --output .taskbook-working/ascend-resume/20261009T110013Z/gateway.json
```

每次替换为新验收目录/输出路径，不覆盖旧证据。该窗口结束自动停止自身服务；桥接结束自动关闭自己的本机隧道。原开发网页和已有服务不重启。本次两个 Python 入口编译检查通过，真实执行结果如上；未更改推理算法，不重复全量前端测试。

## 未完成边界

本次诊断帧没有源视频时间轴，HTTP 测试使用合成 timestampMs=0；不能冒充 46 分钟视频逐时点验收。多来源精度、小字/遮挡/英文代码识别、长视频完整 ASR/AI/笔记链路、公网部署与并发仍需独立验收。现有 OCR 个别错字保留，不用人工正确文本替换模型输出。
