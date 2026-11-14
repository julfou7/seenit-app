import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeDocText, readDocText } from './helpers/docText.ts';

test('#497 un reflow Markdown seul ne fait pas échouer un contrat documentaire', () => {
  const contract = /ouvrir une issue d'amélioration continue avant la prochaine intervention/;
  const original = "L'agent doit ouvrir une issue d'amélioration continue avant la prochaine intervention.";
  // Cas réels de #496 : mots coupés par un retour ligne, indentation de puce, fins de ligne Windows.
  const reflowed = "L'agent doit ouvrir une issue d'amélioration\r\n  continue avant la prochaine\n  intervention.";
  assert.match(normalizeDocText(original), contract);
  assert.doesNotMatch(reflowed, contract, 'sans normalisation, le reflow casse l’assertion');
  assert.match(normalizeDocText(reflowed), contract);
});

test('#497 la normalisation tolère la mise en forme, pas un changement de sens', () => {
  const contract = /ne jamais pousser une nouvelle variante/;
  assert.doesNotMatch(normalizeDocText('ne jamais\npousser une\nautre variante'), contract, 'un mot changé reste détecté');
  assert.doesNotMatch(normalizeDocText('pousser une nouvelle variante, ne jamais'), contract, 'l’ordre des mots reste vérifié');
  assert.doesNotMatch(normalizeDocText('ne jamais pousser\n\n# Titre\n\nune nouvelle variante'), /ne jamais pousser une nouvelle variante/, 'un titre intercalé reste visible');
});

test('#497 les TNR de gouvernance migrés lisent la documentation via readDocText', () => {
  for (const file of ['finalHandoffGovernance', 'runtimeControl', 'playProtectDistribution', 'terrainReleaseFastPath', 'issueTrackingGovernance', 'codexReviewTriage']) {
    const source = readFileSync(`tests/${file}.test.ts`, 'utf8');
    assert.match(source, /from '\.\/helpers\/docText\.ts'/, file);
    assert.doesNotMatch(source, /\.replace\(\/\\s\+\/g, ' '\)/, `${file} : normalisation locale remplacée par le helper commun`);
  }
  assert.equal(readDocText('AGENTS.md').includes('\n'), false);
});
