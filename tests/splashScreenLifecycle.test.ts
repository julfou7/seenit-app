import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('le splash termine réellement son cycle après le début de fermeture', () => {
  const source = fs.readFileSync('src/components/SplashScreen.tsx', 'utf8');

  assert.match(source, /const onCompleteRef = useRef\(onComplete\)/);
  assert.match(source, /const onStartCloseRef = useRef\(onStartClose\)/);
  assert.match(
    source,
    /if \(!timeElapsed \|\| !isReady \|\| isClosing\) return;[\s\S]*setIsClosing\(true\);[\s\S]*onStartCloseRef\.current\?\.\(\);[\s\S]*\}, \[timeElapsed, isReady, isClosing\]\);/
  );
  assert.match(
    source,
    /if \(!isClosing\) return;[\s\S]*const closeTimer = setTimeout\(\(\) => \{[\s\S]*onCompleteRef\.current\(\);[\s\S]*\}, reducedMotion \? 0 : 500\);[\s\S]*return \(\) => clearTimeout\(closeTimer\);[\s\S]*\}, \[isClosing, reducedMotion\]\);/
  );

  const closeStartEffect = source.match(/useEffect\(\(\) => \{\n\s*if \(!timeElapsed[\s\S]*?\n\s*\}, \[timeElapsed, isReady, isClosing\]\);/)?.[0] || '';
  assert.doesNotMatch(closeStartEffect, /setTimeout\(/, 'le timer de fin ne doit plus être détruit par le passage isClosing=true');
});

test('le splash n’anime jamais le symbole SVG : anneau et coche passent par le compositeur (terrain v1.4.248)', () => {
  // Les animations d'éléments SVG tournent sur le fil principal, occupé à monter l'app sous le splash :
  // l'anneau disparaissait puis réapparaissait d'un coup. Seules des couches HTML sont animées.
  const css = fs.readFileSync('src/components/brand.css', 'utf8');
  const splash = fs.readFileSync('src/components/SplashScreen.tsx', 'utf8');
  assert.match(css, /\.seenit-brand-splash\[data-ready=false\] \.brand-stack-symbol circle,\.seenit-brand-splash\[data-ready=false\] \.brand-stack-symbol path\{opacity:0;animation:none\}/);
  assert.doesNotMatch(css, /brand-stack-symbol (?:circle|path)\s*\{[^}]*animation:brand/, 'aucune animation sur le symbole SVG');
  assert.match(css, /\.brand-splash-ring__full\{animation:brandRingShow 1ms linear 1700ms both\}/);
  assert.match(css, /\.brand-splash-ring__tick\{animation:brandSplashTick 220ms ease 1640ms forwards\}/);
  assert.doesNotMatch(css, /brandRingHide/, 'l’anneau du compositeur reste visible jusqu’à la fin du splash');
  assert.match(splash, /className="brand-splash-ring__full" dangerouslySetInnerHTML=\{\{__html:RING_FULL\}\}/);
  assert.match(splash, /className="brand-splash-ring__tick" dangerouslySetInnerHTML=\{\{__html:TICK_MARK\}\}/);
});
