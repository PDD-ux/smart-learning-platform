# MindSpore 端侧推理服务

> 「小模型先过滤」——`services/mindspore-infer` 是平台「端云协同」的端侧一半。
>
> **核心定位**：以 **图像理解为主**（分类 + 文字区域检测），视频关键帧筛选为辅。

---

## 1. 服务职责

| 接口 | 方法 | 用途 | 何时调用 |
|------|------|------|----------|
| `/classify` | POST | 课堂帧三分类：`blackboard / screen / invalid`；模型不可用时返回 `unknown` | 视频抽帧或用户上传图片时 |
| `/detect_text` | POST | 文字区域检测：返回图片中文字框的 bounding box | `/classify` 判定为含文字后 |
| `/select_frames` | POST | 视频关键帧筛选：从候选帧中挑出「有信息量」的帧 | 视频导入流水线（辅助） |
| `/health` | GET | 健康检查（docker-compose `healthcheck` 用） | docker-compose 编排 |

调用方是 Next.js 侧的 `InferenceGateway`（位于 `src/lib/ai/`），通过 `ASCEND_INFER_URL` 环境变量发现本服务。

---

## 2. 端口与路由

- 容器内：`8000`
- 宿主机映射：`8001`（在 `docker-compose.yml` 由 `INFER_PORT` 控制）
- Next.js → 本服务：`http://mindspore-infer:8000`（容器网络内）

---

## 3. 鉴权

所有非 `/health` 接口都需要在请求头带上：

```
X-Infer-Token: <ASCEND_INFER_TOKEN>
```

中间件校验失败返回 `401`。平台侧 `InferenceGateway` 客户端会自动带上该 token。

---

## 4. 超时与降级

- **请求超时**：8000ms（环境变量 `ASCEND_INFER_TIMEOUT_MS`，由 Next.js 侧控制）
- **CPU 真实 OCR 后备**：关闭 mock（`INFER_MOCK=false`）时，MindSpore OCR 模型缺失或在 CPU 上构建/推理失败，将自动调用 Tesseract `chi_sim+eng`；若 Tesseract 未安装或运行失败，则安全返回空文本块。分类器仍独立走 MindSpore/既有降级路径。
- **Mock 模式**：`INFER_MOCK=true` 时分类和 OCR 保持安全降级结果；即使安装 Tesseract 也不会自动绕过显式 mock 设置。

---

## 5. §5.3 预训练 OCR、规则关键帧与部署

CPU 后备：设置 `INFER_MOCK=false` 后，若 MindSpore OCR 模型缺失、Lite 不可用或推理失败，则自动调用 Tesseract `chi_sim+eng`；后备未安装或运行失败时返回空块。Mock 模式仍显式返回安全降级结果。Ubuntu 安装命令：`sudo apt update && sudo apt install -y tesseract-ocr tesseract-ocr-chi-sim`。环境变量：`OCR_FALLBACK_ENABLED=true`、`TESSERACT_LANG=chi_sim+eng`、`TESSERACT_TIMEOUT_SEC=30`，自定义路径可用 `TESSERACT_CMD`。Docker 镜像已包含相关系统包；`/health` 提供 `tesseractAvailable` 和 `ocrFallbackAvailable` 状态。

默认 OCR 链路已接入 MindOCR 官方预训练模型：DBNet ResNet50 中英文检测（`1×3×736×1280`）→ MobileNetV3 0°/180°方向分类（`1×3×48×192`）→ CRNN ResNet34 中文识别（`1×3×32×320`）→ 中文字典 CTC 解码。关键帧不依赖训练集，按清晰度、感知哈希去重和文字密度联合评分。模型大文件不提交 Git。

### 5.1 下载官方模型

```bash
cd services/mindspore-infer
python scripts/download_pretrained_models.py
```

