import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDownloadActiveOrAttention,
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
