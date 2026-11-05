import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('TNR téléchargements : le poster compact ne cède aucune hauteur aux métadonnées', () => {
  const card = readFileSync('src/components/DownloadItemCard.tsx', 'utf8');
  const css = readFileSync('src/screens/downloads.css', 'utf8');
  assert.match(card, /className="download-card__poster"/);
  assert.match(css, /\.download-card__poster \{[^}]*width:54px;[^}]*height:80px;[^}]*flex:none;/);
  assert.match(css, /\.download-card__poster img \{[^}]*object-fit:contain;/);
});
