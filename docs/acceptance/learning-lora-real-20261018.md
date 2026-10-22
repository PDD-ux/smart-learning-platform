# §28.3 真实基座试验与数值阻塞（2026-10-18）

本轮仅处理28.3。用户希望训练后与星火比较，并询问两者组合；未把组合路由提前接入产品。实际仓库为桌面主仓库，原用户数据、页面服务、OCR/ASR、人脸与模型环境变量均未改。

## 实际完成

- Ascend 910B4/32GB、MindSpore2.7.1、MindFormers1.7.0，沿用已有Notebook及保存SSH；没有安装全局依赖、购买磁盘或启动额外HTTP服务。
- 下载固定Qwen/Qwen2.5-1.5B-Instruct revision至独立scratch：3087467144字节，SHA-256 `dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee`，约249.042秒。不是百炼API。work只留报告/计划的小适配器，下载证据已回传。
- 原创12训练/6heldout未变，星火与基座使用相同system/user文本，保留完整原始回答，无格式修复/重试挑选。星火实际`generalv3.5`，仅6次请求，6次均返回；JSON 5/6、schema 4/6、原文引用规则4/6、完整参考摘录及全项通过3/6。该严格摘录指标不等于所有其它回答在教学上错误，也不足以评估通用能力。
- 基座首次因整数eos参数抛TypeError；随机微型模型复现到已安装`text_generator.py:1122`，改显式列表后进行一次复验。修复没有改数据、学习率或训练轮数。
- 第二次基线在226.436秒内完成6条，但全部输出192个重复`!`。不能按0/6认定基座能力差：数值探针确认当前FP16路径151936个词表logits全部NaN（argmax=0），所有参数有限、最大绝对参数316、112个初始LoRA B张量全0。这是无效运行，不是可用训练基线。
- 独立前向首次直接传139 token，与固定512 mask冲突；补齐至512并传有效长度后取得上述数值证据。旧失败日志保留。后续训练驱动按输入257右移对应模型seq256，尚未执行训练验收。
- 另在CPU逐张量对照：338个基座张量全部匹配官方权重经运行时精度转换后的哈希（281个float16、57个float32），没有缺失或差异。首次统一按float16比较会把57个float32 RMSNorm误报差异，旧报告保留，类型感知报告为最终结果。已排除这组装载后参数的数值偏离，但没有定位到产生NaN的具体算子，也未验证BF16或其它数值修复。
- 真实训练入口在0.002秒以`DEGENERATE_BASELINE`拒绝，无MindRecord、无梯度更新、无适配器，也未运行重载。训练/导出/重载代码是可复现入口，不能称其已经实测通过。

## 文件与保护

独立代码：`services/learning-lora/pilot.py`、`evaluate.py`、`compare.py`、`diagnose_forward.py`、`compare_loaded_weights.py`、`generation_smoke.py`、`run-real-pilot.ps1`及专项测试；星火一次性对照入口为`scripts/acceptance/learning-lora-spark.ts`。已有准备工具与数据保留。

每阶段外部超时、整个run创建后1800秒截止、不自动续期；失败/代码快照/原始输出保留。训练前复核冻结消息/来源锁、基线完整性和单字符退化；装载/包装基座值校验及前向NaN/Inf保护已写入入口，完整训练、适配器冻结/导出/重载分支尚未实测。不得绕过拦截继续训练。

工程验证：20项Python数据/掩码/评分/冻结输入/退化拦截测试通过，Python编译、PowerShell解析、非增量TypeScript及新增TS脚本ESLint通过（脚本默认被工程lint忽略，使用`--no-ignore`核对）。未改Web业务代码，未重跑上一编号已通过的全项目数据库/生产/浏览器验收；本轮不宣称全项目或语言模型可用。

文档同步PRD、19、05、PROGRESS、架构、README、DEPLOY、LEARNINGS。没有新增待补TODO；非TODO修改用于区分28.2准备与28.3实际下载/失败范围，纠正“尚未下载”的现行描述。无新API/字段/页面，02/04/06不需要改。

## 证据和复现

本机：`.taskbook-working/lora-real-20261018/run-3d53514faf27/`。远端：`/home/ma-user/work/taskbook-lora-real-3d53514faf27`；大模型缓存：`/home/ma-user/.cache/taskbook-learning-lora/real-3d53514faf27`。这里只保存路径，不保存密钥。关键证据为download、baseline两次日志、generation-smoke、forward-diagnostic两次日志、train-failure、Spark原始6回答及comparison.json；均保留失败。

完整复现顺序见`services/learning-lora/README.md`。已有run截止后训练脚本拒绝继续；下一轮须先有界修复数值/精度路径并重新验证正常基线，再另行启动固定训练，不在当前失败基线上加步数或降低质量规则。单独探针可复用校验过的缓存，但要使用新报告目录并外部240秒超时，不能覆盖旧结果。

当前结论：**28.3未完成，基础推理数值异常阻塞真实LoRA训练**。不能判断微调后是否强于星火，不能称组合已提高质量。后续可在通过验证后按任务路由：微调模型承担原文摘录/笔记，星火承担解释/方案；本轮没有实现或声称该组合有效。

未验：数值异常根因和修复、24步训练、适配器导出/新进程重载、人工教学质量、长课程/多学科泛化、缓存跨停机持久性、产品接入。Notebook仍由用户管理，工具未替用户停止实例。
