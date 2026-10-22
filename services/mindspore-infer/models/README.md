# 模型产物目录

本目录的大文件不提交 Git。执行以下命令会从 MindOCR 官方源下载并按文件大小与 SHA-256 双重校验：

```bash
python scripts/download_pretrained_models.py
```

| 文件 | 官方模型 | 固定输入 | 用途 |
|---|---|---|---|
| `db_r50_icdar15-ch.mindir` | DBNet ResNet50，中英文 | `1×3×736×1280` | 文字区域检测 |
| `crnn_resnet34_ch.mindir` | CRNN ResNet34，中文（官方 `7a342e3c-105bccb2` 版本） | `1×3×32×320` | CTC 文字识别 |
| `cls_mv3.mindir` | MobileNetV3 | `1×3×48×192` | 0°/180°方向分类 |
| `ch_dict.txt` | MindOCR 中文字典 | — | CRNN CTC 解码 |

质量关键帧筛选无需模型文件，使用清晰度、8×8 感知哈希去重和文字边缘密度联合评分。课堂语义分类使用三类 `keyframe_classifier_v3_balanced.mindir`，类别顺序为板书、屏幕、无效；旧八类、四类模型不得复用。仓库忽略 `.mindir`，部署时须另外复制。`/classify` 已接入该文件，但无 MindSpore Lite 或 `INFER_MOCK=true` 时仍安全降级为 `unknown`，不能据文件存在就声称真实推理已通过。

真实 OCR 还需要目标 Linux 主机安装与设备匹配的 MindSpore Lite 云侧 Python 运行时，并设置 `INFER_MOCK=false`。`GET /health` 中 `modelFilesReady=true` 只表示文件齐全；`modelsLoaded=true` 才表示文件与运行时同时就绪。

已验证组合：ModelArts `mindspore_2.7.1-cann_8.3.rc1-py_3.11-euler2.10.11-aarch64-snt9b` + MindSpore Lite 2.7.1。CRNN 实测输入 `[1,3,32,320]`、输出 `[1,80,6624]`，单次零矩阵推理约 0.004 秒。CANN 8.5.2 与该 Lite wheel 不兼容。
