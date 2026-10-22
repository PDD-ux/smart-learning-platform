# 本地真实人脸识别服务

独立 CPU 服务，通过既有 licensed-http 接口调用，不替代 MindSpore/Ascend 课堂模型。只监听回环8002，浏览器不直接调用。Python依赖装到被忽略的独立venv，不改全局或Ascend。

## 固定模型与许可

- YuNet 2023mar：OpenCV Zoo 官方提交47534e27c9851bb1128ccc0102f1145e27f23f98，MIT，原文 licenses/face_detection_yunet.LICENSE。
- SFace 2021dec：同一官方提交，Apache-2.0，原文 licenses/face_recognition_sface.LICENSE。
- MediaPipe Face Landmarker float16 v1：[Google官方模型页](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)、[Python用法](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/python)。MediaPipe Apache-2.0原文 licenses/mediapipe.LICENSE。

权重原始URL、大小、SHA256见 models-manifest.json；下载/启动均校验，ONNX与官方Git LFS校验值一致。权重只在 .taskbook-working/face-infer/models，不入Git。更改模型/阈值/策略应换版本并重录模板。

## 功能和边界

2026-10-09用户明确改为一次扫描：本机.env.local设FACE_LOGIN_MODE=scan，Next与本服务均加载该配置。点击扫描后取3帧、单人和真实身份匹配通过即可登录打卡，无准备/动作按钮。livenessPassed仍false，不假装活体；静态照片能够认证，存在照片/视频冒用风险。公开请求不能切换模式，默认action仍保留下述动作要求；模式切换使旧票据失效。已有128维模板无须重录。scan完整真实模型/HTTP/数据库验收入口：`npx tsx scripts/acceptance/face-scan-local.ts`，公共样本和隔离账号，不冒充真人摄像头验收。

YuNet每帧检测单人，SFace对齐提取128维归一化float32小端向量，固定cosine>=0.45，动作每帧均须匹配本人。仅做公共小样本验收，没有人群级准确率结论。MediaPipe检测双眼闭合及鼻尖相对双眼中点偏移：起始正视睁眼，闭眼再睁眼，或按本人左右方向转头再回正；预览不镜像，动作采集约4秒。光线/眼镜/动作速度会影响通过率。

基础动作核验不能保证抵御录制视频、深度伪造、客户端伪造或专业攻击；不适合高风险身份认证。密码登录保留。模型只处理内存画面/临时向量；enroll向受控Next返回向量供AES-GCM加密，一张录入照片独立加密私存30天；verify仅返回结论，无向量或分值。尽量清零可写数组并释放引用，但Python/NumPy/HTTP库会产生不可控内存副本，不承诺取证级内存擦除。

## 可复现入口

在仓库根目录运行，首次需要Python3.9和网络。Windows使用精确依赖锁，Linux使用核心依赖清单，Linux尚未实测。

```powershell
npm run face:setup   # 独立venv、校验权重、只补空的人脸配置/随机密钥
npm run face:start   # 隐藏后台运行，127.0.0.1:8002
npm run face:status  # 受Bearer保护的真实模型健康检查
npm run dev          # 完成配置后重启原Next，仅运行一个3000服务
npm run face:stop    # 只停止instanceId相同的受管理进程
```

setup保留非空配置，不轮换密钥；已有外部配置须自行确认后修改。版本固定 yunet2023-sface2021-mp1-c045-action-v1。密钥只在被忽略的.env.local，勿删除，否则旧模板不能解密。状态/日志在忽略目录，token不写参数/URL/日志。生产部署仍需受控HTTPS、Secret注入及独立安全验收。

## 验收

```powershell
.taskbook-working/face-infer/venv/Scripts/python.exe services/face-infer/test_actions.py
.taskbook-working/face-infer/venv/Scripts/python.exe services/face-infer/accept_real_models.py .taskbook-working/face-infer
npx tsx scripts/acceptance/face-real-local.ts
node scripts/acceptance/face-service-boundary.cjs
```

动作规则单测是合成landmarks，不证明真实动作通过。模型脚本用Google官方公共portrait/business-person/cat样本做真推理；样本在忽略目录。产品脚本使用隔离账号走真实HTTP/模型/PostgreSQL，核对加密存储及静态照片/不同人/重放拒绝，再清理模板、私有照片、临时账号。不替真人用户授权，不访问原学习资料。证据不含图像、向量、分值或凭据。

本人最后验收：密码登录→工作台“每日打卡与人脸登录设置”→展开可选人脸区→本人阅读同意并录入→退出→同账号选择人脸登录→正视准备、执行动作并回正→登录成功且今日最多一条打卡。做完前不得标记本人摄像头或成功人脸登录验收通过。
