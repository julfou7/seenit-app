import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const downloadsScreen = readFileSync('src/screens/DownloadsScreen.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

test('TNR téléchargements : le badge Film/Série reste sous l’affiche sans réduire son ratio 2:3', () => {
  assert.match(
    downloadsScreen,
    /className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950"[\s\S]*?<\/button>\s*<div className=\{`flex h-\[22px\]/,
    'Le bandeau Film/Série doit rester un frère placé après le bouton affiche.'
  );

  assert.match(
    css,
    /button\.min-h-0\.flex-1\.overflow-hidden\.bg-zinc-950\s*\{[\s\S]*?aspect-ratio:\s*2\s*\/\s*3;[\s\S]*?flex:\s*0\s+0\s+auto;[\s\S]*?width:\s*100%;[\s\S]*?\}/,
    'L’affiche doit conserver son ratio 2:3 et ne plus céder de hauteur au bandeau média.'
  );
});
