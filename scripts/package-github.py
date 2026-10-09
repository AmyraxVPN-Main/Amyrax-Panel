from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
archive = root / f'Amyrax-Panel-v{version}-GitHub.zip'
files = [root / name for name in ['index.js', 'package.json', 'package-lock.json', '.gitignore', 'README.md', 'Amyrax-Logo-Preview.png']]
for folder in ['assets', 'scripts', 'docs']:
    files.extend(sorted(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name != 'Video-original.mp4'))
assert (root / 'docs/media/setup.mp4').stat().st_size < 10_000_000, 'Tutorial must fit the free GitHub video attachment limit'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for file in files:
        bundle.write(file, file.relative_to(root).as_posix())
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert 'README.md' in bundle.namelist() and 'docs/media/setup.mp4' in bundle.namelist()
    assert 'index.js' in bundle.namelist() and 'package.json' in bundle.namelist()
    assert not any(name.startswith(('.review/', 'node_modules/')) or name.endswith(('Video-original.mp4', 'auth.json', 'state.json', 'users.json', 'traffic.json')) for name in bundle.namelist())
    for file in files:
        assert bundle.read(file.relative_to(root).as_posix()) == file.read_bytes()
print(f'{archive.name}: {len(files)} files, {archive.stat().st_size:,} bytes; CRC and file equality verified.')
