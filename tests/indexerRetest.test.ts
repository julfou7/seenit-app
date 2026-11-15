import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { isAllowedServiceProxyPath } from '../src/features/downloads/downloadBackendSecurity.ts';

// Retour du propriétaire du 15/11 (v1.4.318) : « pour les erreurs d'indexers, impossible de fix depuis SeenIt ? »
const bundle = await build({ entryPoints: ['src/features/downloads/indexerRetest.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|sonarrRadarrTransport)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");const no=async()=>{throw new Error("réseau réel interdit")};export const executeGet=no;export const executePost=no;' }));
  } }] });
const retest = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as typeof import('../src/features/downloads/indexerRetest.ts');
const now = Date.parse('2026-11-15T19:00:00Z');
const config = { sonarrUrl: 'http://nas:8989/', sonarrApiKey: 's', radarrUrl: 'http://nas:7878', radarrApiKey: 'r' };

test('retester les indexers : test lancé, indexers encore en échec nommés, aucun réglage modifié', async () => {
  const calls: string[] = [];
  const io = (disabled: Array<{ indexerId: number; disabledTill: string }>) => ({
    post: async (url: string) => { calls.push(`POST ${url}`); throw new Error('400'); },
    get: async (url: string) => { calls.push(`GET ${url}`); return url.endsWith('/indexer') ? [{ id: 1, name: 'C411 (Prowlarr)' }, { id: 2, name: 'YggAPI (Prowlarr)' }] : disabled; },
  });
  const failing = await retest.retestIndexers(config, 'tv', io([{ indexerId: 2, disabledTill: '2026-11-15T21:00:00Z' }, { indexerId: 1, disabledTill: '2026-11-15T18:00:00Z' }]), now);
  assert.deepEqual(calls, ['POST http://nas:8989/api/v3/indexer/testall', 'GET http://nas:8989/api/v3/indexer', 'GET http://nas:8989/api/v3/indexerstatus']);
  assert.ok(calls.every(call => isAllowedServiceProxyPath(call.split(' ')[1], call.split(' ')[0])), 'appels acceptés par le proxy PWA');
  assert.equal(retest.describeIndexerRetest(failing).text, 'Toujours en échec : YggAPI (Prowlarr). À vérifier dans Prowlarr ou dans Sonarr.');
  const fixed = await retest.retestIndexers(config, 'movie', io([]), now);
  assert.deepEqual(retest.describeIndexerRetest(fixed), { text: 'Indexers réactivés : relance la recherche.', ok: true });
  assert.ok(!isAllowedServiceProxyPath('http://nas:8989/api/v3/indexer/1', 'PUT'), 'aucun réglage d’indexer modifiable');
  // Bouton visible seulement sur une carte « À régler » qui parle d'indexers.
  const card = readFileSync('src/components/DownloadItemCard.tsx', 'utf8');
  assert.match(card, /toFix && onTestIndexers && \/indexer\/i\.test\(/);
  assert.match(readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8'), /onTestIndexers=\{\(\) => void handleTestIndexers\(item\)\}/);
});
