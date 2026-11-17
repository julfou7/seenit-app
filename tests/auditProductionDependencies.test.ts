import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { blockingAdvisories, unacceptedAdvisories } = require('../scripts/audit-production-dependencies.cjs') as {
  blockingAdvisories: (report: unknown) => Array<{ id: string; package: string; severity: string }>;
  unacceptedAdvisories: (advisories: Array<{ id: string; package: string }>, accepted: Array<{ id: string; package: string; expiresOn: string }>, today?: string) => Array<{ id: string }>;
};

// Décision du propriétaire du 17/11/2026 (« accepter 30 jours », USR-2026-11-17-002) : l'avis picomatch sans version
// corrigée bloquait toute release ; il est accepté, daté, et tout autre avis high/critical bloque toujours.
const report = { vulnerabilities: {
  picomatch: { name: 'picomatch', severity: 'high', via: [{ name: 'picomatch', severity: 'high', title: 'ReDoS', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }] },
  vite: { name: 'vite', severity: 'high', via: ['picomatch', 'fdir'] },
  qs: { name: 'qs', severity: 'moderate', via: [{ name: 'qs', severity: 'moderate', url: 'https://github.com/advisories/GHSA-6pq8-jhm2-2vcw' }] },
} };
const accepted = [{ id: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', expiresOn: '2026-12-17' }];

test('USR-2026-11-17-002 un avis accepté et non expiré ne bloque pas ; les dépendances transitives suivent', () => {
  const advisories = blockingAdvisories(report);
  assert.deepEqual(advisories.map(item => item.id), ['GHSA-FC5Q-39XC-VJPF'], 'high seulement, dédupliqué ; le moderate ne compte pas');
  assert.deepEqual(unacceptedAdvisories(advisories, accepted, '2026-11-17'), []);
  assert.deepEqual(unacceptedAdvisories(advisories, accepted, '2026-12-17'), [], 'valable jusqu’au jour d’expiration inclus');
});

test('USR-2026-11-17-002 une acceptation expirée, un autre paquet ou un autre avis bloque', () => {
  const advisories = blockingAdvisories(report);
  assert.equal(unacceptedAdvisories(advisories, accepted, '2026-12-18').length, 1, 'expirée');
  assert.equal(unacceptedAdvisories(advisories, [{ ...accepted[0], package: 'autre' }], '2026-11-17').length, 1, 'mauvais paquet');
  const other = blockingAdvisories({ vulnerabilities: { ...report.vulnerabilities, express: { name: 'express', severity: 'critical', via: [{ name: 'express', severity: 'critical', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] } } });
  assert.deepEqual(unacceptedAdvisories(other, accepted, '2026-11-17').map(item => item.id), ['GHSA-AAAA-BBBB-CCCC']);
  assert.throws(() => blockingAdvisories({ error: { code: 'ENOAUDIT' } }), /invalide/, 'audit indisponible : jamais un succès');
});

test('USR-2026-11-17-002 la liste d’acceptations est nommée, motivée, datée et limitée à 30 jours', () => {
  const list = JSON.parse(readFileSync('scripts/accepted-advisories.json', 'utf8')) as Array<{ id: string; package: string; reason: string; acceptedOn: string; expiresOn: string; decision: string }>;
  for (const entry of list) {
    assert.match(entry.id, /^GHSA-/);
    assert.ok(entry.package && entry.reason.length > 40 && entry.decision);
    const days = (Date.parse(entry.expiresOn) - Date.parse(entry.acceptedOn)) / 86_400_000;
    assert.ok(days > 0 && days <= 30, `${entry.id} : 30 jours au plus`);
  }
  assert.match(readFileSync('scripts/validate-change.cjs', 'utf8'), /run\('node', \['scripts\/audit-production-dependencies\.cjs'\]/);
});
