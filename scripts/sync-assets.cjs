const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'index.js');
let source = fs.readFileSync(entry, 'utf8');
const cssPath = path.join(root, 'assets', 'subscription.css');
const iconDir = path.join(root, 'assets', 'apps');
const iconFiles = ['v2rayn.png', 'flclash.png', 'v2rayng.png', 'streisand.png', 'singbox.svg', 'shadowrocket.png'];
const iconRules = iconFiles.map(file => {
  const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  const data = fs.readFileSync(path.join(iconDir, file)).toString('base64');
  return '.app-monogram[data-app="' + path.parse(file).name + '"]{background-image:url("data:' + mime + ';base64,' + data + '")}';
}).join('\n');
const iconSection = /\/\* BEGIN CLIENT ICONS \*\/[\s\S]*?\/\* END CLIENT ICONS \*\//;
const subscriptionCss = fs.readFileSync(cssPath, 'utf8');
if (!iconSection.test(subscriptionCss)) throw new Error('Client icon section is missing');
fs.writeFileSync(cssPath, subscriptionCss.replace(iconSection, () => '/* BEGIN CLIENT ICONS */\n' + iconRules + '\n/* END CLIENT ICONS */'));
const assets = {
  subscriptionHtml: ['subscription.html', 'utf8'],
  subscriptionCss: ['subscription.css', 'utf8'],
  subscriptionJs: ['subscription.js', 'utf8'],
  qrJs: ['vendor/qrcode.js', 'utf8'],
  indexHtml: ['index.html', 'utf8'],
  appCss: ['app.css', 'utf8'],
  appJs: ['app.js', 'utf8'],
  usersJs: ['users.js', 'utf8'],
  usersCss: ['users.css', 'utf8'],
  controlsJs: ['controls.js', 'utf8'],
  controlsCss: ['controls.css', 'utf8'],
  logo: ['logo.svg', 'base64'],
  homeJpg: ['home.svg', 'base64'],
  bgJpg: ['bg.svg', 'base64'],
  cozybgJpg: ['cozybg.svg', 'base64']
};
for (const [key, [file, encoding]] of Object.entries(assets)) {
  const pattern = new RegExp('^  ' + key + ': ".*",?$', 'm');
  if (!pattern.test(source)) throw new Error('Embedded asset is missing: ' + key);
  const value = fs.readFileSync(path.join(root, 'assets', file)).toString(encoding);
  source = source.replace(pattern, () => '  ' + key + ': ' + JSON.stringify(value) + ',');
}
const fonts = {};
const fontDir = path.join(root, 'assets', 'fonts');
for (const name of fs.readdirSync(fontDir)) {
  fonts[name] = fs.readFileSync(path.join(fontDir, name)).toString('base64');
}
if (!/^const EMBEDDED_FONTS = .*;$/m.test(source)) throw new Error('Embedded fonts are missing');
source = source.replace(/^const EMBEDDED_FONTS = .*;$/m, () => 'const EMBEDDED_FONTS = ' + JSON.stringify(fonts) + ';');
const userRuntime = fs.readFileSync(path.join(root, 'scripts/user-manager.cjs'), 'utf8').replace(/^module\.exports = createUserManagement;\s*$/m, '');
const upgradeRuntime = fs.readFileSync(path.join(root,'scripts/upgrade-support.cjs'),'utf8').replace(/^module\.exports = createUpgradeSupport;\s*$/m,'');
source = source.replace(/\/\/ BEGIN UPGRADE SUPPORT[\s\S]*?\/\/ END UPGRADE SUPPORT/, () => '// BEGIN UPGRADE SUPPORT\n'+upgradeRuntime+'\n// END UPGRADE SUPPORT');
source = source.replace(/\/\/ BEGIN USER MANAGEMENT[\s\S]*?\/\/ END USER MANAGEMENT/, () => '// BEGIN USER MANAGEMENT\n' + userRuntime + '\n// END USER MANAGEMENT');
for (const [section, file, factory] of [['TRANSPORT SUPPORT','transport-support.cjs','createTransportSupport'],['NODE PRESENTATION','node-presentation.cjs','createNodePresentation'],['TUNNEL GATEWAY','tunnel-gateway.cjs','createTunnelGateway'],['WORK QUEUE','work-queue.cjs','createWorkQueue'],['TRAFFIC METER','traffic-meter.cjs','createTrafficMeter'],['SYSTEM METRICS','system-metrics.cjs','createSystemMetrics']]) {
  const runtime=fs.readFileSync(path.join(root,'scripts',file),'utf8').replace('module.exports = '+factory+';', '');
  const pattern=new RegExp('// BEGIN '+section+'[\\s\\S]*?// END '+section);
  if(!pattern.test(source))throw new Error('Missing runtime section: '+section);
  source=source.replace(pattern,()=> '// BEGIN '+section+'\n'+runtime+'\n// END '+section);
}
new (require('vm').Script)(source, { filename: 'index.js' });
fs.writeFileSync(entry, source);
console.log('Standalone assets synchronized.');
