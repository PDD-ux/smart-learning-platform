# 文豪智能学习平台

> 基于 MindSpore 与 AI 大模型融合的智能学习平台 · 毕设项目
>
> **围绕资料学习与智能笔记、班级课程与作业、智能作业批改与错因诊断三条主线，完成「导入/阅读 → 提交/反馈 → 校对/订正」的学习闭环。**

---

## 当前项目入口（2026-10-20）

本仓库持续保留早期闪卡、图谱、试卷、游戏化等设计及验收历史；它们**不是当前演示的独立核心模块**。当前需求以 [`spec/01-PRD.md`](spec/01-PRD.md)、任务状态以 [`spec/05-TASKS.md`](spec/05-TASKS.md) 和 [`PROGRESS.md`](PROGRESS.md) 为准。旧试卷运行链路已退出；原始历史数据不因退出而删除。§29.11 三主线同组三角色原生页面整链仍在验收中，不能把下面的历史 P0 功能矩阵当作最终产品完成清单。

| 当前主线 | 主要入口 | 当前可演示内容 |
|---|---|---|
| 资料学习与智能笔记 | 工作台 → 学习中心 | 视频、书籍、公开 URL 或粘贴正文；已解析范围阅读、来源定位、笔记与专题问答 |
| 班级课程与作业 | 班级课程 | 负责人发布章节/任务，学生提交，负责人退回或批阅，学生查看反馈 |
| 智能作业批改与错因诊断 | 智能批改 | 本人先校对识别结果和依据，再查看有界 AI 建议与订正记录 |

本机毕设请先看[现行演示动线](docs/demo/三主线成品演示-20261020.md)：根目录保留普通演示、云端推理演示和可选人脸服务三个启动脚本；新视频导入须先确认 ModelArts Notebook 与推理服务就绪。仅查看已解析资料不需要重新启动云端推理。`docs/demo/功能演练手册-20261017.md`及下文早期功能矩阵、P0 比例和目录树保留为**历史技术基线**，不作为当前操作单。

---

## 📚 文档地图

本仓库采用「四级文档体系 + 根目录资产」，**自上而下形成闭环**：

| 层级 | 文档 | 回答什么问题 |
|------|------|------------|
| **需求层** | [`spec/01-PRD.md`](spec/01-PRD.md) | 做什么、为谁做、做到什么程度 |
| **设计层（页面）** | [`spec/02-DESIGN.md`](spec/02-DESIGN.md) | 页面级交互流程 + 视觉方向 |
| **设计层（架构）** | [`spec/03-ARCHITECTURE.md`](spec/03-ARCHITECTURE.md) | 技术架构、领域模型、接口契约、部署方案 |
| **数据模型层** | [`spec/04-DATA-MODEL.md`](spec/04-DATA-MODEL.md) | 字段、校验与鉴权契约；现行实体以 `prisma/schema.prisma` 为准 |
| **任务层** | [`spec/05-TASKS.md`](spec/05-TASKS.md) | 按 P0/P1/P2 拆解的可勾选编码清单 |
| **视觉规范层** | [`spec/06-VISUAL-SPEC.md`](spec/06-VISUAL-SPEC.md) | CSS 变量、组件拆分、状态机、动画时长 |
| **门面文档** | `README.md`（含 §🛠️ 技术选型与依赖）| 项目入口 / 技术选型总览 |
| **AI 执行规则** | [`AGENTS.md`](AGENTS.md) | AI 必读文档清单 + 执行约束 |
| **部署说明** | [`DEPLOY.md`](DEPLOY.md) | 本地 / Compose / K8s 三档部署 |
| **踩坑记录** | [`LEARNINGS.md`](LEARNINGS.md) | 开发过程中遇到的问题与解决 |
| **开发进度** | [`PROGRESS.md`](PROGRESS.md) | 已完成 / 待办 / 阻塞 / 决策 |
| **UI 原型** | [`prototype/*.html`](prototype/) | 8 个 HTML 原型页面 |

**写论文时的引用顺序**：01-PRD → 02-DESIGN → 03-ARCHITECTURE → 04-DATA-MODEL → 05-TASKS → 06-VISUAL-SPEC。

---

## 🎯 项目亮点（一句话卖点）

> **「小模型先过滤，大模型再精读」——端云协同的智能学习平台**

| 角色 | 干什么 | 跑在哪 |
|------|--------|--------|
| **MindSpore 端侧推理**（课堂关键帧理解） | 视频帧 → 板书 / 屏幕教学内容 / 无效帧三分类；屏幕内容含 PPT、PDF、代码及软件演示；仅有效帧进入文字区域检测 | 边缘/Ascend（CPU mock 降级可用） |
| **ASR 语音转写** | 视频音轨 → 带时间戳文本段落 | 云端 |
| **AI 大模型（讯飞星火）** | ASR 转写 + 有效帧 OCR → 带时间点的课堂笔记、知识点、闪卡、知识图谱、问答 | 云端 |

