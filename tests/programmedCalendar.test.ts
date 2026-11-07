import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

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
      throw new Error(url);
    },
    put: async () => undefined
  };
  const result = await calendar.fetchProgrammedCalendar(config, { now, io });
  assert.deepEqual(result.items.map(item => `${item.kind}:${item.id}`), ['episode:1', 'episode:2', 'movie:9']);
  assert.equal(result.items[2].date, '2026-12-17', 'la sortie future la plus proche, pas le cinéma passé');
  assert.deepEqual(result.failures, []);
  assert.ok(urls.every(url => url.includes('unmonitored=false')));
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
  const io = { get: async (url: string) => ({ id: Number(url.split('/').pop()), monitored: true, title: 'x' }), put: async (url: string, body: Record<string, unknown>) => { puts.push({ url, body }); } };
  await calendar.unprogramItem(config, { kind: 'episode', id: 801, seriesId: 5 }, io);
  await calendar.unprogramItem(config, { kind: 'movie', id: 9 }, io);
  assert.deepEqual(puts.map(put => [put.url, put.body.monitored, put.body.title]), [['http://sonarr/api/v3/episode/801', false, 'x'], ['http://radarr/api/v3/movie/9', false, 'x']]);
  await assert.rejects(calendar.unprogramItem({ ...config, downloadsEnabled: false }, { kind: 'movie', id: 9 }, io));
  assert.equal(calendar.programmedDateLabel(undefined, now), 'Date à venir');
  assert.equal(calendar.programmedDateLabel('2026-11-08T12:00:00Z', now), 'Demain');
  // La liste est liée au serveur qui l'a fournie : une autre URL ou clé change la portée.
  assert.notEqual(calendar.programmedScope(config), calendar.programmedScope({ ...config, sonarrUrl: 'http://autre' }));
  assert.equal(calendar.programmedScope(config), calendar.programmedScope({ ...config, sonarrUrl: 'http://sonarr' }));
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /if \(programmedScope\(config\) !== loadedScope\.current\) \{/, 'Annuler refuse une portée changée');
  assert.match(section, /useEffect\(\(\) => \{ void load\(\); \}, \[load, refreshKey, scope\]\);/, 'rechargée quand la portée change');
  assert.match(section, /if \(id !== request\.current \|\| programmedScope\(useDownloadConfigStore\.getState\(\)\) !== at\) return;/, 'réponse d’une ancienne portée ignorée');
  assert.match(section, /else series\.set\(item\.seriesId, /, 'groupé par identifiant Sonarr exact, jamais par titre');
});
