import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { toastDetailLine } from '../src/features/toasts/toastPresentation.ts';

test('SEENIT-UX-004 le bilan final Plex utilise la bande Plex, un titre et une ligne de détail', () => {
  const toastStoreSource = fs.readFileSync(new URL('../src/store/toastStore.ts', import.meta.url), 'utf8');
  const toastSource = fs.readFileSync(new URL('../src/components/ToastContainer.tsx', import.meta.url), 'utf8');

  assert.match(toastStoreSource, /title:\s*'PLEX • Synchronisation terminée'/);
  assert.match(toastStoreSource, /action:\s*details/);
  assert.match(toastStoreSource, /scope:\s*isCompletion \? undefined : inferredScope/);
  assert.match(toastSource, /flex flex-col justify-center min-w-0/);
  assert.match(toastSource, /parsed\.title/);
  assert.match(toastSource, /parsed\.action/);
  // Bande Plex teintée, préfixe « PLEX • » retiré du titre affiché, détails réunis sur une ligne.
  assert.match(toastSource, /parsed\.iconSymbol \|\| isPlexToast \|\| isReminderToast \|\| type === 'success'\) return 'bg-\[#3A2C10\]'/);
  assert.match(toastSource, /parsed\.title\.replace\(\/\^PLEX\\s\*•\\s\*\/i, ''\)/);
  assert.match(fs.readFileSync(new URL('../src/features/toasts/toastPresentation.ts', import.meta.url), 'utf8'), /\.replace\(\/\\s\*\\n\+\\s\*\/g, ' · '\)/);
  assert.match(toastSource, /const \{ episodeLabel, detail \} = toastDetailLine\(\{ subtitle: parsed\.subtitle,/);
});

test('SEENIT-UX-004 #878 le sous-titre d’un toast n’est jamais perdu : épisode en pastille, contexte dans le détail', () => {
  // Passage à non vu d'un épisode (sous-titre normalisé par le store, action réduite à « Synchronisé »).
  assert.deepEqual(toastDetailLine({ subtitle: 'S1 | E2 • non vu sur Plex', action: 'Synchronisé' }), { episodeLabel: 'S01 | E02', detail: 'Non vu sur Plex · Synchronisé' });
  // Film remis à non vu, bilan Plex et type de média : le contexte précède l'action.
  assert.equal(toastDetailLine({ subtitle: 'non vu sur Plex', action: 'Synchronisé' }).detail, 'Non vu sur Plex · Synchronisé');
  assert.equal(toastDetailLine({ subtitle: '3 vus · 2 ajoutés à voir', action: 'Synchronisation Plex • Bilan' }).detail, '3 vus · 2 ajoutés à voir · Synchronisation Plex • Bilan');
  assert.equal(toastDetailLine({ subtitle: 'Film', action: 'Watchlist Plex • Ajouté à voir' }).detail, 'Film · Watchlist Plex • Ajouté à voir');
  // Cas voisins : code seul en pastille, sous-titre identique à l'action non répété, rien d'inventé sans sous-titre.
  assert.deepEqual(toastDetailLine({ subtitle: 'S10 | E104', action: 'Vu sur Plex • Synchronisé' }), { episodeLabel: 'S10 | E104', detail: 'Vu sur Plex • Synchronisé' });
  assert.equal(toastDetailLine({ subtitle: 'Synchronisé', action: 'Synchronisé' }).detail, 'Synchronisé');
  assert.deepEqual(toastDetailLine({ action: 'Ligne 1\nLigne 2' }), { episodeLabel: undefined, detail: 'Ligne 1 · Ligne 2' });
});
