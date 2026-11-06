import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = readFileSync('docs/specifications/seenit.md', 'utf8');
const ux = readFileSync('docs/specifications/ux-reference.md', 'utf8');
const registry = readFileSync('docs/requests/registry.md', 'utf8');
const css = readFileSync('src/screens/watchListHome.css', 'utf8');

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `section introuvable : ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to < 0 ? undefined : to);
}

test('SEENIT-UX-020 le contrat canonique, la référence UX et le registre portent les mêmes règles visuelles', () => {
  const rule = section(spec, '- **SEENIT-UX-020**', '\n## 10.');
  assert.match(rule, /USR-2026-11-06-002/);
  assert.match(rule, /USR-2026-11-06-003/);
  assert.match(rule, /`#F2C36B`/);
  assert.match(rule, /`HomeLoadMore`/);
  // Statut honnête : la cible n'est pas entièrement livrée et ses issues restent ouvertes.
  assert.match(rule, /cible partiellement livrée/);
  assert.match(rule, /#874/);
  assert.match(rule, /#873/);
  const reference = section(ux, '## 9. Règles visuelles durables', '\n## ');
  assert.match(reference, /`#F2C36B`/);
  assert.match(reference, /`HomeLoadMore`/);
  for (const id of ['USR-2026-11-06-002', 'USR-2026-11-06-003']) {
    assert.match(registry, new RegExp(`\\| ${id} \\|[^\\n]*\\| active \\|`), `${id} reste une demande durable active`);
  }
});

test('SEENIT-UX-020 HomeLoadMore reste le contrôle de pagination livré sur À regarder et l’Historique', () => {
  const control = readFileSync('src/components/cards/HomeLoadMore.tsx', 'utf8');
  assert.match(control, /`Afficher \$\{step\} de plus`/);
  assert.match(control, /`Afficher les \$\{remainingCount\}`/);
  assert.match(control, /'Afficher la dernière'/);
  assert.match(control, /\{remainingCount\} en attente/);
  assert.match(control, /items\.slice\(0, 3\)/, 'trois prochaines vignettes');
  assert.match(readFileSync('src/screens/WatchNextSection.tsx', 'utf8'), /<HomeLoadMore tile /);
  assert.match(readFileSync('src/components/HistoryFeed.tsx', 'utf8'), /<HomeLoadMore step=\{HISTORY_PAGE_SIZE\}/);
});

test('SEENIT-UX-020 les titres média déjà livrés en or le restent, même lus', () => {
  assert.match(css, /\.home-notice \.home-notice__text strong \{ color:#f2c36b; \}/);
  assert.match(css, /\.home-notifications-page \.home-notice \.home-notice__text strong \{[^}]*color:#f2c36b/);
  assert.doesNotMatch(css, /\.home-notice--read[^{]*strong \{[^}]*color:(?!#f2c36b)/i, 'un titre lu ne perd pas l’or');
});

test('SEENIT-NOTIFICATION-003 #443 la cible paysage est tracée sans remplacer le contrat runtime contain', () => {
  const rule = section(spec, '- **SEENIT-NOTIFICATION-003**', '\n- **SEENIT-');
  assert.match(rule, /BigPicture\s+centré en contain dans l'état développé/);
  assert.match(rule, /Cible #443 \(`USR-2026-11-06-004`\), non encore livrée/);
  assert.match(rule, /image paysage/);
  assert.match(rule, /le contrat contain ci-dessus reste celui du runtime/);
  assert.match(registry, /\| USR-2026-11-06-004 \|[^\n]*SEENIT-NOTIFICATION-003[^\n]*\| active \|/);
});
