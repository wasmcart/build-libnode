# build-libnode

Pre-built libnode ([V8](https://v8.dev) + [libuv](https://libuv.org) +
[Node.js](https://nodejs.org) embedding API) static libraries, built once per Node.js
version and per platform so downstream projects link in seconds instead of compiling
V8 from source.

Used by:

- [wasmcart](https://github.com/wasmcart): [wasmcart-native](https://github.com/wasmcart/wasmcart-native) and [wasmcart-libretro](https://github.com/wasmcart/wasmcart-libretro) embed V8 as a **WASM** runtime.
- [jsgame-libretro](https://github.com/monteslu/jsgame-libretro): a libretro core that embeds libnode to run **JavaScript** web games (Canvas 2D / WebGL2 / WebAudio) directly in V8.

## Why

These projects use V8 (via libnode) as their runtime. V8's
[Liftoff](https://v8.dev/blog/liftoff) baseline compiler starts execution immediately:
a 52MB [Godot](https://godotengine.org) WASM game engine loads in 356ms, compared
to 29 seconds with [wasmtime](https://wasmtime.dev)'s full ahead-of-time compilation.

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

## Install via npm

The repo doubles as an npm package (`libnode-prebuilt`) that fetches the right
archive for your platform at install time, verifies it against pinned sha256
digests, and extracts it into the package directory:

```bash
npm install libnode-prebuilt
```

Then point your build at it:

```bash
# Makefile / shell (pkg-config style)
CFLAGS += $(shell npx libnode-config --cflags)
LDLIBS += $(shell npx libnode-config --libs)

# cmake
cmake .. -DLIBNODE_DIR=$(npx libnode-config --dir)
```

`--libs` includes the per-platform system libraries libnode needs
(`-pthread -ldl -lm`, plus `Security`/`CoreFoundation` frameworks on macOS and
`winmm dbghelp ws2_32 crypt32 iphlpapi psapi userenv bcrypt` on Windows).

Or from JavaScript:

```js
import { dir, lib, includeDir, nodeVersion, libs } from 'libnode-prebuilt';
```

Environment variables:

| Variable | Effect |
|----------|--------|
| `LIBNODE_SKIP_DOWNLOAD=1` | Skip the download (offline installs) |
| `LIBNODE_DIR` | Use an existing libnode directory instead of downloading |
| `LIBNODE_TARGET` | Fetch a specific target, e.g. `android-aarch64` on a linux build host |
| `LIBNODE_MIRROR` | Alternate base URL for the release assets |

Every download is rejected unless its size and sha256 match `prebuilds.json`,
which pins a specific release tag. The `npm package` CI workflow proves the
whole path on all five desktop runners: download, verify, extract, then
compile and link a real program against the archive (resolving
`napi_create_function` and its transitive V8/node deps, the exact resolution
that broke in the Windows LTO regression).

## What's in each archive

```
libnode.a               # Static library. Link into your binary, no runtime deps
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
curl -sL https://github.com/wasmcart/build-libnode/releases/download/v26.3.0-jsg9/libnode-linux-x86_64.tar.gz \
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
- `--fully-static`: build as static library (libnode.a)
- `--without-npm`: no package manager
- `--without-inspector`: no Chrome DevTools protocol
- `--without-intl`: no full [ICU](https://icu.unicode.org) internationalization (~25MB savings)
- `--without-corepack`: no package manager shims

What remains: V8 (WASM + JS engine), [libuv](https://libuv.org) (event loop),
[OpenSSL](https://www.openssl.org) (crypto), [zlib](https://zlib.net), and the
Node.js C++ embedding API.

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
# Requires the Android NDK: https://developer.android.com/ndk
NDK_PATH=/path/to/android-ndk ./build-android.sh
./build-android.sh --node-version 24.14.1 --ndk /path/to/ndk
```

Output: `out/android-aarch64/`

## CI / Releases

### Triggering a build

Builds are triggered by:

1. **Tag push**: push a tag matching the Node.js version to build all targets and create a GitHub Release:
   ```bash
   git tag v24.14.1
   git push --tags
   ```

2. **Manual dispatch**: go to Actions → Build libnode → Run workflow, enter the Node.js version.

New releases are made deliberately, not automatically. The V8 version in libnode should stay aligned with what browsers support; we don't want carts using WASM features that the browser host can't run.

### What the CI does

1. Runs 6 build jobs in parallel (one per target platform)
2. Each job clones Node.js source, configures, builds, and packages the output
3. After all builds succeed, creates a GitHub Release with all 6 archives attached plus a `SHA256SUMS.txt`

Build times: ~20-30 minutes per target. All 6 run in parallel so total wall time is ~30 minutes.

## Versioning

Releases are tagged with the Node.js version they're built from (e.g. `v24.14.1`). The `NODE_VERSION` file in each archive contains this version for programmatic access.

When the packaging changes but the Node.js version does not (a build-flag fix, a
Windows archive-format fix, an added header) the rebuild gets a `-jsgN` suffix on
the same version (`v26.3.0`, `v26.3.0-jsg4`, … `v26.3.0-jsg9`). The Node.js source
is identical across those; only how the library is built and packaged differs, so
the highest `-jsgN` for a given version is the one to use. That is what the
downstream projects pin:

```
wasmcart-native   .github/workflows/build.yml   LIBNODE_VERSION: v26.3.0-jsg9
wasmcart-libretro README build step             v26.3.0-jsg9
```

Downstream projects pin to a specific build-libnode release version. Bump when ready; there's no auto-update of downstream.

### npm package after a new release

After cutting a release, repin the npm package and bump its version:

```bash
node scripts/update-prebuilds.mjs v26.3.0-jsg9   # rewrites prebuilds.json from the release's asset digests
npm version patch
```

The package version is independent of the Node.js version; `prebuilds.json`
carries the release tag and per-asset digests. The GitHub API provides the
sha256 digests, so nothing needs downloading to repin.
