# build-libnode

Pre-built libnode shared libraries for [wasmcart](https://github.com/wasmcart). Used by [wasmcart-native](https://github.com/wasmcart/wasmcart-native) and [wasmcart-libretro](https://github.com/wasmcart/wasmcart-libretro) to embed V8 as a WASM runtime.

## Why

wasmcart uses V8 (via libnode) as its WASM runtime. V8's Liftoff baseline compiler starts WASM execution immediately — a 52MB Godot game engine loads in 356ms, compared to 29 seconds with wasmtime's full ahead-of-time compilation.

Building libnode from source takes 20-30 minutes per platform. This repo does that once per Node.js version and publishes pre-built binaries so downstream projects build in seconds.

## Download

Grab the release for your platform from [Releases](https://github.com/wasmcart/build-libnode/releases).

| File | Platform | Arch | Use case |
|------|----------|------|----------|
| `libnode-linux-x86_64.tar.gz` | Linux | x86_64 | Desktop, Steam Deck, CI |
| `libnode-linux-aarch64.tar.gz` | Linux | aarch64 | Raspberry Pi, ARM servers |
| `libnode-macos-x86_64.tar.gz` | macOS | x86_64 | Intel Macs |
| `libnode-macos-aarch64.tar.gz` | macOS | aarch64 | Apple Silicon (M1/M2/M3/M4) |
| `libnode-windows-x86_64.zip` | Windows | x86_64 | Desktop |
| `libnode-android-aarch64.tar.gz` | Android | aarch64 | Retroid, phones, tablets |

## What's in each archive

```
libnode.a               # Static library — link into your binary, no runtime deps
include/                # Headers for compilation
  node.h                #   Node.js embedding API
  v8.h, v8-wasm.h, ... #   V8 C++ API (WASM compilation, isolates, etc.)
  uv.h                  #   libuv event loop
NODE_VERSION            # Node.js version this was built from
```

## Using in downstream projects

Download the archive for your target platform and point your build at it:

```bash
# Download
mkdir -p deps/libnode
curl -sL https://github.com/wasmcart/build-libnode/releases/download/v24.14.1/libnode-linux-x86_64.tar.gz \
  | tar xz -C deps/libnode

# Build (cmake)
cmake .. -DLIBNODE_DIR=deps/libnode
make
```

In your `CMakeLists.txt`:

```cmake
set(LIBNODE_DIR "${CMAKE_SOURCE_DIR}/deps/libnode" CACHE PATH "Path to libnode")

target_include_directories(myapp PRIVATE ${LIBNODE_DIR}/include)
target_link_libraries(myapp PRIVATE ${LIBNODE_DIR}/libnode.a pthread dl m)
```

Output is a single binary with V8 baked in. No shared library to ship alongside.

## Build configuration

Node.js is configured with:

```
--fully-static --without-npm --without-inspector --without-intl --without-corepack
```

This strips out everything not needed for WASM execution:
- `--fully-static` — build as static library (libnode.a)
- `--without-npm` — no package manager
- `--without-inspector` — no Chrome DevTools protocol
- `--without-intl` — no full ICU internationalization (~25MB savings)
- `--without-corepack` — no package manager shims

What remains: V8 (WASM + JS engine), libuv (event loop), OpenSSL (crypto), zlib, and the Node.js C++ embedding API.

## Build locally

### Current platform

```bash
./build.sh                              # defaults to latest LTS
./build.sh --node-version 24.14.1       # specific version
./build.sh --static                     # also build libnode.a
```

Output: `out/<platform>-<arch>/`

### Android (cross-compile)

```bash
# Requires Android NDK
NDK_PATH=/path/to/android-ndk ./build-android.sh
./build-android.sh --node-version 24.14.1 --ndk /path/to/ndk
```

Output: `out/android-aarch64/`

## CI / Releases

### Triggering a build

Builds are triggered by:

1. **Tag push** — push a tag matching the Node.js version to build all targets and create a GitHub Release:
   ```bash
   git tag v24.14.1
   git push --tags
   ```

2. **Manual dispatch** — go to Actions → Build libnode → Run workflow, enter the Node.js version.

New releases are made deliberately, not automatically. The V8 version in libnode should stay aligned with what browsers support — we don't want carts using WASM features that the browser host can't run.

### What the CI does

1. Runs 6 build jobs in parallel (one per target platform)
2. Each job clones Node.js source, configures, builds, and packages the output
3. After all builds succeed, creates a GitHub Release with all 6 archives attached

Build times: ~20-30 minutes per target. All 6 run in parallel so total wall time is ~30 minutes.

## Versioning

Releases are tagged with the Node.js version they're built from (e.g. `v24.14.1`). The `NODE_VERSION` file in each archive contains this version for programmatic access.

Downstream projects pin to a specific build-libnode release version. Bump when ready — there's no auto-update of downstream.
