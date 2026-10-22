# 文豪智能学习平台 · 部署说明

## 2026-10-21 §29.23 视频工具与队列失败恢复

主Dockerfile的builder（worker继承）及runner均显式安装Alpine `ffmpeg` 包，构建时执行 `ffmpeg -version` 和 `ffprobe -version`，缺失时构建失败。无需挂载本机Windows二进制。部署前可分别运行 `docker compose run --rm worker ffmpeg -version`、`docker compose run --rm worker ffprobe -version`，Web容器也需核对；版本通过后再用有授权短视频实测探测/抽帧/抽音轨。Docker daemon未运行时不能把源码/契约测试称为镜像实测通过。

上传确认入队失败会保留源文件并标FAILED，返回503 QUEUE_UNAVAILABLE，服务恢复后使用原“重试解析”；理解入队失败保留资料READY、理解FAILED，走“重试理解”。已被worker认领的任务不因入队应答异常回退。数据库自身不可用、旧进程崩溃遗留RUNNING不自动批量修复，需单独核对，不能随意把所有RUNNING重置后重复执行。

§29.4（2026-10-19）新增20261019053000_classroom_foundation独立十表、六枚举与同班复合FK/CHECK，本地演示库已migrate deploy/generate成功（55业务表，原45表摘要保护通过），无reset或历史迁移改写。其它部署先按备份流程执行migrate deploy与generate，不能用db push遗漏CHECK。Windows生成客户端遇DLL占用，核实并只停本仓库Next后生成并恢复。无新依赖、环境变量或云服务；这一项仅数据/权限基础，班级创建/加入/提交页面及附件上传下载尚未上线，不能据迁移成功演示整个模块。复现见[28规格](spec/28-CLASSROOM-FOUNDATION.md)和[验收](docs/acceptance/classroom-foundation-20261019.md)。

§28.2/28.3（2026-10-18）华为云LoRA为独立实验，不属于Web部署编排。复现见[services/learning-lora/README.md](services/learning-lora/README.md)：使用已运行的Ascend Notebook及已保存SSH；28.2只做准备，28.3增加锁定基础权重下载、固定小样本真实微调/适配器重载及对照入口，不安装全局依赖或启动HTTP服务。大权重放scratch、小适配器放work后回传本机；缓存跨停止持久性与教学语义须另验，完成情况以PROGRESS及验收记录为准。工具结束不会自动停止付费Notebook。

§26.5安全升级：当前Next16.4.1/React19.3.1，开发/测试工具要求Node22.13（22系）/24系/26+，推荐24 LTS，npm ci按新锁文件安装；dev/build显式--webpack，lint独立ESLint CLI/flat config。追踪PDF/ASR资源配置移到顶层，保留standalone与外置Python/模型。先停止自己网页再更新依赖并重启，不复用旧Next14进程。无数据迁移/环境密钥变化；历史Next14/Node20说明仅为旧验收背景，不能据其选择有告警旧版本。Docker/S3/公网仍需目标环境实测。

§25.10已修复私人资产admin全局旁路，§25.9已于2026-10-15 16:02独立完成本地复验（1184项工程回归/TS/lint、138项主流程HTTP及原生页面），无新迁移或环境变量。部署应包含ownership.ts权限修订，不得只更新前端。正式DISCUSSION_RELEASE_READY仍保持默认false，实际共享素材须有传播授权并由管理员预览确认发布，本次不自动公开原三份。临时测试进程已停止，普通demo:start及CPU人脸正常，原数据/媒体/env未改，临时行/文件/凭据清理。生产/S3/公网未验；见docs/acceptance/phase25-reacceptance-20261015.md，首次失败保留为历史证据。

§25.8新增20261014090000_notifications，本机Prisma validate/migrate deploy/generate成功（无reset）。上线前备份后migrate deploy/generate；增量30表，SQL来源类型CHECK、全局eventKey唯一及旧结果事件INSERT去重不可用db push替代。既有举报结果映射为未读，无旧回复回填；不存旧正文。没有新依赖/服务/推送。DISCUSSION_RELEASE_READY仍缺省false，普通demo:start已恢复，消息/参与API门控404、原env未改。25.9完整演练下一项；公网/S3/新生产未验。

§25.7新增20261014080000_discussion_moderation：备份后执行npx prisma migrate deploy及npx prisma generate，本机已成功，共29张表。SQL包含每举报人/目标仅OPEN的部分唯一索引；不要以db push替代迁移而漏掉此约束。无reset、新依赖或外部服务。管理员管理可在正式开关关闭时使用，学生讨论/举报仍要求DISCUSSION_RELEASE_READY精确true；本次临时进程已退出，普通demo:start和真实face CPU已恢复，.env/.env.local未改。25.8消息闭环及后续验收完成前不要正式开放；新生产/S3/公网本轮未验。

§25.6本地新增20261014070000_discussions迁移及User删除前匿名化触发器（公开主题/回复清正文），先备份后migrate deploy与generate；本机已成功，不reset、不改原数据。DISCUSSION_RELEASE_READY仅精确true开放讨论API/页面（缺省关闭），仍需课程published/prepared及discussionEnabled=true才可新写。当前只在临时网页进程对自建隔离课程验收，随后恢复普通demo:start；不要在生产或.env提前开启，待25.7管理/举报与25.8消息闭环和完整验收后再发布。当时共有27张表，25.7后为29张；无Notification模型/额外服务/新依赖。见spec/09-DISCUSSIONS.md及docs/acceptance/discussions-20261014.md。

§25.5共享课程本地增量：先在既有数据库执行迁移20261014060000_shared_course（本机已通过Prisma migrate deploy，未reset），再prisma generate；若Windows客户端DLL被运行的本仓库Next锁定，停止自己的网页后生成并恢复同一服务，勿杀其它端口/数据库。迁移仅新增独立SharedCourse，不自动发布或移动私人资料。正式部署同样先备份、migrate deploy及generate；不要用reset或db push覆盖旧数据。新增shared-courses私有前缀必须持久化；S3通过应用服务端流读，不302到对象直链，需网站读写/删除该前缀权限。PDF副本发布前需Poppler准备全部页图，超时/中断未准备草稿不得发布；反向代理需支持对应长准备请求和Range。新生产/S3/公网本轮未验，独立媒体读取不证明模型就绪。

