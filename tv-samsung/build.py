#!/usr/bin/env python3
"""Build SeenIt TV as a Samsung Tizen .wgt package.

Usage:
  python3 tv-samsung/build.py
  python3 tv-samsung/build.py --sign PROFILE

Unsigned packages are useful for inspection; a retail TV requires a package signed
with a Tizen/Samsung certificate profile. 2017-2022 TVs can use a Tizen certificate.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
WGT = os.path.join(REPO, 'SeenItTV-tizen.wgt')
FILES = ['config.xml', 'index.html', 'styles.css', 'tv.js', 'model.js', 'connection.js', 'sport.js', 'app.js', 'icon.png', 'NOTICE-FreeMyTV.md',
         'vendor/qrcode.min.js', 'vendor/qrcode.LICENSE', 'vendor/NOTICE.md']
# Only shipped local artwork, never sources, tests, certificates or personal exports.
for asset_root, _, asset_names in os.walk(os.path.join(ROOT, 'assets')):
    for asset_name in sorted(asset_names):
        if os.path.splitext(asset_name)[1].lower() in ('.svg', '.png', '.md', '.woff2', '.txt'):
            FILES.append(os.path.relpath(os.path.join(asset_root, asset_name), ROOT).replace(os.sep, '/'))


def tizen_cli():
    name = 'tizen.bat' if os.name == 'nt' else 'tizen'
    home = os.path.expanduser('~')
    candidates = [
        os.environ.get('TIZEN_STUDIO', ''),
        os.path.join(home, 'tizen-studio'),
        os.path.join(home, 'tizen-sdk'),
        'C:\\tizen-studio',
    ]
    for base in candidates:
        path = os.path.join(base, 'tools', 'ide', 'bin', name)
        if base and os.path.exists(path):
            return path
    return shutil.which('tizen')


def sign(profile):
    cli = tizen_cli()
    if not cli:
        raise SystemExit('Signing needs Samsung Tizen tools. Set TIZEN_STUDIO or install the tizen CLI.')
    out = tempfile.mkdtemp(prefix='seenit-tv-sign-')
    try:
        run = subprocess.run([cli, 'package', '-t', 'wgt', '-s', profile, '-o', out, '--', WGT], capture_output=True, text=True)
        made = [name for name in os.listdir(out) if name.endswith('.wgt')]
        if run.returncode != 0 or not made:
            raise SystemExit('tizen package failed:\n' + (run.stdout + run.stderr).strip())
        shutil.move(os.path.join(out, made[0]), WGT)
    finally:
        shutil.rmtree(out, ignore_errors=True)


def main():
    profile = None
    if '--sign' in sys.argv:
        index = sys.argv.index('--sign')
        if index + 1 >= len(sys.argv):
            raise SystemExit('--sign requires a profile name')
        profile = sys.argv[index + 1]
    with zipfile.ZipFile(WGT, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            path = os.path.join(ROOT, name)
            if not os.path.exists(path):
                raise SystemExit('Missing ' + path)
            archive.write(path, name)
    if profile:
        sign(profile)
    with zipfile.ZipFile(WGT) as archive:
        names = set(archive.namelist())
    expected = set(FILES)
    if not expected.issubset(names):
        raise SystemExit('Package verification failed')
    status = 'signed with ' + profile if profile else 'unsigned'
    print('Built %s (%d KB, %s)' % (os.path.basename(WGT), os.path.getsize(WGT) // 1024, status))


if __name__ == '__main__':
    main()