脚本下载三份 `.mindir` 和 `ch_dict.txt`，执行文件大小与 SHA-256 双重校验；CRNN 固定使用官方 `crnn_resnet34_ch-7a342e3c-105bccb2.mindir`，落盘名保持 `crnn_resnet34_ch.mindir`。真实 OCR 需在 Linux 目标机安装与设备匹配的 MindSpore Lite 云侧 Python 运行时，再设置 `INFER_MOCK=false`。Windows 本地与 CI 可继续使用 mock，但 `strategy=quality` 的关键帧规则可直接运行。

下载脚本支持连接中断后重试与 HTTP Range 续传，完成后才把 `.part` 文件改名为正式模型；若镜像不支持 Range，则从头覆盖 `.part`。精简推理包若未包含 `scripts/`，需把仓库中的 `scripts/download_pretrained_models.py` 单独上传到目标机，再以 `--model-dir <推理服务实际模型目录>` 运行。中文字典使用与原版 SHA-256 完全一致的 MindOCR 镜像文件，下载结果仍须通过脚本校验。

### 5.2 三类课堂关键帧分类训练

三类训练图片体积大且已被 `.gitignore` 排除，**不在仓库内**，必须指向本机或训练机上的实际目录。目录结构必须为
`<数据集>/{train,val,test}/{blackboard,screen,invalid}/...jpg`，三个类别缺一不可。

```bash
cd services/mindspore-infer

# 指向实际数据集目录（示例为 Windows 本机；ModelArts 上填解压后的 dataset_split）
export DATASET="C:/Users/qwh76/Desktop/dataset_split_v3"

# 先在无 MindSpore 环境只检查数据结构（只需 numpy，不需要 MindSpore）
python scripts/train_image_classifier.py --dataset-dir "$DATASET" --validate-only

# 在已安装匹配版 MindSpore 的训练机训练；仅用 train 计算类别权重，
# 按 val 的三类宏平均召回率选择 checkpoint，并在连续 5 轮无提升时早停。
python scripts/train_image_classifier.py --dataset-dir "$DATASET" --output models/keyframe_classifier_balanced.ckpt --epochs 30 --batch-size 16 --learning-rate 0.0003 --class-weight-power 0.5 --label-smoothing 0.05 --patience 5 --device-target CPU

# checkpoint → MindIR（官方 export 需要固定输入 shape）
python scripts/export_mindir.py --model classifier --checkpoint models/keyframe_classifier_balanced.ckpt --output models/keyframe_classifier.mindir --device-target CPU

# 只在模型与训练参数确定后，用独立 test 做最终评测（直接加载部署用 MindIR）
python scripts/evaluate_mindir_classifier.py --dataset-dir "$DATASET/test" --model-dir models --model-file keyframe_classifier.mindir --device cpu
```

`--validate-only` 会打印各类样本数与自动计算的类别权重，可据此确认数据没有放错目录。上一轮实测输出为
`train: blackboard=335, screen=1333, invalid=108` / `val: blackboard=346, screen=238, invalid=90`，
权重 `blackboard=1.995, screen=1.000, invalid=3.513`。

> ⚠️ **不要使用仓库内的 `dataset/classifier/`**：那是历史八类数据（板书/PPT/代码/手写笔记/打印教材/试卷/纯语音/other），
> 与三类输出层不兼容，传给它会在 `validate_imagefolder_dir` 阶段直接报错。三类数据的生成见
> `scripts/merge_keyframe_classes.py`。

**2026-10-20 链路实测（ModelArts snt9b / Ascend 910B4 / MindSpore 2.7.1）**：以上述命令在云端完整跑通
「训练 30 epoch（batch 16）→ `export_mindir.py` 导出 MindIR → `evaluate_mindir_classifier.py` 在独立 test 141 张评测」三段，
脚本全部可执行、产物齐全，不再只是"脚手架"。但结果必须如实看待：本次按 val 宏平均召回选中的是 `best_epoch=1`，
val 准确率 93.32%，**同一模型在来源隔离的独立 test 上只有 62/141=43.97%**（无效类召回 3/59，43 张转为 `unknown`）。
这既复现了上文"验证集虚高"的结论，也说明**该流程复现方差很大，重跑不保证得到与已部署模型（74.47%）相当的产物**。
如需重训，先解决数据集来源多样性问题（每类仅 3 个来源、单源占比最高 84%），否则大概率越训越差。