---

## ✨ 早期功能矩阵（历史基线，当前产品以三核心表为准）

### 用户视角

| 页面 | 路由 | 说明 |
|------|------|------|
| 登录 | `/login` | 邮箱/手机号 + 密码 |
| 注册 | `/register` | 邮箱/手机号 + 验证码 + 密码强度校验 |
| 工作台 | `/dashboard` | 学习总览 + 薄弱点摘要 + 连续答对 streak |
| 内容导入 | `/import` | 上传本人拥有或获授权的视频/文档；展示抽帧、关键帧识别、OCR、ASR 与 AI 整理进度 |
| 学习页 | `/study/:id` | 视频播放器 + AI 整理笔记（带时间点依据）+ 实时笔记（带时间戳跳转）+ 解析结果与 AI 问答 |
| 复习页 | `/review` | **轻游戏化闪卡**：🔥 streak + ⚡ XP + 4 档评分 + 稀有度标签 + 答对粒子飞字 + 成就弹窗 |
| 知识图谱 | `/graph` | 知识点节点 + 薄弱点红色高亮 + 跨内容聚合视图 |

### 技术视角（P0 主线）

| 模块 | 核心交付物 | 文档位置 |
|------|-----------|---------|
| **MindSpore 端侧推理服务** | FastAPI + MindSpore Lite；三类课堂关键帧分类 + DBNet/识别网络 OCR；OCR 采用**多后端择优**：MindSpore（昇腾）→ RapidOCR（PP-OCRv4/onnxruntime 本地 CPU）→ Tesseract 简中/英文后备，结果置信不足时自动改试下一后端；识别模型可通过 `OCR_REC_MODEL/HEIGHT/WIDTH/NORMALIZE` 替换（默认 CRNN 中文版 32×320，可换成 MindOCR SVTR 中文版 64×256，见 `scripts/demo/prepare-svtr-ch.py`）；Ascend 验证基线为 Lite 2.7.1 + CANN 8.3.RC1 | spec/03-ARCHITECTURE.md §1.1 / tasks §5 |
| **RapidOCR（PP-OCRv4）** | `rapidocr-onnxruntime` ≥ 1.4.0，纯 onnxruntime CPU 推理、模型随包自带、Windows 免编译；负责作业拍照识别的主体准确率，并做去阴影/对比度/锐化增强与多版本融合 | services/mindspore-infer/rapid_ocr.py |
| **OCR 云端兜底（可选）** | OpenAI 兼容视觉大模型，仅在本地结果为空或置信 < 0.85 时调用；未配置则完全跳过 | src/lib/ai/vision-ocr.ts |
| **端云协同流水线** | 视频/图文 → 端侧筛选 → 云端理解 → 产物落库；SM-2 调度；掌握度模型 | spec/03-ARCHITECTURE.md §1.3 / tasks §6-7 |
| **复习闭环** | 闪卡 + SM-2 + 掌握度 + 薄弱点看板 + AI 出题练习 + 轻游戏化反馈 | spec/03-ARCHITECTURE.md §3 / tasks §7-8 |
| **完整账号体系** | 注册 + 登录 + 验证码 + JWT + bcrypt（cost ≥ 12） | spec/03-ARCHITECTURE.md §2.3 / tasks §1 |
| **数据隔离与共享** | 历史初版结构；当前表结构以 Prisma schema 为准 | spec/03-ARCHITECTURE.md §3 / prisma/schema.prisma |

### 轻游戏化复习（PRD §5.5）

复习评分在不改变 SM-2 与掌握度算法的前提下，追加 XP、连续答对 streak、等级、稀有度徽标、答对粒子反馈和成就弹窗。XP 与成就由服务端事务写入，前端组件位于 `src/components/review/`。

> 截图占位：复习页原型 [`prototype/review.html`](prototype/review.html) 即对应轻游戏化交互效果。

---

## 🏗️ 技术架构（一图流）

```
┌────────────────────────────────────────────────────────────────────┐
│                         学习者浏览器                                 │
└────────────────────────────┬───────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼───────────────────────────────────────┐
│              Next.js 16 (App Router) · React 19 · TypeScript strict │
│                                                                       │
│   /login /register /dashboard /import /study /review /graph         │
└────┬──────────┬──────────┬───────────┬─────────────┬───────────────┘
     │          │          │           │             │
     │   ┌──────▼─────┐    │    ┌──────▼─────┐ ┌─────▼──────┐
     │   │  BullMQ     │    │    │  Prisma    │ │  ioredis   │
     │   │  (队列)      │    │    │  (ORM)     │ │  (缓存)     │
     │   └──────┬──────┘    │    └──────┬─────┘ └─────┬──────┘
     │          │           │           │             │
┌────▼──────────▼───────────▼───────────▼─────────────▼──────────────┐
│       PostgreSQL 16     ←     S3 / MinIO 对象存储                     │
└────────────────────────────────────────────────────────────────────┘

                  ╔═══════════════════════╗
                  ║   端云协同 (核心)        ║
                  ╚═══════════════════════╝

   视频抽帧/拍照 ──► MindSpore 推理服务 ◄──► AI 大模型 (讯飞星火)
   (FastAPI +            │                │
    MindSpore)           │                │
                  /classify 图像分类     知识点抽取
                  /detect_text 文字检测   闪卡生成
                  /select_frames 抽帧    知识图谱
                                         智能问答
                                            ▲
                                            │ 调用
                                            │
                                  ┌─────────┴─────────┐
                                  │   ASR 语音转写      │
                                  │  (讯飞/阿里/腾讯)   │
                                  └───────────────────┘
```

