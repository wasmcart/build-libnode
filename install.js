/**
 * postinstall: download the libnode prebuilt for this platform from the
 * GitHub release pinned in prebuilds.json, verify its sha256 against the
 * pinned digest, and extract it to <package>/libnode/.
 *
 * Environment:
 *   LIBNODE_SKIP_DOWNLOAD=1 - skip entirely (offline installs, or when the
 *                             consumer supplies LIBNODE_DIR at build time)
 *   LIBNODE_DIR             - external libnode directory; skips the download
 *   LIBNODE_TARGET          - force a target (cross-compile fetches)
 *   LIBNODE_MIRROR          - alternate base URL for the release assets
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const pkgRoot = dirname(fileURLToPath(import.meta.url));
const prebuilds = JSON.parse(readFileSync(join(pkgRoot, 'prebuilds.json'), 'utf8'));

if (process.env.LIBNODE_SKIP_DOWNLOAD === '1' || process.env.LIBNODE_DIR) {
  console.log('libnode-prebuilt: skipping download (' +
    (process.env.LIBNODE_DIR ? `LIBNODE_DIR=${process.env.LIBNODE_DIR}` : 'LIBNODE_SKIP_DOWNLOAD') + ')');
  process.exit(0);
}

const osName = { linux: 'linux', darwin: 'macos', win32: 'windows', android: 'android' }[process.platform];
const archName = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
const target = process.env.LIBNODE_TARGET || (osName && archName ? `${osName}-${archName}` : null);
const asset = target && prebuilds.targets[target];
if (!asset) {
  console.error(`libnode-prebuilt: no prebuilt for ${target || `${process.platform}-${process.arch}`}. ` +
    `Available: ${Object.keys(prebuilds.targets).join(', ')}. ` +
    'Set LIBNODE_TARGET to fetch a cross target, or LIBNODE_SKIP_DOWNLOAD=1 to skip.');
  process.exit(1);
}

const destDir = join(pkgRoot, 'libnode');
const marker = join(destDir, '.libnode-prebuilt');
const wanted = `${prebuilds.release} ${target}`;

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === wanted) {
  console.log(`libnode-prebuilt: ${wanted} already installed`);
  process.exit(0);
}

const base = process.env.LIBNODE_MIRROR || prebuilds.baseUrl;
const url = `${base}/${prebuilds.release}/${asset.file}`;
const archive = join(pkgRoot, `.download-${asset.file}`);

/** Download url to archive, returning the sha256 hex of the bytes written. */
async function download() {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const hash = createHash('sha256');
  const out = createWriteStream(archive);
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (source) { for await (const chunk of source) { hash.update(chunk); yield chunk; } },
    out
  );
  return hash.digest('hex');
}

function extract() {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  // tar handles .tar.gz everywhere; on Windows the system tar is bsdtar,
  // which also reads .zip. A .zip on a non-Windows host (cross fetch)
  // falls back to unzip.
  let r = spawnSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
  if (r.status !== 0 && asset.file.endsWith('.zip') && process.platform !== 'win32') {
    r = spawnSync('unzip', ['-q', archive, '-d', destDir], { stdio: 'inherit' });
  }
  if (r.status !== 0) throw new Error(`extraction of ${asset.file} failed (is tar on PATH?)`);
}

try {
  const mb = (asset.size / 1048576).toFixed(0);
  console.log(`libnode-prebuilt: fetching ${asset.file} (${mb}MB) from ${prebuilds.release}...`);
  let digest;
  try {
    digest = await download();
  } catch (err) {
    console.log(`libnode-prebuilt: retrying after ${err.message}`);
    digest = await download();
  }
  const size = statSync(archive).size;
  if (size !== asset.size) throw new Error(`size mismatch: got ${size}, expected ${asset.size}`);
  if (digest !== asset.sha256) throw new Error(`sha256 mismatch: got ${digest}, expected ${asset.sha256}`);
  extract();
  const libName = target.startsWith('windows') ? 'libnode.lib' : 'libnode.a';
  if (!existsSync(join(destDir, libName)) || !existsSync(join(destDir, 'include', 'node.h'))) {
    throw new Error(`archive did not contain ${libName} + include/node.h`);
  }
  writeFileSync(marker, wanted + '\n');
  console.log(`libnode-prebuilt: installed ${wanted} -> ${destDir}`);
} catch (err) {
  console.error(`libnode-prebuilt: install failed: ${err.message}`);
  console.error(`  asset: ${url}`);
  console.error('  Manual fallback: download it yourself, extract anywhere, and set LIBNODE_DIR.');
  process.exit(1);
} finally {
  rmSync(archive, { force: true });
}
