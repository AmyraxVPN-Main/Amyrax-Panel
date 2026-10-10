'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { prepareRuntimeBinaries } = require('../index.js');

(async () => {
  const config = await prepareRuntimeBinaries();
  const binaries = {};
  for (const [name, file, version] of [
    ['sing-box', config.paths.singboxBin, config.singBoxVersion],
    ['xray', config.paths.xrayBin, config.xrayVersion]
  ]) {
    const result = spawnSync(file, ['version'], {encoding:'utf8', timeout:15000});
    if (result.status !== 0 || !result.stdout.includes(version)) throw new Error(name + ' version validation failed');
    binaries[name] = {version, sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  }
  const manifest = {platform:os.platform(), arch:os.arch(), binaries};
  fs.writeFileSync(path.join(config.paths.binDir, 'manifest.json'), JSON.stringify(manifest), {mode:0o600});
  console.log('[Amyrax] Container engines prepared and verified.');
})().catch(error => {
  console.error('[Amyrax] Container preparation failed:', error.message);
  process.exitCode = 1;
});