**核心理念**：

- **端侧（MindSpore）**：眼睛——实时筛选、低成本、不联网
- **云端（大模型）**：脑子——深度理解、慢但聪明
- **ASR**：耳朵——把人话转成文字
- **小模型过滤 → 大模型精读**：节省 token、加快响应

---

## 🚀 开发环境启动（本机毕设展示请用上方现行演示动线）

### 环境要求

- Node.js 22.13+（22 系）、24.x 或 26+，推荐 24 LTS
- pnpm 或 npm ≥ 9
- Docker Desktop（用于一键启动中间件）
- Python ≥ 3.9（如需跑 MindSpore 推理服务，本地不跑也能用 mock 模式）

### 第一次启动

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量
cp .env.example .env
# （按需修改密码 / API Key）

# 3. 启动中间件（PostgreSQL + Redis + MinIO）
docker compose up -d postgres redis minio minio-init

# 4. 初始化数据库
npm run prisma:generate
npm run prisma:migrate

# 5. 启动开发服务器
npm run dev
```

打开 http://localhost:3000 即可访问。

### 完整启动（含 MindSpore + ASR 网关）

```bash
docker compose up -d        # 启动全部 7 个服务
docker compose logs -f      # 查看实时日志
```

### 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 Next.js 开发服务器（端口 3000） |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm run lint` | ESLint 检查 |
| `npm run type-check` | TypeScript 类型检查（strict 模式） |
| `npm run prisma:generate` | 生成 Prisma Client |
| `npm run prisma:migrate` | 数据库迁移（开发环境） |
| `npm run prisma:seed` | 填充种子数据 |
| `npm test` | 跑一次单元测试（vitest） |
| `npm run test:watch` | 监听模式跑测试 |
| `npm run test:ui` | 可视化测试界面 |
| `npm run test:coverage` | 测试覆盖率报告 |

---

## 📁 项目结构（初版示意；新增班级/批改目录见实际源码）

```
.
├── AGENTS.md                           # AI 执行规则（根目录）
├── DEPLOY.md                           # 部署说明（本地 / Compose / K8s）
├── LEARNINGS.md                        # 踩坑记录
├── PROGRESS.md                         # 开发进度（公开版）
├── spec/                               # 项目核心规格文档（按编号分层）
│   ├── 01-PRD.md                       # 需求层
│   ├── 02-DESIGN.md                    # 设计层（页面级）
│   ├── 03-ARCHITECTURE.md              # 设计层（架构）
│   ├── 04-DATA-MODEL.md                # 数据模型与接口契约
│   ├── 05-TASKS.md                     # 任务层（按 P0/P1/P2）
│   └── 06-VISUAL-SPEC.md               # 视觉与交互规范（组件级）
├── prototype/                          # UI 原型
│   ├── prototype.css                   # 共享 CSS 变量与组件样式
│   ├── index.html                      # 登录页
│   ├── register.html                   # 注册页
│   ├── dashboard.html                  # 工作台
│   ├── import.html                     # 内容导入
│   ├── study.html                      # 学习页
│   ├── review.html                     # 复习页
│   └── graph.html                      # 知识图谱
├── prisma/
│   ├── schema.prisma                   # 现行数据模型，以文件为准
│   └── seed.ts                         # 种子数据
├── src/
│   ├── app/                            # Next.js 16 App Router
│   │   ├── api/                        # 33 个 REST 接口
│   │   ├── login/                      # /login
│   │   ├── register/                   # /register
│   │   ├── dashboard/                  # /dashboard
│   │   ├── import/                     # /import
│   │   ├── study/[id]/                 # /study/:id
│   │   ├── review/                     # /review
│   │   └── graph/                      # /graph
│   ├── components/                     # React 组件（按 SPEC §6 拆分）
│   ├── lib/
│   │   ├── ai/                         # 讯飞星火客户端 + InferenceGateway + ASR 网关 + 内容安全
│   │   ├── auth/                       # JWT + bcrypt + middleware + ownership
│   │   ├── jobs/                       # 异步任务（AsyncJob）
│   │   ├── domain/                     # ContentRef、Mastery、SM-2
│   │   ├── api/                        # 统一响应封装 + ErrorCode 枚举
│   │   ├── prisma.ts  redis.ts  queue.ts  storage.ts  design-tokens.ts  password-strength.ts
│   └── styles/                         # 全局样式
├── services/                           # 独立 Python 服务
│   └── mindspore-infer/                # MindSpore 端侧推理（FastAPI）
│       ├── Dockerfile
│       ├── infer_server.py             # 接口服务（含 mock 降级）
│       ├── models.py                   # 三类轻量网络定义
│       ├── scripts/                    # 训练、MindIR 导出、ATC 转 OM
│       └── models/                     # 模型产物约定（大文件不入库）
├── tests/                              # vitest 单元测试
│   ├── unit/                           # 核心算法单测
│   └── integration/                    # 集成测试
├── docker-compose.yml                  # 7 个服务一键启动
├── Dockerfile                          # Next.js 多阶段构建
├── vitest.config.mts                   # ESM 测试配置
└── README.md                           # 本文件
```