类别顺序固定为 `blackboard, screen, invalid`；`screen` 包含 PPT、PDF、代码及软件演示，不按学科区分。训练/验证目录必须恰有这三个非空类别；可用 `--validate-only` 在无 MindSpore 环境预检。可通过 `scripts/merge_keyframe_classes.py --source <四类数据集> --output <新目录>` 保留来源分组并生成新清单，原始数据不改动。验证集用于选择 checkpoint，测试集只用于最终独立评测，不应反复用于调参。历史八类及四类 checkpoint 与三类输出层不兼容，不能混用。`models/README.md` 记录文件约定；三类 MindIR 已接入 `/classify` 并在 ModelArts Linux x86_64 + MindSpore Lite 2.7.1 上完成真实接口验收。本地 Windows 无 MindSpore Lite，保留 `INFER_MOCK=true`。

已选用 `keyframe_classifier_v3_balanced.mindir`（训练、验证与独立测试使用按来源隔离的三类数据）：独立 test 105/141=74.47%，板书 21/34、屏幕 39/48、无效 45/59。模型对部分有效帧仍会误判为无效；`/classify` 只在无效类 softmax 概率至少达到 `CLASSIFIER_INVALID_THRESHOLD`（默认 0.95）时返回 `invalid` 并跳过 OCR，其他不确定结果返回 `unknown`，继续 OCR。此阈值尚未用独立校准集校准，不应当作实际精度保证。

在兼容的 Linux/ModelArts 环境把模型放入 `INFER_MODEL_DIR` 后设置 `INFER_MOCK=false`，启动推理服务并用真实课堂帧调用 `/classify` 验证三类输出。默认相对目录 `models` 基于服务启动时的工作目录；Windows 本机无 Lite 时即使模型文件存在，也只返回 `unknown`。模型文件大于源码，已被 `.gitignore` 排除，部署时须单独复制。

2026-09-28 的首轮三分类基线验证集总体准确率 84.12%，但 `invalid` 召回率只有 19/90=21.11%。因此新训练入口默认使用按训练样本数平方根倒数的类别权重、轻度标签平滑和较小学习率，按验证集宏平均召回率选模并早停；不以总体准确率单独选模。新策略已在 ModelArts 完成训练、独立测试、MindIR 导出与 Notebook 内真实接口验收；网页端远程调用仍待部署。

ModelArts 网页上传单文件限制为 100 MB 时，可用 `scripts/package_keyframe_training.py --dataset <三类数据集> --output-dir <输出目录>` 生成 v3 的三个分包。三个分包的内部路径可直接合并，但**必须解压到新的空目录**，不能覆盖旧四类训练目录。例如先创建 `~/work/keyframe-v3`，依次把 `modelarts-keyframe-training-v3-part1.zip`、`part2.zip`、`part3.zip` 解压到该目录，再以 `~/work/keyframe-v3/modelarts-keyframe-training/dataset_split` 为训练数据目录。三包都上传并解压后先运行两条 `--validate-only` 命令，确认 train/val/test 只有三类；不要运行旧四分类脚本或加载旧 checkpoint。

### 5.3 CPU / GPU / Ascend 三档

| 档位 | 适用场景 | 运行方式 | 模型设置 |
|---|---|---|---|
| CPU/mock | 本地开发、CI、无训练产物的演示 | `pip install -r requirements.txt` 后启动服务 | `ASCEND_DEVICE=cpu`、`INFER_MOCK=true` |
| GPU | 有兼容 GPU 的验证机 | 安装匹配的 MindSpore Lite 云侧运行时 | `ASCEND_DEVICE=gpu`、`INFER_MOCK=false`，只读挂载官方 MindIR |
| Ascend | Atlas/昇腾设备部署 | 已验证 MindSpore Lite 2.7.1 + CANN 8.3.RC1 + Python 3.11 aarch64；先 source CANN 环境 | `ASCEND_DEVICE=ascend`、`INFER_MOCK=false`，只读挂载模型目录 |

