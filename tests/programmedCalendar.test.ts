import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { isAllowedServiceProxyPath } from '../src/features/downloads/downloadBackendSecurity.ts';

// Vrai module du calendrier : seuls les transports et le gate sont remplacés.
const bundle = await build({ entryPoints: ['src/features/downloads/programmedCalendar.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'calendar-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|sonarrRadarrTransport|downloadFeatureVisibility)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'sonarrRadarr'
      ? 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeGet=async()=>{throw new Error("réseau réel interdit")};'
      : args.path === 'sonarrRadarrTransport' ? 'export const executePut=async()=>{throw new Error("réseau réel interdit")};'
      : 'export const isDownloadFeatureEnabled=c=>c.downloadsEnabled===true;' }));
  } }] });
type Item = { kind: string; id: number; seriesId?: number; date?: string; title?: string };
const calendar = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  fetchProgrammedCalendar: (config: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ items: Item[]; failures: string[] }>;
  programmedScope: (config: Record<string, unknown>) => string;
  unprogramItem: (config: Record<string, unknown>, item: Item, io: Record<string, unknown>) => Promise<void>;
  programmedDateLabel: (date: string | undefined, now: number) => string;
  movieRelease: (movie: Record<string, string>, now: number) => { date?: string; kind?: string; inCinemasPast: boolean };
  changeProgrammedQuality: (config: Record<string, unknown>, target: { kind: string; id: number }, preference: string, io: Record<string, unknown>) => Promise<void>;
  fetchWatchedMovie: (config: Record<string, unknown>, tmdbId: number, io: Record<string, unknown>, now: number) => Promise<Record<string, unknown> | null>;
};

const now = Date.parse('2026-11-07T12:00:00Z');
const config = { downloadsEnabled: true, sonarrUrl: 'http://sonarr/', sonarrApiKey: 's', radarrUrl: 'http://radarr', radarrApiKey: 'r' };

test('SEENIT-DOWNLOAD-013 #879 Programmés : seuls les éléments surveillés sans fichier, triés par date', async () => {
  const urls: string[] = [];
  const io = {
    get: async (url: string) => {
      urls.push(url);
      if (url.startsWith('http://sonarr/api/v3/calendar')) return [
        { id: 2, seriesId: 5, seasonNumber: 1, episodeNumber: 9, airDateUtc: '2026-11-21T20:00:00Z', monitored: true, series: { title: 'A', tmdbId: 77, monitored: true } },
        { id: 1, seriesId: 5, seasonNumber: 1, episodeNumber: 8, airDateUtc: '2026-11-14T20:00:00Z', monitored: true, hasFile: false, series: { title: 'A', tmdbId: 77, monitored: true } },
        { id: 3, seriesId: 5, seasonNumber: 1, episodeNumber: 10, airDateUtc: '2026-11-28T20:00:00Z', monitored: false, series: { monitored: true } },
        { id: 4, seriesId: 6, seasonNumber: 1, episodeNumber: 1, airDateUtc: '2026-11-10T20:00:00Z', monitored: true, series: { monitored: false } },
        { id: 5, seriesId: 6, seasonNumber: 1, episodeNumber: 2, airDateUtc: '2026-11-11T20:00:00Z', monitored: true, hasFile: true, series: { monitored: true } }
      ];
      if (url.startsWith('http://radarr/api/v3/calendar')) return [
        { id: 9, title: 'Film', tmdbId: 83533, monitored: true, hasFile: false, inCinemas: '2026-10-01', digitalRelease: '2026-12-17' },
        { id: 10, title: 'Déjà là', monitored: true, hasFile: true }
      ];
      if (url.includes('/api/v3/wanted/missing')) return { page: 1, records: [] };
      throw new Error(url);
    },
    put: async () => undefined
  };
  const result = await calendar.fetchProgrammedCalendar(config, { now, io });
  assert.deepEqual(result.items.map(item => `${item.kind}:${item.id}`), ['episode:1', 'episode:2', 'movie:9']);
  assert.equal(result.items[2].date, '2026-12-17', 'la sortie future la plus proche, pas le cinéma passé');
  assert.deepEqual(result.failures, []);
  assert.ok(urls.filter(url => url.includes('/calendar')).every(url => url.includes('unmonitored=false')));
  // En PWA, le calendrier passe par le proxy serveur : chaque URL émise doit y être acceptée.
  assert.ok(urls.every(url => isAllowedServiceProxyPath(url, 'GET')), urls.join(' '));
  // Panne d'une source : signalée, jamais confondue avec « rien de programmé ».
  const down = await calendar.fetchProgrammedCalendar(config, { now, io: { ...io, get: async (url: string) => { if (url.startsWith('http://sonarr')) throw new Error('503'); return io.get(url); } } });
  assert.deepEqual([down.failures, down.items.map(item => item.id)], [['Sonarr'], [9]]);
  // Page de connexion HTML d'un proxy (HTTP 200) : panne, pas calendrier vide.
  const html = await calendar.fetchProgrammedCalendar(config, { now, io: { ...io, get: async () => '<html>login</html>' } });
  assert.deepEqual([...html.failures].sort(), ['Radarr', 'Sonarr']);
  // Téléchargements désactivés : aucun appel.
  urls.length = 0;
  assert.deepEqual((await calendar.fetchProgrammedCalendar({ ...config, downloadsEnabled: false }, { now, io })).items, []);
  assert.equal(urls.length, 0);
});

