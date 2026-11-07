import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';

const read = (path: string) => readFileSync(path, 'utf8');

async function loadControl() {
  const bundle = await build({ entryPoints: ['src/components/cards/HomeLoadMore.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'load-more-ports', setup(builder) {
      builder.onResolve({ filter: /^react\/jsx-runtime$|seriesCardPresentation$|\.css$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="f";export const imageUrl=(path,size)=>"https://image.tmdb.org/t/p/"+size+path;' }));
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
});

test('SEENIT-UX-020 #873 toutes les paginations réutilisent le contrôle partagé, sans bouton texte « voir plus »', () => {
  const surfaces: Array<[string, RegExp]> = [
    ['src/components/MovieActorProfile.tsx', /<LoadMore previews=\{grid\.slice\(limit, limit \+ 3\)/],
    ['src/screens/mediaDetail/detailSections.tsx', /<LoadMore round previews=\{cast\.slice\(6, 9\)/],
    ['src/components/ProAnalyticsDashboard.tsx', /<LoadMore round previews=\{people\.slice\(PEOPLE_PREVIEW, PEOPLE_PREVIEW \+ 3\)/],
    ['src/screens/PersonDetailModal.tsx', /<LoadMore previews=\{filteredCredits\.slice\(visibleCredits\.length, visibleCredits\.length \+ 3\)/]
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
});
