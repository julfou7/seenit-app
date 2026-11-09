import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { seasonBlanketPlan } from '../src/features/downloads/sonarrSeasonMonitoring.ts';
import { frenchArrMessage, frenchArrMessages, isStalledWithoutSources } from '../src/features/downloads/arrStatusMessages.ts';

// Retours terrain du 08/11 sur la v1.4.280 (MobLand, Harry Potter, « Le Chat Chapeauté ») et question du
// propriétaire : « ça serait pas mieux de synchroniser Sonarr et Radarr plutôt que de bricoler un truc à moitié
// synchronisé ? ».
const read = (path: string) => readFileSync(path, 'utf8');
const now = Date.parse('2026-11-08T20:00:00Z');

test('SEENIT-DOWNLOAD-017 un épisode précis ne laisse pas sa saison surveillée en bloc (MobLand : E09 seul, pas E10)', () => {
  const series = { id: 7, seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: true }] };
  const episodes = [
    { id: 205, seasonNumber: 2, episodeNumber: 5, monitored: true, hasFile: false, airDateUtc: '2026-10-20T20:00:00Z' },
    { id: 208, seasonNumber: 2, episodeNumber: 8, monitored: true, hasFile: true, airDateUtc: '2026-11-06T20:00:00Z' },
    { id: 209, seasonNumber: 2, episodeNumber: 9, monitored: true, hasFile: false, airDateUtc: '2026-11-13T20:00:00Z' },
    { id: 210, seasonNumber: 2, episodeNumber: 10, monitored: true, hasFile: false, airDateUtc: '2026-11-20T20:00:00Z' },
    { id: 211, seasonNumber: 2, episodeNumber: 11, monitored: true, hasFile: false },
  ];
  const plan = seasonBlanketPlan(series, 2, episodes, [9], now);
  assert.deepEqual(plan.seasons, [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: false }], 'seule la saison visée cesse d’être surveillée en bloc');
  assert.deepEqual(plan.restore.map(entry => entry.episodeNumber), [5, 9], 'demandé + déjà sorti sans fichier ; E10 et E11 (à venir, non demandés) ne sont plus programmés');
  assert.deepEqual(seasonBlanketPlan({ seasons: [{ seasonNumber: 2, monitored: false }] }, 2, episodes, [9], now), { seasons: null, restore: [] }, 'saison déjà suivie épisode par épisode : rien ne change');
  assert.deepEqual(seasonBlanketPlan(null, 2, episodes, [9], now), { seasons: null, restore: [] });
  // Revue Codex #918 : liste des épisodes illisible (vide) ou sans la saison visée → la saison n'est pas touchée.
  assert.deepEqual(seasonBlanketPlan(series, 2, [], [9], now), { seasons: null, restore: [] }, 'liste illisible : rien n’est désurveillé');
  assert.deepEqual(seasonBlanketPlan(series, 2, episodes.map(entry => ({ ...entry, seasonNumber: 3 })), [9], now), { seasons: null, restore: [] });
  const search = read('src/services/sonarrRadarrSearch.ts');
  assert.match(search, /monitored: \(!isEpisodeSearch && !isSeasonSearch\) \|\| \(isSeasonSearch && Number\(s\.seasonNumber\) === Number\(params\.season\)\)\n/, 'série ajoutée pour un épisode : saison non surveillée');
  assert.match(search, /const plan = seasonBlanketPlan\(existingSeries, Number\(params\.season\)[\s\S]{0,900}targetEp\.monitored = false;\n\s+\}\n\s+await ensureEpisodeMonitored\(targetEp\);/, 'série existante : même règle avant de surveiller l’épisode téléchargé');
});

