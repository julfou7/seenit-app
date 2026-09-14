import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { C411Torrent } from './c411';
import { authenticatedFetch } from '../lib/apiAuth';
import { buildFreshGetUrl, buildNoCacheHeaders } from '../features/downloads/downloadNetwork';
import { extractQbitSessionCookie, isQbitAuthError } from '../features/downloads/qbitNativeSession';
import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, normalizeQualityLabel, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';
import { auth } from '../lib/firebase';
import { buildQbitSessionScopeKey } from '../features/downloads/qbitSessionScope';
import { nextDownloadSourceBackoffMs, shouldFetchNextArrQueuePage } from '../features/downloads/downloadPollingPolicy';
import { executeDownloadMutationOnce } from '../features/downloads/downloadMutationPolicy';
import { isSafeMagnetLink } from '../features/downloads/magnetLink';

export interface SonarrRadarrConfig {
  sonarrUrl?: string;
  sonarrApiKey?: string;
  radarrUrl?: string;
  radarrApiKey?: string;
  qbittorrentUrl?: string;
  qbittorrentUsername?: string;
  qbittorrentPassword?: string;
}

/**
 * Normalise l'URL pour s'assurer qu'elle n'a pas de slash final
 */
export function cleanUrl(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = `http://${u}`;
  }
  return u.replace(/\/+$/, '');
}

/**
 * Détecte si une URL cible pointe vers une IP ou un hôte de réseau local privé
 */
export function isLocalNetworkUrl(url: string): boolean {
  const u = (url || '').toLowerCase();
  return (
    u.includes('192.168.') ||
    u.includes('10.') ||
    u.includes('172.16.') || u.includes('172.17.') || u.includes('172.18.') || u.includes('172.19.') ||
    u.includes('172.20.') || u.includes('172.21.') || u.includes('172.22.') || u.includes('172.23.') ||
    u.includes('172.24.') || u.includes('172.25.') || u.includes('172.26.') || u.includes('172.27.') ||
    u.includes('172.28.') || u.includes('172.29.') || u.includes('172.30.') || u.includes('172.31.') ||
    u.includes('localhost') ||
    u.includes('127.0.0.1')
  );
}

interface QbitSessionState {
  cookie: string;
  cookieTime: number;
  offlineUntil: number;
}

// Une session qBittorrent appartient à un compte SeenIt, un serveur et un login.
// Elle ne doit jamais survivre à un changement de portée utilisateur.
const qbitSessions = new Map<string, QbitSessionState>();

function qbitSessionKey(url: string, username?: string): string {
  return buildQbitSessionScopeKey(auth.currentUser?.uid, cleanUrl(url), username);
}

function getQbitSession(url: string, username?: string): QbitSessionState {
  const key = qbitSessionKey(url, username);
  const existing = qbitSessions.get(key);
  if (existing) return existing;
  const created = { cookie: '', cookieTime: 0, offlineUntil: 0 };
  qbitSessions.set(key, created);
  return created;
}

export function invalidateQbitCache(url?: string, username?: string, markOffline = true) {
  if (!url) {
    qbitSessions.clear();
    return;
  }
  const session = getQbitSession(url, username);
  session.cookie = '';
  session.cookieTime = 0;
  session.offlineUntil = markOffline ? Date.now() + 20_000 : 0;
}

/**
 * Exécute une requête GET multiplateforme (Fetch direct / Proxy)
 */
