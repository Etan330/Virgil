#!/usr/bin/env bash
# Downloads the bundled speaker-embedding model into vendor/asr/speaker.
# (Speech recognition itself is cloud-based via Volcengine - no local ASR model.)
set -euo pipefail

BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download"
MODEL_BASE="${BASE}/speaker-recongition-models"

DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/asr/speaker"
mkdir -p "$DIR"
cd "$DIR"

echo "==> 下载声纹模型（说话人嵌入，39.6MB）"
[ -f "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" ] || curl -L \
  -o "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" \
  "${MODEL_BASE}/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"

echo
echo "完成。"
