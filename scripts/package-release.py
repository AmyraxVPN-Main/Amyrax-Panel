from pathlib import Path
import json
import re
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
source = (root / 'index.js').read_bytes().decode('utf-8')
assert f"const AMYRAX_VERSION = '{version}';" in source
lock = json.loads((root / 'package-lock.json').read_text(encoding='utf-8'))
assert lock['version'] == lock['packages']['']['version'] == version
for token in ['WORK_TIMEOUT', 'WORK_FULL', 'createWorkQueue', 'workQueue', 'AMYRAX_WORK_', 'importInFlight']:
    assert token not in source, token
for key, filename in {
    'updatesJs':'updates.js','updatesCss':'updates.css',
    'studioJs':'studio.js','studioCss':'studio.css',
    'controlsJs':'controls.js', 'controlsCss':'controls.css',
    'usersJs':'users.js', 'usersCss':'users.css', 'indexHtml':'index.html',
    'subscriptionHtml':'subscription.html', 'appCss':'app.css', 'appJs':'app.js',
    'subscriptionCss':'subscription.css', 'subscriptionJs':'subscription.js',
    'qrJs':'vendor/qrcode.js',
}.items():
    match = re.search(r'^  ' + key + r': (".*"),?\r?$', source, re.M)
    assert match and json.loads(match[1]) == (root / 'assets' / filename).read_bytes().decode('utf-8'), filename
for section, filename, factory in [
    ('PANEL UPDATES','panel-updates.cjs','createPanelUpdates'),
    ('CONFIG STUDIO','config-studio.cjs','createConfigStudio'),
    ('NETWORK SUPPORT','network-support.cjs','createNetworkSupport'),
    ('TRANSPORT SUPPORT','transport-support.cjs','createTransportSupport'),
    ('NODE PRESENTATION','node-presentation.cjs','createNodePresentation'),
    ('TUNNEL GATEWAY','tunnel-gateway.cjs','createTunnelGateway'),
    ('TRAFFIC METER','traffic-meter.cjs','createTrafficMeter'),
    ('SYSTEM METRICS','system-metrics.cjs','createSystemMetrics'),
]:
    embedded = source.split('// BEGIN ' + section + '\n')[1].split('\n// END ' + section)[0]
    readable = (root / 'scripts' / filename).read_bytes().decode('utf-8').replace('module.exports = ' + factory + ';', '')
    assert embedded == readable, filename
for section, filename, factory in [
    ('USER MANAGEMENT','user-manager.cjs','createUserManagement'),
    ('UPGRADE SUPPORT','upgrade-support.cjs','createUpgradeSupport'),
]:
    embedded = source.split('// BEGIN ' + section + '\n')[1].split('\n// END ' + section)[0]
    readable = re.sub(r'^module\.exports = ' + factory + r';\s*$', '', (root / 'scripts' / filename).read_bytes().decode('utf-8'), flags=re.M)
    assert embedded == readable, filename

files = [root / name for name in ['index.js','package.json','package-lock.json','Dockerfile','.dockerignore','RAILWAY.md','CONFIGS.md','UPDATES.md','Amyrax-Logo-Preview.png']]
files += sorted(file for folder in ['assets','scripts'] for file in (root / folder).rglob('*') if file.is_file() and '__pycache__' not in file.parts)
archive = root / f'Amyrax-Panel-v{version}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for file in files:
        bundle.write(file, file.relative_to(root).as_posix())
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(files)
    assert not any(name.startswith(('.review/', 'node_modules/')) or name.endswith(('auth.json','state.json','users.json','traffic.json','work-queue.cjs')) for name in bundle.namelist())
    for file in files:
        assert bundle.read(file.relative_to(root).as_posix()) == file.read_bytes()
print(f'PASS version and embedded-source consistency; {archive.name}: {len(files)} files, {archive.stat().st_size:,} bytes; CRC and file equality verified.')
