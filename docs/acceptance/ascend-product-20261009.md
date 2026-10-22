# §10.4 桌面网站接入真实 Ascend（2026-10-09 19:19）

本轮只继续 §10.4 网站产品接入验收。在上一轮真实直调/HTTP/网关通过后，恢复桌面主仓库 `http://localhost:3000` 到 ModelArts 的真实推理演示；没有新增业务功能、改接口/数据字段、重跑原资料或更换模型。

## 接入与改动

启动器 `scripts/demo/run-ascend-demo.py` 增加可选 `--known-hosts`，使用隔离记录与 accept-new，拒绝后续指纹变化，解决旧记录变化导致 SSH 允许登录但拒绝隧道的问题。复用上一轮记录，其 RSA 指纹仍为 `SHA256:BtE0Fqc6c12m3bCE9U45vupfVAVMpjN429YD4Sy9nKU`；原 known_hosts 保留，不宣称独立确认主机身份。

原 3000 进程通过 Next 命令、子进程完整仓库路径与父子关系确认后，只停止该项目 Next 进程树。数据库唯一 RUNNING 是 9 月 28 日遗留 UNDERSTANDING/light-filter，早于本次旧网页进程启动时间；保留该记录，不改写状态或声称历史任务完成。新网页加载既有 `.env.local` 的合格签名密钥；旧会话失效时重新登录，不重置账号密码或人脸模板。

新云端目录 `/home/ma-user/work/taskbook-demo-2EEIboV0`，复用现有 Lite/CANN/模型。关闭 mock、OCR 后备，服务预热后建立回环 `8001 → 18765` 隧道；Next 子进程显式启用真实推理和 memory 队列。随机共享令牌只在一次性 SSH stdin 和子进程环境中，不写配置或证据。没有更改全局依赖、原模型/服务目录、数据库和人脸服务。

产品验收入口 `scripts/demo/accept-local-product.ts` 补强通过条件：不仅要求真实 OCR 和完成状态，还要求非空知识点、非空闪卡及理解 API 可访问。无新增依赖。

## 实际验收

临时隔离账号经真实 HTTP 登录、upload-intent、预签名 PUT、complete 触发流水线，使用原诊断 `frame_014.jpg`，未调用视频 ASR。

- 退出 0、status=passed，资料 READY、理解 COMPLETED，两个异步任务 SUCCEEDED。
- OCR 95 块，全部来源 OCR，文本顺序与真实 Ascend 修复后基线完全一致；源图 SHA-256 留在原始报告。
- 实际云端理解后生成 1 个知识点、1 张闪卡，理解 API 可访问；这是执行验收，不是语义质量评分。
- 删除本次临时资料/账号完成；独立数据库复核同前缀验收账号剩余 0。原 18 份内容及解析文本/笔记/闪卡/生成笔记指纹未改变。
- TypeScript type-check、Python 启动器编译、改动差异空白检查通过。没有修改推理算法/业务页面，不重复生产构建或全量前端测试。

证据：[产品结果](ascend-product-20261009/product.json)、[启动状态快照](ascend-product-20261009/startup.json)。真实服务状态在 `.taskbook-working/ascend-demo/current.json`，快照不是永久在线证明。网页入口已发送到 Codex 预览面板；该工具返回 queued，不能据此说已完成当前窗口浏览器交互验收。

## 演示与复现

当前演示从北京时间 19:17 启动，最多运行到约 21:17，实例停机或断线可能更早；不是公网或常驻部署。网页和隧道本轮保持运行，方便本人登录展示。停止本次 controller 管理的网页/隧道/独立云端服务：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
$demoState = Get-Content .taskbook-working/ascend-demo/current.json -Raw | ConvertFrom-Json
New-Item -Path $demoState.stopFile -ItemType File -Force
```

再次启动前先确认当前演示已结束、本机3000/8001空闲、当前实例IP和解释器仍有效；不要盲杀其它占端口进程。

```powershell
D:\python\python.exe scripts/demo/run-ascend-demo.py `
  --host ma-user@dev-modelarts-cnsouth1.huaweicloud.com --ip 110.41.14.167 `
  --key 'C:\Users\qwh76\Downloads\KeyPair-e0aa.pem' `
  --known-hosts .taskbook-working/ascend-resume/20261009T110013Z/known_hosts `
  --remote-python /home/ma-user/work/taskbook-accept-20261008-eNe960/.venv/bin/python
# status=ready后，选择新输出路径保留旧证据
node --import tsx scripts/demo/accept-local-product.ts .taskbook-working/ascend-demo/product-new.json
```

该验收调用已配置的大模型处理一张图片。不要用它声称 46 分钟视频 ASR、整段时间轴笔记、代表性 OCR 精度、公网HTTPS/Docker部署或本人摄像头登录已验收。遗留 RUNNING 任务仍待单独诊断，本轮不越界修复历史数据。
