import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// #925 : en CI, l'appui long simulé (530 ms fixes) ne laissait que 50 ms de marge sur le seuil de 480 ms ;
// un runner chargé relâchait avant le déclenchement. Le harnais attend désormais l'événement.
test('#925 harnais navbar : l’appui long attend le raccourci (3 s au plus) et reste un appui long, unique', () => {
  const harness = readFileSync('scripts/navbar-browser-checks.cjs', 'utf8');
  assert.match(readFileSync('src/components/NavigationTabButton.tsx', 'utf8'), /timer\.current = setTimeout\(trigger, 480\);/, 'seuil réel de l’appui long');
  assert.match(harness, /while\(Date\.now\(\)-started<3000 && !\(await evaluate\(client,`Boolean\(\$\{firedExpression\}\)`\)\)\) await delay\(20\);/, 'relâché seulement après le déclenchement');
  assert.match(harness, /if\(held<450\)throw new Error\(`#721 appui long \$\{tab\} déclenché trop tôt/, 'jamais immédiat');
  assert.match(harness, /'appui long unique '\+tab\);/, 'toujours un seul raccourci par appui');
  assert.doesNotMatch(harness, /tap\(client,selector\(tab\),'left',530\)/, 'plus de durée fixe');
});
