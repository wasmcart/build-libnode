#!/bin/bash
set -e

# build-android.sh — Cross-compile libnode shared library for Android aarch64
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
echo "=== Building libnode v${NODE_VERSION} for ${TARGET} ==="

SRC_DIR="${SCRIPT_DIR}/node-src"
OUT_DIR="${SCRIPT_DIR}/out/${TARGET}"
mkdir -p "$OUT_DIR"

if [ ! -d "$SRC_DIR" ]; then
    echo "Cloning Node.js v${NODE_VERSION}..."
    git clone --depth 1 --branch "v${NODE_VERSION}" https://github.com/nodejs/node.git "$SRC_DIR"
fi

cd "$SRC_DIR"

# Full clean (cross-compile can't reuse objects from other targets)
rm -rf out/

# Patch 1: Disable V8 trap handler (uses signals not available on Android)
sed -i 's/#define V8_TRAP_HANDLER_SUPPORTED true/#define V8_TRAP_HANDLER_SUPPORTED false/' \
    deps/v8/src/trap-handler/trap-handler.h

# Patch 2: Add our configure flags to android-configure
sed -i 's|--cross-compiling")|--cross-compiling --without-npm --without-inspector --without-intl --without-corepack")|' \
    android_configure.py

# Set host compiler so V8 build tools (torque, mksnapshot) compile for the build machine
export CC_host=gcc
export CXX_host=g++
# -fPIC for shared library compatibility (libretro cores are .so)
export CFLAGS="${CFLAGS:-} -fPIC"
export CXXFLAGS="${CXXFLAGS:-} -fPIC"

echo "Configuring for Android aarch64..."
# API level 33+ required — Bionic libc needs API 33 for backtrace functions used by V8
./android-configure "$NDK" 33 arm64

NPROC=$(nproc 2>/dev/null || echo 4)
echo "Building with ${NPROC} jobs..."
# The node binary link may fail (we don't need it) — libnode.so is the target
make -j"$NPROC" || true


echo "Collecting outputs to ${OUT_DIR}..."

# Collect all .o files and pack into a fat libnode.a
echo "Creating fat libnode.a from object files..."
OBJ_FILES=$(find out/Release/obj.target -name "*.o" ! -path "*gtest*")
OBJ_COUNT=$(echo "$OBJ_FILES" | wc -l)
echo "Packing $OBJ_COUNT object files..."
ar rcs "$OUT_DIR/libnode.a" $OBJ_FILES
echo "libnode.a: $(du -sh "$OUT_DIR/libnode.a" | cut -f1) ($OBJ_COUNT objects)"

INCLUDE_DIR="${OUT_DIR}/include"
mkdir -p "$INCLUDE_DIR"
cp -r src/node.h src/node_version.h src/node_api.h src/node_api_types.h \
      src/node_buffer.h src/js_native_api.h src/js_native_api_types.h \
      "$INCLUDE_DIR/" 2>/dev/null || true
cp -r deps/v8/include/* "$INCLUDE_DIR/" 2>/dev/null || true
cp -r deps/uv/include/* "$INCLUDE_DIR/" 2>/dev/null || true

echo "${NODE_VERSION}" > "$OUT_DIR/NODE_VERSION"

# Restore patched files
cd "$SRC_DIR"
git checkout -- deps/v8/src/trap-handler/trap-handler.h android_configure.py 2>/dev/null || true

echo ""
echo "=== Done: ${OUT_DIR} ==="
ls -lh "$OUT_DIR"/libnode.a
file "$OUT_DIR"/libnode.a
