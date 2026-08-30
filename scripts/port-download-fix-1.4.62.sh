#!/usr/bin/env bash
set -euo pipefail

# Réimporte uniquement les fichiers fonctionnels téléchargements déjà validés,
# sans toucher au correctif Plex 1.4.61 présent sur main.
git checkout origin/fix/download-tracking-cancel-1.4.60 -- \
  src/features/downloads/downloadIdentity.ts \
  src/features/downloads/downloadNetwork.ts \
  src/features/downloads/downloadReconciliation.ts \
  src/screens/DownloadsScreen.tsx \
  src/screens/ShowDetailScreen.tsx \
  src/services/sonarrRadarr.ts \
  src/store/liveDownloadStore.ts \
  tests/downloadIdentity.test.ts

python3 - <<'PY'
from pathlib import Path
import re

p = Path('android/app/build.gradle')
s = p.read_text()
s = re.sub(r'versionCode\s+\d+', 'versionCode 104062', s, count=1)
s = re.sub(r'versionName\s+"[^"]+"', 'versionName "1.4.62"', s, count=1)
p.write_text(s)

p = Path('src/store/updateStore.ts')
s = p.read_text()
s = re.sub(r"CURRENT_APP_VERSION\s*=\s*'[^']+'", "CURRENT_APP_VERSION = '1.4.62'", s, count=1)
p.write_text(s)
PY

echo 'Correctif téléchargements 1.4.62 porté depuis main 1.4.61.'