> 本文档说明从零部署本系统的完整流程，包含本地开发、Docker Compose 一键启动、生产环境部署三档。

---

## 1. 部署档位

| 档位 | 用途 | 推荐场景 | 启动方式 |
|------|------|---------|---------|
| **本地开发** | 不依赖 Docker，直接跑 Node 进程 | 代码热重载、调试 | `npm run dev` |
| **Docker Compose** | 一键启动 7 个服务（PostgreSQL + Redis + MinIO + MinIO 初始化 + Next.js + BullMQ worker + mindspore-infer）| 本地集成测试、答辩演示 | `docker compose up -d` |
| **生产部署** | Kubernetes / 阿里云 ACK / 腾讯云 TKE | 公网服务 | 见本文档 §6 |

**当前桌面毕设推荐**：先用本地网页和已解析资料演练；Docker Compose用于具备所需运行环境后的集成/生产检查，不能保证5分钟跑通外部模型全链路。

**当前本机毕设演示（§22.5）**：已有三份预解析资料使用memory队列和本地媒体，可运行`npm run demo:check`检查后以`npm run demo:start`启动网页，也可双击根目录“启动演示.cmd”。已经运行文豪3000时按登录页品牌检查复用，不另开进程；品牌检查不证明运行进程来自本仓库或环境配置最新，改配置后仍须回原终端处理。端口未确认是本项目时拒绝，不杀占用进程。启动前须数据库、三份资料及本地媒体可读、本地认证工具能签发/校验（使用现有开发契约，预检不改密钥，不等于生产安全验收）；不会安装/启动数据库、重置资料或修改.env.local。Next启动保持前台，关闭该终端停止本次启动的网页；若复用了现有网页，关闭检查终端不停止它。

`npm run demo:check -- --import`另检查现场新导入前提，必须有真实Ascend热就绪、真实ASR/星火配置、memory队列及本地存储；本入口不证明推理Token有效、ASR/模型额度或完整导入成功。AI/人脸以配置或健康读取状态分别报告，不调用模型、不采集画面。预检只读，无需Docker；生产BullMQ仍用§4.1严格worker预检。报告每次保存在新的.taskbook-working/local-demo目录，输出不含URL凭据、密钥、私有存储键或错误正文。

---

## 2. 前置条件

### 2.1 本地开发

- Node.js 22.13+（22 系）、24.x 或 26+（推荐 24 LTS，与 `Dockerfile` 对齐）
- npm ≥ 10
- PostgreSQL 16（如不跑 Docker，需本机安装）
- Redis 7（同上）
- Poppler `pdftoppm`（仅扫描 PDF 页视觉 OCR；可通过 `PDFTOPPM_PATH` 指向便携版，缺失时保留文本层并跳过 OCR）

### 2.2 Docker Compose

- Docker Engine ≥ 24.0
- Docker Compose V2（即 `docker compose`，不是 `docker-compose`）
- 可用资源：CPU ≥ 4 核 / 内存 ≥ 8 GB（mindspore-infer CPU 模式较重）

### 2.3 生产部署

- Kubernetes 1.24+ 集群
- Helm 3（推荐）或 Kustomize
- 持久化存储：PostgreSQL 16 + Redis 7 + S3 兼容对象存储
- 镜像仓库：Docker Hub / 阿里云 ACR / 腾讯云 TCR

---

## 3. 配置环境变量

### 3.1 复制模板

```bash
# Docker Compose 读取 .env；本地 Next.js 开发可复制为 .env.local。
cp .env.example .env
```

### 3.2 必填项（Compose / 生产环境不得保留空值或示例值）

| 变量 | 说明 | 本地占位 |
|------|------|---------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose PostgreSQL 初始化账号 | 自行设置专用账号与强密码 |
| `REDIS_PASSWORD` | Compose Redis 密码 | 随机强密码 |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO 根账号 | 自行设置，不使用示例值 |
| `INFER_TOKEN` | MindSpore 服务鉴权 token | 至少 32 字符随机值 |
| `JWT_SECRET` | JWT 签名密钥 | 至少 32 字符随机值 |
| `SPARK_API_PASSWORD` | 讯飞星火 APIPassword / APIKey | 留空时语义抽取不可用 |
| `ASR_PROVIDER` | ASR 后端；默认 `xunfei`，`mock` 仅供显式测试 | 未配置 ASR 凭据时转写明确不可用，不生成伪转写 |
| `ASR_APP_ID` / `ASR_API_KEY` | 讯飞 ASR AppID / SecretKey（与星火凭据相互独立）| 从讯飞开放平台语音转写服务控制台获取；仅注入服务端 |
| `APP_URL` | 浏览器访问 Next.js 的公开地址 | 本地默认 `http://localhost:3000`；部署时改为 HTTPS 域名 |

### 3.3 推荐项

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `S3_*` | MinIO/AWS S3 配置 | 见 `docker-compose.yml`；`S3_PUBLIC_ENDPOINT` 必须是浏览器可访问的地址 |
| `ASCEND_INFER_URL` | MindSpore 服务地址 | `http://localhost:8001` |
| `ASCEND_INFER_TOKEN` | 本地运行推理服务时的鉴权 token | 与 `INFER_TOKEN` 一致的随机值 |
| `ASCEND_DEVICE` | 推理设备 | `cpu`（开发）/ `ascend`（生产）|
| `PDFTOPPM_PATH` | 扫描 PDF 页渲染工具 | 留空时从 PATH 查找；Compose 镜像已安装 Poppler |
| `ASR_BASE_URL` / `ASR_LANGUAGE` | 讯飞录音文件转写 API 根路径 / 语种 | `https://raasr.xfyun.cn/v2/api` / `cn` |
| `ASR_POLL_INTERVAL_MS` / `ASR_POLL_MAX_ATTEMPTS` | 讯飞异步订单查询节奏与上限 | `10000` / `90`（低于讯飞每单 100 次限制）|
| `ASR_REQUEST_TIMEOUT_MS` | 单次讯飞 HTTP 请求超时 | `60000` |

