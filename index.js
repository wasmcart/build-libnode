/**
 * libnode-prebuilt: paths and link flags for the pre-built libnode
 * static library that install.js downloads into <package>/libnode/.
 *
 * Environment overrides:
 *   LIBNODE_DIR    - use an existing libnode directory instead of the
 *                    downloaded one (must contain libnode.a or libnode.lib
 *                    and include/)
 *   LIBNODE_TARGET - force a target triple (e.g. android-aarch64 when
 *                    cross-compiling on a linux host)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(fileURLToPath(import.meta.url));

/** @type {{release: string, nodeVersion: string, baseUrl: string, targets: Record<string, {file: string, sha256: string, size: number}>}} */
export const prebuilds = JSON.parse(readFileSync(join(pkgRoot, 'prebuilds.json'), 'utf8'));

/** Release tag the binaries come from, e.g. "v26.3.0-jsg9". */
export const release = prebuilds.release;

/** Node.js version libnode was built from, e.g. "26.3.0". */
export const nodeVersion = prebuilds.nodeVersion;

/**
 * Detect the target triple for the current process.
 * @returns {string} e.g. "linux-x86_64"
 */
export function detectTarget() {
  const os = { linux: 'linux', darwin: 'macos', win32: 'windows', android: 'android' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) {
    throw new Error(`libnode-prebuilt: unsupported platform ${process.platform}-${process.arch}. ` +
      `Available targets: ${Object.keys(prebuilds.targets).join(', ')}`);
  }
  return `${os}-${arch}`;
}

/** Effective target: LIBNODE_TARGET override or detected. */
export const target = process.env.LIBNODE_TARGET || detectTarget();

if (!prebuilds.targets[target]) {
  throw new Error(`libnode-prebuilt: no prebuilt for target "${target}". ` +
    `Available: ${Object.keys(prebuilds.targets).join(', ')}`);
}

/** Directory holding libnode.a/.lib, include/, NODE_VERSION. */
export const dir = process.env.LIBNODE_DIR || join(pkgRoot, 'libnode');

/** Full path to the static library. */
export const lib = join(dir, target.startsWith('windows') ? 'libnode.lib' : 'libnode.a');

/** Full path to the header directory (node.h, v8.h, uv.h, ...). */
export const includeDir = join(dir, 'include');

/**
 * Whether the prebuilt is present on disk (downloaded, or pointed at
 * via LIBNODE_DIR).
 * @returns {boolean}
 */
export function installed() {
  return existsSync(lib) && existsSync(join(includeDir, 'node.h'));
}

/**
 * Compiler flags for the headers.
 * @returns {string}
 */
export function cflags() {
  return `-I${includeDir}`;
}

/**
 * Linker inputs for the current target: the static library plus the
 * system libraries libnode needs on that platform.
 * @returns {string}
 */
export function libs() {
  if (target.startsWith('windows')) {
    return `${lib} winmm.lib dbghelp.lib ws2_32.lib crypt32.lib iphlpapi.lib psapi.lib userenv.lib bcrypt.lib`;
  }
  if (target.startsWith('macos')) {
    return `${lib} -pthread -ldl -lm -framework Security -framework CoreFoundation`;
  }
  return `${lib} -pthread -ldl -lm`;
}

export default { prebuilds, release, nodeVersion, detectTarget, target, dir, lib, includeDir, installed, cflags, libs };
