import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agents = readFileSync('AGENTS.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const specIndex = readFileSync('docs/specifications/README.md', 'utf8');
const spec = readFileSync('docs/specifications/seenit.md', 'utf8');
const functional = readFileSync('docs/specifications/functional-reference.md', 'utf8');
const auditIndex = readFileSync('docs/audits/README.md', 'utf8');
const requestRegistry = readFileSync('docs/requests/registry.md', 'utf8');

test('SEENIT-FUNCTIONAL-001 impose la lecture de la référence produit avant toute intervention', () => {
  assert.match(agents, /docs\/specifications\/functional-reference\.md/);
  assert.match(specIndex, /functional-reference\.md/);
  assert.match(readme, /référence fonctionnelle/i);
  assert.match(requestRegistry, /USR-2026-09-04-007/);
});

test('SEENIT-FUNCTIONAL-001 couvre tous les écrans et parcours structurants', () => {
  for (const heading of [
    'Compte, démarrage et synchronisation multi-appareils',
    'Navigation globale',
    'Écran « À Voir »',
    'Profil, statistiques et Ma Liste',
    'Explorer',
    'Fiche média et détails associés',
    'Plex',
    'Téléchargements',
    'Notifications, actualités et appareils',
    'Réglages et maintenance utilisateur',
    'Matrice PWA / APK',
    'Écarts connus à ne pas normaliser silencieusement'
  ]) {
    assert.match(functional, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('SEENIT-FUNCTIONAL-001 garde la machine d’états et le mapping Plex dans la SPEC canonique', () => {
  assert.match(spec, /SEENIT-FUNCTIONAL-001/);
  assert.match(spec, /### 5\.3 Machine d'états canonique/);
  assert.match(spec, /### 5\.4 Transitions Film et Série/);
  assert.match(spec, /### 5\.5 Événements Plex/);
  assert.match(spec, /Non suivi[^\n]*Absence de document/);
  assert.match(spec, /Watchlist Plex retirée/);
  assert.match(spec, /#68/);
  assert.match(spec, /#93/);
});

test('SEENIT-QUALITY-002 indexe et clôt la matrice du nouvel audit fonctionnel', () => {
  assert.match(auditIndex, /AUDIT-2026-09-04-FONCTIONNEL/);
  assert.match(auditIndex, /audit-fonctionnel-2026-09-04\.md/);
  assert.match(functional, /#94/);
  assert.match(functional, /#95/);
  assert.match(functional, /#96/);
});

