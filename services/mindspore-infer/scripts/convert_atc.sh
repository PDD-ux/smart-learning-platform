#!/usr/bin/env bash
# 将 MindSpore AIR 或 ONNX 编译为 Ascend OM。须在已安装并 source CANN 环境的 Ascend 主机运行。
set -euo pipefail

MODEL_NAME="${1:-}"
MODEL_DIR="${INFER_MODEL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models}"
OUTPUT_DIR="${ATC_OUTPUT_DIR:-${MODEL_DIR}/om}"
SOC_VERSION="${ASCEND_SOC_VERSION:-}"
MODEL_FORMAT="${ATC_MODEL_FORMAT:-AIR}"
MODEL_EXTENSION=""
FRAMEWORK=""

usage() {
echo "Usage: ASCEND_SOC_VERSION=<target_soc> [ATC_MODEL_FORMAT=AIR|ONNX] bash $0 <classifier|text_detector|frame_selector>"
echo "Requires: atc in PATH, CANN environment sourced, and models/<name>.<air|onnx>"
echo "Export first with scripts/export_mindir.py --file-format AIR|ONNX --device-target Ascend."
}

if [[ -z "${MODEL_NAME}" || ! "${MODEL_NAME}" =~ ^(classifier|text_detector|frame_selector)$ ]]; then
  usage
  exit 2
fi
if ! command -v atc >/dev/null 2>&1; then
  echo "ATC 未找到：请先 source /usr/local/Ascend/ascend-toolkit/set_env.sh" >&2
  exit 127
fi
if [[ -z "${SOC_VERSION}" ]]; then
  echo "必须设置 ASCEND_SOC_VERSION 为目标推理芯片型号；脚本不猜测目标型号。" >&2
  exit 2
fi
case "${MODEL_FORMAT}" in
  AIR)
    MODEL_EXTENSION="air"
    FRAMEWORK="1"
    ;;
  ONNX)
    MODEL_EXTENSION="onnx"
    FRAMEWORK="5"
    ;;
  *)
    echo "ATC_MODEL_FORMAT 只支持 AIR 或 ONNX：${MODEL_FORMAT}" >&2
    exit 2
    ;;
esac
if [[ -n "${ATC_INPUT_SHAPE:-}" ]]; then
  echo "导出模型使用固定输入形状；请按实际输入形状导出，不要设置 ATC_INPUT_SHAPE。" >&2
  exit 2
fi

MODEL_PATH="${MODEL_DIR}/${MODEL_NAME}.${MODEL_EXTENSION}"
if [[ ! -f "${MODEL_PATH}" ]]; then
  echo "${MODEL_FORMAT} 模型不存在：${MODEL_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
TEMP_DIR="$(mktemp -d "${OUTPUT_DIR}/.${MODEL_NAME}.atc.XXXXXX")"
cleanup() {
  rm -rf -- "${TEMP_DIR}"
}
trap cleanup EXIT

ATC_ARGS=(
  --framework="${FRAMEWORK}" \
  --input_format=NCHW \
  --model="${MODEL_PATH}" \
  --output="${TEMP_DIR}/${MODEL_NAME}" \
  --soc_version="${SOC_VERSION}"
)
if [[ "${MODEL_FORMAT}" == "AIR" ]]; then
  ATC_ARGS+=(--mode=0)
fi
atc "${ATC_ARGS[@]}"

TEMP_OM="${TEMP_DIR}/${MODEL_NAME}.om"
if [[ ! -s "${TEMP_OM}" ]]; then
  echo "ATC 返回成功但未生成有效 OM：${TEMP_OM}" >&2
  exit 1
fi
FINAL_OM="${OUTPUT_DIR}/${MODEL_NAME}.om"
mv -f -- "${TEMP_OM}" "${FINAL_OM}"
echo "OM generated: ${FINAL_OM}"
