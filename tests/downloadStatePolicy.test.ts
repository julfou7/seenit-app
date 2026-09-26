import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  hasExplicitDownloadError,
  isDownloadActiveOrAttention,
  isDownloadCompleted,
  isDownloadInHistorySection
} from '../src/features/downloads/downloadStatePolicy.ts';

test('le badge ignore les éléments terminés et annulés', () => {
  assert.equal(isDownloadActiveOrAttention({ status: 'downloading', progress: 42 }), true);
  assert.equal(isDownloadActiveOrAttention({ status: 'warning', progress: 20 }), true);
  assert.equal(isDownloadActiveOrAttention({ status: 'error', progress: 20 }), true);
  assert.equal(isDownloadActiveOrAttention({ status: 'completed', progress: 100 }), false);
  assert.equal(isDownloadActiveOrAttention({ status: 'cancelled', progress: 12 }), false);
});

test('vider une section ne sélectionne jamais un téléchargement actif', () => {
  const active = { status: 'downloading', progress: 40 };
  for (const section of ['completed', 'cancelled', 'error'] as const) {
    assert.equal(isDownloadInHistorySection(active, section), false);
  }
  assert.equal(isDownloadInHistorySection({ status: 'completed', progress: 100 }, 'completed'), true);
  assert.equal(isDownloadInHistorySection({ status: 'cancelled', progress: 30 }, 'cancelled'), true);
  assert.equal(isDownloadInHistorySection({ status: 'error', progress: 30 }, 'error'), true);
});


test('SEENIT-DOWNLOAD-007 une erreur d’import à 100 % reste dans En erreur', () => {
  const manualImportBlocked = {
    status: 'completed',
    progress: 100,
    errorMessage: 'Found matching movie via grab history. Manual Import required.'
  };

  assert.equal(hasExplicitDownloadError(manualImportBlocked), true);
  assert.equal(isDownloadCompleted(manualImportBlocked), false);
  assert.equal(isDownloadActiveOrAttention(manualImportBlocked), true);
  assert.equal(isDownloadInHistorySection(manualImportBlocked, 'error'), true);
  assert.equal(isDownloadInHistorySection(manualImportBlocked, 'completed'), false);
});


test('SEENIT-DOWNLOAD-007 la fiche média traite l’erreur avant le 100 % et ne relance pas Plex', () => {
  const source = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');

  assert.ok(source.includes("import { hasExplicitDownloadError, isDownloadCompleted } from '../features/downloads/downloadStatePolicy';"));
  assert.match(source, /const hasDownloadError = !hasActiveDownload && mediaDownloads\.some\(hasExplicitDownloadError\);/);
  assert.match(
    source,
    /const hasCompletedDownload = !hasActiveDownload\s+&& !hasDownloadError\s+&& mediaDownloads\.some\(isDownloadCompleted\);/
  );
  assert.match(source, /if \(!hasCompletedDownload \|\| hasActiveDownload \|\| !effectiveTmdbId/);
});
