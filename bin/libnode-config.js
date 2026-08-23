#!/usr/bin/env node
/**
 * pkg-config style CLI for the downloaded libnode prebuilt.
 *
 * Usage in a Makefile or shell:
 *   CFLAGS  += $(shell npx libnode-config --cflags)
 *   LDLIBS  += $(shell npx libnode-config --libs)
 *   cmake .. -DLIBNODE_DIR=$(npx libnode-config --dir)
 */
import * as libnode from '../index.js';

const usage = `libnode-config <flag>
  --dir           libnode directory (for -DLIBNODE_DIR=...)
  --lib           full path to libnode.a / libnode.lib
  --include       header directory
  --cflags        compiler flags (-I...)
  --libs          linker inputs (library + platform system libs)
  --target        resolved target triple
  --node-version  Node.js version the library was built from
  --release       GitHub release tag the binaries came from`;

const out = [];
for (const arg of process.argv.slice(2)) {
  switch (arg) {
    case '--dir': out.push(libnode.dir); break;
    case '--lib': out.push(libnode.lib); break;
    case '--include': out.push(libnode.includeDir); break;
    case '--cflags': out.push(libnode.cflags()); break;
    case '--libs': out.push(libnode.libs()); break;
    case '--target': out.push(libnode.target); break;
    case '--node-version': out.push(libnode.nodeVersion); break;
    case '--release': out.push(libnode.release); break;
    default:
      console.error(usage);
      process.exit(arg === '--help' || arg === '-h' ? 0 : 1);
  }
}
if (!out.length) { console.error(usage); process.exit(1); }
if (!libnode.installed() && !process.env.LIBNODE_DIR) {
  console.error('libnode-config: prebuilt not installed yet (postinstall skipped or failed); run: node install.js');
  process.exit(1);
}
console.log(out.join(' '));
