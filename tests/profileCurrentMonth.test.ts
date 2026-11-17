import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Retour terrain du 17/11 (Moi · Ton année 2026 : « j'aimerais voir le mois en cours »).
test('Moi : le mois en cours est nommé avec ses heures et sa barre se repère, record ou non', () => {
  const card = readFileSync('src/components/profile/MoiYearCard.tsx', 'utf8');
  assert.match(card, /Heures par mois\{currentMonth >= 0 && currentMonth < stats\.months\.length && <b data-current-month> · \{PROFILE_MONTH_LABELS\[currentMonth\]\} : \{Math\.round\(stats\.months\[currentMonth\] \/ 60\)\} h<\/b>\}/);
  assert.match(card, /data-now=\{month === currentMonth \|\| undefined\}/, 'repère indépendant de l’état record');
  const css = readFileSync('src/screens/moi.css', 'utf8');
  assert.match(css, /\.moi-month-bar\[data-now\]>b,\.moi-month-bar\[data-now\]>small\{color:#F2C36B\}/);
  assert.match(css, /\.moi-month-bar\[data-now\]>small::after\{/);
});

// Retour terrain du 17/11 (À voir : « pas assez d'espace au-dessus des filtres, ça touche presque »).
test('À voir : les pastilles de tri des films s’écartent de l’en-tête', () => {
  assert.match(readFileSync('src/screens/watchListHome.css', 'utf8'), /\.home-movie-sort \{ display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 12px; \}/);
});