Compose 内部服务通过 `S3_ENDPOINT=http://minio:9000` 访问 MinIO；浏览器直传/读取预签名 URL 则使用 `S3_PUBLIC_ENDPOINT`。本地可留空（自动按 `MINIO_PORT` 生成），部署到服务器时必须填写用户实际可访问的对象存储域名或网关地址。

详见 `.env.example` 全部 14 组 50+ 字段说明。

可用 `openssl rand -base64 32` 为各密码和 token 生成独立随机值。不要把生成后的 `.env` / `.env.local` 提交到仓库。

### 3.4 可选人脸签到（P1）

人脸登录默认关闭。未配置真实模型时仍可密码登录与普通每日打卡，**不会伪造自动验签成功**；历史人工确认只保留旧记录。若要启用自动验证，必须由部署人员注入以下服务端 Secret：

| 变量 | 要求 |
|------|------|
| `FACE_TEMPLATE_ENCRYPTION_KEY` / `FACE_ENROLLMENT_PHOTO_ENCRYPTION_KEY` | 两个彼此不同的 Base64 32 字节随机密钥；用于加密特征向量和短期录入照片 |
| `FACE_*_KEY_ID` | 记录当前密钥轮换标识，不使用密钥内容作为标识 |
| `FACE_CHALLENGE_SECRET` | 至少 32 字符的独立随机串，签发 2 分钟有效的活体动作挑战 |
| `FACE_VERIFICATION_PROVIDER` | 设为 `licensed-http` 才会启用获授权的外部模型服务 |
| `FACE_INFER_URL` / `FACE_INFER_TOKEN` / `FACE_INFER_MODEL_VERSION` | 受控 HTTPS 或私网服务、独立 Bearer Token、固定且已验证的模型版本 |

模型服务只可部署在私网或受控 HTTPS 网络，需实现 `POST /v1/face/enroll` 与 `POST /v1/face/verify` 契约；enroll仅向受控Next后端返回向量供加密，verify仅返回结论；响应不返回照片，日志不记录图像、向量或分值。应用数据库只保存 AES-GCM 密文和必要审计元数据，录入照片写入私有 `face-enrollment/` 前缀并在 30 天后删除，任何 bucket 都不得开放匿名读取或预签名展示这些照片。

部署时将以下清理任务配置为每天一次（Docker/K8s 使用独立 CronJob；传统主机使用系统计划任务），并以最小权限服务账号执行：

```bash
npm run face:cleanup
```

删除用户模板时会同步清理对应私有照片；每日任务只用于兜底清理到期照片。不要在浏览器、日志、监控标签、审计详情或备份导出中保存原始画面、特征向量和相似度/活体分数。

---

## 4. Docker Compose 一键启动（推荐）

### 4.1 启动全部服务

部署前可运行只读预检：`node --import tsx scripts/acceptance/worker-preflight.ts .taskbook-working/worker-preflight/result.json http://127.0.0.1:8001`。入口检查项目要求的Redis 7+、Docker Engine 24+及真实Ascend健康；blocked退出1、ready退出0，不启动消费者或写队列/数据库、不打印连接凭据。ready只表示这些前提通过，不替代容器/worker/网站验收。CPU/mock开发Compose不适用该严格Ascend判定。

2026-10-10本机Redis 3.0.504、Docker Linux引擎不可达且WSL未安装；用户选择先做本地毕设演示，因此继续§8.5已通过的memory方案，不为演示强制安装或升级这些生产前提。本地演示步骤见[操作单](docs/demo-local-20261010.md)，生产阻塞见[预检记录](docs/acceptance/worker-preflight-20261010.md)。

```bash
docker compose up -d
```

启动顺序（依赖健康检查）：
1. `postgres` / `redis` / `minio` 同时启动
2. `minio-init` 等 `minio` healthy 后自动创建私有 bucket `slp-learning`，并写入仅允许 `APP_URL` 的直传 CORS 策略
3. `mindspore-infer` 单独启动，30 秒启动期
4. `nextjs` 与 `worker` 等所有依赖 healthy（以及 `minio-init` 成功）后启动；Web 进程只提供服务，worker 独立消费 BullMQ 后台任务

### 4.2 验证服务

```bash
# 查看所有服务状态
docker compose ps

# Next.js 主应用
curl http://localhost:3000

# MindSpore 推理服务
curl http://localhost:8001/health

# BullMQ 消费进程（应保持 Up）
docker compose logs --tail=50 worker

# MinIO 控制台（仅绑定在本机回环地址）
open http://localhost:9001    # 使用 .env 中的 MINIO_ROOT_USER / MINIO_ROOT_PASSWORD
```

### 4.3 查看日志

```bash
docker compose logs -f nextjs              # Next.js 实时日志
docker compose logs -f worker              # BullMQ worker 实时日志
docker compose logs -f mindspore-infer     # 推理服务日志
docker compose logs --tail=100 postgres    # 数据库最近 100 行
```

### 4.4 数据库初始化

```bash
# 进入 Next.js 容器执行 Prisma migrate
docker compose exec nextjs npx prisma migrate deploy

# 可选：导入种子数据（先在 .env 中完整配置 SEED_ADMIN_* 或 SEED_DEMO_*；未配置会安全跳过）
docker compose exec nextjs npx tsx prisma/seed.ts
```

### 4.5 停止与清理

```bash
docker compose down                # 停止（保留数据卷）
docker compose down -v             # 停止并删除所有数据 ⚠️ 不可恢复
docker compose restart nextjs      # 仅重启某个服务
```

---

## 5. 本地开发（不依赖 Docker）

### 5.1 仅启动前端

```bash
npm install
npm run dev   # → http://localhost:3000
```

