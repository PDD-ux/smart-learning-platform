# §28.2 华为云LoRA准备验收（2026-10-18）

用户明确选择华为云后继续。本轮只完成训练准备与随机运行检查，没有实施真实基座微调或页面接入。

## 已通过

- Ascend910B4健康OK、32GiB HBM；Python3.11.10、MindSpore2.7.1、MindFormers1.7.0、CANN8.3.RC1，npu-smi工具25.5.1。未升级驱动/CANN/全局Python或改动现有OCR解释器与模型。
- 基础NPU平方求和/梯度返回5和[2,4]。最终24GB检查在随机1层微型Llama上真实注入LoRA并更新两步：1792个可训练参数，8个LoRA张量变化，其余冻结参数逐一哈希不变；loss为4.845195770263672和4.838493824005127，均有限。约39.9秒，外部限时120秒，结束后npu-smi确认无遗留NPU进程。
- 本机和云端各10项数据/集合隔离/引用/配置测试通过；Python编译、PowerShell解析通过。实际读取并校验官方yaml生成候选配置，训练12条、heldout6条；锁定tokenizer离线检查完整对话最大214/218 token，未截断、未加载基础模型权重。
- 无新npm依赖、迁移、HTTP、页面或模型路由修改。本机没有PyYAML，配置生成使用云端已有6.0.2，未安装全局包。1325项Web回归与生产检查是28.1的结果，本轮没有把它们作为新运行重复核销。

随机loss变化只是参数更新证据，不是学习模型质量提升。源码锁定、数据与结果见[脱敏JSON](learning-lora-prep-20261018.json)。

## 发现与处理

1. 官方配置默认为8卡/58GB/8192上下文，不能直接用于此单卡32GB实例。生成器改为1卡/24GB/1024、batch1、1轮、rank8，先关闭FlashAttention及全参检查点回调。配置尚未加载真实1.5B权重或完成图模式训练，不能称全模型可训练已验证。
2. 首次28GB随机检查也通过，但出现其它组件预留空间不足警告；降为24GB后重新检查，最终没有该预留警告。两次日志保留，复跑是配置修正，不是刷语义成功。框架弃用及浮点subnormal警告仍保留，不宣称长训练数值稳定或全套驱动固件认证。
3. 官方预处理默认truncation；增加完整messages长度先验检查，超长即拒绝，避免静默丢掉答案。tokenizer固定revision/大小/SHA-256，本地加载并禁用远端代码。
4. work约3.5GiB空闲，home根目录约49.5GiB；cache空间多不证明私有、配额或持久性。这里只保存约7MB分词资产和小样本；后续大模型用独立scratch，成果须持久保存并回传再讨论清理。

## 交付与复现

新增services/learning-lora：source-lock.json固定源码commit、候选基座revision/Apache-2.0许可及小资产哈希；seed-cases.jsonl/prepare.py实现原创样本及配置；fetch_assets.py只下载固定配置与tokenizer；check_tokens.py/runtime_smoke.py检查长度与随机LoRA；run-cloud-check.ps1复用私有SSH配置、严格主机校验、唯一目录、时限及证据取回；test_prepare.py/README.md提供回归和说明。

候选为Qwen/Qwen2.5-1.5B-Instruct，源码commit b77980de71ef62d3d38d5926fdcd4e7b669eec94、基座revision 989aa7980e4cf806f80c7fef2b1adb7bc71aa306。这是开源权重，不调用百炼或阿里云API，不承诺强于现有模型。

按[训练准备说明](../../services/learning-lora/README.md)下载锁定小资产并执行run-cloud-check。所有输出目录须不存在；失败证据不覆盖，不启停实例或删除他人文件/进程。

原始证据：.taskbook-working/lora-pilot-20261018/prep-7f984f85cb12/（最终24GB）、prep-6a49fba5fdf7/（首次28GB），以及同根的npu-after.txt、unit-tests-final.log、两次cloud-check日志。远端小目录保留以便后续实验，运行进程已结束；Notebook仍在运行，停止及云端计费由用户管理。

## 未完成

基础1.5B权重未下载、MindRecord未生成、真实预训练模型未微调、适配器导出/重载未实现、停机持久性未验证。18条原创冒烟材料未经教师人工审定，不代表多学科或通用出卷质量。先记录相同heldout上的基座表现，再真正训练并比较格式/引用/拒答及人工语义，通过后另行决定产品接入。

网页仍为OpenAI主用/星火手动备用，OpenAI缺Key不因LoRA准备完成而解决。规格见[19-LEARNING-LORA.md](../../spec/19-LEARNING-LORA.md)。本轮同步新增实验及现行非TODO说明，没有TODO补写或重写历史验收结论。