---

## 🔌 初版核心 API 索引（增量接口以当前路由和规格为准）

| 接口 | 方法/路径 | 说明 | 文档位置 |
|------|----------|------|---------|
| 内容导入 | `POST /api/contents/upload-intent` | 预签名直传 | spec/03-ARCHITECTURE.md §2.2 |
| 内容导入 | `POST /api/contents/:id/complete` | 驱动解析 | spec/03-ARCHITECTURE.md §2.2 |
| 笔记 | `GET/POST/PATCH/DELETE /api/notes` | 乐观锁并发控制 | spec/03-ARCHITECTURE.md §2.2 |
| 闪卡复习 | `POST /api/flashcards/:id/review` | SM-2 + 游戏化扩展字段 | spec/03-ARCHITECTURE.md §2.2 |
| 掌握度 | `GET /api/mastery` | 汇总 | spec/03-ARCHITECTURE.md §2.2 |
| 薄弱点 | `GET /api/mastery/weak-points` | 薄弱点清单 | spec/03-ARCHITECTURE.md §2.2 |
| 知识图谱 | `GET /api/contents/:id/graph` | 内容局部图谱 | spec/03-ARCHITECTURE.md §2.2 |
| 游戏化 | `GET /api/gamification/profile` | XP / streak / 成就 | tasks §7.5 |
| 端侧推理 | `POST /select_frames /classify /detect_text` | MindSpore 推理服务 | spec/03-ARCHITECTURE.md §1.1 |

**接口契约**：见 `spec/03-ARCHITECTURE.md` §2.2 和 `spec/04-DATA-MODEL.md`；当前路由数量、已退场接口及最终行为以 `src/app/api/**/route.ts` 和对应测试为准，不沿用初版数量。

---

## 🤖 端云协同详解

这是本系统的**核心技术特色**，也是论文和答辩的重点。

### 视频解析链路（视频 → 知识）

```
视频上传
   │
   ▼
ffmpeg 抽帧（每 2s 1 帧）
   │
   ▼
MindSpore /classify ──► 分类「板书/屏幕教学内容/无效帧」
   │                    （无效帧直接跳过后续 OCR）
   ▼
MindSpore /select_frames ──► 模糊/重复/信息量评估
   │                        丢弃低价值帧
   ▼
MindSpore /detect_text ──► 文字区域检测 + 轻量 OCR
   │                      （检测 + 文字识别）
   ▼
ASR ──► 音轨转写（带时间戳）
   │
   ▼
讯飞星火大模型 ──► 自动课堂笔记（带时间点）
                    知识点抽取
                    闪卡生成
                    知识图谱构建
                    问答
   │
   ▼
存入 PostgreSQL
```

### 拍照识别链路（图像理解为主角）

```
拍照/上传图片
   │
   ▼
MindSpore /classify ──► 课堂帧三分类「板书/屏幕教学内容/无效帧」（未部署模型时为 unknown 降级）
   │
   ▼
MindSpore /detect_text ──► 文字区域检测
   │
   ▼
OCR ──► 文字提取
   │
   ▼
讯飞星火 ──► 知识点抽取 / 闪卡生成
```

### 「小模型过滤、大模型精读」的好处

| 维度 | 纯大模型方案 | 端云协同方案 |
|------|------------|------------|
| Token 成本 | 全量输入会增加请求量 | 先过滤低价值帧可减少模型输入；本项目尚无通用节省比例验收 |
| 响应延迟 | 取决于服务与内容长度 | 端侧先筛选可减少后续处理量；尚无跨场景倍率验收 |
| 离线能力 | 无 | **端侧可离线跑通 mock 降级** |
| 论文价值 | 一般 | **高**（MindSpore + 大模型融合是亮点） |

---

## 📐 早期范围与优先级（历史基线，当前以§29任务为准）

> **毕设主线 = P0 跑通即可视为完成，P1/P2 写到论文「展望」章节**

