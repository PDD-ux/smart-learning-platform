# §22.6 ModelArts推理恢复验收（2026-10-12）

只执行本编号。用户启动原notebook-85a2并提供31637端口SSH，本次恢复限时本地毕设演示；无训练、模型覆盖、既有资料重生成、人脸恢复或公网部署。

## 环境与恢复

原known_hosts拒绝重启后的指纹，第一次连接失败保留结论；随后以新独立`.taskbook-working/cloud-resume-20261012-1/known_hosts`连接，原记录未修改。观测RSA指纹`SHA256:yILrt64FZb2JohAm2JM6enNgGhdbI+hJQk/cKCGVp0k.`，并未通过独立可信渠道核验身份。Windows域名解析198.18.0.90，本次域名SSH成功，未固化历史110.41.14.167。

远端aarch64、910B4健康OK、npu-smi25.5.1、MindSpore Lite2.7.1；复用原解释器及CANN set_env.sh和/home/ma-user/work模型，无安装。原本地配置仍指向旧内网8001且不是演示随机令牌，不能直接接回；确认Next PID83484及监听子进程99564属于桌面仓库后仅停止这棵进程树，用既有启动器重启。原先补复用模式的设想撤回，无生产代码修改。

09:03:34启动，源码上传新目录`/home/ma-user/work/taskbook-demo-vTy6atA8`；09:07:13 ready。真实health：device=ascend、mindsporeAvailable/modelsLoaded/modelFilesReady=true，四模型状态true，mock=false，ocrFallbackAvailable=false。预热期未监听是预期；采集到NPU进程10090/325MB，Ascend custom operator path警告未阻止本轮真实推理，不据此推断历史断线原因。

随机令牌仅启动器内存、SSH stdin及子进程环境；未写.env、日志或命令参数。控制器94616、Next107028、隧道102452；本机8001转发云端回环18765，网页3000。当前ready只是时点状态，最长至约11:03:34，云端到期可能更早。控制器停止会停自己网页/隧道/远端服务，不会停止Notebook或其它服务；用户应在云控制台管理Notebook停止。

## 真实结果

- 单帧classify/detectText/selectFrames分别599/1220/343ms；16帧分别1991/17250/1560ms，六项均无fallback，status=executed，退出0。批量OCR通过网关分批，原每请求8000ms预算不变；17.250秒是整组时间，无稳定P95/精度承诺。
- 真实图片完整产品接口09:07:50–09:08:10通过：隔离账号登录、上传、complete及任务结束；95 OCR文字块与既有frame_014 Ascend基线一致，pageCount1、1知识点/1闪卡及第1页有效引用、理解API可达。临时账号及内容清理完成，全部既有内容产物指纹不变。
- 前后只读agent-retrieval均modelCalled=false，十类学习指纹保持`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`。原三份演示资料和XP等保持。
- `D:\python\python.exe -m unittest discover -s scripts/demo -p test_demo_lifecycle.py`三项通过。无代码/依赖/算法变更，不重复全量前端测试或冲突构建；未刷新本人助手页面或代登录。

原始证据保留在忽略目录：`.taskbook-working/cloud-resume-20261012-1/{environment-and-prewarm.txt,ready-state.json,gateway.json,product.json}`，前后保护报告在cloud-resume-20261012-before/after，控制器完整状态/日志在ascend-demo/20261012T010334Z。product/gateway含原样课堂OCR，仅留本地，不公开正文/密钥；已有失败/历史证据未覆盖。

## 复现与停止

确认Notebook运行、连接命令及解释器仍有效，本机3000/8001和远端18765空闲后，在桌面仓库执行DEPLOY §8.5当前命令；不得与现有演示同时运行。`--ip`实际传给SSH HostName，可以传本次成功的域名，不把旧IP作为永久地址。

已ready时重新验收只使用新的输出路径：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/demo/accept-local-product.ts .taskbook-working/cloud-resume-NEXT/product.json
```

先创建新的cloud-resume-NEXT目录，此入口会真实调用星火并创建/清理临时资料，不重跑原资料。网关入口为scripts/performance/check-ssh-gateway.py，连接参数同启动器；remote-root取本次current.json的remoteRoot，remote-report传services/mindspore-infer/lifecycle.json，output取新路径。它只在内存读取该服务令牌，创建并关闭自己的额外隧道，执行单帧与16帧真实调用。

停止本次演示：

```powershell
$cloudDemoState = Get-Content .taskbook-working/ascend-demo/current.json -Raw | ConvertFrom-Json
New-Item -Path $cloudDemoState.stopFile -ItemType File -Force
```

停止后已有三份资料仍可用根目录启动演示.cmd展示；普通本地启动使用原配置，不自动恢复云端。未验收新的全段视频上传/ASR/产物一遍完成、人脸、生产worker或长期稳定性。没有TODO补全，TASKS/PROGRESS/DEPLOY的非TODO修改仅同步本次授权恢复及边界。
