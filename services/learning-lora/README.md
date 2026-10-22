# 学习语言模型LoRA试训准备（§28.2）

用户选择华为云。此目录是独立实验工具，不进入Next.js或现有OCR服务，不修改LLM_PROVIDER，不以随机模型冒烟代替真实预训练模型微调。

## 选型和固定版本

- 已有环境：Ascend 910B4 32GB、MindSpore2.7.1、MindFormers1.7.0、Python3.11；基础NPU梯度已运行，整套配套仍以具体运行报告为准。
- 候选基座：`Qwen/Qwen2.5-1.5B-Instruct`，Apache-2.0。选择已有r1.7实现的小模型先跑通，不承诺学科质量超过现有模型，不是阿里云百炼API。
- `source-lock.json`固定MindFormers源码commit、HF基座revision、官方配置和三个tokenizer文件的SHA-256/大小。禁止拿master/2.0配置替换当前环境。
- 12条训练/6条heldout为项目原创短文本，涉及摘录、条件/主体边界、指令混入和资料不足。仅用于流程与结构检查，未经教师人工审定，不足以宣称专用模型质量提升。私人课程、留言和人脸数据不在其中。

## 可复现准备

在桌面主仓库执行，所有证据目录须不存在；以下命令不下载基础权重，不开始真实课堂模型训练：

```powershell
python -m unittest discover -s services/learning-lora -p "test_*.py" -v
python services/learning-lora/fetch_assets.py --output .taskbook-working/lora-assets-repeat
powershell -NoProfile -File services/learning-lora/run-cloud-check.ps1 -Template .taskbook-working/lora-assets-repeat/template.yaml -Tokenizer .taskbook-working/lora-assets-repeat/tokenizer
```

第三条使用已有`.taskbook-working/ascend-demo/connection.local.json`及本机私钥/known_hosts；严格主机验证失败需核对身份，不在此脚本自动接受变化。仅支持现有ma-user目录布局；先在ModelArts手动启动实例。它不购买/启停实例、不改全局包、不清理其它进程。已运行实例按华为云规则计费，工具结束也不会自动停止Notebook。

入口先校验本机资产哈希，再创建唯一`/home/ma-user/work/taskbook-lora-prep-*`和独立缓存目录，上传约7MB分词资产及小段代码；运行数据测试、生成候选配置、离线分词长度验证，以及外部120秒超时的微型随机Llama LoRA两步检查。运行证据取回`.taskbook-working/lora-pilot-20261018/prep-*/`，失败目录保留；不覆盖旧证据。若拉取报告失败，要重新取回检查，不能只按远端退出码宣称本地证据齐全。

## 候选配置与安全边界

`prepare.py`先核对所有来源、集合与固定模板哈希，再独占创建输出。配置将官方8卡/58GB/8192上下文缩为1卡/24GB/1024、batch1、1轮、固定LoRA rank8；FlashAttention先关闭便于排障。仅train进入训练文件，heldout单独保存，候选配置没有评测自动混入或训练循环启动。

原CheckpointMonitor可能同时保存全参网络/优化器，占满工作盘。候选配置暂只含loss监控，后续真实训练驱动必须实现“只导出适配器→重载→基座一致性校验→复制到持久目录/本机”；当前manifest如实标注adapterExportImplemented=false、readyForRealTraining=false。

`check_tokens.py`只加载本地、锁定哈希的tokenizer，禁用远端自定义代码与在线获取；逐条验证完整messages长度不超过1025（与1024下一token训练对应），避免官方预处理的truncation静默丢答案。通过不说明中文笔记语义正确。

`runtime_smoke.py --tiny-lora`在无预训练权重的1层微型Llama上验证：loss/梯度有限、确有LoRA可训练参数、两步更新只改变LoRA张量、基座冻结不变。它保存固定数值报告，不保存随机模型为产品模型，不以loss下降当性能提升。该命令必须通过外部timeout运行，脚本退出/超时均留证，不自动反复运行到成功。

## 存储和后续

