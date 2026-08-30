const fs = require('fs');

const servicePath = 'src/services/sonarrRadarr.ts';
let content = fs.readFileSync(servicePath, 'utf8');

const importNeedle = "import { buildFreshGetUrl, buildNoCacheHeaders } from '../features/downloads/downloadNetwork';\n";
if (!content.includes(importNeedle)) throw new Error('Import downloadNetwork introuvable');
content = content.replace(
  importNeedle,
  importNeedle + "import { extractQbitSessionCookie, isQbitAuthError } from '../features/downloads/qbitNativeSession';\n"
);

const loginStart = content.indexOf('export async function loginQBittorrent(');
if (loginStart < 0) throw new Error('loginQBittorrent introuvable');
const nativeStart = content.indexOf('  if (Capacitor.isNativePlatform()) {', loginStart);
const pwaMarker = '  } else {\n    // Mode PWA / Navigateur Web';
const pwaStart = content.indexOf(pwaMarker, nativeStart);
if (nativeStart < 0 || pwaStart < 0) throw new Error('Bloc natif loginQBittorrent introuvable');

const nativeBlock = `  if (Capacitor.isNativePlatform()) {\n    try {\n      // IMPORTANT : le polling qBittorrent Android utilise CapacitorHttp. Le login\n      // doit utiliser exactement la même pile HTTP ; un login fetch() stocke le SID\n      // dans le cookie jar de la WebView, invisible pour CapacitorHttp.\n      const form = \`username=\${encodeURIComponent(username || '')}&password=\${encodeURIComponent(password || '')}\`;\n      const res = await CapacitorHttp.post({\n        url: \`${'${base}'}/api/v2/auth/login\`,\n        headers: {\n          'Content-Type': 'application/x-www-form-urlencoded',\n          Referer: base,\n          Origin: base\n        },\n        data: form,\n        connectTimeout: 6000,\n        readTimeout: 6000\n      });\n\n      const bodyStr = String(res.data ?? '').trim();\n      if (bodyStr === 'Fails.' || res.status === 403 || res.status === 401) {\n        cachedQbitCookie = '';\n        cachedQbitCookieTime = 0;\n        return { success: false, message: 'Identifiants qBittorrent incorrects' };\n      }\n      if (res.status < 200 || res.status >= 300) {\n        throw new Error(\`qBittorrent login HTTP \${res.status}\`);\n      }\n\n      cachedQbitCookie = extractQbitSessionCookie(res.headers as Record<string, unknown> | undefined);\n      cachedQbitCookieTime = Date.now();\n      qbittorrentOfflineUntil = 0;\n      return { success: true, cookie: cachedQbitCookie };\n    } catch (err: any) {\n      qbittorrentOfflineUntil = Date.now() + 20000;\n      return {\n        success: false,\n        message: err?.message || 'Impossible de joindre qBittorrent sur le réseau local'\n      };\n    }\n`;

content = content.slice(0, nativeStart) + nativeBlock + content.slice(pwaStart);

const qbitSectionStart = content.indexOf('  // 3. qBittorrent direct');
if (qbitSectionStart < 0) throw new Error('Section qBittorrent direct introuvable');
const qbitTryStart = content.indexOf('    try {', qbitSectionStart);
const arrayCheckNeedle = '      sourceHealth.qbittorrent = { configured: true, ok: true, checkedAt: Date.now() };\n      if (Array.isArray(res)) {';
const arrayCheckIndex = content.indexOf(arrayCheckNeedle, qbitTryStart);
if (qbitTryStart < 0 || arrayCheckIndex < 0) throw new Error('Bloc lecture qBittorrent introuvable');

