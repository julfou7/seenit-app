import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { apkDownloadCandidates, getLatestRouteApkUrl, isTrustedSeenItApkFallbackUrl, isTrustedSeenItApkUrl } from '../src/features/release/releasePolicy.ts';

// Retour terrain du 08/11 (v1.4.273) : GitHub répondait 504 sur le lien de la release par tag
// (`/releases/download/v1.4.273/…`) alors que `/releases/latest/download/…` servait le même fichier.
const TAG_URL = 'https://github.com/julfou7/seenit-app/releases/download/v1.4.273/SeenIt-v1.4.273.apk';
const LATEST_URL = 'https://github.com/julfou7/seenit-app/releases/latest/download/SeenIt-v1.4.273.apk';
const APK = Buffer.alloc(700 * 1024, 7);
const DIGEST = createHash('sha256').update(APK).digest('hex');

test('SEENIT-UPDATE-008 secours GitHub : route « latest » du même fichier, seulement si le SHA-256 officiel est connu', () => {
  assert.equal(getLatestRouteApkUrl('1.4.273'), LATEST_URL);
  assert.equal(isTrustedSeenItApkFallbackUrl(LATEST_URL, '1.4.273'), true);
  // Le secours n'est jamais un lien de dépôt ou de version arbitraire.
  assert.equal(isTrustedSeenItApkFallbackUrl(LATEST_URL.replace('julfou7', 'evil'), '1.4.273'), false);
  assert.equal(isTrustedSeenItApkFallbackUrl(`${LATEST_URL}?x=1`, '1.4.273'), false);
  assert.equal(isTrustedSeenItApkUrl(LATEST_URL, '1.4.273'), false, 'la route latest ne remplace pas le lien principal');
  assert.deepEqual(apkDownloadCandidates({ version: '1.4.273', apkDownloadUrl: TAG_URL, apkSha256: DIGEST }), [TAG_URL, LATEST_URL]);
  // Sans empreinte officielle, aucun fichier d'une autre route ne peut être prouvé identique : pas de secours.
  assert.deepEqual(apkDownloadCandidates({ version: '1.4.273', apkDownloadUrl: TAG_URL, apkSha256: null }), [TAG_URL]);
  assert.deepEqual(apkDownloadCandidates({ version: '1.4.273', apkDownloadUrl: 'https://evil.example/a.apk', apkSha256: DIGEST }), []);
});

// Vrai téléchargeur : seuls les plugins Capacitor et les services annexes sont simulés.
const bundle = await build({ entryPoints: ['src/services/appUpdater.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'updater-ports', setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/(?:core|filesystem)$|\/lib\/utils$|clientOperationalDiagnostics\.ts$|updateDownloadNotification\.ts$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === '@capacitor/core'
      ? 'export const Capacitor={isNativePlatform:()=>true};export const registerPlugin=()=>({installApk:async o=>{globalThis.__updater.installed.push(o.filePath);return {sessionId:1};}});'
      : args.path === '@capacitor/filesystem'
        ? `export const Directory={Cache:'CACHE'};export const Filesystem={
            deleteFile:async()=>{}, addListener:async()=>({remove:async()=>{}}),
            downloadFile:async o=>{globalThis.__updater.urls.push(o.url);if(globalThis.__updater.fail.includes(o.url))throw new Error('Error downloading file: '+o.url);globalThis.__updater.size=${APK.length};return {path:'/cache/SeenIt-update.apk'};},
            stat:async()=>({size:globalThis.__updater.size||0}),
            readFile:async()=>({data:globalThis.__updater.base64}),
            getUri:async()=>({uri:'file:///cache/SeenIt-update.apk'})};`
        : args.path.endsWith('utils') ? 'export const openExternalUrl=async()=>{};'
          : args.path.includes('clientOperationalDiagnostics') ? 'export const recordClientOperationalSignal=()=>{};'
            : 'export const notifyVerifiedUpdateDownload=async()=>{};' }));
  } }] });
const updater = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  downloadAndInstallApk: (release: Record<string, unknown>, onProgress?: (progress: { message: string }) => void) => Promise<{ success: boolean; error?: string }>;
};
const setup = (fail: string[]) => { (globalThis as Record<string, unknown>).__updater = { urls: [], installed: [], fail, size: 0, base64: APK.toString('base64') }; return (globalThis as Record<string, unknown>).__updater as { urls: string[]; installed: string[] }; };

test('SEENIT-UPDATE-008 GitHub en 504 sur le lien de la release : le même APK arrive par la route « latest », vérifié puis installé', async () => {
  const state = setup([TAG_URL]);
  const messages: string[] = [];
  const result = await updater.downloadAndInstallApk({ version: '1.4.273', apkDownloadUrl: TAG_URL, apkSha256: DIGEST }, progress => messages.push(progress.message));
  assert.deepEqual(result, { success: true });
  assert.deepEqual(state.urls, [TAG_URL, LATEST_URL]);
  assert.equal(state.installed.length, 1);
  assert.ok(messages.some(message => message.includes('nouvel essai par un autre lien')));
});

test('SEENIT-UPDATE-008 les deux routes en panne : message clair, aucune installation', async () => {
  const state = setup([TAG_URL, LATEST_URL]);
  const result = await updater.downloadAndInstallApk({ version: '1.4.273', apkDownloadUrl: TAG_URL, apkSha256: DIGEST });
  assert.equal(result.success, false);
  assert.match(String(result.error), /GitHub ne répond pas pour le moment/);
  assert.equal(state.installed.length, 0);
});

test('SEENIT-UPDATE-008 sans empreinte officielle, pas de secours : un seul essai, puis l’erreur', async () => {
  const state = setup([TAG_URL]);
  const result = await updater.downloadAndInstallApk({ version: '1.4.273', apkDownloadUrl: TAG_URL, apkSha256: null });
  assert.equal(result.success, false);
  assert.deepEqual(state.urls, [TAG_URL]);
  assert.equal(state.installed.length, 0);
});

test('SEENIT-UPDATE-008 un fichier de secours qui ne correspond pas au SHA-256 officiel n’est jamais installé', async () => {
  const state = setup([TAG_URL]);
  const result = await updater.downloadAndInstallApk({ version: '1.4.273', apkDownloadUrl: TAG_URL, apkSha256: 'b'.repeat(64) });
  assert.equal(result.success, false);
  assert.match(String(result.error), /SHA-256/);
  assert.equal(state.installed.length, 0);
});