| 优先级 | 覆盖范围 | 占比 |
|--------|---------|------|
| **P0**（必做）| 鉴权、Prisma migrate、视频导入、内容浏览/笔记、MindSpore 服务（全部）、端云流水线核心、SM-2 复习、掌握度+薄弱点看板、前端学习页、核心单测+集成测试、docker-compose | 70% |
| **P1**（有余力）| 图文导入、笔记检索/导出、练习生成/判分、知识问答、图谱渲染（react-flow）、监控指标、性能压测、轻游戏化 | 20% |
| **P2**（可砍/简化）| AuditService、笔记导出、审计日志、链路追踪 | 10% |

**现行任务清单**：见 [`spec/05-TASKS.md`](spec/05-TASKS.md) §29；上表为初版计划占比，不能据此判断当前完成度。

---

## 🛠️ 技术选型与依赖

> **事实来源**：`package.json`（运行时 + 构建时依赖）+ `tsconfig.json` + `docker-compose.yml`
> **最近核对**：2026-09-10

### 技术选型总览

§29.23（2026-10-21）：Docker builder/worker和runner显式安装Alpine系统包ffmpeg（同时提供ffmpeg、ffprobe），构建期执行两工具版本检查，供视频元数据、抽帧/抽音轨及直链媒体校验使用；Poppler仍供PDF页渲染。不是新增npm包，Windows便携路径仍沿用FFMPEG_PATH/FFPROBE_PATH，不能把本机安装当容器依赖已具备。实测边界见[队列可靠性修复](docs/acceptance/queue-reliability-20261021.md)。

§22.8本地ASR产品接入：显式ASR_PROVIDER=funasr-local、ASR_LOCAL_PYTHON及ASR_LOCAL_MODEL_DIR；复用上项隔离依赖/模型，Node以无shell子进程串行处理既有≤300秒PCM窗口、180秒/2MiB预算，网络连接阻断，失败不回退付费讯飞/mock。无HTTP服务端口/新npm依赖；段落VAD区间由既有流水线加一次真实窗口偏移入库。普通启动复用本机.env.local配置，Docker/其它主机未安装此环境时不能使用该模式。具体配置/验收见DEPLOY §8.9。

§22.7 免费本地ASR小样验证：独立Windows Python3.9 venv，funasr-onnx0.4.1/onnxruntime1.19.2/NumPy1.26.4；包导入遗漏需补jieba0.42.1及torch2.5.1+cpu，精确完整依赖见scripts/acceptance/local-asr-requirements.txt。官方固定Paraformer量化ONNX+FSMN-VAD模型及校验值见local-asr-download.py；运行时代码MIT，两模型卡Apache2.0。30秒中文课堂小样实际CPU转写及3个真实语音区间通过，约0.863秒分段/推理（模型加载另1.891秒）；首次无VAD转写含前端初始化46.232秒，不承诺长视频或冷启动速度。段落级VAD时间不是逐字对齐，文本仍有识别差异。仅本机诊断，不切换src/lib/ai/asr.ts或ASR_PROVIDER，不与MindSpore/人脸共用环境，不调用付费ASR；复现、原失败及未接入边界见[本地ASR验收](docs/acceptance/local-asr-20261012.md)。

§19 本地真实人脸识别补验使用隔离 Python 3.9 venv：MediaPipe 0.10.21、OpenCV contrib 4.11.0.86、NumPy 1.26.4、Pillow 11.3.0、FastAPI 0.128.8、Uvicorn 0.39.0；精确依赖见 `services/face-infer/requirements.txt`。官方 YuNet（MIT）、SFace（Apache-2.0）和 MediaPipe Face Landmarker v1 只用于独立 CPU 人脸/动作服务，不替代现有 MindSpore/Ascend。启动说明见 DEPLOY §8.6，权重台账和许可见 services/face-infer/README.md；权重和 venv 不入 Git。只提供基础动作检查，不宣称专业防回放。

