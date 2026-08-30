const fs = require('fs');

const servicePath = 'src/services/sonarrRadarr.ts';
let content = fs.readFileSync(servicePath, 'utf8');

const importNeedle = "import { authenticatedFetch } from '../lib/apiAuth';\n";
if (!content.includes(importNeedle)) throw new Error('Import apiAuth introuvable');
content = content.replace(
  importNeedle,
  importNeedle + "import { buildFreshGetUrl, buildNoCacheHeaders } from '../features/downloads/downloadNetwork';\n"
);

const fnStart = content.indexOf('export async function executeGet(url: string, headers: Record<string, string> = {}): Promise<any> {');
if (fnStart < 0) throw new Error('executeGet introuvable');
const nativeStart = content.indexOf('  if (Capacitor.isNativePlatform()) {', fnStart);
const pwaMarker = '  } else {\n    // Mode PWA / Navigateur Web';
const pwaStart = content.indexOf(pwaMarker, nativeStart);
if (nativeStart < 0 || pwaStart < 0) throw new Error('Bloc natif executeGet introuvable');

const nativeBlock = `  if (Capacitor.isNativePlatform()) {\n    // Android interroge directement Sonarr/Radarr/qBittorrent. Contrairement au\n    // proxy Web (appelé en POST), ces GET peuvent être servis depuis un cache HTTP\n    // natif/intermédiaire. Chaque poll doit donc être physiquement unique.\n    const freshUrl = buildFreshGetUrl(url);\n    const normHeaders = buildNoCacheHeaders(headers);\n    if (headers['X-Api-Key']) normHeaders['x-api-key'] = headers['X-Api-Key'];\n\n    try {\n      const response = await CapacitorHttp.get({\n        url: freshUrl,\n        headers: normHeaders,\n        connectTimeout: 8000,\n        readTimeout: 8000\n      });\n      if (response.status >= 200 && response.status < 300) {\n        let data = response.data;\n        if (typeof data === 'string') {\n          try { data = JSON.parse(data); } catch {}\n        }\n        return data;\n      }\n      if (response.status === 401 || response.status === 403) {\n        throw new Error(\`Accès refusé (\${response.status}) : Clé API ou identifiants incorrects\`);\n      }\n      throw new Error(\`Erreur HTTP \${response.status}\`);\n    } catch (err) {\n      const nativeError = err;\n      if (nativeError?.message?.includes('Accès refusé')) throw nativeError;\n      try {\n        const directRes = await fetch(freshUrl, {\n          headers: normHeaders,\n          cache: 'no-store',\n          signal: AbortSignal.timeout(6000)\n        });\n        if (directRes.ok) {\n          const text = await directRes.text();\n          try { return JSON.parse(text); } catch { return text; }\n        }\n      } catch {}\n      if (!isLocalNetworkUrl(url)) {\n        try {\n          const proxyRes = await authenticatedFetch('/api/service-proxy', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ targetUrl: freshUrl, method: 'GET', headers: normHeaders }),\n            cache: 'no-store',\n            signal: AbortSignal.timeout(10000)\n          });\n          const rawText = await proxyRes.text();\n          let json = {};\n          try { json = JSON.parse(rawText); } catch {}\n          if (json.ok && !json.error) return json.data;\n        } catch {}\n      }\n      throw new Error(nativeError?.message || 'Serveur injoignable sur le réseau local');\n    }\n`;

content = content.slice(0, nativeStart) + nativeBlock + content.slice(pwaStart);
fs.writeFileSync(servicePath, content);

fs.writeFileSync('src/features/downloads/downloadNetwork.ts', `/** Ajoute un nonce aux GET de polling pour empêcher tout cache natif/intermédiaire. */\nexport function buildFreshGetUrl(url: string, nonce: number = Date.now()): string {\n  const separator = url.includes('?') ? '&' : '?';\n  return \`${'${url}'}\${separator}_seenitFresh=\${nonce}\`;\n}\n\n/** Headers explicites pour les endpoints dont les données évoluent à chaque seconde. */\nexport function buildNoCacheHeaders(headers: Record<string, string> = {}): Record<string, string> {\n  const next: Record<string, string> = {};\n  for (const [key, value] of Object.entries(headers)) {\n    const lower = key.toLowerCase();\n    if (lower === 'cache-control' || lower === 'pragma' || lower === 'expires') continue;\n    next[key] = value;\n  }\n  next['Cache-Control'] = 'no-cache, no-store, max-age=0';\n  next.Pragma = 'no-cache';\n  next.Expires = '0';\n  return next;\n}\n`);

fs.appendFileSync('tests/downloadIdentity.test.ts', `\n\ntest('les GET Android de suivi sont uniques et explicitement non cachables', async () => {\n  const { buildFreshGetUrl, buildNoCacheHeaders } = await import('../src/features/downloads/downloadNetwork.ts');\n  assert.equal(\n    buildFreshGetUrl('https://example.test/api/v3/queue?page=1', 12345),\n    'https://example.test/api/v3/queue?page=1&_seenitFresh=12345'\n  );\n  assert.equal(\n    buildFreshGetUrl('https://example.test/api/v2/torrents/info', 67890),\n    'https://example.test/api/v2/torrents/info?_seenitFresh=67890'\n  );\n  const headers = buildNoCacheHeaders({ 'X-Api-Key': 'abc', 'cache-control': 'public, max-age=3600' });\n  assert.equal(headers['X-Api-Key'], 'abc');\n  assert.equal(headers['Cache-Control'], 'no-cache, no-store, max-age=0');\n  assert.equal(headers.Pragma, 'no-cache');\n  assert.equal(headers.Expires, '0');\n});\n`);

console.log('Patch fraîcheur GET Android appliqué.');