export async function executeGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    // Android interroge directement Sonarr/Radarr/qBittorrent. Contrairement au
    // proxy Web (appelé en POST), ces GET peuvent être servis depuis un cache HTTP
    // natif/intermédiaire. Chaque poll doit donc être physiquement unique.
    const freshUrl = buildFreshGetUrl(url);
    const normHeaders = buildNoCacheHeaders(headers);
    if (headers['X-Api-Key']) normHeaders['x-api-key'] = headers['X-Api-Key'];

    try {
      const response = await CapacitorHttp.get({
        url: freshUrl,
        headers: normHeaders,
        connectTimeout: 8000,
        readTimeout: 8000
      });
      if (response.status >= 200 && response.status < 300) {
        let data = response.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch {}
        }
        return data;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Accès refusé (${response.status}) : Clé API ou identifiants incorrects`);
      }
      throw new Error(`Erreur HTTP ${response.status}`);
    } catch (err) {
      const nativeError = err;
      if (nativeError?.message?.includes('Accès refusé')) throw nativeError;
      try {
        const directRes = await fetch(freshUrl, {
          headers: normHeaders,
          cache: 'no-store',
          signal: AbortSignal.timeout(6000)
        });
        if (directRes.ok) {
          const text = await directRes.text();
          try { return JSON.parse(text); } catch { return text; }
        }
      } catch {}
      if (!isLocalNetworkUrl(url)) {
        try {
          const proxyRes = await authenticatedFetch('/api/service-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUrl: freshUrl, method: 'GET', headers: normHeaders }),
            cache: 'no-store',
            signal: AbortSignal.timeout(10000)
          });
          const rawText = await proxyRes.text();
          let json: any = {};
          try { json = JSON.parse(rawText); } catch {}
          if (json.ok && !json.error) return json.data;
        } catch {}
      }
      throw new Error(nativeError?.message || 'Serveur injoignable sur le réseau local');
    }
  } else {
    // Mode PWA / Navigateur Web
    const isLocal = isLocalNetworkUrl(url);

    if (isLocal) {
      try {
        const directRes = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
        if (directRes.ok) {
          const text = await directRes.text();
          try { return JSON.parse(text); } catch { return text; }
        }
        if (directRes.status === 401 || directRes.status === 403) {
          throw new Error(`Accès refusé (${directRes.status}) : Clé API incorrecte`);
        }
        throw new Error(`Erreur HTTP ${directRes.status}`);
      } catch (directErr: any) {
        if (directErr?.message?.includes('Accès refusé')) throw directErr;
        throw new Error(
          "PWA Web : L'accès aux IP locales est restreint. Utilisez l'APK Android sur Wi-Fi."
        );
      }
    } else {
      try {
        const res = await authenticatedFetch('/api/service-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: url,
            method: 'GET',
            headers
          }),
          signal: AbortSignal.timeout(10000)
        });

        const rawText = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(rawText);
        } catch {
          throw new Error(`Réponse inattendue (${res.status})`);
        }

        if (json.ok && !json.error) {
          return json.data;
        }

        if (json.status === 401 || json.status === 403) {
          throw new Error(`Accès refusé (${json.status}) : Authentification ou clé API requise / invalide`);
        }

        throw new Error(json.message || json.error || `Erreur proxy ${json.status || res.status}`);
      } catch (proxyErr: any) {
        throw new Error(proxyErr?.message || 'Impossible de joindre le service');
      }
    }
  }
}

/**
 * Exécute une requête POST multiplateforme (Fetch direct sur Android / Proxy ou Fetch sur Web)
 */
export async function executePost(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  const mutationHeaders = {
    ...headers,
    'X-SeenIt-Request-Id': headers['X-SeenIt-Request-Id'] || crypto.randomUUID()
  };
  if (Capacitor.isNativePlatform()) {
    try {
      const response = await executeDownloadMutationOnce(() => CapacitorHttp.post({
        url,
        headers: {
          ...mutationHeaders,
          'Content-Type': mutationHeaders['Content-Type'] || (typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json')
        },
        data: body,
        connectTimeout: 5000,
        readTimeout: 5000
      }));
      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }
      throw new Error(`Erreur HTTP ${response.status}`);
    } catch (err: any) {
      // Une mutation peut avoir été appliquée côté service avant un timeout réseau.
      // La rejouer automatiquement via fetch créerait des téléchargements en double.
      throw new Error(err?.message || 'Résultat de la mutation inconnu : vérifiez le client avant de réessayer');
    }
  } else {
    // Mode PWA / Navigateur Web
    const isLocal = isLocalNetworkUrl(url);

    if (isLocal) {
      try {
        const directRes = await fetch(url, {
          method: 'POST',
          headers: {
            ...mutationHeaders,
            'Content-Type': mutationHeaders['Content-Type'] || (typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json')
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(5000)
        });
        if (directRes.ok) {
          const text = await directRes.text();
          try { return JSON.parse(text); } catch { return text || { success: true }; }
        }
        throw new Error(`Erreur HTTP ${directRes.status}`);
      } catch (directErr: any) {
        throw new Error(
          "PWA Web : L'accès aux IP locales est restreint par le navigateur."
        );
      }
    } else {
      try {
        const res = await authenticatedFetch('/api/service-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: url,
            method: 'POST',
            headers: mutationHeaders,
            body
          }),
          signal: AbortSignal.timeout(12000)
        });

        const rawText = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(rawText);
        } catch {
          throw new Error(`Réponse inattendue (${res.status})`);
        }

        if (json.ok && !json.error) {
          return json.data;
        }

        if (json.status === 401 || json.status === 403) {
          throw new Error(`Accès refusé (${json.status}) : Identifiants ou clé API incorrects`);
        }

        throw new Error(json.message || json.error || `Erreur proxy ${json.status || res.status}`);
      } catch (proxyErr: any) {
        throw new Error(proxyErr?.message || 'Erreur réseau');
      }
    }
  }
}

/**
 * Exécute une requête PUT multiplateforme
 */
export async function executePut(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.put({
        url,
        headers,
        data: body,
        connectTimeout: 10000,
        readTimeout: 10000
      });
      if (res.status >= 200 && res.status < 300) {
        if (!res.data) return { success: true };
        return typeof res.data === 'string' ? (res.data.startsWith('{') || res.data.startsWith('[') ? JSON.parse(res.data) : res.data) : res.data;
      }

      let readableError = `Erreur HTTP ${res.status}`;
      try {
        const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].errorMessage) {
          readableError = parsed.map(e => e.errorMessage || e.message).join(' • ');
        } else if (parsed && parsed.message) {
          readableError = parsed.message;
        } else if (parsed && parsed.error) {
          readableError = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
        }
      } catch {
        const strData = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
        if (strData) readableError = `${readableError} : ${strData.substring(0, 100)}`;
      }

      throw new Error(readableError);
    } catch (err: any) {
      throw new Error(err?.message || 'Serveur injoignable sur le réseau local');
    }
  } else {
    // Mode PWA / Navigateur Web
    const isLocal = isLocalNetworkUrl(url);

    if (isLocal) {
      try {
        const directRes = await fetch(url, {
          method: 'PUT',
          headers: {
            ...headers,
            'Content-Type': headers['Content-Type'] || (typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json')
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(5000)
        });
        if (directRes.ok) {
          const text = await directRes.text();
          try { return JSON.parse(text); } catch { return text || { success: true }; }
        }
        throw new Error(`Erreur HTTP ${directRes.status}`);
      } catch {
        throw new Error("PWA Web : L'accès aux IP locales est restreint par le navigateur.");
      }
    } else {
      try {
        const res = await authenticatedFetch('/api/service-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: url,
            method: 'PUT',
            headers,
            body
          }),
          signal: AbortSignal.timeout(12000)
        });

        const rawText = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(rawText);
        } catch {
          throw new Error(`Réponse inattendue (${res.status})`);
        }

        if (json.ok && !json.error) {
          return json.data;
        }

        if (json.status === 401 || json.status === 403) {
          throw new Error(`Accès refusé (${json.status}) : Identifiants ou clé API incorrects`);
        }

        throw new Error(json.message || json.error || `Erreur proxy ${json.status || res.status}`);
      } catch (err: any) {
        throw new Error(err?.message || 'Erreur réseau');
      }
    }
  }
}

/**
 * Exécute une requête DELETE multiplateforme
 */
export async function executeDelete(url: string, headers: Record<string, string> = {}): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.delete({
        url,
        headers,
        connectTimeout: 8000,
        readTimeout: 8000
      });
      if (res.status >= 200 && res.status < 300) {
        return res.data || { success: true };
      }
      throw new Error(`Erreur HTTP ${res.status}`);
    } catch (err: any) {
      throw new Error(err?.message || 'Serveur injoignable sur le réseau local');
    }
  } else {
    // Mode PWA / Web
    const isLocal = isLocalNetworkUrl(url);

    if (isLocal) {
      try {
        const directRes = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(4000) });
        if (directRes.ok) return { success: true };
        throw new Error(`Erreur HTTP ${directRes.status}`);
      } catch {
        throw new Error("PWA Web : L'accès aux IP locales est restreint.");
      }
    } else {
      try {
        const res = await authenticatedFetch('/api/service-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: url,
            method: 'DELETE',
            headers
          }),
          signal: AbortSignal.timeout(10000)
        });

        const rawText = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(rawText);
        } catch {
          throw new Error(`Réponse inattendue (${res.status})`);
        }

        if (json.ok && !json.error) {
          return json.data;
        }

        throw new Error(json.message || json.error || `Erreur proxy ${json.status || res.status}`);
      } catch (err: any) {
        throw new Error(err?.message || 'Erreur réseau');
      }
    }
  }
}

/**
 * Utilitaires de résolution des profils de qualité Sonarr / Radarr (1080p vs 4K)
 */
export function resolveQualityProfileId(
  profiles: Array<{ id: number; name: string }>,
  preference?: '1080p' | '4k',
  explicitId?: number
): number {
  if (explicitId && explicitId > 0) return explicitId;
  if (!profiles || profiles.length === 0) return 1;

  if (preference === '1080p') {
    // Profil 1080p ou HD
    const hd1080 = profiles.find(p => {
      const n = (p.name || '').toLowerCase();
      return n.includes('1080') || n.includes('hd-1080p') || n.includes('hd 1080p') || n.includes('web-1080p');
    });
    if (hd1080) return hd1080.id;

    const hdAny = profiles.find(p => {
      const n = (p.name || '').toLowerCase();
      return (n.includes('hd') || n.includes('720/1080')) && !n.includes('4k') && !n.includes('2160');
    });
    if (hdAny) return hdAny.id;

    return profiles[0].id;
  }

  if (preference === '4k') {
    // Profil Ultra-HD / 4K
    const uhd = profiles.find(p => {
      const n = (p.name || '').toLowerCase();
      return n.includes('4k') || n.includes('2160') || n.includes('ultra-hd') || n.includes('uhd') || n.includes('ultra hd');
    });
    if (uhd) return uhd.id;

    const anyProfile = profiles.find(p => (p.name || '').toLowerCase().includes('any'));
    if (anyProfile) return anyProfile.id;

    return profiles[profiles.length - 1].id;
  }

  return profiles[0].id;
}

/**
 * Récupère les profils de qualité configurés dans Sonarr ou Radarr
 */
export async function fetchQualityProfiles(
  type: 'sonarr' | 'radarr',
  url: string,
  apiKey: string
): Promise<Array<{ id: number; name: string }>> {
  const base = cleanUrl(url);
  if (!base || !apiKey) return [];
  const headers = { 'X-Api-Key': apiKey, 'Accept': 'application/json' };
  try {
    const res = await executeGet(`${base}/api/v3/qualityprofile`, headers);
    if (!Array.isArray(res)) throw new Error(`Réponse de profils ${type} invalide`);
    return res.map((p: any) => ({ id: p.id, name: p.name }));
  } catch (error: any) {
    throw new Error(error?.message || `Impossible de charger les profils ${type}.`);
  }
}

/**
 * Effectue l'authentification auprès de l'API Web UI de qBittorrent
 */
export async function loginQBittorrent(
  url: string,
  username?: string,
  password?: string
): Promise<{ success: boolean; cookie?: string; message?: string }> {
  const base = cleanUrl(url);
  if (!base) return { success: false, message: 'URL qBittorrent invalide' };
  const session = getQbitSession(base, username);

  // Si un cookie récent (< 5 min) existe, l'utiliser directement
  if (session.cookie && Date.now() - session.cookieTime < 300000) {
    return { success: true, cookie: session.cookie };
  }

  // Si le serveur était hors-ligne récemment (< 20s), temporiser
  if (Date.now() < session.offlineUntil) {
    return { success: false, message: 'qBittorrent hors-ligne (attente)' };
  }

  if (Capacitor.isNativePlatform()) {
    try {
      // IMPORTANT : le polling qBittorrent Android utilise CapacitorHttp. Le login
      // doit utiliser exactement la même pile HTTP ; un login fetch() stocke le SID
      // dans le cookie jar de la WebView, invisible pour CapacitorHttp.
      const form = `username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`;
      const res = await CapacitorHttp.post({
        url: `${base}/api/v2/auth/login`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: base,
          Origin: base
        },
        data: form,
        connectTimeout: 6000,
        readTimeout: 6000
      });

      const bodyStr = String(res.data ?? '').trim();
      if (bodyStr === 'Fails.' || res.status === 403 || res.status === 401) {
        session.cookie = '';
        session.cookieTime = 0;
        return { success: false, message: 'Identifiants qBittorrent incorrects' };
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`qBittorrent login HTTP ${res.status}`);
      }

      session.cookie = extractQbitSessionCookie(res.headers as Record<string, unknown> | undefined);
      session.cookieTime = Date.now();
      session.offlineUntil = 0;
      return { success: true, cookie: session.cookie };
    } catch (err: any) {
      session.offlineUntil = Date.now() + 20_000;
      return {
        success: false,
        message: err?.message || 'Impossible de joindre qBittorrent sur le réseau local'
      };
    }
  } else {
    // Mode PWA / Navigateur Web
    const isLocal = isLocalNetworkUrl(base);

    if (isLocal) {
      try {
        const directRes = await fetch(`${base}/api/v2/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': base,
            'Origin': base
          },
          body: `username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`,
          signal: AbortSignal.timeout(5000)
        });
        const bodyStr = await directRes.text();
        if (bodyStr.trim() === 'Fails.' || directRes.status === 401 || directRes.status === 403) {
          invalidateQbitCache(base, username);
          return { success: false, message: 'Identifiants qBittorrent incorrects' };
        }
        session.cookieTime = Date.now();
        session.offlineUntil = 0;
        return { success: true };
      } catch {
        session.offlineUntil = Date.now() + 20_000;
        return {
          success: false,
          message: "PWA Web : Connexion locale bloquée par le navigateur."
        };
      }
    } else {
      try {
        const res = await authenticatedFetch('/api/service-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: `${base}/api/v2/auth/login`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': `${base}/`,
              'Origin': base
            },
            body: `username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`
          }),
          signal: AbortSignal.timeout(10000)
        });

        const rawText = await res.text();
        let json: any = {};
        try {
          json = JSON.parse(rawText);
        } catch {
          return { success: false, message: 'Réponse inattendue du proxy' };
        }

        const bodyStr = typeof json.data === 'string' ? json.data : JSON.stringify(json.data || '');
        if (bodyStr.trim() === 'Fails.' || json.status === 401 || json.status === 403) {
          invalidateQbitCache(base, username);
          return { success: false, message: 'Identifiants qBittorrent incorrects' };
        }
        if (!json.ok && json.error) {
          session.offlineUntil = Date.now() + 20_000;
          return { success: false, message: json.message || `Erreur proxy (${json.status || 500})` };
        }

        let cookieHeader = '';
        if (json.cookie) {
          cookieHeader = json.cookie.split(';')[0];
        } else if (json.headers && json.headers['set-cookie']) {
          const raw = json.headers['set-cookie'];
          const cookieStr = Array.isArray(raw) ? raw[0] : String(raw);
          cookieHeader = cookieStr.split(';')[0];
        }

        session.cookie = cookieHeader;
        session.cookieTime = Date.now();
        session.offlineUntil = 0;

        return { success: true, cookie: cookieHeader };
      } catch (err: any) {
        session.offlineUntil = Date.now() + 20_000;
        return { success: false, message: err?.message || 'Erreur réseau' };
      }
    }
  }
}