| 层级 | 选型 | 版本 | 满足的核心诉求 |
|------|------|------|--------------|
| 前端框架 | Next.js（App Router） | 16.4.1 | 安全升级；Webpack、异步路由参数、standalone及PDF/ASR资源追踪 |
| UI 框架 | React / ReactDOM | 19.3.1 | 与Next16匹配；类型声明19.3.0，保持原页面交互 |
| 类型系统 | TypeScript（strict 模式） | 5.6.3 | 强约束 `TS_Strict` |
| 样式方案 | Tailwind CSS | 3.4.14 | 实用类 CSS，组件样式快速组合 |
| 样式工具 | — | — | 移除：clsx / tailwind-merge 全仓零引用（条件 class 用模板字符串实现），不再引入 |
| 图谱画布 | React Flow (`@xyflow/react`) | 12.12.0 | 可缩放/拖动的交互式知识图谱、节点与关系渲染 |
| ORM | Prisma | 5.19.1 | 数据建模 + 迁移 + 乐观锁（含实时笔记会话/片段） |
| 主数据库 | PostgreSQL | 16 | tsvector 全文索引、JSON 字段、事务 |
| 缓存 | Redis（ioredis 客户端）| 7 / 5.4.1 | 学习进度、限流、session |
| 异步队列 | BullMQ | 5.12.0 | 导入/解析/抽取异步流水线 |
| 对象存储 | S3 兼容（AWS SDK v3）| 3.637.0 | 视频/图片预签名直传 |
| 鉴权 | JWT（jsonwebtoken）+ bcryptjs | 9.0.2 / 2.4.3 | 完整账号体系（bcrypt cost ≥ 12 ✅）|
| 数据校验 | Zod | 3.23.8 | API 入参强校验 |
| 代码质量 | ESLint + eslint-config-next | 9.39.5 / 16.4.1 | flat config + ESLint CLI；react插件peer尚不支持ESLint10，保留兼容9与原Hooks基础规则，未启React Compiler |
| CSS工具安全版本 | PostCSS / source-map-js / postcss-selector-parser | 8.5.30 / 1.2.2 / 7.1.6 | 保留Tailwind3；parser仅对Tailwind和postcss-nested两条依赖路径override，现有CSS与嵌套/变体编译前后逐字一致；官方审计复验 |
| URL HTML解析 / IP分类 | htmlparser2 / ipaddr.js | 12.0.0 / 2.5.0 | MIT；服务端静态正文与公网地址校验，Node固定IP连接，无浏览器执行或自动资源加载 |
| EPUB XML解析 | saxes | 6.0.0 | ISC；严格事件式XML、无外部实体获取，Node内建有界ZIP/CRC；只在服务端转纯文本 |
| AI 大模型 | 讯飞星火HTTP（本机Lite） | — | 原生fetch；全部文本任务统一星火，无供应商回退；试卷已退场 |
| 内容安全 | 自写规则（关键词 + 转义）| — | 用户输入与 AI 产物过滤 |
| 端侧推理 | MindSpore（独立 Python 服务）| — | 图像分类 + 文字区域检测 |
| 扫描 PDF 页渲染 | Poppler `pdftoppm`（系统工具，可选）| — | 将无文本层页面转 PNG 后交给文字检测 |
| 测试 | vitest/UI + @testing-library/react + happy-dom | 5.0.4 / 16.x / 21.0.1 | 单元测试 + 集成测试；Vite React插件6.1.2，Node22.13（22系）/24系/26+ |

### 范围简化声明（合理偏离 ARCHITECTURE）

§28.2/28.3独立华为云LoRA实验：使用现有MindSpore2.7.1/MindFormers1.7.0/CANN8.3.RC1，云端已有PyYAML6.0.2、Transformers4.51.3、PyTorch2.1.0和safetensors仅用于固定权重读取、数据处理及MindSpore实验，不加入npm运行依赖、不安装torch-npu。`services/learning-lora`固定官方配置/tokenizer/基础权重版本与哈希，提供原创样本隔离、单卡24GB及有界训练、适配器导出/重载与星火同样例对照；不自动接入产品星火网关。命令与真实完成状态见[实验说明](services/learning-lora/README.md)及PROGRESS。

§29.12.1（2026-10-18用户修订）仅保留星火：LLM_PROVIDER=spark，SPARK_API_PASSWORD为HTTP接口APIPassword，SPARK_BASE_URL默认官方HTTPS/v1。2026-10-19按用户指令默认SPARK_MODEL=lite，样例同为lite；型号和额度由实际账号授权决定，不自动换型号。移除OpenAI、智谱与百炼运行分支，无SDK或新依赖。

JSON对象模式带明确指令并保留Zod/引用/内容校验；数组及文档行协议保持。支持内建搜索的型号显式关闭联网，输出预算按型号校验。ASR与MindSpore独立；AGENT_REVIEW_READY=false保持证据模式，AGENT_REVIEW_THINKING是独立验收的可选覆盖/术语检查，不能当隐藏推理能力或质量保证。未通过真实语义验收前不自动开放生成式原文解释。协议和验收边界见spec/22-SPARK-ONLY.md。

历史失败与验收不删除：[原智谱记录](docs/acceptance/agent-bigmodel-20261011.md)、[原百炼记录](docs/acceptance/agent-aliyun-20261011.md)、[有界复核](docs/acceptance/agent-review-thinking-20261011.md)、[证据模式](docs/acceptance/agent-evidence-20261011.md)。它们不再是当前配置指引。新协议与复现见[迁移规范](spec/18-OPENAI-MIGRATION.md)。

> 这些"自写实现"是**有意的简化**，目的是在单人毕设周期内控制依赖规模。