test('SEENIT-DOWNLOAD-013 messages du client en français, transfert sans source = attente, pas une panne', () => {
  assert.equal(frenchArrMessage('The download is stalled with no connections'), 'Aucune source connectée pour l’instant');
  assert.equal(frenchArrMessage('Found matching series via grab history, but release was matched to series by ID. Automatic import is not possible.'), 'Import manuel requis');
  assert.equal(frenchArrMessage('No files found are eligible for import in /downloads/x'), 'Aucun fichier importable dans ce téléchargement');
  assert.equal(frenchArrMessage('Something unexpected happened with the release'), 'Le client de téléchargement signale un problème', 'anglais inconnu : jamais affiché tel quel');
  assert.equal(frenchArrMessage('Disque plein : espace de stockage insuffisant'), 'Disque plein : espace de stockage insuffisant', 'déjà français : gardé');
  assert.equal(frenchArrMessages(['Not an upgrade for existing movie file', 'not an upgrade']), 'Pas une amélioration de la version déjà présente');
  assert.equal(isStalledWithoutSources(['The download is stalled with no connections']), true);
  assert.equal(isStalledWithoutSources(['The download is stalled with no connections', 'Sample']), false);
  const live = read('src/services/sonarrRadarrLive.ts');
  assert.match(live, /if \(!isTrackedError && !isFailed && isStalledWithoutSources\(statusMsgs\)\) \{\n\s+return \{ status: 'stalled', statusText: 'En attente de sources' \};/);
  assert.match(live, /t\.state === 'stalledDL' \? 'stalled'/, 'qBittorrent bloqué : en attente, pas « à régler »');
  assert.match(live, /errorMessage = frenchArrMessages\(statusMsgs\);/);
  const card = read('src/components/DownloadItemCard.tsx');
  assert.match(card, /item\.status === 'stalled' \? 'En attente de sources'/);
  assert.match(card, /\(terminal \|\| item\.status === 'stalled'\) && <button type="button" onClick=\{\(\) => setChoosingRelease\(true\)\}>/, 'une autre version reste possible depuis ⋯');
  assert.match(read('src/features/downloads/downloadGroups.ts'), /hint: frenchArrMessage\(message\) \|\|/);
});

test('SEENIT-DOWNLOAD-016 un seul état Sonarr/Radarr synchronisé : relu en un endroit, après chaque écriture, jamais d’une autre portée', async () => {
  const stubs: Record<string, string> = {
    'lib/firebase': 'const s=()=>globalThis.__arr;export const auth={get currentUser(){return {uid:s().uid}}};',
    'store/downloadConfigStore': 'const s=()=>globalThis.__arr;export const useDownloadConfigStore=Object.assign(()=>s().config,{getState:()=>s().config});',
    'store/mediaPresenceStore': 'const s=()=>globalThis.__arr;export const useMediaPresenceStore={getState:()=>({checkPresence:async p=>{s().presence.push(p.tmdbId+":"+p.forceRefresh)}})};',
    'features/downloads/programmedCalendar': 'const s=()=>globalThis.__arr;export const programmedScope=c=>c.sonarrUrl;export const fetchProgrammedCalendar=async c=>{s().reads.push(c.sonarrUrl);const r=s().next.shift();return r?await r:{items:[{id:1,from:c.sonarrUrl}],failures:[]}};export const fetchWatchedMovie=async(c,id)=>{s().watchedReads.push(c.sonarrUrl+":"+id);return {id:id*10,server:c.sonarrUrl}};',
    'features/downloads/recentImports': 'export const fetchRecentImports=async()=>({items:[],failures:[]});',
    'features/downloads/arrMediaSource': 'export const tmdbArrLabelSource={media:async()=>null,episodes:async()=>null};',
  };
  const bundle = await build({ entryPoints: ['src/store/arrSyncStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false, external: ['zustand', 'react'],
    plugins: [{ name: 'arr-ports', setup(builder) {
      builder.onResolve({ filter: /lib\/firebase$|downloadConfigStore$|mediaPresenceStore$|programmedCalendar$|recentImports$|arrMediaSource$/ }, args => ({ path: Object.keys(stubs).find(key => args.path.endsWith(key.split('/').at(-1)!))!, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: stubs[args.path] }));
    } }] });
  const state = (globalThis as unknown as { __arr: { uid: string; config: { sonarrUrl: string }; reads: string[]; watchedReads: string[]; presence: string[]; next: Array<Promise<unknown>> } }).__arr = { uid: 'u1', config: { sonarrUrl: 'http://a' }, reads: [], watchedReads: [], presence: [], next: [] };
  const file = new URL(`./.arr-sync-${process.pid}.mjs`, import.meta.url);
  writeFileSync(file, bundle.outputFiles[0].text);
  let store: { useArrSyncStore: { getState: () => { sync: (o?: { maxAgeMs?: number }) => Promise<void>; afterWrite: (t?: unknown) => void; watchMovies: (ids: number[]) => void; snapshot: { key: string; programmed: { items: Array<{ from: string }> }; watched: Record<number, { id: number; server: string }> } | null; revision: number } } };
  try { store = await import(file.href); } finally { rmSync(file, { force: true }); }
  const sync = store.useArrSyncStore.getState;
  await Promise.all([sync().sync(), sync().sync()]);
  assert.equal(state.reads.length, 1, 'deux écrans à l’ouverture : une seule lecture');
  assert.equal(sync().snapshot?.programmed.items[0].from, 'http://a');
  await sync().sync({ maxAgeMs: 60_000 });
  assert.equal(state.reads.length, 1, 'copie récente réutilisée');
  // Une lecture lancée avant une écriture est dépassée par celle qui suit l'écriture.
  let release!: (value: unknown) => void;
  state.next.push(new Promise(resolve => { release = resolve; }));
  const stale = sync().sync();
  sync().afterWrite({ tmdbId: 77, mediaType: 'tv' });
  await new Promise(resolve => setTimeout(resolve, 0));
  release({ items: [{ id: 9, from: 'avant écriture' }], failures: [] });
  await stale;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sync().snapshot?.programmed.items[0].from, 'http://a', 'la réponse d’avant l’écriture ne remplace pas la nouvelle');
  assert.deepEqual(state.presence, ['77:true'], 'la fiche concernée relit sa présence');
  assert.equal(sync().revision, 1);
  // Revue Codex #918 : un film suivi fait partie de la copie, relu à chaque synchronisation.
  sync().watchMovies([3]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(sync().snapshot?.watched[3], { id: 30, server: 'http://a' });
  await sync().sync();
  assert.equal(state.watchedReads.filter(entry => entry === 'http://a:3').length, 2, 'relu à la synchronisation ordinaire');
  // Autre serveur : l'ancienne copie (et ses identifiants Radarr) n'est jamais montrée.
  state.config = { sonarrUrl: 'http://b' };
  const switching = sync().sync();
  assert.equal(sync().snapshot, null);
  await switching;
  assert.equal(sync().snapshot?.programmed.items[0].from, 'http://b');
  assert.deepEqual(sync().snapshot?.watched[3], { id: 30, server: 'http://b' }, 'détails relus sur le nouveau serveur');

  const programmed = read('src/components/ProgrammedSection.tsx');
  assert.doesNotMatch(programmed, /fetchProgrammedCalendar\(/, 'Programmés ne lit plus Sonarr/Radarr lui-même');
  assert.match(programmed, /const snapshot = useArrSnapshot\(\);/);
  assert.doesNotMatch(programmed, /fetchWatchedMovie\(/, 'films suivis lus dans la copie synchronisée (revue Codex #918)');
  assert.match(programmed, /const watchedMovies: Record<number, WatchedMovie> = snapshot\?\.watched \|\| \{\};/);
  assert.match(programmed, /notifyArrWrite\(\{ tmdbId: first\.tmdbId, tvdbId: first\.kind === 'episode' \? first\.tvdbId : undefined, mediaType: first\.kind === 'movie' \? 'movie' : 'tv' \}\);/, 'annuler resynchronise la fiche (épisode à nouveau sélectionnable)');
  const rail = read('src/components/RecentImportsRail.tsx');
  assert.doesNotMatch(rail, /fetchRecentImports\(/, 'Téléchargés ne lit plus Sonarr/Radarr lui-même');
  assert.match(rail, /const snapshot = useArrSnapshot\(\);/);
  const view = read('src/screens/ShowDetailView.tsx');
  assert.equal((view.match(/notifyArrWrite\(\);/g) || []).length, 3, 'programmer un film, l’annuler et programmer des épisodes resynchronisent');
  assert.match(read('src/components/EpisodeProgramCard.tsx'), /notifyArrWrite\(\{ tmdbId, tvdbId, mediaType: 'tv' \}\);/);
});

test('SEENIT-DOWNLOAD-018 fiche épisode : programmer ou annuler le téléchargement d’un épisode à venir', () => {
  const modal = read('src/screens/EpisodeDetailModalCore.tsx');
  assert.match(modal, /<EpisodeProgramCard title=\{tmdbShowTitle \|\| activeShow\?\.title \|\| ''\} tmdbId=\{tmdbShowId \|\| activeShow\?\.tmdbId\}/);
  assert.ok(modal.indexOf('<EpisodeProgramCard') > modal.indexOf('{isFutureEpisode ? <>'), 'seulement pour un épisode à venir');
  const card = read('src/components/EpisodeProgramCard.tsx');
  assert.match(card, /if \(!available \|\| !tmdbId \|\| presence\.episodesHasFile\?\.\[key\]\) return null;/, 'réglage Téléchargements et Sonarr requis ; rien si le fichier est là');
  assert.match(card, /programArrEpisodes\(\{ title, tmdbId, tvdbId, imdbId, season, episodes: \[episode\], qualityPreference: quality, readConfig \}\)/, 'même écriture que le mode téléchargement, cet épisode seul');
  assert.match(card, /unprogramArrEpisode\(\{ title, tmdbId, tvdbId, imdbId, season, episode, readConfig \}\)/);
  assert.match(card, /className="flex-1 min-h-11 rounded-xl/, 'boutons 1080p/4K de 44 px');
  // Fiche série : l'épisode suivant n'est plus entouré, « Programmé » tient sur sa vignette, cloche bleue.
  const rows = read('src/screens/mediaDetail/seriesSections.tsx');
  assert.doesNotMatch(rows, /isNext \|\| picked \?/);
  assert.match(read('src/screens/mediaDetail/downloadMode.tsx'), /state === 'programmed' \? 'left-1 right-1 px-1 text-center text-\[9\.5px\] whitespace-nowrap/);
  const bell = read('src/components/EpisodeReminderBell.tsx');
  // Retour terrain du 09/11 : la cloche reste en or ; c'est le mode téléchargement qui est bleu (SEENIT-DOWNLOAD-019).
  assert.match(bell, /reminder \? 'bg-\[#E5A93D\] text-black' : idle/);
});