test('SEENIT-DOWNLOAD-013 #879 Annuler une programmation retire seulement la surveillance', async () => {
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const gets: string[] = [];
  const io = { get: async (url: string) => { gets.push(url); return { id: Number(url.split('/').pop()), monitored: true, title: 'x' }; }, put: async (url: string, body: Record<string, unknown>) => { puts.push({ url, body }); } };
  await calendar.unprogramItem(config, { kind: 'episode', id: 801, seriesId: 5 }, io);
  await calendar.unprogramItem(config, { kind: 'movie', id: 9 }, io);
  assert.deepEqual(puts.map(put => [put.url, put.body.monitored, put.body.title]), [['http://sonarr/api/v3/episode/801', false, 'x'], ['http://radarr/api/v3/movie/9', false, 'x']]);
  assert.ok(gets.every(url => isAllowedServiceProxyPath(url, 'GET')) && puts.every(put => isAllowedServiceProxyPath(put.url, 'PUT')), 'déprogrammer passe le proxy PWA');
  await assert.rejects(calendar.unprogramItem({ ...config, downloadsEnabled: false }, { kind: 'movie', id: 9 }, io));
  assert.equal(calendar.programmedDateLabel(undefined, now), 'Date à venir');
  assert.equal(calendar.programmedDateLabel('2026-11-08T12:00:00Z', now), 'Demain');
  // La liste est liée au serveur qui l'a fournie : une autre URL ou clé change la portée.
  assert.notEqual(calendar.programmedScope(config), calendar.programmedScope({ ...config, sonarrUrl: 'http://autre' }));
  assert.equal(calendar.programmedScope(config), calendar.programmedScope({ ...config, sonarrUrl: 'http://sonarr' }));
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  // SEENIT-DOWNLOAD-016 : la liste vient de l'état Sonarr/Radarr synchronisé, lié au compte et au serveur.
  assert.match(section, /if \(useArrSyncStore\.getState\(\)\.snapshot\?\.key === arrSyncKey\(\)\) return true;/, 'Annuler refuse une portée changée');
  assert.match(section, /useEffect\(\(\) => \{ void useArrSyncStore\.getState\(\)\.sync\(\); \}, \[refreshKey, scope\]\);/, 'resynchronisée quand la portée change');
  assert.match(readFileSync('src/store/arrSyncStore.ts', 'utf8'), /if \(arrSyncKey\(\) !== key \|\| id !== sequence\) return;/, 'réponse d’une ancienne portée ignorée');
  assert.match(section, /else series\.set\(item\.seriesId, /, 'groupé par identifiant Sonarr exact, jamais par titre');
});

// Retour terrain du 08/11 sur la v1.4.280 : qualité affichée, menu ⋯ « changer la qualité », date d'un film
// selon la sortie dont il s'agit (« Le Chat Chapeauté » : déjà au cinéma, numérique pas encore annoncé).
test('SEENIT-DOWNLOAD-015 Programmés : qualité réelle, sortie numérique distinguée du cinéma, qualité modifiable', async () => {
  const profiles = [{ id: 4, name: 'HD-1080p' }, { id: 5, name: 'Ultra-HD' }, { id: 6, name: 'Any' }];
  const io = {
    get: async (url: string) => {
      if (url.endsWith('/api/v3/qualityprofile')) return profiles;
      if (url.startsWith('http://sonarr/api/v3/calendar')) return [{ id: 1, seriesId: 5, seasonNumber: 1, episodeNumber: 8, airDateUtc: '2026-11-14T20:00:00Z', monitored: true, series: { title: 'A', tmdbId: 77, monitored: true, qualityProfileId: 4 } }];
      if (url.startsWith('http://radarr/api/v3/calendar')) return [
        { id: 9, title: 'Avant le cinéma', tmdbId: 1, monitored: true, qualityProfileId: 5, inCinemas: '2026-11-20', digitalRelease: '2027-01-20' },
        { id: 10, title: 'Cinéma seul', tmdbId: 2, monitored: true, qualityProfileId: 6, inCinemas: '2026-12-09' }];
      if (url.startsWith('http://radarr/api/v3/movie?tmdbId=3')) return [{ id: 30, tmdbId: 3, qualityProfileId: 4, inCinemas: '2026-11-04' }];
      if (url.startsWith('http://radarr/api/v3/movie?tmdbId=')) return [];
      if (url.includes('/api/v3/wanted/missing')) return { page: 1, records: [] };
      throw new Error(url);
    },
    put: async () => undefined
  };
  const { items } = await calendar.fetchProgrammedCalendar(config, { now, io });
  assert.deepEqual(items.map(item => [item.id, (item as Record<string, unknown>).quality, item.date, (item as Record<string, unknown>).dateKind]), [
    [1, '1080p', '2026-11-14T20:00:00Z', undefined],
    [10, 'Any', '2026-12-09', 'cinema'],
    [9, '4K', '2027-01-20', 'digital'],
  ], 'la date utile est la sortie numérique, pas la salle ; le profil inconnu garde son nom');
  assert.deepEqual(calendar.movieRelease({ inCinemas: '2026-11-04' }, now), { date: undefined, kind: undefined, inCinemasPast: true });
  // Film suivi absent du calendrier : déjà au cinéma, sans date numérique ; un film inconnu de Radarr rend null.
  assert.deepEqual(await calendar.fetchWatchedMovie(config, 3, io, now), { id: 30, date: undefined, dateKind: undefined, inCinemasPast: true, quality: '1080p' });
  assert.equal(await calendar.fetchWatchedMovie(config, 404, io, now), null);
  // Changer la qualité : le profil 4K de SeenIt (explicite d'abord, sinon déduit) sur le film ou la série.
  const puts: Array<[string, unknown]> = [];
  const change = { get: async (url: string) => url.endsWith('/qualityprofile') ? profiles : { id: 9, qualityProfileId: 4, title: 'x' }, put: async (url: string, body: { qualityProfileId: number }) => { puts.push([url, body.qualityProfileId]); } };
  await calendar.changeProgrammedQuality(config, { kind: 'movie', id: 9 }, '4k', change);
  await calendar.changeProgrammedQuality({ ...config, sonarr1080pProfileId: 6 }, { kind: 'series', id: 5 }, '1080p', change);
  await calendar.changeProgrammedQuality(config, { kind: 'movie', id: 9 }, '1080p', change);
  assert.deepEqual(puts, [['http://radarr/api/v3/movie/9', 5], ['http://sonarr/api/v3/series/5', 6]], 'profil déjà en place : aucune écriture');
  assert.ok(puts.every(([url]) => isAllowedServiceProxyPath(url, 'PUT')) && isAllowedServiceProxyPath('http://radarr/api/v3/movie?tmdbId=3', 'GET') && isAllowedServiceProxyPath('http://radarr/api/v3/qualityprofile', 'GET'), 'passe le proxy PWA');
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /const items = \(snapshot\?\.programmed\?\.items \|\| \[\]\)/, 'bug d’affichage du 08/11 : la copie synchronisée reste affichée à la réouverture');
  assert.match(section, /notifyArrWrite\(media\);/, 'changer la qualité resynchronise l’état et la fiche');
});