| 项 | ARCHITECTURE 原始方案 | 实际方案 | 理由 | 文件位置 |
|----|---------------------|---------|------|---------|
| AI SDK | 讯飞星火 SDK / WebSocket | **自写 HTTP 客户端** | 避免引入额外依赖；仅星火官方HTTP接口，JSON与来源质量仍需校验 | `src/lib/ai/spark.ts` |
| 内容安全 SDK | 阿里云绿网 / 百度内容审核 | **自写 `content-guard.ts`** | 基础规则检查，不宣称已接入外部审核服务 | `src/lib/ai/content-guard.ts` |
| 进度推送 | WebSocket | **SSE**（Next.js 原生支持）| 避免引入 socket.io，依赖更轻 | Next.js Route Handler `Response` |
| ASR SDK | 讯飞 / 阿里 / 腾讯 SDK | **讯飞录音文件转写 HTTP API**（原生 `fetch` + Node `crypto` 签名，无新增依赖）| 长音频异步上传/轮询；凭据仅从服务端环境变量读取 | `src/lib/ai/asr.ts` |
| MindSpore 推理服务 | 完整训练 + 导出 + 部署 | **FastAPI + Mock 降级 + 可执行训练/导出/ATC 脚本** | 无 NPU 时主线可跑；真实训练和部署按硬件环境执行 | `services/mindspore-infer/` |

### 已落地 / 待补齐 / 待确认

**✅ 已落地**

| 项 | 落地位置 |
|----|---------|
| Prisma 数据表与枚举（以schema为准） | `prisma/schema.prisma` |
| BullMQ 队列脚手架 | `src/lib/jobs/` |
| JWT + bcrypt 鉴权（cost ≥ 12）| `src/lib/auth/` |
| Zod 数据校验 | `src/lib/api/` |
| 讯飞星火客户端 | `src/lib/ai/spark.ts` |
| 内容安全过滤 | `src/lib/ai/content-guard.ts` |
| 鉴权中间件 + 归属校验 | `src/lib/auth/{middleware,ownership}.ts` |
| vitest 测试框架 | `vitest.config.mts` + `vitest.setup.ts` |
| docker-compose 7 service 部署（含 BullMQ worker） | `docker-compose.yml` + `Dockerfile` + `.dockerignore` |
| Next.js standalone 构建 | `Dockerfile` |
| MindSpore 推理服务 Docker | `services/mindspore-infer/Dockerfile` |

**🔵 待补齐**

| 项 | 待办位置 |
|----|---------|
| S3 兼容对象存储部署复验 | `src/lib/storage/` 已实现，目标环境需真实验证 |
| MindSpore 真实在线推理适配 | `services/mindspore-infer/inference.py`（当前保留 mock 降级） |
| ASR 长时/目标环境验收 | 本机本地ASR短样已通过，长时与其它部署环境仍需真实验证 |
| 端到端测试（Playwright）| `tests/e2e/` |

**⚠️ 待确认**

| 项 | 当前 | 期望 | 风险 |
|----|------|------|------|
| ASR 部署选型 | 讯飞文件转写与免费本地FunASR均已实现，本机采用本地 | 目标机器提供实际可用的对应配置/模型 | configured不能当成实际识别通过 |

### 不引入的依赖（明确边界）

> 防止后续开发时无意识地引入新依赖。

| 类别 | 不引入 | 原因 |
|------|--------|------|
| 前端框架 | ❌ Nuxt / Remix / SvelteKit | 已定 Next.js 16 |
| UI 组件库 | ❌ Antd / Material-UI / Chakra | 已定 Tailwind CSS + 自写组件（按 SPEC）|
| 状态管理库 | ❌ Redux / MobX / Zustand | Next.js 16 + Server Components + React Context 足够 |
| 数据库 | ❌ MySQL / MongoDB / SQLite | 已定 PostgreSQL |
| ORM | ❌ Sequelize / TypeORM / Drizzle | 已定 Prisma |
| 队列 | ❌ Kafka / RabbitMQ | BullMQ（基于 Redis）足够 |

**工具链例外**：测试框架 vitest 与 Next.js 官方 ESLint 配置不在上述六类限制内；前者用于测试，后者用于 `npm run lint`。

### 依赖升级策略

- **升级方式**：锁定大版本（`~` 波浪号），避免 minor 升级引入 breaking change
- **关键依赖锁定**：`next`、`react`、`prisma`、`bullmq`、`@aws-sdk/*` 大版本锁定
- **安全升级**：每两周 `npm outdated` 一次，手动评估
- **依赖审查**：新增任何依赖必须先更新本文档「技术选型总览」表，并在 PR 描述说明

---

## 🧪 测试

| 类型 | 工具 | 位置 |
|------|------|------|
| 单元测试 | vitest + @testing-library/react | `tests/unit/` |
| 集成测试 | vitest（路由处理器 + 内存替身） | `tests/integration/` |
| 主路径验收 | vitest + @testing-library/react + happy-dom（页面组件 + 有状态接口替身） | `tests/e2e/` |

跑测试：

```bash
npm test              # 单次
npm run test:watch    # 监听模式
npm run test:ui       # 可视化界面
npm run test:coverage # 覆盖率
```

**核心测试目标**：

