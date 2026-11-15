import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// #403 — retour du 15/11 : « la météo, je voulais Plex, Sonarr, Radarr etc., toutes les intégrations ».
const bundle = await build({ entryPoints: ['src/features/settings/integrationHealth.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'ports', setup(builder) {
    builder.onResolve({ filter: /^react$|\/(?:sonarrRadarrTransport|c411)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'react'
      ? 'export const useState=v=>[typeof v==="function"?v():v,()=>{}];export const useEffect=()=>{};'
      : 'export const testServiceConnection=async()=>{throw new Error("réseau réel interdit")};export const testC411Connection=testServiceConnection;' }));
  } }] });
const health = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as typeof import('../src/features/settings/integrationHealth.ts');

const config = { isHydrated: true, downloadsEnabled: true, sonarrUrl: 'http://nas:8989', sonarrApiKey: 's', radarrUrl: 'http://nas:7878', radarrApiKey: 'r', qbittorrentUrl: 'http://nas:8080', qbittorrentUsername: 'u', qbittorrentPassword: 'p', c411ApiKey: '' };

test('#403 météo : une ligne par intégration configurée, testée pour de vrai, jamais « OK » par défaut', async () => {
  assert.deepEqual(health.configuredIntegrations(config), ['sonarr', 'radarr', 'qbittorrent'], 'C411 non configuré : pas de ligne');
  assert.deepEqual(health.configuredIntegrations({ ...config, downloadsEnabled: false }), [], 'Téléchargements désactivés : aucune ligne');
  const calls: string[] = [];
  const results = await health.probeIntegrations(config, {
    service: async (type, url, apiKey, username) => { calls.push(`${type}:${url}:${apiKey || username}`); if (type === 'radarr') throw new Error('ECONNREFUSED'); return { success: type === 'sonarr' }; },
    c411: async () => ({ success: true }),
  });
  assert.deepEqual(calls, ['sonarr:http://nas:8989:s', 'radarr:http://nas:7878:r', 'qbittorrent:http://nas:8080:u']);
  assert.deepEqual(results.map(result => [result.label, health.describeIntegration(result).tone]), [['Sonarr', 'ok'], ['Radarr', 'error'], ['qBittorrent', 'error']]);
  assert.equal(health.describeIntegration({ key: 'sonarr', label: 'Sonarr', ok: null }).text, 'Vérification…');

  // Au plus un test toutes les 5 minutes pour une même configuration ; une autre configuration est retestée.
  health.resetIntegrationHealthCache();
  let probes = 0;
  const probe = async () => { probes++; return results; };
  let clock = 0;
  await health.readIntegrationHealth(config, probe, () => clock);
  clock = health.INTEGRATION_HEALTH_TTL_MS - 1; await health.readIntegrationHealth(config, probe, () => clock);
  assert.equal(probes, 1);
  await health.readIntegrationHealth({ ...config, sonarrApiKey: 'autre' }, probe, () => clock);
  assert.equal(probes, 2);
  // Revue Codex #1055 : activer ou désactiver Téléchargements relit la liste, jamais le résultat précédent.
  await health.readIntegrationHealth({ ...config, downloadsEnabled: false }, probe, () => clock);
  assert.equal(probes, 3);
  health.resetIntegrationHealthCache();
});
