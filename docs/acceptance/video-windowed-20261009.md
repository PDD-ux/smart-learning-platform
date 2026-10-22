# §10.4 长视频分窗知识抽取验收

2026-10-09 21:13，桌面主仓库，仅继续§10.4长视频重点集中开头的补修。代码和30分钟真实解析数据的隔离模型复验通过；46分钟完整链路前两轮失败，第三轮因演示服务提前退出中断，完整验收仍阻塞。任务保持未完成，不将局部成功写成完整通过。此前[来源修复验收](video-refs-fixed-20261009.md)及[原46分钟失败](video-46m-20261009.md)保留。

## 改动与边界

`context-builder.ts`增加真实时间窗口查询：转写按startMs、视频文本块按ref.timestampSec的左闭右开区间归属，窗口不读取个人笔记。长视频超过300秒时以300秒分窗，最多36窗，更长视频扩大窗口宽度。末端以整数毫秒上界包含末尾定位，入库仍校验全片范围。每窗6000估算token、保留首尾；不再对全片一次截断后仅生成开头重点。

`deep-extract.stage.ts`每窗独立提供实际来源编号，最多2个知识点、2500输出token、60秒单次请求，沿用最多两次校验。空窗跳过，有来源窗必须至少一个安全且有引用的知识点；未知编号、缺引用和模型失败阻止该阶段提交，所有窗口完成后一次事务替换。来源编号在本窗映射回精确ContentRef，不跨窗借编号或猜时间。模型提示只要求标题、简短自然语言摘要和来源编号，省略可默认字段，不修补非法JSON。

`product-gen.stage.ts`每8个知识点一批，批内pointIndex映射回完整列表，拒绝越界和重复；全部批次成功后事务替换闪卡。多批提示缩短问答、省略hint，保持原字段校验和输出预算。知识点和闪卡各自事务提交，整个流水线不是一个原子事务；闪卡失败时，知识点及整理笔记可能已经生成。

完整HTTP入口`video-product.ts`增加逐点及逐窗引用断言，并在清理接口失败时仍保存失败结果、明确fixtureCleaned=false，不因finally再次抛错丢失结果文件。新增`video-windowed-semantic.ts`仅将指定已完成视频的真实解析结果复制到临时账号，调用实际模型阶段，核对引用与闪卡关联，随后清理并复核原资料指纹。它不包含上传、重新ASR、Ascend推理或媒体播放，不替代完整入口。没有新模块、公开接口、数据库字段或依赖，旧视频和学习记录不自动重跑。

## 已完成的隔离语义验证

输入来自已有30分钟视频：510转写、1383文本块，六个真实时间窗口；没有伪造文本或调用模型替身。首次六窗生成11知识点后，闪卡阶段SCHEMA_INVALID，临时数据清理且原资料不变。原模型回复未保存，不能确认该次属于JSON语法还是字段校验失败。

多批闪卡提示缩短后，20:52:55–20:54:24复验exit0/status=passed：6窗均有实际来源，12知识点、12闪卡、1整理笔记（sourceCount=12）。每点引用非空，共36处引用均命中原转写/OCR定位；时间42–1769秒，最后一窗1500秒起有引用。全部闪卡关联本次生成的知识点。临时账号/资料清理，原18份资料及转写、OCR、知识点/图谱节点/掌握度、闪卡/复习、笔记、练习、进度、图谱边、异步任务的指纹一致。证据见[语义结果](video-windowed-20261009/semantic.json)与[语义阶段记录](video-windowed-20261009/semantic-pipeline.json)。

## 46分钟前两轮失败证据

使用同一独立剪辑190132514字节、2760.083秒，SHA256为`90603076e50283dfd10b5df42eef9a15cfaeb6110a70df34eb10807a37a542a3`，不修改原视频。

- 首轮20:18:16–20:31:22：视觉推理TIMEOUT，8060文本块仅为内存累计，正式OCR为0。十个音轨窗口完成769转写；前三个知识窗口各生成2点，第四窗模型两次JSON解析失败，SCHEMA_INVALID，理解777115ms后失败。知识点事务尚未提交，知识点/闪卡/整理笔记均0，后置45分钟检查未执行。见[first-product](video-windowed-20261009/first-product.json)、[first-progress](video-windowed-20261009/first-progress.json)、[first-pipeline](video-windowed-20261009/first-pipeline.json)。不能根据未保存的原模型回复推定语法失败根因。
- 第二轮20:32:43–20:46:59：全片视觉成功1380帧、10585文本块；第7个音轨窗口（1800秒起）讯飞ASR请求超时，只保存493转写。理解在light-filter失败，语义阶段未执行，知识点/闪卡/整理笔记均0，不算简化知识提示通过。见[product](video-windowed-20261009/product.json)、[progress](video-windowed-20261009/progress.json)、[pipeline](video-windowed-20261009/pipeline.json)。

两轮均使用一次队列尝试、退出1；临时资料/账号已清理，原18份资料及完整HTTP入口所核对的解析/笔记/闪卡/整理笔记指纹一致。失败不改写为通过，不推定外部网络或设备根因。