- SM-2 调度（状态迁移 / 间隔计算边界）
- 掌握度计算（近因衰减 / 阈值 0.6 判定）
- ContentRef 范围校验
- Token 预算分块截断
- 端云协同流水线全流程
- 复习闭环（闪卡 → 掌握度 → 薄弱点 → 练习）

---

## 🚢 部署

### 容器化清单

`docker-compose.yml` 一键启动 7 个服务：

| Service | 端口 | 镜像 | 作用 |
|---------|------|------|------|
| `postgres` | 5432 | postgres:16-alpine | 主数据库 |
| `redis` | 6379 | redis:7-alpine | 缓存 + 队列 |
| `minio` | 9000 / 9001 | minio/minio:latest | S3 兼容对象存储 |
| `minio-init` | — | minio/mc | 自动建 bucket |
| `nextjs` | 3000 | 自构建 | Web 应用 |
| `worker` | — | 自构建 | 独立消费 BullMQ 后台任务 |
| `mindspore-infer` | 8000 | 自构建 | MindSpore 推理服务 |

```bash
# 一键启动
docker compose up -d

# 查看日志
docker compose logs -f nextjs

# 停止
docker compose down

# 停止并清数据
docker compose down -v
```

### 生产环境建议

- **PostgreSQL**：替换为阿里云 RDS 或腾讯云 CDB（启用自动备份）
- **Redis**：替换为云 Redis（开启持久化）
- **对象存储**：替换为阿里 OSS / 腾讯 COS（走内网）
- **MindSpore 推理**：部署到 Atlas 200 DK 边缘设备（profile: ascend）
- **Web**：Nginx 反向代理 + CDN 加速静态资源

---

## 📝 论文写作建议

| 论文章节 | 引用本仓库的文档 |
|---------|----------------|
| 第一章 绪论 | — |
| 第二章 需求分析 | `spec/01-PRD.md` |
| 第三章 系统设计（架构） | `spec/03-ARCHITECTURE.md` §1 + 本 README「技术架构」|
| 第四章 关键技术（端云协同） | `spec/03-ARCHITECTURE.md` §1.1 + 本 README「端云协同详解」|
| 第五章 系统实现 | `spec/05-TASKS.md`（按 P0 落地情况展开）|
| 第六章 测试 | `tests/` 目录 + `npm run test:coverage` 输出 |
| 第七章 总结与展望 | `spec/05-TASKS.md` 的 P1/P2 章节 |
| 附录 | 本 README §🛠️ 技术选型与依赖 |

---

## 🤝 致谢

- **MindSpore / 昇腾**：华为开源的深度学习框架与异构计算架构
- **讯飞星火**：国产大模型服务
- **Next.js / React / Prisma / BullMQ / ioredis / zod**：开源生态
- **导师**：感谢老师提出的「华为技术栈落地」约束，让本项目有了更明确的技术主线

---

## 📄 许可

本项目为**毕业设计项目**，仅用于学术研究与答辩演示。

---

> 💡 **最后提醒**：MindSpore 在无可用模型时可按契约降级；ASR 未配置真实凭据时会明确不可用，只有将 `ASR_PROVIDER=mock` 显式设为测试/演示模式才会生成占位转写。验收报告须区分真实服务与 mock。

§22.11：服务端PDF正文提取新增固定pdfjs-dist 4.10.38（Apache-2.0，Node>=20），按页面树读取中文字体映射；不执行PDF嵌入脚本（isEvalSupported=false）。Poppler仍用于逐页PNG阅读。





2026-10-13运行选择：按用户要求，桌面本地演示的Agent、题库生成及PDF/MD/TXT理解/闪卡均显式spark，保留原lite型号；百炼门禁关闭，密钥不删除。Agent原文依据模式保持，生成解释须独立质量复验；现有出题/引用门禁不放宽。恢复记录见docs/acceptance/spark-return-20261013.md。

### §23.1 历史麦克风方案（入口已撤下，当前使用§23.2）

历史麦克风课堂笔记实现已退场：`/live-notes` 跳转到资料导入，相关API返回410，不读取旧录音数据。原实现、两张Prisma表、迁移和验收文档只作历史记录；当前视频课堂随看笔记见下一条。旧操作说明见[历史文档](docs/live-notes.md)。

### §23.2 导入视频随看笔记
按用户澄清，功能在/study/:id播放器旁。连续已看转写约30秒调用现有星火逐段生成、本页积累，显式保存至个人笔记/导出；不录音、不重跑ASR、无新依赖或表。参见[操作说明](docs/watched-notes.md)。


§29.13 EPUB阅读：学习中心选择文档→上传无DRM EPUB（≤50MiB）→进入学习→目录选章/提取最多20段→书签/续读或记个人笔记。本版纯文本，无图片/公式/固定页码；AI章节整理尚未提供，导入不会自动跑整书模型。saxes@6.0.0仅服务端使用，ZIP由Node内建有界解压/CRC校验；限制与兼容范围见spec/23-EPUB-READING.md，验收见docs/acceptance/epub-reading-20261018.md。无新增数据库迁移。
