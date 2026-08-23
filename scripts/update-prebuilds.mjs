/**
 * Regenerate prebuilds.json from a GitHub release's asset digests.
 * Run after cutting a new release, then commit the result and bump the
 * package version.
 *
 * Usage:
 *   node scripts/update-prebuilds.mjs            # latest release
 *   node scripts/update-prebuilds.mjs v26.3.0-jsg9
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(pkgRoot, 'prebuilds.json');
const current = JSON.parse(readFileSync(path, 'utf8'));

const tag = process.argv[2];
const api = tag
  ? `https://api.github.com/repos/wasmcart/build-libnode/releases/tags/${tag}`
  : 'https://api.github.com/repos/wasmcart/build-libnode/releases/latest';
const headers = { 'user-agent': 'libnode-prebuilt' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(api, { headers });
if (!res.ok) { console.error(`GitHub API ${res.status} for ${api}`); process.exit(1); }
const release = await res.json();

const targets = {};
const re = /^libnode-(.+)\.(?:tar\.gz|zip)$/;
for (const a of release.assets) {
  const m = a.name.match(re);
  if (!m) continue;
  if (!a.digest || !a.digest.startsWith('sha256:')) {
    console.error(`asset ${a.name} has no sha256 digest from the API; refusing to pin without one`);
    process.exit(1);
  }
  targets[m[1]] = { file: a.name, sha256: a.digest.slice(7), size: a.size };
}
if (!Object.keys(targets).length) { console.error('no libnode-* assets found'); process.exit(1); }

// NODE_VERSION for the tag lives in the repo at that tag
const nvRes = await fetch(`https://raw.githubusercontent.com/wasmcart/build-libnode/${release.tag_name}/NODE_VERSION`, { headers });
const nodeVersion = nvRes.ok ? (await nvRes.text()).trim() : current.nodeVersion;

const sorted = Object.fromEntries(Object.keys(targets).sort().map(k => [k, targets[k]]));
writeFileSync(path, JSON.stringify({
  release: release.tag_name,
  nodeVersion,
  baseUrl: current.baseUrl,
  targets: sorted
}, null, 2) + '\n');
console.log(`prebuilds.json pinned to ${release.tag_name} (node ${nodeVersion}, ${Object.keys(targets).length} targets: ${Object.keys(targets).join(', ')})`);