/**
 * Test de connectivité avec Sonarr, Radarr ou qBittorrent
 */
export async function testServiceConnection(
  type: 'sonarr' | 'radarr' | 'qbittorrent',
  url: string,
  apiKey?: string,
  username?: string,
  password?: string
): Promise<{ success: boolean; message: string; version?: string }> {
  const base = cleanUrl(url);
  if (!base) return { success: false, message: 'URL manquante' };

  try {
    if (type === 'sonarr' || type === 'radarr') {
      if (!apiKey) return { success: false, message: 'Clé API manquante' };
      const data = await executeGet(`${base}/api/v3/system/status`, {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      });
      return {
        success: true,
        message: `Connecté avec succès à ${type === 'sonarr' ? 'Sonarr' : 'Radarr'} (v${data.version || '3+'})`,
        version: data.version
      };
    }

    if (type === 'qbittorrent') {
      let cookieHeader = '';
      if (username || password) {
        const loginRes = await loginQBittorrent(base, username, password);
        if (!loginRes.success) {
          return {
            success: false,
            message: loginRes.message || 'Échec d\'authentification qBittorrent'
          };
        }
        cookieHeader = loginRes.cookie || '';
      }

      const headers: Record<string, string> = {
        'Accept': 'text/plain, application/json',
        'Referer': `${base}/`,
        'Origin': base
      };
      if (cookieHeader) headers['Cookie'] = cookieHeader;

      try {
        const data = await executeGet(`${base}/api/v2/app/version`, headers);
        const versionStr = typeof data === 'string' ? data.trim() : (data?.version || 'Web UI');
        return {
          success: true,
          message: `Connecté avec succès à qBittorrent (${versionStr})`,
          version: versionStr
        };
      } catch (err: any) {
        if (!username && !password && (err?.message?.includes('403') || err?.message?.includes('401') || err?.message?.includes('Accès refusé'))) {
          return {
            success: false,
            message: 'Authentification requise : Veuillez renseigner le nom d\'utilisateur et le mot de passe qBittorrent'
          };
        }
        throw err;
      }
    }

    return { success: false, message: 'Service inconnu' };
  } catch (err: any) {
    return {
      success: false,
      message: `Connexion impossible à ${type} (${err?.message || 'Vérifiez l\'adresse IP et que votre PC est allumé'})`
    };
  }
}


