# §5.3 OCR 长行与方向修复（2026-10-08，北京时间）

本次在桌面主仓库完成已有 OCR 实现的修复；真实 ModelArts Ascend 环境可用。没有更换模型、增加依赖、修改接口字段或重跑业务数据库、ASR、LLM。整体验收仍包含未完成项，不能将下面少量标注片段成绩称为产品 OCR 准确率。

## 原因与修复

原实现把任意长度文字行压到固定 CRNN 32×320 输入，且在分段前把整行拉伸至方向模型 48×192 输入。`frame_014.jpg` 第二正文行的原裁图为 1310×30，原方向输出约 `[0.000249, 0.999512]`，被错误旋转 180 度。相同裁图保持原方向、分段识别后恢复可读正文，证明该方向误判是严重乱码的一项直接原因。[定位证据](mindspore-20261008-ocr-orientation.json) 同时保留不同扩边/方向处理的真实结果，没有用正确词替换模型输出。

`services/mindspore-infer/ocr_runtime.py` 改为：

- 宽高比超过 10 的行优先选较宽背景间隙，分为最多 16 段，覆盖全部源列；无合适间隙或极端宽高比保留旧单段路径。每段独立识别并返回原图坐标，避免长行统一压扁；不能保证复杂字形内部空隙绝不误切。
- 每段进行方向预测，按段宽投票统一整行方向，避免很短的尾段误判导致局部乱码。短行仍是一票；不硬编码课程、文字、帧号或裁图区域。
- 方向输入对短裁图等比例缩放，并在归一化后补零；CRNN 保持原黑色补白后归一化。方向预处理形态参考 [PaddleOCR 原始方向分类实现](https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/tools/infer/predict_cls.py)，未引入其代码依赖。

原检测框、检测阈值、模型/字典、类别门槛、后备语义和网关预算保持既有策略。架构文档补充上述内部流程；本次无待补 TODO，修改的是既有流程说明和误判的验收结论。

## 真实前后对照

使用 Lite 2.7.1、CANN 8.3.RC1、Python 3.11.10、Ascend 910B4，在隔离目录 `/home/ma-user/work/taskbook-ocr-20261008-OXNjtu` 运行。解释器复用前次诊断 venv；旧推理目录和全局环境保留。关闭 mock 和 Tesseract 后备。

- 原实现：17 张图 × 1 轮，退出码 0；[原始基线](mindspore-20261008-ocr-baseline.json)。修复后：同样 17 张图 × 2 轮，34 条结果，退出码 0；[最终结果](mindspore-20261008-ocr-fixed.json)。两轮同帧文字、坐标和置信度完全一致；最终源码 SHA-256 与桌面主仓库一致，样本、模型及标注清单指纹均记录在 JSON。
- 17 张图包含原诊断 16 帧及另一来源的 Go 编辑器截图 `sample3-real-lecture.jpg`。修改前冻结 12 个可读区域的人工转录，按真实 bbox 中心选区域并按 x 拼接。CER 使用编辑距离，只忽略标点和空白，保留字母大小写，不纠正词语。区域清单与指标脚本一同保存；该小样本不是代表性独立精度测试集。
- `frame_014.jpg` 五个正文/题干区域共 131 个计分字符：错误从 **40 降到 1**，CER 从 **30.53% 降到 0.76%**。第一行“诱骗/遏制/效仿”和第三行“打赏”已恢复；原第二行成片乱码恢复为可读正文，但“打赏后”仍多识别一个“背”字。
- `frame_002.jpg` 完整大标题始终正确，最终仍为“言语理解与表达”。此前报告将它误记为缺失，现已更正；题干“依次填入……”同样早已存在，不能记作此次新增恢复。
- `frame_003.jpg` 右侧遮挡的“基础理论”仍输出“基础理诊”，不以推断字形替换文本。另一来源的 Go 截图 5 个区域共 69 个字符，错误仍为 20，未观察到退化，也未解决小字裁图/方向/英文大小写问题。
- 最终预热 53.492 秒；16 帧第一轮温态 OCR 累计 15.131 秒，原实现 15.127 秒。最终两轮 32 次 OCR 的经验 P95 为 1129.039 毫秒，基线 16 次为 1113.403 毫秒；样本数不同且很少，不宣称性能提升。16 帧文字块数从 1209 变为 1246，块数变化源于分段和方向修复，不能用块数计算精度。

## 复跑入口

云端/JupyterLab Terminal 进入隔离目录，源文件按仓库相同布局放置后：

```bash
cd /home/ma-user/work/taskbook-ocr-20261008-OXNjtu
source /usr/local/Ascend/ascend-toolkit/set_env.sh
/home/ma-user/work/taskbook-accept-20261008-eNe960/.venv/bin/python \
  scripts/performance/accept-ocr-quality.py \
  --model-dir /home/ma-user/work \
  --extra-frame /home/ma-user/work/sample3-real-lecture.jpg \
  --rounds 2 --output ocr-retest.json
```

基线复跑加 `--service-dir /home/ma-user/work/taskbook-accept-20261008-eNe960/services/mindspore-infer`。模型在 `/home/ma-user/work`，不是服务默认 `models`；入口在导入配置前设置真实 Ascend/模型目录。原始逐框定位脚本仅在 `.taskbook-working`/云端诊断目录，正式质量入口不依赖它。若运行时或模型失败，入口记录 `failed` 并退出 1；外部超时留下 `running`，不得算成功。`executed` 只表示运行完成，质量须检查 `evaluation`。

## 验证与限制

本地推理相关回归 25/25、性能入口回归 12/12、mock 服务冒烟和 Python 编译检查通过。覆盖等比例/补白、背景间隙、连续坐标、处理上限、方向投票及指标区域筛选和编辑距离。

最终源码在新隔离 Uvicorn 服务预热 59.097 秒后，实际 Windows TypeScript 网关经 SSH 隧道执行两轮，每轮单帧/16 帧的三个接口全部成功，原生退出码 0、无 fallback：[第一轮](mindspore-20261008-ocr-gateway.json)、[第二轮](mindspore-20261008-ocr-gateway-repeat.json)。每轮 OCR 返回全部 16 帧/1246 块，文字、坐标和置信度逐帧与最终直调结果一致。第一轮四个子请求为 3777/4335/4744/5267ms，第二轮为 3678/4396/4690/5276ms，全部 HTTP 200，均未触发默认 8 秒超时；整组逻辑调用仍为 18.851/18.866 秒，不宣称整组少于 8 秒。这些只是本组两轮观测，不保证任意图片或负载的预算。

复跑网关时使用已有 `accept-mindspore-http.py --skip-benchmark --hold-seconds 120`，输出目录选 `http-final`；窗口就绪后用 `check-ssh-gateway.py --remote-root /home/ma-user/work/taskbook-ocr-20261008-OXNjtu --remote-report http-final/http-run.json` 配合前次报告中的连接参数和本机密钥路径。临时令牌仅经内存传递，不写结果或命令参数。隔离服务窗口自然结束，运行记录 `status=executed, stage=complete, exitCode=0`，服务和本机隧道已退出；[服务运行记录](mindspore-20261008-ocr-http/http-run.json) 与 [基线日志](mindspore-20261008-ocr-logs/baseline.log)、[最终日志](mindspore-20261008-ocr-logs/final.log) 一并保存。

尚未完成：代表性多来源 OCR 全量标注、小字/倾斜/遮挡/英文代码精确识别、界面噪声去除、常规网络部署和长视频产品链路。没有更新既有视频产物或替换长期运行服务；本次只推进 §5.3，整体质量待办保持未勾选。
