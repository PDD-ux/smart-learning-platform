# MindSpore → ATC → OM 验收（2026-10-20）

## 结论

本次复用已训练 checkpoint，在 ModelArts Ascend 910B4 验证两种 ATC 输入格式，没有重新训练，也没有替换线上模型。AIR 转换成功，但生成的 OM 有 28 个输入（图像 + 27 个参数），不适合作为自包含单图部署；增加 ONNX 导出路径后，生成的 OM 只有一个图像输入，权重已嵌入，并通过 ACL 实际推理和 CPU 数值对照。

ONNX 路径达成本任务“单张图片即可执行”的部署形态。此处验收的是运行链路和算子数值一致性，不是分类准确率；所用实验 checkpoint 在既有来源隔离 test 上仅 43.97%，不得替代线上 74.47% MindIR。

## 环境与隔离边界

- ModelArts Notebook：`notebook-cedc4280-73fe-49d3-acdd-080c5cb91b04`，Ascend 910B4、MindSpore 2.7.1、CANN 8.3.RC1、Python 3.11 aarch64。
- 输入 checkpoint：`/home/ma-user/work/s53_verify/ckpt/s53_full.ckpt`，沿用先前已训练的分类器。
- 本次产物写入 `/home/ma-user/work/s53_verify/air_om_recheck_20261020/`，没有覆盖部署模型 `keyframe_classifier_v3_balanced.mindir`。

## AIR 兼容路径结果

使用 `export_mindir.py --file-format AIR --device-target Ascend` 生成 90,144 byte AIR（SHA-256 `ab70d06580e86442fe9bf04f48c0181615dbfb84e12e017c3fc4c2f15d7f76a9`），ATC `--framework=1 --mode=0` 转换成功并生成 258,310 byte OM（SHA-256 `d1a674804d3e935ac9633218ae1edeb352624623a8e97f2688203c07be5d0c60`）。ACL 描述符显示 28 个输入：`input_data` 图像和 27 个 checkpoint 参数。此前的零张量 ACL 测试显式喂入权重后可运行，输出与 MindSpore CPU 最大差约 0.000631；但这个 OM 不能只传图像部署。旧原始回执保留于 [`mindspore-atc-acl-runtime-20261020.json`](mindspore-atc-acl-runtime-20261020.json)。

## 自包含 ONNX 路径结果

`export_mindir.py --file-format ONNX` 调用 MindSpore 2.7.1 的 `mindspore.onnx.export`，设置 `export_params=True` 和 `keep_initializers_as_inputs=False`，然后由 `convert_atc.sh` 通过 `ATC_MODEL_FORMAT=ONNX` 选择 `--framework=5`。实际流程：

```bash
source /usr/local/Ascend/ascend-toolkit/set_env.sh
python scripts/export_mindir.py \
  --model classifier \
  --checkpoint /home/ma-user/work/s53_verify/ckpt/s53_full.ckpt \
  --output /home/ma-user/work/s53_verify/air_om_recheck_20261020/onnx_probe/models/classifier.onnx \
  --file-format ONNX \
  --device-target Ascend
export INFER_MODEL_DIR=/home/ma-user/work/s53_verify/air_om_recheck_20261020/onnx_probe/models
export ASCEND_SOC_VERSION=Ascend910B4
export ATC_MODEL_FORMAT=ONNX
bash scripts/convert_atc.sh classifier
python scripts/test_om_acl.py \
  --model /home/ma-user/work/s53_verify/air_om_recheck_20261020/onnx_probe/models/om/classifier.om \
  --device-id 0
```

ATC 成功生成 OM。ACL 模型描述为一个 `input_data` 输入 `[1,3,224,224]` float32 和一个 `[1,3]` float32 输出；不提供 checkpoint 的运行也通过，证明权重不再是外部输入。OM 大小 626,979 byte，SHA-256：`d957ef341762425dc0dcd7723d794e8aadf6b442379cb23ea2f15f454d69c8e3`。ONNX 大小 1,009,044 byte，SHA-256：`f23d7136a7ae29bfc8a855b72a184fd02a1f323b65b85522178d9771c435ae3d`。

额外用同一训练集预处理方式，对独立 test 下三张图片分别跑 ACL 与 CPU checkpoint，CPU/ACL logits 差均低于 0.01，且两端 top-1 相同。注意 blackboard 样本的两端都预测成 screen，说明只是运行数值一致、两者共享同一分类错误，不代表标签正确：

| 测试集标注 | 输入图片 | CPU / ACL 预测 | 标注一致 | 最大 logits 差 | 运行结果 |
|---|---|---|---|---:|---|
| blackboard | `songhao750_frame00018_t00-00-54.jpg` | screen / screen | 否 | 0.001030 | PASS |
| screen | `ctest_frame00005_t00-00-24.jpg` | screen / screen | 是 | 0.001240 | PASS |
| invalid | `real_yale_music_0040.jpg` | invalid / invalid | 是 | 0.001618 | PASS |

三张图只是数值一致性样例，不构成模型精度结论，也没有全量重跑 141 张 test。逐次 ACL 回执和模型哈希见 [`mindspore-atc-onnx-acl-runtime-20261020.json`](mindspore-atc-onnx-acl-runtime-20261020.json)。

## 既有模型与其它模型边界

- 不重新训练；线上继续使用 `keyframe_classifier_v3_balanced.mindir` 与 MindSpore Lite，不切换到本次低准确率 checkpoint 或 OM。
- AIR→ATC 入口保留兼容性，已知会将权重暴露为外部输入；需要自包含 OM 时使用 ONNX。
- ONNX/ATC/ACL 实测只覆盖 `classifier`。`text_detector` 与 `frame_selector` 的训练数据仍缺失，也未做 ONNX OM 实际运行验收。
- OM 执行通过只表明该 Ascend 设备可加载并执行图，不意味着网页接入、跨机部署、服务吞吐或识别质量已经验收。
