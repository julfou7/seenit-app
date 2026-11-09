import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// Vrais modules (répartition, calendrier) : seuls les transports et le gate sont remplacés.
const bundle = await build({ entryPoints: ['src/features/downloads/arrCoverage.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'coverage-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|sonarrRadarrTransport|downloadFeatureVisibility)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'sonarrRadarr'
      ? 'export const cleanUrl=u=>String(u);export const executeGet=async()=>{throw new Error("réseau réel interdit")};export const executeDelete=executeGet;'
      : args.path === 'sonarrRadarrTransport' ? 'export const executePut=async()=>{throw new Error("réseau réel interdit")};'
      : 'export const isDownloadFeatureEnabled=()=>true;' }));
  } }] });
type Pending = { kind: 'series' | 'movie'; key: string; arrId: number; tmdbId?: number; title: string; date: number; monitored: boolean; episodes?: []; release?: Record<string, unknown>; profileId?: number };
type Programmed = { kind: string; id: number; seriesId?: number; title?: string; date?: string; wanted?: boolean; quality?: string };
const coverage = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  coverArrLibrary: (programmed: { items: Programmed[]; failures: string[]; movieQuality?: (id?: number) => string | undefined }, pending: Pending[], now: number) => { programmed: { items: Programmed[]; failures: string[] }; undecided: Pending[] };
  undecidedReason: (title: Pending) => string;
};

const now = Date.parse('2026-11-09T18:00:00Z');
const pending: Pending[] = [
  // Retour terrain du 09/11 : film ajouté par le propriétaire, non surveillé et sans fichier — invisible avant.
  { kind: 'movie', key: 'm42', arrId: 42, tmdbId: 1100, title: "A Dog's Perfect Christmas", date: 1, monitored: false },
  // Surveillé, sortie numérique lointaine : hors calendrier (120 jours), mais bien programmé.
  { kind: 'movie', key: 'm41', arrId: 41, tmdbId: 99, title: 'Pas encore là', date: 2, monitored: true, release: { digitalRelease: '2027-06-01T00:00:00Z' }, profileId: 5 },
  // Déjà au calendrier : jamais répété.
  { kind: 'movie', key: 'm901', arrId: 901, tmdbId: 83533, title: 'Avatar', date: 3, monitored: true },
  { kind: 'series', key: 's5', arrId: 5, tmdbId: 77, title: "L'Arène", date: 4, monitored: true, episodes: [] },
  { kind: 'series', key: 's10', arrId: 10, tmdbId: 555, title: 'Sans fichier', date: 5, monitored: false, episodes: [] },
  { kind: 'series', key: 's11', arrId: 11, tmdbId: 556, title: 'Annoncée', date: 6, monitored: true, episodes: [] },
];
const programmed = { items: [{ kind: 'movie', id: 901, title: 'Avatar', date: '2026-12-01T00:00:00Z' }, { kind: 'episode', id: 801, seriesId: 5, date: '2026-11-16T00:00:00Z' }], failures: [] as string[], movieQuality: (profileId?: number) => profileId === 5 ? '4K' : profileId === 4 ? '1080p' : undefined };

test('SEENIT-DOWNLOAD-023 aucun titre de Sonarr/Radarr invisible : Programmés ou « À décider », jamais deux fois', () => {
  const result = coverage.coverArrLibrary(programmed, pending, now);
  assert.deepEqual(result.undecided.map(title => title.key), ['m42', 's10', 's11'], 'non surveillés et série sans épisode attendu');
  assert.deepEqual(result.programmed.items.map(item => `${item.kind}:${item.id}`), ['episode:801', 'movie:901', 'movie:41'], 'film surveillé hors calendrier ajouté, trié par date');
  assert.equal(result.programmed.items.find(item => item.id === 41)?.date, '2027-06-01T00:00:00Z');
  assert.equal(result.programmed.items.find(item => item.id === 41)?.quality, '4K', 'revue Codex #933 : qualité du profil Radarr, comme au calendrier (menu 1080p/4K)');
  // Invariant : chaque titre sans fichier apparaît exactement une fois (Programmés ou À décider).
  for (const title of pending) {
    const inProgrammed = result.programmed.items.some(item => item.kind === 'movie' ? `m${item.id}` === title.key : `s${item.seriesId}` === title.key);
    const inUndecided = result.undecided.some(entry => entry.key === title.key);
    assert.ok(inProgrammed !== inUndecided, `${title.title} : visible une seule fois`);
  }
  assert.deepEqual(result.undecided.map(coverage.undecidedReason), ['Film non surveillé, sans fichier', 'Série non surveillée, sans fichier', 'Série surveillée, sans fichier']);
  // Calendrier Sonarr illisible : une série surveillée n'est jamais classée « À décider » à tort.
  const sonarrDown = coverage.coverArrLibrary({ items: [], failures: ['Sonarr'] }, pending, now);
  assert.deepEqual(sonarrDown.undecided.map(title => title.key), ['m42', 's10']);
  // Rien à ajouter : la liste Programmés est rendue telle quelle.
  assert.equal(coverage.coverArrLibrary(programmed, [], now).programmed, programmed);
  // Revue Codex #933 : « À décider » ne retire jamais sans relire les épisodes ; une série gardée reste visible.
  const rail = readFileSync('src/components/RecentImportsRail.tsx', 'utf8');
  assert.match(rail, /const outcome = await removeRecentImport\(useDownloadConfigStore\.getState\(\), item\);/);
  assert.doesNotMatch(rail, /keepAwaited/);
  assert.match(rail, /const keptVisible = undecided && outcome === 'kept';\n\s+if \(!keptVisible\) \{/);
  assert.match(rail, /keptVisible \? 'Gardée dans Sonarr · des épisodes y sont encore attendus'/);
});
