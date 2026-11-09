import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';

const read = (path: string) => readFileSync(path, 'utf8');

async function loadControl() {
  const bundle = await build({ entryPoints: ['src/components/cards/HomeLoadMore.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'load-more-ports', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$|seriesCardPresentation$|\.css$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="f";export const imageUrl=(path,size)=>"https://image.tmdb.org/t/p/"+size+path;export const useEffect=()=>{};export const useRef=()=>({current:null});export const useState=(value)=>[value,()=>{}];' }));
    } }] });
  const module = { exports: {} as Record<string, unknown> };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, exports: module.exports }));
  return module.exports as { loadMoreLabel: (remaining: number, step: number, last: string) => string; LoadMore: (props: Record<string, unknown>) => { props: { className: string; children: unknown[]; onClick: () => void } } | null };
}

const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text((node as { props?: { children?: unknown } }).props?.children) : node === null || node === undefined || node === false ? '' : String(node);

test('SEENIT-UX-020 #873 un seul « Afficher plus » : libellé du lot, des N restants ou du dernier, compteur et trois vignettes', async () => {
  const { loadMoreLabel, LoadMore } = await loadControl();
  assert.equal(loadMoreLabel(20, 9, 'Afficher le dernier'), 'Afficher 9 de plus');
  assert.equal(loadMoreLabel(4, 9, 'Afficher le dernier'), 'Afficher les 4');
  assert.equal(loadMoreLabel(1, 9, 'Afficher la dernière'), 'Afficher la dernière');
  let loads = 0;
  const control = LoadMore({ previews: [1, 2, 3, 4].map(id => ({ key: `k${id}`, initial: 'T', imagePath: `/p${id}.jpg` })), remainingCount: 12, step: 9, onLoad: () => { loads += 1; }, round: true })!;
  assert.match(control.props.className, /^home-load-more home-load-more--round$/);
  const [posters, label, waiting] = control.props.children as Array<{ props: { children: unknown } }>;
  assert.equal((posters.props.children as unknown[]).length, 3, 'les trois prochains éléments seulement');
  assert.equal(text(label), 'Afficher 9 de plus');
  assert.equal(text(waiting), '12 en attente');
  control.props.onClick();
  assert.equal(loads, 1);
  assert.equal(LoadMore({ previews: [], remainingCount: 0, onLoad: () => {} }), null, 'rien quand il ne reste rien');
  // Retour terrain du 08/11 : « Afficher les 46 · 46 en attente » répétait le compte ; le libellé suffit.
  for (const [remaining, expected] of [[46, 'Afficher les 46'], [1, 'Afficher le dernier']] as const) {
    const [, rest, counter] = LoadMore({ previews: [], remainingCount: remaining, step: 46, onLoad: () => {} })!.props.children as unknown[];
    assert.equal(text(rest), expected);
    assert.equal(counter, false, `${expected} : pas de « ${remaining} en attente » répété`);
  }
});

test('SEENIT-UX-020 les Personnages se déplient dix par dix, puis « Réduire »', () => {
  const cast = read('src/screens/mediaDetail/detailSections.tsx');
  assert.match(cast, /const CAST_FIRST = 6, CAST_STEP = 10;/);
  assert.match(cast, /remainingCount=\{cast\.length - limit\} step=\{CAST_STEP\} onLoad=\{\(\) => \{ reveal\.focusItem\(limit\); setLimit\(limit \+ CAST_STEP\); \}\}/);
  assert.match(cast, /\{cast\.length > CAST_FIRST && cast\.length <= limit && <button type="button" onClick=\{\(\) => \{ setLimit\(CAST_FIRST\); reveal\.focusLoadMore\(\); \}\}/);
  assert.doesNotMatch(cast, /step=\{cast\.length\}/, 'plus de dépliage d’un bloc');
});

test('SEENIT-UX-020 #873 toutes les paginations réutilisent le contrôle partagé, sans bouton texte « voir plus »', () => {
  const surfaces: Array<[string, RegExp]> = [
    ['src/components/MovieActorProfile.tsx', /<LoadMore previews=\{grid\.slice\(limit, limit \+ 3\)/],
    ['src/screens/mediaDetail/detailSections.tsx', /<LoadMore round previews=\{cast\.slice\(limit, limit \+ 3\)/],
    ['src/components/ProAnalyticsDashboard.tsx', /<LoadMore round previews=\{people\.slice\(PEOPLE_PREVIEW, PEOPLE_PREVIEW \+ 3\)/],
    ['src/screens/PersonDetailModal.tsx', /<LoadMore previews=\{filteredCredits\.slice\(visibleCredits\.length, visibleCredits\.length \+ 3\)/],
    // Retour terrain du 09/11 : Moi · Films à voir avait gardé « Charger plus ».
    ['src/screens/LibraryScreen.tsx', /<LoadMore\n\s+previews=\{data\.slice\(visibleCount, visibleCount \+ 3\)/]
  ];
  for (const [file, pattern] of surfaces) {
    const source = read(file);
    assert.match(source, pattern, file);
    assert.doesNotMatch(source, /actor-profile__more|Afficher tout le casting|Voir les \$\{people\.length\}|\} de plus\s*<\/button>/, `${file} : plus de bouton texte de pagination`);
  }
  // L'accueil et l'Historique gardent HomeLoadMore, qui délègue au même contrôle ; ses styles sont partagés.
  assert.match(read('src/components/cards/HomeLoadMore.tsx'), /return <LoadMore previews=\{items\.slice\(0, 3\)/);
  assert.match(read('src/components/cards/HomeLoadMore.tsx'), /import '\.\/loadMore\.css';/);
  assert.match(read('src/components/cards/loadMore.css'), /\.home-load-more \{ height:52px; min-height:52px;/);
  assert.doesNotMatch(read('src/screens/watchListHome.css'), /\.home-load-more \{/, 'une seule source de styles');
  // Invariant global (retour terrain du 09/11) : aucun autre bouton texte de pagination dans toute l'app, même sur
  // une surface oubliée de la liste ci-dessus.
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.tsx$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
  for (const file of walk('src')) {
    const code = read(file).replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, />\s*(?:Charger|Voir|Afficher) (?:plus|la suite)\s*</, `${file} : pagination hors du contrôle partagé`);
  }
});

test('SEENIT-UX-020 #873 le focus clavier suit le dépliage et le repli sans se perdre', () => {
  const control = read('src/components/cards/HomeLoadMore.tsx');
  assert.match(control, /export function useRevealFocus<T extends HTMLElement>\(itemSelector: string\)/);
  assert.match(control, /next\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(read('src/screens/mediaDetail/detailSections.tsx'), /onLoad=\{\(\) => \{ reveal\.focusItem\(limit\); setLimit\(limit \+ CAST_STEP\); \}\}/);
  assert.match(read('src/screens/mediaDetail/detailSections.tsx'), /onClick=\{\(\) => \{ setLimit\(CAST_FIRST\); reveal\.focusLoadMore\(\); \}\}/);
  assert.match(read('src/components/ProAnalyticsDashboard.tsx'), /reveal\.focusItem\(PEOPLE_PREVIEW\)/);
  assert.match(read('src/components/ProAnalyticsDashboard.tsx'), /setExpanded\(false\); reveal\.focusLoadMore\(\);/);
  assert.match(read('src/components/MovieActorProfile.tsx'), /filmographyReveal\.focusItem\(limit\); setLimit/);
  assert.match(read('src/screens/PersonDetailModal.tsx'), /creditsReveal\.focusItem\(visibleCredits\.length\);/);
});