## 第三轮基础设施中断与网页恢复

20:55:31开始第三轮完整入口，解析370ms成功。21:02:51视觉处理到862帧时INFER_UNAVAILABLE，5729块仍为内存累计；21:02:57演示控制器状态变为failed并退出，网页/隧道进程均不存在，3000/8001无监听。21:05使用本机既有密钥和独立known_hosts对110.41.14.167:31637重新SSH，返回Connection closed。不能确认是云实例到期、网络还是其他云端状态。

任务当时仍记录RUNNING，转写/OCR/知识点/闪卡均0，整个工作进程已经退出，不能记为正常流水线终态或模型校验失败。只核对本轮临时账号、资料ID以及旧控制器/工作进程不存在后，将该临时异步任务标为基础设施中断FAILED，使其可安全清理；没有处理9月28日遗留任务或真实资料。正式入口在网页不可达时finally删除再次失败，退出1但未写product结果文件，因此保留[中断前进度](video-windowed-20261009/final-progress.json)、[阶段记录](video-windowed-20261009/final-pipeline.json)、[控制器快照](video-windowed-20261009/startup.json)、[中断终态处理](video-windowed-20261009/interruption.json)和[手工中断结果](video-windowed-20261009/interrupted-product.json)，不伪造正式product.json。

本轮中断入口的原资料指纹比较未写出，不能宣称该轮完成了指纹核验。恢复本地网页后，使用仅属于本次临时账号的后台签名通过所有者DELETE接口清理资料，数据库删除该临时账号；存储清理日志确认2个本次对象删除。独立复核验收账号0、临时资料0，总资料18，见[清理结果](video-windowed-20261009/cleanup.json)。此前两轮及30分钟隔离语义验证的原资料指纹通过结果保留。

本地网页独立恢复，3000登录页200，人脸8002健康200；Ascend8001不可达，见[服务状态](video-windowed-20261009/services.json)。使用既有.env配置和memory队列，未改密码、令牌、环境文件或开启mock。真实Ascend演示已提前结束，原21:26是最大运行上限；恢复的本地网页不等于真实推理连接恢复。下一次完整验收需先确认ModelArts实例可用和SSH可连接，再按DEPLOY启动新隔离演示。

## 检查与限制

新增7项回归：窗口边界/36窗上限/无个人笔记、逐窗局部编号映射、后续窗口失败保留旧知识点、闪卡跨批关联及后批失败保留旧闪卡。三文件26测试通过；全量首轮学习计划测试偶发失败，单独6项及随后92文件558测试通过。首次浮点末端断言失败已改为整数毫秒处理。简化知识提示后11项检查通过；简化多批闪卡提示后26项再次通过。TypeScript和改动文件ESLint通过，未与运行中网页共用.next执行构建。

正式入口清理失败导致证据丢失的补修，额外使用真实隔离数据库账号/资料模拟上传500与清理连接失败；确认原失败结果仍写出、fixtureCleaned=false、原资料指纹不变，测试随后清理自身账号，无媒体上传或外部AI调用。见[清理异常验证](video-windowed-20261009/cleanup-failure-check.json)。此项是故障回归，不冒充46分钟真实流水线通过。

真实PostgreSQL只读查询复核6窗：保留来源均在本窗、无个人笔记、各窗来源非空，见[context-query](video-windowed-20261009/context-query.json)。各窗仍truncated=true，存在有依据重点不等于逐分钟覆盖或摘要语义正确率。每窗仅1–2代表性知识点。46分钟新分窗全部完成、最后一窗知识引用、45分钟笔记/进度/Range尚未在本轮通过；浏览器解码、实际点击回看、独立多来源精度及公网常驻部署未在本轮验证。

架构、数据模型、任务清单和LEARNINGS同步非TODO协议/限制说明；没有补全TODO，没有新增依赖或页面交互。修正原文“一次知识抽取/一次闪卡覆盖全量”和强制response_format的非TODO描述，使文档符合当前实现。

## 复现

完整入口需按DEPLOY启动真实有界演示并等待ready，隔离验收可使用`--queue-retries 0`；剪辑、SSH密钥、ASR和模型凭据留本机忽略目录或环境变量。每次选新输出路径，避免覆盖失败证据。

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/acceptance/video-product.ts .taskbook-working/long-video-46m/product-next.json
node --import tsx scripts/acceptance/video-windowed-semantic.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/long-video-46m/semantic-next.json
npx vitest run tests/unit/jobs/context-builder.test.ts tests/unit/jobs/deep-extract.stage.test.ts tests/unit/jobs/product-gen.stage.test.ts
npm run type-check
```

语义入口的资料ID必须指向本机已完成的真实长视频；它复制解析结果到独立临时账号并在终态清理，不写源资料或读取原媒体对象。两入口实际调用外部模型，完整入口还调用ASR及真实Ascend，会产生服务用量。完整入口超时且任务仍运行时保留临时资料，终态后再清理，不删除运行中的资料。证据仅保留状态、计数、来源时间和哈希，不保存课堂正文、令牌、签名、密码或模型原始回答。