// Décision du propriétaire du 09/11 (« pourquoi je ne vois pas tous ces films ») : ce que Sonarr/Radarr cherchent
// encore — surveillé, déjà sorti, sans fichier — figure dans Programmés, marqué « recherché ».
test('SEENIT-DOWNLOAD-020 Programmés : les recherchés (wanted/missing) rejoignent la liste, sans doublon, après les sorties à venir', async () => {
  const urls: string[] = [];
  const io = {
    get: async (url: string) => {
      urls.push(url);
      if (url.endsWith('/api/v3/qualityprofile')) return [];
      if (url.startsWith('http://sonarr/api/v3/calendar')) return [{ id: 1, seriesId: 5, seasonNumber: 2, episodeNumber: 3, airDateUtc: '2026-11-14T20:00:00Z', monitored: true, series: { title: 'A', tmdbId: 77, monitored: true } }];
      if (url.startsWith('http://sonarr/api/v3/wanted/missing')) return { page: 1, totalRecords: 4, records: [
        { id: 7, seriesId: 5, seasonNumber: 2, episodeNumber: 1, airDateUtc: '2026-10-31T20:00:00Z', monitored: true, hasFile: false, series: { title: 'A', tmdbId: 77, monitored: true } },
        { id: 8, seriesId: 5, seasonNumber: 2, episodeNumber: 2, airDateUtc: '2026-11-06T20:00:00Z', monitored: true, series: { title: 'A', tmdbId: 77, monitored: true } },
        { id: 1, seriesId: 5, seasonNumber: 2, episodeNumber: 3, airDateUtc: '2026-11-14T20:00:00Z', monitored: true, series: { title: 'A', tmdbId: 77, monitored: true } },
        { id: 9, seriesId: 6, seasonNumber: 1, episodeNumber: 1, airDateUtc: '2026-11-01T20:00:00Z', monitored: true, series: { title: 'B', monitored: false } }
      ] };
      if (url.startsWith('http://radarr/api/v3/calendar')) return [];
      if (url.startsWith('http://radarr/api/v3/wanted/missing')) return { page: 1, records: [
        { id: 40, title: 'Blade Runner 2049', tmdbId: 335984, monitored: true, hasFile: false, isAvailable: true, inCinemas: '2017-10-04', digitalRelease: '2018-01-16' },
        { id: 41, title: 'Le Chat Chapeauté', tmdbId: 1234, monitored: true, hasFile: false, isAvailable: false, inCinemas: '2026-11-04' },
        { id: 42, title: 'Annoncé', tmdbId: 55, monitored: true, hasFile: false, isAvailable: false, digitalRelease: '2027-06-01' },
        { id: 43, title: 'Déjà là', monitored: true, hasFile: true, isAvailable: true }
      ] };
      throw new Error(url);
    },
    put: async () => undefined
  };
  const { items, failures } = await calendar.fetchProgrammedCalendar(config, { now, io });
  assert.deepEqual(failures, []);
  const flags = (item: Record<string, unknown>) => `${item.kind}:${item.id}${item.wanted ? ':recherché' : ''}${item.inCinemasPast ? ':salle' : ''}`;
  assert.deepEqual(items.map(item => flags(item as unknown as Record<string, unknown>)), ['episode:1', 'movie:42', 'episode:8:recherché', 'episode:7:recherché', 'movie:40:recherché', 'movie:41:salle'],
    'à venir par date, puis recherchés du plus récent au plus ancien ; une série non surveillée et un film présent sont exclus');
  assert.ok(urls.includes('http://sonarr/api/v3/wanted/missing?page=1&pageSize=100&monitored=true&includeSeries=true&sortKey=episodes.airDateUtc&sortDirection=descending'));
  assert.ok(urls.includes('http://radarr/api/v3/wanted/missing?page=1&pageSize=100&monitored=true'));
  assert.ok(urls.every(url => isAllowedServiceProxyPath(url, 'GET')), 'lecture acceptée par le proxy PWA');
  // Une page wanted illisible est une panne de la source, jamais « rien de recherché » ; revue Codex #923 : le
  // calendrier lu correctement reste affiché (les sorties à venir ne disparaissent pas).
  for (const broken of [async () => '<html>login</html>', async () => { throw new Error('504'); }]) {
    const partial = await calendar.fetchProgrammedCalendar(config, { now, io: { ...io, get: async (url: string) => url.includes('wanted/missing') ? broken() : io.get(url) } });
    assert.deepEqual([...partial.failures].sort(), ['Radarr', 'Sonarr']);
    assert.deepEqual(partial.items.map(item => `${item.kind}:${item.id}`), ['episode:1'], 'calendrier conservé, recherchés absents');
  }
  // Et l'inverse : calendrier en panne, recherchés lus.
  const noCalendar = await calendar.fetchProgrammedCalendar(config, { now, io: { ...io, get: async (url: string) => url.includes('/calendar') ? Promise.reject(new Error('503')) : io.get(url) } });
  assert.deepEqual([[...noCalendar.failures].sort(), noCalendar.items.length], [['Radarr', 'Sonarr'], 6]);
});