`/home/ma-user/work`约3.5GiB空闲，无法稳妥同时容纳1.5B基座、转换副本和全参检查点。基础模型计划放独立scratch/cache，可能随停止或重建丢失；`/cache`虽空闲很多，不据此推断归属、配额或持久性。模型/缓存均未下载；训练成果的持久卷/OBS或本机回传方案须在真正训练前完成。

下一实验才下载/校验基座并准备MindRecord、正式训练和只保存LoRA参数，先测训练前基线再用完全相同heldout对比；合格后再单独决定页面接入。沿用已有OpenAI/星火配置，不自动用实验替换网页功能。

协议见[19-LEARNING-LORA.md](../../spec/19-LEARNING-LORA.md)。

## §28.3 独立真实训练与对照入口

以下是用户明确要求后的实际训练入口，与上方28.2准备命令区分。不会更改网页的模型路由，也不同时调用两个模型合成答案。

```powershell
powershell -NoProfile -File services/learning-lora/run-real-pilot.ps1 -Phase download
# 从输出复制本次run.json路径，下列各阶段必须属于同一次实验：
powershell -NoProfile -File services/learning-lora/run-real-pilot.ps1 -Phase baseline -RunFile <run.json>
powershell -NoProfile -File services/learning-lora/run-real-pilot.ps1 -Phase train -RunFile <run.json>
powershell -NoProfile -File services/learning-lora/run-real-pilot.ps1 -Phase reload -RunFile <run.json>
npx tsx scripts/acceptance/learning-lora-spark.ts <本次本地run目录>
python services/learning-lora/compare.py --run <本次本地run目录>
```

依赖已验证的28.2远端模板/tokenizer目录；不同机器先运行准备阶段并核对`run-real-pilot.ps1`的资产目录。Spark对照使用固定28.2消息文件，严格一次6请求，失败不修答案或切服务。基座下载固定3087467144字节及SHA-256，放独立scratch；work只保存小适配器和报告并拉回本机。下载最多600秒、baseline/reload各600秒、train含训练后评测最多900秒；整个run自创建起1800秒，不自动延长。截止后不得继续使用旧run启动训练。

实验固定12训练/6保留样例、24更新、rank8、lr1e-4、assistant-only loss；MindRecord不含heldout。仅导出LoRA，并检查所有冻结参数不变、适配器键/值/哈希以及新进程重载输出。推理为MindFormers贪心、192新token、模型序列512、不启用KV缓存、官方repetition_penalty=1.05；Spark以temperature=0、192输出token、相同system/user文本且无额外jsonMode指令对照。两家分词/生成实现不同，不声称数值同构或速度公平。

`evaluate.py`检查严格JSON、预定schema、逐字来源引用、完整参考摘录和不足拒答；其中完整摘录是严格文本指标，不能据此判定所有短摘录在教学上错误。`compare.py`保留每条输出和未完成状态；网络/额度失败与输出质量区分，不宣称通用能力胜出或教师人工审核通过。

MindFormers1.7生成停止判断对传入eos_token_id使用`in`：显式覆盖时须传列表，不能传整数；`generation_smoke.py`为随机微型模型兼容复现，非质量实验。仅空输出且已有失败报告的baseline允许`-Attempt 2`（最多3），每次保存代码快照与旧空文件，不能覆写成功或部分结果。无训练自动重试。

训练入口还会拒绝退化为单字符长重复的基线；模型装载后核对转换张量/包装后基座哈希、前向检查NaN/Inf，失败不开始更新。`diagnose_forward.py <scratch> <新artifacts目录>`提供独立数值探针，需外部`timeout -k 10s 240s`；`compare_loaded_weights.py <scratch> <同artifacts目录>`在CPU逐张量比对探针哈希与官方权重（`timeout -k 10s 120s`）。两者的输出文件须不存在，不能覆盖旧证据。固定长度MindFormers前向须补齐至配置seq_length并传真实有效长度；训练模型使用256、输入257后由模型右移，推理使用512。
