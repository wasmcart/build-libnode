/**
 * Smoke test: the downloaded prebuilt is real and the API/CLI report it.
 * Assumes install.js has run (postinstall, or CI calling it directly).
 */
import { strict as assert } from 'node:assert';
import { statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as libnode from '../index.js';

assert.ok(libnode.installed(), `libnode not installed at ${libnode.dir}`);

const libSize = statSync(libnode.lib).size;
assert.ok(libSize > 50_000_000, `${libnode.lib} is ${libSize} bytes; a real merged libnode is >50MB`);

for (const h of ['node.h', 'v8.h', 'uv.h', 'node_api.h']) {
  assert.ok(existsSync(join(libnode.includeDir, h)), `missing header ${h}`);
}

assert.equal(libnode.nodeVersion, libnode.prebuilds.nodeVersion);
assert.ok(libnode.cflags().includes(libnode.includeDir));
assert.ok(libnode.libs().startsWith(libnode.lib));

const cliPath = fileURLToPath(new URL('../bin/libnode-config.js', import.meta.url));
const cli = (flag) => execFileSync(process.execPath, [cliPath, flag], { encoding: 'utf8' }).trim();
assert.equal(cli('--dir'), libnode.dir);
assert.equal(cli('--node-version'), libnode.nodeVersion);
assert.ok(cli('--libs').length > 0);

console.log(`smoke ok: ${libnode.target} ${libnode.release} lib=${(libSize / 1048576).toFixed(0)}MB`);
