import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DAY_MS,
  buildStoragePlan,
  retentionPolicyForArtifact
} = require('../scripts/prune-github-storage.cjs');
const { runMaintenance, resolveProtectedRelease, MAX_DELETIONS_PER_RUN, MUTATION_DELAY_MS } = require('../scripts/prune-github-storage.cjs');

test('garde uniquement la release protégée sans planifier de suppression de tag', () => {
  const latest = { id: 208, tag_name: 'v1.4.208', assets: [{ size: 13_000_000 }] };
  const old = { id: 207, tag_name: 'v1.4.207', assets: [{ size: 12_000_000 }] };
  const older = { id: 206, tag_name: 'v1.4.206', assets: [{ size: 11_000_000 }] };

  const plan = buildStoragePlan({
    protectedRelease: latest,
    releases: [older, latest, old],
    artifacts: [],
    nowMs: Date.UTC(2026, 9, 13)
  });

  assert.deepEqual(plan.releasesToDelete.map((release: { id: number }) => release.id), [206, 207]);
  assert.equal(plan.protectedReleaseId, 208);
  assert.equal(plan.estimatedBytes.releases, 23_000_000);
  assert.equal(Object.hasOwn(plan, 'tagsToDelete'), false);
});

test('refuse de purger les releases si la release protégée manque dans une collection non vide', () => {
  assert.throws(() => buildStoragePlan({
    protectedRelease: { id: 208, tag_name: 'v1.4.208' },
    releases: [{ id: 207, tag_name: 'v1.4.207' }],
    artifacts: [],
    nowMs: Date.UTC(2026, 9, 13)
  }), /release protégée est absente/i);
});

test('ne supprime aucune release lorsqu’aucune release officielle protégée n’est prouvée', () => {
  const plan = buildStoragePlan({
    protectedRelease: null,
    releases: [{ id: 207, tag_name: 'v1.4.207' }],
    artifacts: [],
    nowMs: Date.UTC(2026, 9, 13)
  });
  assert.deepEqual(plan.releasesToDelete, []);
});

test('applique 1 jour aux APK/harness et 7 jours aux preuves qualité', () => {
  assert.equal(retentionPolicyForArtifact('SeenIt-Android-APK-v1.4.208')?.days, 1);
  assert.equal(retentionPolicyForArtifact('seenit-apk-v1.4.190')?.days, 1);
  assert.equal(retentionPolicyForArtifact('SeenIt-Android-Upgrade-Test-v1.4.208')?.days, 1);
  assert.equal(retentionPolicyForArtifact('seenit-test-harness-123')?.days, 1);
  assert.equal(retentionPolicyForArtifact('SeenIt-Quality-Gates-123')?.days, 7);
  assert.equal(retentionPolicyForArtifact('SeenIt-Agent-Quality-Gates-123')?.days, 7);
  assert.equal(retentionPolicyForArtifact('SeenIt-APK-Upgrade-Smoke-Android-36-v1.4.208')?.days, 7);
  assert.equal(retentionPolicyForArtifact('unrelated-artifact'), null);
});

test('supprime seulement les artefacts SeenIt ayant dépassé leur fenêtre', () => {
  const nowMs = Date.UTC(2026, 9, 13, 12);
  const created = (daysAgo: number) => new Date(nowMs - daysAgo * DAY_MS).toISOString();
  const artifacts = [
    { id: 1, name: 'SeenIt-Android-APK-v1.4.208', created_at: created(0.5), size_in_bytes: 13 },
    { id: 2, name: 'SeenIt-Android-APK-v1.4.207', created_at: created(1.1), size_in_bytes: 13 },
    { id: 3, name: 'SeenIt-Quality-Gates-1', created_at: created(6), size_in_bytes: 2 },
    { id: 4, name: 'SeenIt-Quality-Gates-2', created_at: created(8), size_in_bytes: 3 },
    { id: 5, name: 'unrelated-artifact', created_at: created(100), size_in_bytes: 999 },
    { id: 6, name: 'SeenIt-Agent-Quality-Gates-expired', created_at: created(1), expired: true, size_in_bytes: 5 }
  ];

  const plan = buildStoragePlan({ protectedRelease: null, releases: [], artifacts, nowMs });
  assert.deepEqual(plan.artifactsToDelete.map((artifact: { id: number }) => artifact.id), [2, 4, 6]);
  assert.equal(plan.estimatedBytes.artifacts, 21);
});

test('préserve les publications plus récentes, brouillons et préreleases pendant une purge retardée', () => {
  const protectedRelease = { id: 208, tag_name: 'v1.4.208', published_at: '2026-10-01T12:00:00Z' };
  const plan = buildStoragePlan({ protectedRelease, releases: [protectedRelease,
    { id: 207, published_at: '2026-09-30T12:00:00Z' },
    { id: 209, published_at: '2026-10-02T12:00:00Z' },
    { id: 210, draft: true }, { id: 211, prerelease: true }, { id: 212 }
  ] });
  assert.deepEqual(plan.releasesToDelete.map((release: { id: number }) => release.id), [207]);
});

test('la maintenance sérialise et borne les suppressions réelles, puis conserve le travail restant', async () => {
  const apply = process.env.SEENIT_STORAGE_APPLY;
  process.env.SEENIT_STORAGE_APPLY = 'true';
  const latest = { id: 208, tag_name: 'v1.4.208' };
  const releases = [latest, ...Array.from({ length: 120 }, (_, index) => ({ id: index + 1, tag_name: `old-${index}` }))];
  const deleted: string[] = []; const delays: number[] = [];
  try {
    const request = async (route: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') { deleted.push(route); return null; }
      if (route === '/releases/latest') return latest;
      if (route.startsWith('/actions/artifacts')) return { artifacts: [] };
      const page = Number(new URL('https://api.github.com' + route).searchParams.get('page'));
      return releases.slice((page - 1) * 100, page * 100);
    };
    const result = await runMaintenance({ request, sleep: async (ms: number) => { delays.push(ms); } });
    assert.equal(deleted.length, MAX_DELETIONS_PER_RUN);
    assert.equal(deleted.includes('/releases/208'), false);
    assert.equal(delays.length, MAX_DELETIONS_PER_RUN - 1);
    assert.ok(delays.every(value => value === MUTATION_DELAY_MS));
    assert.equal(result.remaining, 120 - MAX_DELETIONS_PER_RUN);
  } finally {
    if (apply === undefined) delete process.env.SEENIT_STORAGE_APPLY;
    else process.env.SEENIT_STORAGE_APPLY = apply;
  }
});

test('un ancien événement de release protège la dernière publication plutôt que sa propre version', async () => {
  const previous = process.env.SEENIT_STORAGE_KEEP_HEAD_SHA;
  const sha = 'a'.repeat(40);
  process.env.SEENIT_STORAGE_KEEP_HEAD_SHA = sha;
  try {
    const latest = { id: 209, tag_name: 'v1.4.209' };
    const result = await resolveProtectedRelease({ releases: [{ id: 208, target_commitish: sha }, latest],
      request: async (route: string) => { assert.equal(route, '/releases/latest'); return latest; } });
    assert.equal(result.id, 209);
  } finally {
    if (previous === undefined) delete process.env.SEENIT_STORAGE_KEEP_HEAD_SHA;
    else process.env.SEENIT_STORAGE_KEEP_HEAD_SHA = previous;
  }
});