需要本机已启动 PostgreSQL + Redis（或用 Docker 只起这两个）。

### 5.2 同时启动前端 + 中间件

推荐用 Docker Compose 只启动中间件，再本地跑 Next.js 热重载：

```bash
docker compose up -d postgres redis minio minio-init   # 只起中间件
npm run dev                                             # 本地热重载 Next.js
```

详见 [`spec/05-TASKS.md`](spec/05-TASKS.md) §1 工程基座。

---

## 6. 生产部署（K8s 思路）

> 本节为论文附录级别的部署架构描述，详细 Helm Chart 留作毕设后续工作。

### 6.1 架构

```
Ingress (TLS)
  └─ Next.js Deployment (3 replicas)
       ├─ PostgreSQL 16 (StatefulSet, 1 replica + 备份)
       ├─ Redis 7 (StatefulSet, 1 replica)
       ├─ MinIO (StatefulSet, 4 节点分布式)
       └─ mindspore-infer (Deployment, CPU/GPU/NPU 三档)
```

### 6.2 镜像构建

```bash
# Next.js 镜像（多阶段构建）
docker build -t slp-nextjs:v1.0.0 -f Dockerfile .

# MindSpore 推理镜像
docker build -t slp-mindspore-infer:v1.0.0 ./services/mindspore-infer
```

### 6.3 关键配置

- **JWT_SECRET** 必须用 K8s Secret 注入，绝不写在 ConfigMap
- **SPARK_API_PASSWORD** 同上，仅服务端使用
- **数据库、Redis、MinIO 与 mindspore-infer** 仅部署在私有网络；不要暴露 NodePort/LoadBalancer，MinIO bucket 保持私有
- **POSTGRES_PASSWORD / REDIS_PASSWORD / MINIO_ROOT_PASSWORD / INFER_TOKEN** 也必须以 K8s Secret 注入，并为每个服务使用独立值
- **数据库连接池**：Next.js 容器内 `pgbouncer` 转发，避免直连打爆 PostgreSQL
- **对象存储**：生产用阿里云 OSS / 腾讯云 COS，不用 MinIO
- **mindspore-infer**：若部署到 Atlas 200 硬件，需用 `ascend` profile 镜像 + 挂载 NPU 设备

### 6.4 健康检查

- Liveness：Next.js 用首页 `GET /`（暂无独立 `/api/health`） + mindspore-infer `GET /health`
- Readiness：等待 Prisma 连接、Redis 连接建立后才接流量

### 6.5 MindSpore 模型交付

OCR 模型不进入镜像层或 Git。在联网准备机执行 `python services/mindspore-infer/scripts/download_pretrained_models.py`，取得官方 DBNet ResNet50 中英文检测、CRNN ResNet34 中文识别、MobileNetV3 方向分类 MindIR 与中文字典，并完成大小/SHA-256 双校验，再通过只读卷分发到 `INFER_MODEL_DIR`。CPU Linux 目标机还需安装 `tesseract-ocr` 与 `tesseract-ocr-chi-sim`；MindSpore OCR 初始化/推理失败时服务自动回退到 Tesseract `chi_sim+eng`，`/health` 中 `tesseractAvailable`/`ocrFallbackAvailable` 为 true 表示后备二进制可找到。Ascend 已验证组合为 ModelArts `mindspore_2.7.1-cann_8.3.rc1-py_3.11-euler2.10.11-aarch64-snt9b` + MindSpore Lite 2.7.1；先 source `/usr/local/Ascend/ascend-toolkit/set_env.sh`，再设置 `ASCEND_DEVICE=ascend`、`INFER_MOCK=false`。CANN 8.5.2 与该 Lite wheel 不兼容。关键帧使用清晰度、感知哈希去重和文字密度规则，无额外模型。开发/CI 保持 `ASCEND_DEVICE=cpu`、`INFER_MOCK=true`。交付时同时核验 `/health` 的 `modelFilesReady`、`modelsLoaded` 和 `ocrFallbackAvailable`，具体命令见 `services/mindspore-infer/README.md §5`。

**RapidOCR（强烈建议一并交付）**：PP-OCRv4 本地 CPU 引擎，`pip install rapidocr-onnxruntime` 即可，模型随包自带、无需额外下载，Linux/Windows/aarch64 均可用（aarch64 需 onnxruntime 提供对应 wheel）。它是对 DBNet+CRNN 老模型识别率不足的兜底：即便 Ascend 上 MindSpore 可用，只要识别结果的平均置信低于 `OCR_GOOD_CONFIDENCE`，服务会自动改试 RapidOCR 并取更优结果（`OCR_PRIMARY=auto` 默认行为）。`/health` 的 `rapidocrAvailable` 为 true、`ocrBackend` 显示实际命中后端。可用 `OCR_PRIMARY=mindspore` 强制只走昇腾主线做演示。

真实 Ascend 模式默认启用 `INFER_PREWARM=true`：Uvicorn 在监听请求前对四个 MindIR 执行一次固定形状推理。首次启动可能等待数十秒；必须看到 `Application startup complete` 后再检查 `/health`。运行时/模型缺失或预热失败会使进程启动失败，不应将其当作端口或网络故障；检查启动日志，但不得记录令牌。排障时可显式设 `INFER_PREWARM=false` 恢复懒加载，不能将此模式下的 `/health` 200 当作模型已热就绪。ModelArts 同一张样本在改动前首次 HTTP OCR 用 55.7 秒、第二次 0.3 秒；启动预热后首次 HTTP OCR 0.35 秒、首次分类 0.04 秒，均返回预期结果。该单样本结果不等于多样本、批量或跨机网关验收，另一次超过 120 秒的异常超时原因仍待排查。

---

## 7. 上线验证清单

部署完成后逐项验证：

### 7.1 基础连通性

- [ ] 浏览器打开首页（`/`），看到公开品牌页并可进入登录页
- [ ] MinIO 控制台仅能从管理网络登录（账号来自 Secret）
- [ ] 从集群内部访问 `http://mindspore-infer:8000/health` 返回 `{"status":"ok",...}`

