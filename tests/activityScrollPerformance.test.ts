import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const discoverSource = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('../src/screens/LibraryScreen.tsx', import.meta.url), 'utf8');

test('#229 réarme le scroll infini Explorer après Activity hidden → visible', () => {
  assert.match(discoverSource, /const observerTargetNodeRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(
    discoverSource,
    /const observerTargetRef = useCallback\(\(node: HTMLDivElement \| null\) => \{\s*observerTargetNodeRef\.current = node;\s*\}, \[\]\);/,
    'la callback-ref doit seulement conserver le sentinel DOM afin que React Activity puisse le réutiliser au réveil',
  );
  assert.match(
    discoverSource,
    /useEffect\(\(\) => \{\s*const node = observerTargetNodeRef\.current;[\s\S]*new IntersectionObserver[\s\S]*observer\.observe\(node\);[\s\S]*return \(\) => observer\.disconnect\(\);/,
    'le cycle de vie de l’IntersectionObserver doit appartenir à un Effect reconnectable par Activity',
  );
  assert.doesNotMatch(
    discoverSource,
    /const observerRef = useRef<IntersectionObserver/,
    'un observer conservé puis seulement déconnecté au cleanup ne serait pas réarmé quand Activity reconnecte les Effects',
  );
});

test('#229 borne le montage initial des rangées de Ma Liste sans masquer les médias suivants', () => {
  assert.match(librarySource, /const LIBRARY_ROW_BATCH_SIZE = 12/);
  assert.match(librarySource, /data\.slice\(0, visibleCount\)\.map\(media =>/);
  assert.match(
    librarySource,
    /setVisibleCount\(current => Math\.min\(data\.length, current \+ LIBRARY_ROW_BATCH_SIZE\)\)/,
    'la rangée réduite doit étendre progressivement son lot quand le scroll horizontal approche de la fin',
  );
  assert.match(librarySource, /const showsByMediaKey = useMemo\(\(\) => \{/);
  assert.match(librarySource, /key=\{getMediaKey\(media\.media_type, media\.id\)\}/);
  assert.match(librarySource, /onShowClick=\{handleShowClick\}/);
  assert.doesNotMatch(librarySource, /key=\{`\$\{media\.id\}_\$\{idx\}`\}/);
});