test('SEENIT-DOWNLOAD-020 Programmés : vue compacte par défaut, détaillée au choix, mémorisée par compte', () => {
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /useState<ProgrammedLayout>\(\(\) => readUserScopedJson<ProgrammedLayout>\(auth\.currentUser\?\.uid, LAYOUT_FIELD, 'compact'\) === 'detailed' \? 'detailed' : 'compact'\)/, 'compact par défaut, relu par compte');
  assert.match(section, /const switchLayout = \(next: ProgrammedLayout\) => \{ setLayout\(next\); writeUserScopedJson\(auth\.currentUser\?\.uid, LAYOUT_FIELD, next\); \};/, 'choix mémorisé par compte');
  assert.match(section, /aria-label="Programmés en compact" aria-pressed=\{compact\}/);
  assert.match(section, /aria-label="Programmés en détaillé" aria-pressed=\{!compact\}/);
  assert.match(section, /\{card\.episodes && expanded\.has\(card\.key\) && card\.episodes\.rows\}/, 'compact : épisodes repliés jusqu’au chevron');
  assert.match(section, /item\.wanted \? `Sorti \$\{pastDayLabel\(item\.date\)\} · recherché` : programmedDateLabel\(item\.date\)/, 'un recherché dit sa vraie date de sortie');
  assert.match(readFileSync('src/screens/downloads.css', 'utf8'), /\.programmed-compact__title \{[^}]*overflow-wrap:anywhere/, 'titre entier en compact');
  // Retour terrain du 09/11 : « supprime Sonarr et Radarr sous le titre, y a pas besoin ».
  assert.match(section, /meta: meta\('Série', first\.quality, /);
  assert.match(section, /meta: meta\('Film', movie\.quality\)/);
  assert.match(section, /meta: meta\(requestScope\(entry\), quality\)/);
  assert.doesNotMatch(section, /'(?:Série|Film) · (?:Sonarr|Radarr)'|isTv \? 'Sonarr' : 'Radarr', quality/);
});