### 7.2 核心功能闭环

- [ ] 注册新账号 → 邮箱/手机验证码 → 登录成功
- [ ] 上传一个 5MB 测试视频 → 解析任务入队 → 状态从「解析中」→「已就绪」
- [ ] 进入学习页 → 添加笔记 → 实时落库
- [ ] 上传一张获授权学习资料图片 → 图片OCR路径完成 → `/detect_text` 输出文字块；课堂视频分类仍为板书/屏幕教学内容/无效帧，不以“手写笔记”为当前训练类别
- [ ] 上传一份扫描型 PDF → 无文本层页渲染为 PNG → `/detect_text` 输出带页码定位的 OCR 文本块
- [ ] 触发「理解流水线」→ 知识点抽取 → 闪卡生成 → 复习页可答
- [ ] 答题评分=3 → SM-2 调度正确（`nextReviewAt` 延长）

### 7.3 安全 & 稳定性

- [ ] 未登录访问 `/api/contents` 返回 401
- [ ] 用户 A 访问用户 B 的内容 ID 返回 403
- [ ] `.env.local` 不在 git 仓库
- [ ] JWT_SECRET、数据库/Redis/MinIO/推理服务凭据均为独立随机值，且未出现在日志或镜像层
- [ ] 数据库、Redis、MinIO 和推理服务没有暴露到公网；MinIO bucket 未启用匿名下载
- [ ] 连续触发登录或 AI 接口时收到 429，且 `Retry-After` 生效
- [ ] 数据库与 Redis 数据卷配置持久化（重启容器数据不丢）
- [ ] 若启用人脸签到：未勾选独立授权无法录入；普通学习者无法访问 `/admin/attendance`；删除模板后立即无法再自动验证
- [ ] 若启用人脸签到：外部模型服务、PostgreSQL 和对象存储均在私网；录入照片不可通过公网 URL、预签名 URL 或管理列表读取

### 7.4 监控（生产必做）

- [ ] 为 `METRICS_TOKEN` 配置独立、随机的 Secret（不复用 JWT 或推理 token）
- [ ] Prometheus 以 `Authorization: Bearer <METRICS_TOKEN>` 抓取 Next.js `GET /api/metrics`；端点返回 Prometheus text format，未配置 token 时安全返回 503
- [ ] 多副本时分别抓取每个 Web/worker 进程并由 Prometheus 聚合；进程内 P95 样本只用于短期观测
- [ ] Grafana 看板：CPU / 内存 / 请求量 / 错误率 / 队列长度
- [ ] 日志收集：Next.js stdout → Loki / ELK

---

## 8. 常见问题

### 8.9 免费本地ASR（§22.8）

先按docs/acceptance/local-asr-20261012.md准备独立venv和固定模型；本机.env.local明确选择ASR_PROVIDER="funasr-local"，ASR_LOCAL_PYTHON指向独立venv/Scripts/python.exe，ASR_LOCAL_MODEL_DIR指向已校验local-asr/model，路径使用正斜杠。Next开发服务会重新加载.env.local；其它启动模式需重启自己网页/worker，不轮换账号密钥。配置检查只表示configured，实际转写应运行scripts/acceptance/local-asr-product.ts并观察真实流水线provider。

转写进程按需启动，无单独端口，模型加载每窗口一次，CPU只读本地音频，失败不自动花费云ASR额度。原讯飞凭据保留，需要讯飞时人工改ASR_PROVIDER=xunfei并加载配置。已有三份资料不会因切换重跑。180秒预算及300秒窗口只约束本地进程，整段视频仍顺序处理；模型须校验，时间为段落VAD区间。这里只降低ASR费用，知识点/闪卡/Agent仍调用各自的大模型，Ascend仍受云实例时限约束。Docker/公网/全长视频效果未通过本轮即不得宣称完成。

### 8.1 `nextjs` 容器启动失败：数据库连接不上

**原因**：`depends_on` 只等服务 healthy，但 Prisma 连接初始化需要更多时间。

**解决**：当前编排已为 `nextjs` 配置 `start_period: 30s`；若仍出现该问题，先检查 `docker compose logs nextjs postgres`，确认连接串和数据库卷状态。

### 8.2 MindSpore 服务一直重启

**原因**：CPU 模式内存不足，或模型文件缺失。

**解决**：
- 增加 Docker 内存限制到 4GB+
- 检查 `services/mindspore-infer/README.md` 模型文件挂载说明

### 8.3 MinIO bucket 没创建

**原因**：`minio-init` 容器已退出（一次性任务），但日志说失败。

**解决**：
```bash
docker compose logs minio-init
# 手动重新执行
docker compose run --rm minio-init
```

### 8.4 Prisma migrate 报错 "relation already exists"

**原因**：开发库与生产库 schema 不一致。

**解决**：MVP 阶段允许 `prisma migrate reset` 重置；生产阶段禁止。

---

### 8.5 桌面主仓库接入 ModelArts Ascend 的本地演示

§26.9（2026-10-16）：已增加本机保存连接入口。项目根目录双击`启动云端推理演示.cmd`，或`node scripts/demo/saved-ascend.cjs start`。先在控制台启动原NPU Notebook、停止原普通演示网页，等待入口status=ready再上传；入口不会购买或启动Notebook、不会自动停止占用端口的进程。普通`启动演示.cmd`仍只展示本地已有资料。

私有配置为`.taskbook-working/ascend-demo/connection.local.json`，已在gitignore与源码导出排除范围；只保存host/hostname/port、本机keyPath/localPython、remotePython/modelDir、knownHostsPath及durationSeconds，不保存私钥正文、账号密码、API密钥或推理令牌，未知字段拒绝。样例见`scripts/demo/ascend-connection.example.json`；本机配置已按用户历史SSH保存31637端口，历史远端环境未重新连通验证。运行`node scripts/demo/saved-ascend.cjs check`仅检查本地JSON/文件，cloudConnectionTested=false不是在线健康检查。地址/端口/密钥位置/远端环境不变时无需重复提供SSH命令；重启后控制台信息如变更，只更新相应字段，不能保证旧端口永久不变。

