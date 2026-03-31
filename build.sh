#!/bin/bash
set -e

# build.sh — Build libnode static library (.a) for the current platform
#
# Usage:
#   ./build.sh                              # build for current platform
#   ./build.sh --node-version 24.14.1       # specific version
#
# Output: out/<platform>-<arch>/
#   libnode.a       — all deps merged, PIC-compatible (works in static binaries AND shared libs)
#   include/        — node + v8 + uv headers
#   NODE_VERSION

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION=$(cat "$SCRIPT_DIR/NODE_VERSION" | tr -d '[:space:]')

while [[ $# -gt 0 ]]; do
    case $1 in
        --node-version) NODE_VERSION="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    aarch64|arm64) ARCH="aarch64" ;;
esac
case "$OS" in
    linux) PLATFORM="linux" ;;
    darwin) PLATFORM="macos" ;;
    mingw*|msys*|cygwin*) PLATFORM="windows" ;;
esac

TARGET="${PLATFORM}-${ARCH}"
echo "=== Building libnode v${NODE_VERSION} for ${TARGET} (static, PIC) ==="

SRC_DIR="${SCRIPT_DIR}/node-src"
OUT_DIR="${SCRIPT_DIR}/out/${TARGET}"
mkdir -p "$OUT_DIR"

# Clone if needed
if [ ! -d "$SRC_DIR" ]; then
    echo "Cloning Node.js v${NODE_VERSION}..."
    git clone --depth 1 --branch "v${NODE_VERSION}" https://github.com/nodejs/node.git "$SRC_DIR"
else
    CURRENT=$(cd "$SRC_DIR" && git describe --tags 2>/dev/null || echo "unknown")
    if [ "$CURRENT" != "v${NODE_VERSION}" ]; then
        echo "Source is ${CURRENT}, need v${NODE_VERSION}. Re-cloning..."
        rm -rf "$SRC_DIR"
        git clone --depth 1 --branch "v${NODE_VERSION}" https://github.com/nodejs/node.git "$SRC_DIR"
    fi
fi

cd "$SRC_DIR"

# Patch V8 TLS model: "local-exec" can't be linked into shared libraries (.so).
# Change to "global-dynamic" which works in both static binaries and shared libs.
TLS_HEADER="deps/v8/src/common/thread-local-storage.h"
if grep -q '"local-exec"' "$TLS_HEADER" 2>/dev/null; then
    echo "Patching V8 TLS model: local-exec → global-dynamic"
    sed -i 's/"local-exec"/"global-dynamic"/' "$TLS_HEADER"
fi

# Configure for static build with PIC (needed for libretro .so cores)
CONFIGURE_FLAGS="--fully-static --without-npm --without-inspector --without-intl --without-corepack"
export CFLAGS="${CFLAGS:-} -fPIC"
export CXXFLAGS="${CXXFLAGS:-} -fPIC"

echo "Configuring..."
./configure $CONFIGURE_FLAGS

# Build
NPROC=${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}
echo "Building with ${NPROC} jobs..."
make -j"$NPROC"

# Collect outputs
echo "Collecting outputs to ${OUT_DIR}..."

# Repack all .o files into a fat libnode.a
# Linux ar produces thin archives (useless for distribution) so we repack from .o
# macOS libtool can merge .a files directly
# Filter out test/tool executables
if [ "$PLATFORM" = "macos" ]; then
    echo "Stripping debug symbols..."
    for a in $(find out/Release -maxdepth 1 -name "*.a" ! -name "*gtest*"); do
        strip -S "$a" 2>/dev/null || true
    done
    SNAPSHOT_STUB=$(find out/Release/obj.target -name "node_snapshot_stub.o" -path "*/embedtest/*" | head -1)
    if [ -n "$SNAPSHOT_STUB" ]; then
        strip -S "$SNAPSHOT_STUB" 2>/dev/null || true
        echo "Including snapshot stub: $SNAPSHOT_STUB"
    fi
    libtool -static -o "$OUT_DIR/libnode.a" \
        $(find out/Release -maxdepth 1 -name "*.a" ! -name "*gtest*") \
        $SNAPSHOT_STUB
else
    echo "Creating fat libnode.a from object files..."
    OBJ_FILES=$(find out/Release/obj.target -name "*.o" \
        ! -path "*gtest*" ! -path "*cctest*" ! -path "*embedtest*" \
        ! -path "*/mksnapshot/*" ! -path "*/torque/*" ! -path "*/node_js2c/*" \
        ! -path "*/v8_init/*" ! -path "*/v8_initializers/*" ! -path "*/v8_initializers_slow/*" \
        ! -name "main_unix.o" ! -name "node_main.o")
    OBJ_COUNT=$(echo "$OBJ_FILES" | wc -l)
    echo "Packing $OBJ_COUNT object files..."
    ar rcs "$OUT_DIR/libnode.a" $OBJ_FILES
fi

echo "libnode.a: $(du -sh "$OUT_DIR/libnode.a" | cut -f1)"

# Headers
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
echo "Headers: ${INCLUDE_DIR}/"