export async function executeArrInteractiveGet(url: string, headers: Record<string, string>): Promise<any> {
  if (!Capacitor.isNativePlatform()) return executeGet(url, headers);
  try {
    const normHeaders = { ...headers };
    if (headers['X-Api-Key']) normHeaders['x-api-key'] = headers['X-Api-Key'];
    const response = await CapacitorHttp.get({
      url,
      headers: normHeaders,
      connectTimeout: 10000,
      readTimeout: 30000
    });
    if (response.status >= 200 && response.status < 300) {
      let data = response.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }
      return data;
    }
    throw new Error(`Erreur HTTP ${response.status}`);
  } catch (error: any) {
    throw new Error(error?.message || 'Recherche interactive impossible');
  }
}

export async function executeArrInteractivePost(url: string, body: any, headers: Record<string, string>): Promise<any> {
  if (!Capacitor.isNativePlatform()) return executePost(url, body, headers);
  try {
    const response = await CapacitorHttp.post({
      url,
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: body,
      connectTimeout: 10000,
      readTimeout: 30000
    });
    if (response.status >= 200 && response.status < 300) return response.data || { success: true };
    throw new Error(`Erreur HTTP ${response.status}`);
  } catch (error: any) {
    throw new Error(error?.message || 'Grab de la release impossible');
  }
}