真实 Ascend 服务默认在启动阶段预热 DBNet、方向分类、CRNN 和三类课堂帧模型（`INFER_PREWARM=true`），四个固定形状推理成功后才开放 HTTP 端口；预热失败则启动失败，平台侧按服务不可达降级。启动可能持续数十秒，等待 Uvicorn 输出 `Application startup complete` 后再请求 `/health`。仅排障时设置 `INFER_PREWARM=false` 以恢复懒加载；此时 `modelsLoaded=true` 只表示模型文件和 Lite 运行时齐全，不表示模型已预热。CPU/GPU 与 mock 默认不预热。ModelArts Ascend 单样本预热后首次真实 HTTP OCR 0.35 秒、首次分类 0.04 秒；其他版式、批量与跨机调用仍需独立验收。

ModelArts 已验证镜像：`mindspore_2.7.1-cann_8.3.rc1-py_3.11-euler2.10.11-aarch64-snt9b`。安装官方 `mindspore_lite-2.7.1-cp311-cp311-linux_aarch64.whl` 后，CRNN 输入 `[1,3,32,320]`、输出 `[1,80,6624]`，零矩阵单次推理约 0.004 秒。Lite 2.7.1 不应配 CANN 8.5.2；完整 MindSpore `GraphCell` 也不是该 MindIR 的部署入口。

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
python -m pip install --user --no-deps mindspore_lite-2.7.1-cp311-cp311-linux_aarch64.whl
export ASCEND_DEVICE=ascend
export INFER_MOCK=false
```

MindIR 留给 MindSpore Lite 使用；ATC 可接收 MindSpore AIR（`--framework=1`）或 ONNX（`--framework=5`）。本项目的 AIR 兼容路径和自包含 ONNX 路径如下。

AIR 兼容路径：

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
python scripts/export_mindir.py \
  --model classifier \
  --checkpoint models/keyframe_classifier_balanced.ckpt \
  --output models/classifier.air \
  --file-format AIR \
  --device-target Ascend
export INFER_MODEL_DIR="$PWD/models"
export ASCEND_SOC_VERSION=Ascend910B4  # 必须按实际目标芯片设置
bash scripts/convert_atc.sh classifier
```

**需要单文件 OM 时使用 ONNX 路径**。导出器调用 MindSpore 自带的 `mindspore.onnx.export`，明确设为 `export_params=True`、`keep_initializers_as_inputs=False`，把 checkpoint 权重保存在 ONNX initializer 中；转换时设置 `ATC_MODEL_FORMAT=ONNX`：

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
python scripts/export_mindir.py \
  --model classifier \
  --checkpoint models/keyframe_classifier_balanced.ckpt \
  --output models/classifier.onnx \
  --file-format ONNX \
  --device-target Ascend
