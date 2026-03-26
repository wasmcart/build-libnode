#!/bin/bash
set -e

# build-android.sh — Cross-compile libnode static library for Android aarch64
#
# Requires: Android NDK (set ANDROID_NDK_HOME or NDK_PATH)
#
# Usage:
#   NDK_PATH=/path/to/ndk ./build-android.sh
#   ./build-android.sh --ndk /path/to/ndk

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION=$(cat "$SCRIPT_DIR/NODE_VERSION" | tr -d '[:space:]')
NDK="${ANDROID_NDK_HOME:-${NDK_PATH:-}}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --node-version) NODE_VERSION="$2"; shift 2 ;;
        --ndk) NDK="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$NDK" ]; then
    echo "Error: Set ANDROID_NDK_HOME or NDK_PATH, or pass --ndk /path/to/ndk"
    exit 1
fi

TARGET="android-aarch64"
echo "=== Building libnode v${NODE_VERSION} for ${TARGET} (static) ==="

SRC_DIR="${SCRIPT_DIR}/node-src"
OUT_DIR="${SCRIPT_DIR}/out/${TARGET}"
mkdir -p "$OUT_DIR"

if [ ! -d "$SRC_DIR" ]; then
    echo "Cloning Node.js v${NODE_VERSION}..."
    git clone --depth 1 --branch "v${NODE_VERSION}" https://github.com/nodejs/node.git "$SRC_DIR"
fi

cd "$SRC_DIR"

echo "Configuring for Android..."
./android-configure "$NDK" arm64 \
    --fully-static \
    --without-npm \
    --without-inspector \
    --without-intl \
    --without-corepack

NPROC=$(nproc 2>/dev/null || echo 4)
echo "Building with ${NPROC} jobs..."
make -j"$NPROC"

echo "Collecting outputs to ${OUT_DIR}..."
cp out/Release/libnode.a "$OUT_DIR/" 2>/dev/null || \
    cp out/Release/obj.target/libnode.a "$OUT_DIR/" 2>/dev/null || \
    { echo "Error: libnode.a not found"; exit 1; }

INCLUDE_DIR="${OUT_DIR}/include"
mkdir -p "$INCLUDE_DIR"
cp -r src/node.h src/node_version.h src/node_api.h src/node_api_types.h \
      src/node_buffer.h src/js_native_api.h src/js_native_api_types.h \
      "$INCLUDE_DIR/" 2>/dev/null || true
cp -r deps/v8/include/* "$INCLUDE_DIR/" 2>/dev/null || true
cp -r deps/uv/include/* "$INCLUDE_DIR/" 2>/dev/null || true

echo "${NODE_VERSION}" > "$OUT_DIR/NODE_VERSION"

echo ""
echo "=== Done: ${OUT_DIR} ==="
ls -lh "$OUT_DIR"/libnode.a