保存入口总时限默认配置3600秒，仍受原controller 60–7200秒校验；始终传独立known_hosts，接受首次新主机、拒绝已记录主机指纹变化，保留原预热/随机令牌/隧道/回环/重连/停止机制。Next16云端演示网页显式--webpack与普通启动一致。停止方法沿用下方stopFile；停止连接不会自动停止Notebook，仍需在控制台手动停止。旧源码ZIP是26.8快照，新导出才包含本次入口；私有连接配置始终不随包分发。

2026-10-12 §22.6恢复：本次域名SSH可连接，`--ip`接受SSH HostName，因此下列命令传域名而非固定历史IP；若失效须重新核对。独立known_hosts保留原主机记录，本次新指纹仅连接观测。原网页指向旧内网，核对进程归属后重启，由控制器临时环境接入隧道；启动器没有复用运行中网页的模式，不可与3000冲突运行。六项真实网关与图片完整接口通过，三份资料不变，见[恢复验收](docs/acceptance/cloud-resume-20261012.md)。普通demo:start不会自动恢复云端；控制器停止也不停止华为云Notebook。

2026-10-08 已用真实图片走通登录、预签名上传、解析、Ascend OCR、知识点和闪卡生成，记录见 `docs/performance/mindspore-20261008-product.md`。这是限时开发演示，长视频、生产 worker、并发与整体精度仍需单独验收。

前提：本机现有 Node/Next 依赖、PostgreSQL、Redis及 `.env.local` 配置可用；本机 3000/8001、云端 18765 空闲；ModelArts 实例运行且已有可用 Lite/CANN 环境和模型。不要重置数据库、覆盖旧推理目录或批量安装全局依赖。

在桌面主仓库 PowerShell 执行（密钥只作为本机文件路径，环境解释器路径须随实例检查）：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
D:\python\python.exe scripts/demo/run-ascend-demo.py `
  --host ma-user@dev-modelarts-cnsouth1.huaweicloud.com `
  --ip dev-modelarts-cnsouth1.huaweicloud.com `
  --known-hosts .taskbook-working/cloud-resume-20261012-1/known_hosts `
  --key C:\Users\qwh76\Downloads\KeyPair-e0aa.pem `
  --remote-python /home/ma-user/work/taskbook-accept-20261008-eNe960/.venv/bin/python
```

启动入口上传当前 Python 推理代码到独立 `taskbook-demo-*` 目录，关闭 mock/后备 OCR 并完成预热，再建立 `127.0.0.1:8001 → 云端127.0.0.1:18765` 隧道、启动本地 `http://localhost:3000`。随机推理令牌只经一次性 SSH stdin 到云端启动器，再进入受时限保护的服务进程环境，不写 `.env`；Next 进程覆盖推理地址、令牌、开关和 memory 队列，保留既有数据库/ASR/星火配置。只绑定本机地址。直连 IP 是本次域名解析异常的绕行地址，若失效须重新检查，不能当永久地址。

默认最多运行两小时（从启动计时，云端实例到期可能更早）。一次性 SSH 启动后，推理服务在云端独立 session 运行，避免长期绑定到交互 shell；controller 仍监控隧道及网页。前台 Ctrl+C 或以下命令停止本次 Web 进程树、隧道和独立云端服务；不停止 Notebook 或既有服务：

```powershell
$demoState = Get-Content .taskbook-working/ascend-demo/current.json -Raw | ConvertFrom-Json
New-Item -Path $demoState.stopFile -ItemType File -Force
```

`current.json` 记录状态、进程号、日志目录和停止文件；新启动同时保存会话 `state.json`。等待 `status=ready` 后再上传。2026-10-10补修：已就绪后的SSH隧道退出先进入`reconnecting`，保留原Web/令牌/远端服务，最多3次、120秒内重建隧道并核对真实Ascend热就绪；恢复记录在`reconnections`，不重放上传或任务，正在进行的请求仍可能失败。重连耗尽或Web退出记录`failedComponent`后结束；预热期失败仍直接退出。所有恢复受原演示总时限约束。云端独立目录的`services/mindspore-infer/lifecycle.json`记录监督进程、服务退出码、信号/到期/子进程退出原因与时间；若容器被强制结束，可能没有终态记录，不能据此推断原因。Next 日志会遮蔽上传签名参数。API 验收入口如下；它创建隔离临时账号，经真实登录/上传/complete API 触发流水线，对照已存真实 Ascend 输出并核对原内容指纹，完成后删除自己创建的内容和账号。若任务超时，保留临时内容以避免删掉仍在运行的任务，并明确记录 `fixtureCleaned=false`。

```powershell
npx tsx scripts/demo/accept-local-product.ts .taskbook-working/ascend-demo/product-repeat.json
```

该入口会调用已配置的大模型处理一张课堂截图，不调用视频 ASR，也不重新生成已有内容。验收记录应保留；不要用重复执行覆盖此前证据。

---

**最近核对**：2026-10-08（补充桌面本地开发演示；生产 Docker/长视频验收仍以清单待办为准）

### 8.6 本机真实人脸登录演示（2026-10-09）

用户本次确认一次扫描登录：本地.env.local显式设置`FACE_LOGIN_MODE="scan"`，配置后重启人脸服务并由Next重新加载环境。默认action仍要求动作；scan只做身份匹配，静态照片可能认证，不提供活体防伪。模板无须重录。scan验收入口为`npx tsx scripts/acceptance/face-scan-local.ts`，结果见docs/acceptance/face-scan-20261009.md；以下动作说明仅适用于action。

本轮只补验§19。独立CPU YuNet/SFace/MediaPipe服务不占用或修改Ascend OCR。官方固定权重和许可证在services/face-infer台账；模型/venv/日志/状态在被忽略的.taskbook-working/face-infer。Windows Python3.9已实测，Linux/生产尚未验收。

