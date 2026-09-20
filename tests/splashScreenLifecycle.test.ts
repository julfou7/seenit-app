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
    /if \(!isClosing\) return;[\s\S]*const closeTimer = setTimeout\(\(\) => \{[\s\S]*onCompleteRef\.current\(\);[\s\S]*\}, 500\);[\s\S]*return \(\) => clearTimeout\(closeTimer\);[\s\S]*\}, \[isClosing\]\);/
  );

  const closeStartEffect = source.match(/useEffect\(\(\) => \{\n\s*if \(!timeElapsed[\s\S]*?\n\s*\}, \[timeElapsed, isReady, isClosing\]\);/)?.[0] || '';
  assert.doesNotMatch(closeStartEffect, /setTimeout\(/, 'le timer de fin ne doit plus être détruit par le passage isClosing=true');
});
