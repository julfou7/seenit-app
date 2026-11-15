import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Retour du propriétaire du 15/11 : « peut-on avoir l'espace disque libre en temps réel, à la demande ? »
const bundle = await build({ entryPoints: ['src/features/downloads/arrDiskStatus.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'ports', setup(builder) {
    builder.onResolve({ filter: /^react$|\/sonarrRadarr$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'react'
      ? 'export const useState=v=>[v,()=>{}];export const useEffect=()=>{};'
      : 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeGet=async()=>{throw new Error("réseau réel interdit")};' }));
  } }] });
const disk = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as typeof import('../src/features/downloads/arrDiskStatus.ts');
const gib = 1024 ** 3;
const config = { isHydrated: true, downloadsEnabled: true, sonarrUrl: 'http://nas:8989/', sonarrApiKey: 's', radarrUrl: 'http://nas:7878', radarrApiKey: 'r' };

test('espace disque de Sonarr/Radarr : un disque une fois, chiffres réels, lu à la demande', async () => {
  const urls: string[] = [];
  const disks = await disk.fetchDiskStatus(config, async url => {
    urls.push(url);
    return url.includes(':8989') ? [{ path: 'D:\\Series', freeSpace: 1.2 * gib, totalSpace: 515.7 * gib }] : [{ path: 'D:\\Films', freeSpace: 1.2 * gib, totalSpace: 515.7 * gib }, { path: '/data/films', freeSpace: 300 * gib }];
  });
  assert.deepEqual(urls, ['http://nas:8989/api/v3/rootfolder', 'http://nas:7878/api/v3/rootfolder']);
  assert.deepEqual(disks.map(entry => entry.label), ['D:', '/data/films'], 'même lecteur montré une fois, le plus plein d’abord');
  assert.equal(disk.describeDisk(disks[0]), '1,2 Go libres sur 515,7 Go');
  assert.deepEqual(disks.map(disk.diskTone), ['error', 'ok']);
  assert.equal(disk.diskTone({ label: 'E:', freeSpace: 5 * gib }), 'warn');
  // Une lecture en échec n'affiche rien plutôt qu'un chiffre faux ; téléchargements désactivés : rien n'est lu.
  assert.deepEqual(await disk.fetchDiskStatus(config, async () => { throw new Error('503'); }), []);
  assert.deepEqual(await disk.fetchDiskStatus({ ...config, downloadsEnabled: false }, async () => { throw new Error('jamais'); }), []);
  // L'onglet Télécharger montre un disque presque plein sous son titre.
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /const lowDisks = \(useDiskStatus\(config\) \|\| \[\]\)\.filter\(disk => diskTone\(disk\) !== 'ok'\);/);
  assert.match(screen, /lowDisks\.map\(disk => <p key=\{disk\.label\} className="downloads-disk" data-tone=\{diskTone\(disk\)\}>Disque \{disk\.label\} · \{describeDisk\(disk\)\}<\/p>\)/);
});