```powershell
npm run face:setup
npm run face:start
npm run face:status
# 配置后重启原Next开发服务；勿另开第二个3000服务
npm run dev
# 只停本入口管理的人脸进程
npm run face:stop
```

setup只补空的人脸配置和独立随机密钥，不覆盖其它环境变量、不轮换已有密钥；密钥保留.env.local，不提交。服务只监听127.0.0.1:8002并要求服务端Bearer，生产适配器仍要求HTTPS。每天执行face:cleanup兜底清理到期加密照片。

本人用密码登录后，从工作台进入登录与打卡设置，亲自阅读授权并录入，再退出以同账号完成动作人脸登录。按上海自然日最多一条记录，保留第一次方式和时间。闭眼约1秒再睁眼，或向本人左右小幅转头再回正。当前为基础动作检测，不承诺专业防回放。公共真实模型/接口证据与待本人步骤见docs/acceptance/face-real-20261009.md；未做本人动态成功验收前，不标记全链路摄像头验收通过。

### 8.7 不占用开发网页的生产产物复验（2026-10-09）

在桌面主仓库执行 `node scripts/acceptance/production-demo-smoke.cjs`。要求现有依赖/PostgreSQL配置有效且3100空闲；脚本在系统临时目录复制源码和实体依赖，生产构建后直接运行standalone/server.js，绑定127.0.0.1:3100，通过临时账号验证真实登录、读取、401/403与退出。它不替换正在运行的.next开发产物，不调用AI、ASR或摄像头；结束清理账号、服务与本次临时快照，结果只含布尔结论。

本机不合格JWT_SECRET/STORAGE_SIGN_SECRET可使用 `--repair-local-secrets` 生成彼此独立随机值，仅写被忽略.env.local；合格值保留，重复赋值规范成一项。签名密钥改变会使旧会话/旧预签名链接失效，重新登录/重新申请链接即可；不重置密码、人脸加密密钥或模板。生产同样拒绝显式配置开发默认JWT密钥。脚本必须先loadEnvConfig，再加载Prisma，避免Prisma先读取.env导致.env.local配置优先级错误。

public/.gitkeep保证Dockerfile的public复制源存在；.dockerignore排除.env.production/.env.development、密钥、本机验收目录、uploads及运行时/模型数据。没有Docker运行时的本机只验证standalone，不能勾选Docker镜像/公网HTTPS验收。HTTP验收检查Secure/HttpOnly标志及Bearer接口，不证明浏览器在公网HTTPS上的会话持久性。生产应用仍需HTTPS入口、私网数据库/存储和真实外部服务。

### 8.8 ModelArts SSH 恢复与隔离推理验收（2026-10-09）

长视频复跑先运行`scripts/acceptance/video-asr-preflight.ts`隔离检查曾失败的音频段；通过后启动§8.5演示时可加`--queue-retries 0`，只覆盖本次网页子进程的额外重试，不改.env.local或产品默认配置。完整入口`scripts/acceptance/video-product.ts OUTPUT.json`走真实46分钟剪辑上传/ASR/Ascend/学习产物及时间定位API；输出进度为OUTPUT.json.progress.json，未终态超时会保留自己的测试资料，不删除仍运行的任务。命令、结果与边界见[46分钟验收](docs/acceptance/video-46m-20261009.md)。这些入口会调用已配置的真实外部服务。

19:19已恢复本机3000到真实Ascend，图片上传/OCR/理解/知识点/闪卡产品接口验收通过，见[产品接入复验](docs/acceptance/ascend-product-20261009.md)。§8.5示例新增启动器可选known-hosts参数，使用本次独立记录与accept-new；保留用户旧记录，拒绝该独立记录后续变化。本次为最长两小时的开发演示，不是常驻公网部署；结束后依原停止/复跑入口管理，不盲杀其它服务。

§8.5示例中的直连IP并非永久地址。2026-10-09本机域名解析到198.18.0.45、旧139.159.152.36握手断开；通过`https://dns.alidns.com/resolve?name=dev-modelarts-cnsouth1.huaweicloud.com&type=A`核对公共A记录，另一当前地址110.41.14.167实际连接成功。后续须重新核对实例当前连接地址与解释器，不能固化本次IP。

新增标准库入口`scripts/acceptance/resume-ascend.py`，完整命令与结果见[真实推理复验](docs/acceptance/ascend-resume-20261009.md)。它新建远端隔离目录、上传源码和诊断帧，复用现有模型/Lite/CANN，关闭mock和OCR后备，运行直调与回环HTTP后取回证据；不更改现有网页、模型、数据库或全局环境。HTTP验收结束停止自己的服务，不代表为网页启动了持久推理服务。

本次SSH返回的主机指纹与旧known_hosts不同，遵照用户给出的StrictHostKeyChecking=no继续，但保留旧记录。正式部署仍应通过可信渠道核对主机指纹；不要把临时连接选项当生产主机校验策略。密钥保留本机文件，令牌不写命令参数、日志或版本库。

§22.11：PDF文本提取由pdfjs-dist 4.10.38在服务端执行（Node>=20），需要部署node_modules/pdfjs-dist的cmaps/standard_fonts及worker文件；standalone打包资源须部署时另验。PDF阅读逐页PNG也依赖pdftoppm，并非仅扫描OCR用；Windows建议显式PDFTOPPM_PATH，避免网页进程PATH缺少工具。已在本机忽略.env.local配置，不提交。


§22.13：APP_URL必须填写浏览器访问的真实公开地址（生产不再以内部request.url猜测可信源）；HTTPS反向代理可保持内部HTTP，本地配置localhost/127.0.0.1仅同协议同端口互认。不要用客户端Host/X-Forwarded-Host任意扩大允许源。刷新/退出仍要求X-Session-Refresh并拒绝cross-site；生产缺少或非法APP_URL时拒绝会话来源，先修配置。

### §29.12.1 唯一星火文本模型（2026-10-18用户修订）

在服务端.env.local或部署Secret中配置；不要提交真实凭据：

