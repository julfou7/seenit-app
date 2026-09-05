import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = readFileSync('docs/specifications/seenit.md', 'utf8');
const functional = readFileSync('docs/specifications/functional-reference.md', 'utf8');
const registry = readFileSync('docs/requests/registry.md', 'utf8');
const start = spec.indexOf('**SEENIT-UPDATE-003**');
const end = spec.indexOf('\n## 9.', start);
const updatePushSpec = spec.slice(start, end);

test('SEENIT-UPDATE-003 spécifie un push Android uniquement après une release officielle vérifiée', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(updatePushSpec, /publication réussie/);
  assert.match(updatePushSpec, /release immuable/);
  assert.match(updatePushSpec, /`main` officiel/);
  assert.match(updatePushSpec, /julfou7\/seenit-app/);
  assert.match(updatePushSpec, /tag sémantique `vX\.Y\.Z`/);
  assert.match(updatePushSpec, /asset exact `SeenIt-vX\.Y\.Z\.apk`/);
  assert.match(updatePushSpec, /SHA-256 officielle/);
  assert.match(functional, /Après qu'une release APK officielle a été publiée et vérifiée/);
  assert.match(registry, /USR-2026-09-05-001/);
});

test('SEENIT-UPDATE-003 limite la diffusion à une fois par version et installation', () => {
  assert.match(updatePushSpec, /uniquement les installations Android enregistrées et[\s\S]*autorisées/);
  assert.match(updatePushSpec, /la PWA n'est pas destinataire/);
  assert.match(updatePushSpec, /au plus une notification par version/);
  assert.match(updatePushSpec, /isolés par UID et appareil/);
  assert.match(functional, /une même installation reçoit au plus une notification par version/);
});

test('SEENIT-UPDATE-003 sépare le signal push du téléchargement APK', () => {
  assert.match(updatePushSpec, /signal non fiable/);
  assert.match(updatePushSpec, /ni URL d'APK considérée comme fiable/);
  assert.match(updatePushSpec, /Un appui ouvre SeenIt et force son contrôle canonique/);
  assert.match(updatePushSpec, /SEENIT-UPDATE-001/);
  assert.match(updatePushSpec, /SEENIT-UPDATE-002/);
  assert.match(functional, /ne constitue jamais une source d'installation/);
});

test('SEENIT-UPDATE-003 conserve une release publiée si FCM échoue', () => {
  assert.match(updatePushSpec, /échec FCM total ou partiel/);
  assert.match(updatePushSpec, /rejoué de manière[\s\S]*idempotente/);
  assert.match(updatePushSpec, /ne retire, ne remplace et ne réécrit jamais une release/);
  assert.match(functional, /panne FCM reste observable et rejouable sans annuler ni altérer la release/);
});
