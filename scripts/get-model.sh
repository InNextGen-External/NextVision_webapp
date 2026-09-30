#!/bin/sh
# Downloads the YOLOX-Tiny ONNX detector (Apache-2.0, Megvii) and verifies its checksum.
set -e
DIR="$(dirname "$0")/../worker/models"; mkdir -p "$DIR"
URL="https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx"
SHA="427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7"
curl -fsSL -o "$DIR/yolox_tiny.onnx" "$URL"
echo "$SHA  $DIR/yolox_tiny.onnx" | sha256sum -c -