```dotenv
LLM_PROVIDER="spark"
SPARK_API_PASSWORD=""
SPARK_MODEL="lite"
SPARK_BASE_URL="https://spark-api-open.xf-yun.com/v1"
SPARK_TIMEOUT_MS="60000"
AGENT_REVIEW_READY="false"
AGENT_REVIEW_THINKING="false"
```

填入讯飞对应型号的HTTP APIPassword，型号须有实际权限/额度；2026-10-19用户指定默认lite，不自动升级或回退。网页与worker加载同组变量并重启。Compose仅透传星火配置，移除OPENAI_*及旧的按场景供应商选择、智谱/百炼参数。MindSpore/ASR/人脸和原学习资料保持，不自动重跑导入。

真实短接口检查：`npx tsx scripts/acceptance/agent-model-health.ts spark .taskbook-working/spark-real-repeat`，目录须不存在。最多两次格式尝试、共享30秒，用原创短句，不输出密钥/模型正文；available只表示短请求及JSON通路，教学质量单独验证。关闭支持型号的内建联网搜索；AGENT_REVIEW_READY=false保持证据模式，不能按切换供应商称质量已经通过。

PDF仍最多48批、每批7000正文字符且至多12页；旧PDF引用沿原补全入口，不改写已有学习记录。历史供应商文档/失败证据保留作历史。

### §22.19 普通演示入口配置优先级
`npm run demo:check`、`npm run demo:check -- --import`和`npm run demo:start`在加载Prisma运行时之前，使用Next开发环境规则读取配置：显式进程环境 > .env.development.local > .env.local > .env.development > .env。无需另加node --env-file，启动的网页子进程继承同一配置；不自动覆盖显式环境、修改文件或轮换密钥。已运行网页只能按品牌识别复用，不能据此证明该进程配置最新。ASR的configured仍非实际转写通过，Ascend/人脸不可达仍如实blocked。

### §22.21 standalone PDF／本地ASR资产

Next14构建显式跟踪内容API所需pdfjs legacy运行模块/worker、CMap、标准字体、包许可及services/local-asr/transcribe.py/assets.py/timing.py，runner的standalone复制带入它们；worker镜像继续保留完整源码/依赖。不要仅检查next build退出码，需要实际处理PDF/本地转写。

本地隔离复验入口：`node scripts/acceptance/production-demo-smoke.cjs --runtime-assets --output-dir .taskbook-working/standalone-runtime-repeat`。输出目录须新建且在忽略目录；3100须空闲，不能覆盖正在运行的开发.next。入口读取既有222页PDF和30秒535–565秒音频片段，仅复制到临时账号/临时快照；ASR视频使用合成黑色帧与真实样例音频，不是实际视觉分类验收。它禁用测试子进程全部大模型凭据、真实Ascend，解析/转写结果与理解终态分开记录，不宣称AI笔记或全链路通过。结束清理自己的账号/快照/服务，不修改.env.local。

本地ASR的Python、FunASR/ONNX依赖、固定校验模型仍外置；设置ASR_LOCAL_PYTHON和ASR_LOCAL_MODEL_DIR为目标机器可读路径，运行目录必须为standalone/server.js所在目录。Windows venv不能移到Linux。现有Alpine镜像默认讯飞配置，本次没有把Python/torch自动装进Alpine；若要在容器用funasr-local，应另行提供兼容的CPU运行时/模型或采用兼容基础镜像，并实测，不能仅挂Windows路径或以脚本存在称可用。ffmpeg/ffprobe及pdftoppm也需目标系统实际可执行。Docker/公网与Linux本地ASR未取得本轮真实证据。

### §23.1 历史录音方案（用户澄清后入口撤下）

先在正确数据库执行 `npx prisma migrate deploy`、`npm run prisma:generate`，新增LiveSession/LiveChunk表，禁止reset。本机本轮已应用20261013150000_live_notes。继续用§8.9已校验的ASR_LOCAL_PYTHON和ASR_LOCAL_MODEL_DIR；新实时入口始终使用此本地模型，不因云ASR配置自动付费降级。首次请求加载模型，后续片段复用同一个Web进程的Python worker。修改Python/模型配置后重启自己的网页进程。

从localhost/127.0.0.1或HTTPS打开/live-notes，亲自允许麦克风；非安全上下文不能录制。浏览器需AudioWorklet，至少16k采样设备；静音输出不回放录音。5秒分片、30分钟上限，原WAV处理后删，只保存转写/重点。勾选自动整理会将转写文字送至现有星火，仍受API额度与审核限制；取消后保留免费本地转写，最终笔记不额外请求模型。详情见[操作指引](docs/live-notes.md)。

standalone应包含services/local-asr/live_worker.py/assets.py/timing.py和public/audio/live-pcm-worklet.js，生产验收入口检查哈希。Python环境与模型仍外置，Windows venv不能移到Linux，原Alpine镜像没有自动包含FunASR；Docker/Linux、HTTPS实际麦克风与30分钟连续录音需另验。当前MVP单Web进程；数据库CAS保护提交，进程内模型互斥不等于跨副本请求去重。

### §23.2 当前随看笔记入口
从学习中心进入已有视频/study/:id，使用已保存转写与统一大模型配置；无麦克风、ASR子进程或新迁移要求。旧/live-notes跳转/import，上述§23.1作为历史部署记录保留，不再作为当前用户演练流程。无需为此开启Ascend，模型不可用明确暂停生成，原播放/个人笔记仍可用。

### §23.4 随看笔记生产构建复验
执行 `node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/watched-production-repeat`（新目录、3100空闲）。隔离快照生产构建/standalone及PostgreSQL临时账号验证新接口；子进程禁用所有模型Key，合法来源应明确503且不写Note，而非模拟成功。原开发服务/配置不替换，结束清理临时快照/账号/进程。旧/live-notes须保留force-dynamic，避免本机Next14.2.21静态产物307没有Location；本轮动态后正常307到/import。结果见docs/acceptance/watched-production-20261013.md。HTTP产物验收不代表公网HTTPS/Docker或生产浏览器播放。