export INFER_MODEL_DIR="$PWD/models"
export ASCEND_SOC_VERSION=Ascend910B4  # 按实际目标设备设置
ATC_MODEL_FORMAT=ONNX bash scripts/convert_atc.sh classifier
```

`convert_atc.sh` 默认编译 AIR；设置 `ATC_MODEL_FORMAT=ONNX` 时切换为 ATC `--framework=5`。两种路径都要求 CANN 环境、显式目标芯片和固定输入形状，并在临时目录生成有效 OM 后才替换目标文件。`ATC_INPUT_SHAPE` 不接受，因为本导出器在导出时固定了输入。ATC 格式编号及参数见[昇腾 ATC 参数说明](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/83RC1alpha001/devaids/atctool/atlasatcparam_16_0014.html)。

> ✅ **Ascend 910B4 实测（2026-10-20）**：同一既有分类器 checkpoint 未重训。AIR→ATC 可转换和执行，但生成的 OM 将 27 组权重暴露为输入（合计 28 个），不能单独部署。MindSpore 2.7.1 的 ONNX→ATC 路径生成单输入自包含 OM，ACL 在零张量及独立 test 集三张实际图片上成功推理；与 MindSpore CPU logits 最大差异为 0.00162（阈值 0.01）。这是运行与数值一致性验收，不是准确率验收；checkpoint 的独立 test 准确率仍为 43.97%，不得替换线上 74.47% MindIR。详见[验收记录](../../docs/acceptance/mindspore-atc-20261020.md)及[单输入 OM 原始回执](../../docs/acceptance/mindspore-atc-onnx-acl-runtime-20261020.json)。

单输入 OM 可直接执行：

```bash
python scripts/test_om_acl.py --model models/om/classifier.om
# 可选：加 checkpoint 和 --input-image <JPG/PNG>，同时比对 MindSpore CPU logits；checkpoint 不会作为 OM 输入
```

线上服务仍使用既有 MindSpore Lite + MindIR；本次 AIR/ONNX/OM 产物留在隔离验收目录，不自动切换线上模型。ONNX→ATC→ACL 的真实验证目前只覆盖三类课堂帧分类器，文字检测和帧筛选模型未验证。

## 6. 镜像 Profile

Dockerfile 提供两个构建目标：

| Target | 用途 | 何时构建 |
|--------|------|----------|
| `cpu`（默认） | MindSpore CPU 模式 + mock 降级 | 本地开发、CI、毕设演示 |
| `ascend` | 完整 MindSpore + Ascend NPU 版 | 生产部署、华为 Atlas 200 环境 |

构建示例：

```bash
# 默认（cpu）
docker compose build mindspore-infer

# 昇腾版
docker build --target ascend -t slp-mindspore-infer:ascend ./services/mindspore-infer
```

---

## 7. 本地开发

```bash
cd services/mindspore-infer
pip install -r requirements.txt
python -m uvicorn infer_server:app --host 0.0.0.0 --port 8000

# 冒烟测试（无需 pytest）
python smoke_test.py
```

默认 `INFER_MOCK=true`（无 MindSpore Lite / NPU 环境时 OCR 以 mock 运行），`GET /health` 可访问；关键帧 `quality` 策略不依赖 MindSpore Lite。
`/classify /detect_text /select_frames` 推理接口见 `spec/05-TASKS.md` §5.2。

---

## 8. 文件清单

```
services/mindspore-infer/
├── Dockerfile              # cpu + ascend 双 profile
├── README.md               # 本文件
├── requirements.txt        # 基础依赖（FastAPI 栈；MindSpore 可选）
├── requirements-ascend.txt # 昇腾专用 wheel 说明
├── .env.example            # 环境变量示例
├── infer_server.py         # ✅ FastAPI 入口（uvicorn infer_server:app）
├── config.py               # ✅ 配置（os.environ）
├── auth.py                 # ✅ X-Infer-Token 中间件
├── trace.py                # ✅ traceId 透传中间件
├── device.py               # ✅ 设备 / 模型加载状态探测
├── schemas.py              # ✅ 推理接口契约模型
├── inference.py            # ✅ 分类降级、真实 OCR 与关键帧策略编排
├── model_runtime.py        # ✅ MindSpore Lite MindIR 懒加载运行时
├── ocr_runtime.py          # ✅ DBNet + 方向分类 + CRNN + CTC 后处理
├── frame_quality.py        # ✅ 清晰度 + 感知哈希 + 文字密度规则
├── vision_io.py            # ✅ 有界图片读取与解码
├── smoke_test.py           # ✅ 冒烟测试
├── models.py               # ✅ 三类训练/导出共用网络
├── scripts/                # ✅ 训练 / MindIR 导出 / ATC 转 OM
├── routes/
│   ├── __init__.py
│   ├── health.py           # ✅ GET /health
│   ├── classify.py         # ✅ POST /classify
│   ├── detect_text.py      # ✅ POST /detect_text
│   └── select_frames.py    # ✅ POST /select_frames
└── models/                 # 训练产物说明（.ckpt / .mindir / .om 均忽略）
```