const qbitPrefix = `    try {\n      const fetchQbitInfo = async (forceRelogin = false): Promise<any> => {\n        if (forceRelogin) {\n          cachedQbitCookie = '';\n          cachedQbitCookieTime = 0;\n          qbittorrentOfflineUntil = 0;\n        }\n\n        let cookieHeader = '';\n        if (config.qbittorrentUsername || config.qbittorrentPassword) {\n          const loginRes = await loginQBittorrent(qbitBase, config.qbittorrentUsername, config.qbittorrentPassword);\n          if (!loginRes.success) {\n            throw new Error(loginRes.message || 'Authentification qBittorrent impossible');\n          }\n          cookieHeader = loginRes.cookie || '';\n        }\n\n        const qHeaders: Record<string, string> = {\n          Accept: 'application/json',\n          Referer: qbitBase,\n          Origin: qbitBase\n        };\n        if (cookieHeader) qHeaders.Cookie = cookieHeader;\n\n        return executeGet(\n          \`${'${qbitBase}'}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true&limit=50\`,\n          qHeaders\n        );\n      };\n\n      let res: any;\n      try {\n        res = await fetchQbitInfo(false);\n      } catch (firstError: any) {\n        if (!isQbitAuthError(firstError) || !(config.qbittorrentUsername || config.qbittorrentPassword)) {\n          throw firstError;\n        }\n        // SID expiré : une seule reconnexion explicite, puis on laisse remonter l'erreur.\n        res = await fetchQbitInfo(true);\n      }\n\n`;

content = content.slice(0, qbitTryStart) + qbitPrefix + content.slice(arrayCheckIndex);
fs.writeFileSync(servicePath, content);

fs.writeFileSync('src/features/downloads/qbitNativeSession.ts', `function readHeader(headers: Record<string, unknown> | undefined, name: string): string {\n  if (!headers) return '';\n  const wanted = name.toLowerCase();\n  for (const [key, rawValue] of Object.entries(headers)) {\n    if (key.toLowerCase() !== wanted) continue;\n    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;\n    return value == null ? '' : String(value);\n  }\n  return '';\n}\n\n/** Extrait le SID qBittorrent d'une réponse native CapacitorHttp. */\nexport function extractQbitSessionCookie(headers: Record<string, unknown> | undefined): string {\n  const raw = readHeader(headers, 'set-cookie');\n  if (!raw) return '';\n  const sid = raw.match(/(?:^|[,;\\s])SID=([^;,\\s]+)/i);\n  return sid ? \`SID=\${sid[1]}\` : raw.split(';')[0].trim();\n}\n\n/** Détermine si le polling peut être retenté après renouvellement de session. */\nexport function isQbitAuthError(error: unknown): boolean {\n  const message = error instanceof Error ? error.message : String(error || '');\n  return /(?:\\b401\\b|\\b403\\b|accès refusé|authentication|authentification)/i.test(message);\n}\n`);

fs.writeFileSync('tests/qbitNativeSession.test.ts', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { extractQbitSessionCookie, isQbitAuthError } from '../src/features/downloads/qbitNativeSession.ts';\n\ntest('extrait le SID qBittorrent depuis Set-Cookie natif', () => {\n  assert.equal(\n    extractQbitSessionCookie({ 'Set-Cookie': 'SID=abc123; HttpOnly; path=/' }),\n    'SID=abc123'\n  );\n  assert.equal(\n    extractQbitSessionCookie({ 'set-cookie': ['SID=xyz789; path=/', 'foo=bar'] }),\n    'SID=xyz789'\n  );\n});\n\ntest('reconnaît uniquement les erreurs nécessitant un relogin qBittorrent', () => {\n  assert.equal(isQbitAuthError(new Error('Accès refusé (403)')), true);\n  assert.equal(isQbitAuthError(new Error('qBittorrent HTTP 401')), true);\n  assert.equal(isQbitAuthError(new Error('Erreur HTTP 500')), false);\n});\n`);

for (const [path, versionCode, versionName] of [
  ['android/app/build.gradle', '104063', '1.4.63'],
]) {
  let value = fs.readFileSync(path, 'utf8');
  value = value.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  value = value.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
  fs.writeFileSync(path, value);
}

const updatePath = 'src/store/updateStore.ts';
let updateStore = fs.readFileSync(updatePath, 'utf8');
updateStore = updateStore.replace(/CURRENT_APP_VERSION\s*=\s*'[^']+'/, "CURRENT_APP_VERSION = '1.4.63'");
fs.writeFileSync(updatePath, updateStore);

console.log('Correctif session qBittorrent Android 1.4.63 appliqué.');
