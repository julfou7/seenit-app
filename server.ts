import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { getMessaging } from "firebase-admin/messaging";
import { adminAuth, adminDb } from "./src/lib/firebase-admin.ts";
import { DecodedIdToken } from "firebase-admin/auth";
import multer from "multer";
import dns from "node:dns/promises";
import net from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  buildPlexParentShowIdentityItem,
  extractPlexExternalIds,
  getPlexMetadataLookupKey,
  getPlexParentShowMetadataLookupKey,
  getStrongPlexSourceIdentity,
  unwrapPlexMediaItem
} from "./src/features/plex/plexIdentity.ts";
import {
  isPlexLibraryItemWatched,
  normalizePlexAccountHistoryNode,
  PLEX_ACCOUNT_HISTORY_MINIMAL_QUERY,
  PLEX_ACCOUNT_HISTORY_QUERY
} from "./src/features/plex/plexAccountHistory.ts";
import { evaluatePlexSourceCompletion } from "./src/features/plex/plexSyncIntegrity.ts";

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}


export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying Firebase ID token:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

const WEBHOOK_SECRET_HEADER = 'x-seenit-webhook-secret';

const requireWebhookSecret = (req: Request, res: Response, next: NextFunction) => {
  const expectedSecret = process.env.WEBHOOK_SECRET?.trim();
  if (!expectedSecret) {
    console.error('[Webhook] WEBHOOK_SECRET absent : webhook refuse par securite.');
    return res.status(503).json({ error: 'Webhook non configure' });
  }

  const headerSecret = req.headers[WEBHOOK_SECRET_HEADER];
  const providedSecret = (
    (typeof headerSecret === 'string' ? headerSecret : '') ||
    (typeof req.query.secret === 'string' ? req.query.secret : '')
  ).trim();

  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);
  const isValid =
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isValid) {
    return res.status(401).json({ error: 'Secret de webhook invalide' });
  }

  next();
};

function isPrivateOrReservedAddress(address: string): boolean {
  const cleanAddress = address.toLowerCase().split('%')[0];

  if (net.isIPv4(cleanAddress)) {
    const [a, b, c] = cleanAddress.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (net.isIPv6(cleanAddress)) {
    if (cleanAddress.startsWith('::ffff:')) {
      return isPrivateOrReservedAddress(cleanAddress.slice('::ffff:'.length));
    }
    return (
      cleanAddress === '::' ||
      cleanAddress === '::1' ||
      cleanAddress.startsWith('fc') ||
      cleanAddress.startsWith('fd') ||
      /^fe[89ab]/.test(cleanAddress) ||
      cleanAddress.startsWith('ff') ||
      cleanAddress.startsWith('2001:db8:')
    );
  }

  return true;
}

async function validateOutboundUrl(rawUrl: unknown): Promise<URL> {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw new Error('URL cible invalide');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('URL cible invalide');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Seuls les protocoles HTTP et HTTPS sont autorises');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Les identifiants dans l URL sont interdits');
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
  const forbiddenHostname =
    hostname === 'localhost' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan');

  if (forbiddenHostname) {
    throw new Error('Hote local ou interne interdit depuis le serveur');
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
    throw new Error('Adresse IP privee ou reservee interdite depuis le serveur');
  }

  return parsedUrl;
}

const BLOCKED_PROXY_HEADERS = new Set([
  'connection',
  'content-length',
  'forwarded',
  'host',
  'metadata-flavor',
  'proxy-authorization',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip'
]);

function sanitizeProxyHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const safeHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase();
    if (
      BLOCKED_PROXY_HEADERS.has(normalizedKey) ||
      normalizedKey.startsWith('x-goog-') ||
      typeof value !== 'string' ||
      value.length > 8192
    ) {
      continue;
    }
    safeHeaders[key] = value;
  }
  return safeHeaders;
}

async function secureServerFetch(rawUrl: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const validatedUrl = await validateOutboundUrl(rawUrl);
  return fetch(validatedUrl, {
    ...init,
    redirect: 'error'
  });
}

function startCronJobs() {
  // CRON disabled in preview environment due to missing Service Account credentials
  console.log("[CRON] Scheduled jobs are disabled in this environment.");
  return;
  // Exécution tous les jours à 9h05 (Heure du serveur)
  cron.schedule("5 9 * * *", async () => {
    console.log("[CRON] Démarrage de la vérification des rappels d'épisodes...");
    const db = adminDb;
    const messaging = getMessaging();
    
    // Obtenir la date du jour au format YYYY-MM-DD
    const todayStr = new Date().toISOString().split("T")[0];

    try {
      // Utilisation d'un collectionGroup pour chercher dans toutes les sous-collections 'reminders' de tous les utilisateurs
      const remindersSnap = await db.collectionGroup("reminders")
        .where("air_date", "==", todayStr)
        .get();

      if (remindersSnap.empty) {
        console.log("[CRON] Aucun rappel prévu pour aujourd'hui.");
        return;
      }

      console.log(`[CRON] ${remindersSnap.size} rappel(s) trouvé(s). Envoi en cours...`);
      const batch = db.batch();

      for (const doc of remindersSnap.docs) {
        const data = doc.data();
        if (!data.fcmToken) continue;

        const message = {
          notification: {
            title: `Nouvel épisode disponible ! 🍿`,
            body: `L'épisode ${data.episodeString || ""} de ${data.showTitle || "votre série"} est sorti aujourd'hui.`,
          },
          token: data.fcmToken,
        };

        try {
          await messaging.send(message);
          console.log(`[CRON] Notification envoyée pour ${data.showTitle}`);
          // On supprime le rappel une fois envoyé pour éviter les doublons
          batch.delete(doc.ref);
        } catch (err: any) {
          console.error(`[CRON] Échec de l'envoi au token ${data.fcmToken}:`, err.message);
          // Si le token n'est plus valide, on supprime quand même le rappel
          if (err.code === 'messaging/registration-token-not-registered') {
            batch.delete(doc.ref);
          }
        }
      }

      await batch.commit();
      console.log("[CRON] Vérification terminée et base de données nettoyée.");
    } catch (error) {
      console.error("[CRON] Erreur générale lors de l'exécution :", error);
    }
  });
}

const PLEX_SERVERS_CACHE_TTL_MS = 5 * 60 * 1000;
const PLEX_SERVERS_CACHE_MAX_ENTRIES = 100;

// Le jeton Plex brut ne doit jamais devenir une clé persistante en mémoire.
// L'UID SeenIt cloisonne deux comptes qui utiliseraient volontairement le même Plex.
const plexServersCache = new Map<string, { servers: any[]; timestamp: number }>();

function getPlexServersCacheKey(token: string, userScope: string): string {
  const tokenDigest = createHash('sha256').update(token).digest('hex');
  return `${userScope}:${tokenDigest}`;
}

function prunePlexServersCache(now = Date.now()): void {
  for (const [key, entry] of plexServersCache) {
    if (now - entry.timestamp >= PLEX_SERVERS_CACHE_TTL_MS) {
      plexServersCache.delete(key);
    }
  }

  if (plexServersCache.size <= PLEX_SERVERS_CACHE_MAX_ENTRIES) return;
  const oldestKeys = [...plexServersCache.entries()]
    .sort(([, left], [, right]) => left.timestamp - right.timestamp)
    .slice(0, plexServersCache.size - PLEX_SERVERS_CACHE_MAX_ENTRIES)
    .map(([key]) => key);
  for (const key of oldestKeys) plexServersCache.delete(key);
}

async function getPlexServers(
  token: string,
  clientId: string,
  timeoutMs: number = 7000,
  userScope = 'anonymous'
): Promise<any[]> {
  const now = Date.now();
  prunePlexServersCache(now);
  const cacheKey = getPlexServersCacheKey(token, userScope);
  const cached = plexServersCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < PLEX_SERVERS_CACHE_TTL_MS) {
    return cached.servers;
  }

  let servers: any[] = [];
  try {
    const resourcesRes = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
      headers: {
        'X-Plex-Token': token,
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': clientId
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (resourcesRes.ok) {
      const resources = await resourcesRes.json();
      if (Array.isArray(resources)) {
        servers = resources.filter((r: any) => r.provides && r.provides.includes('server'));
        plexServersCache.set(cacheKey, { servers, timestamp: Date.now() });
        prunePlexServersCache();
      } else {
        throw new Error('Réponse Plex resources invalide');
      }
    } else {
      throw new Error(`Plex resources HTTP ${resourcesRes.status}`);
    }
  } catch (err: any) {
    // If timeout or network glitch, return previously cached if available
    if (cached && cached.servers.length > 0) {
      return cached.servers;
    }
    throw err;
  }

  return servers;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS Middleware for native mobile app requests (APK) and web
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Plex-Token, X-Plex-Client-Identifier, X-Plex-Product, X-Plex-Version');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  const upload = multer();

  const handleResolveSlug = async (req: express.Request, res: express.Response) => {
    console.log('[Plex Resolve Backend] --- DÉBUT DE LA RÉSOLUTION DU SLUG PLEX ---');

    try {
      const queryParams = req.query || {};
      const bodyParams = req.body || {};
      const params = { ...queryParams, ...bodyParams };

      const {
        tmdbId,
        imdbId,
        tvdbId,
        type,
        clientId
      } = params;

      const normalizedTmdbId =
        tmdbId && /^\d+$/.test(String(tmdbId))
          ? Number(tmdbId)
          : null;

      const normalizedImdbId =
        imdbId && /^tt\d+$/i.test(String(imdbId))
          ? String(imdbId).toLowerCase()
          : null;

      const normalizedTvdbId =
        tvdbId && /^\d+$/.test(String(tvdbId))
          ? Number(tvdbId)
          : null;

      const hasExternalId =
        !!normalizedTmdbId ||
        !!normalizedImdbId ||
        !!normalizedTvdbId;

      const targetType =
        type === 'show' ||
        type === 'series' ||
        type === 'tv'
          ? 'show'
          : 'movie';

      const plexType = targetType === 'show' ? 2 : 1;

      const plexAgent =
        targetType === 'show'
          ? 'tv.plex.agents.series'
          : 'tv.plex.agents.movie';

      const plexClientId =
        typeof clientId === 'string' && clientId.trim()
          ? clientId
          : (typeof req.headers['x-plex-client-identifier'] === 'string' ? req.headers['x-plex-client-identifier'] : 'seenit-app-server');

      const resolvedToken =
        (typeof req.headers['x-plex-token'] === 'string' && req.headers['x-plex-token']) ||
        '';

      console.log(
        `[Plex Resolve Backend] ` +
        `tmdbId=${normalizedTmdbId ?? 'ABSENT'}, ` +
        `imdbId=${normalizedImdbId ?? 'ABSENT'}, ` +
        `tvdbId=${normalizedTvdbId ?? 'ABSENT'}, ` +
        `hasExternalId=${hasExternalId}, ` +
        `type=${targetType}, ` +
        `token=${resolvedToken ? 'PRÉSENT' : 'ABSENT'}`
      );

      if (!hasExternalId) {
        console.warn(
          '[Plex Resolve Backend] Aucun identifiant externe vérifiable fourni.'
        );

        return res.status(400).json({
          success: false,
          slug: null,
          error: 'Identifiant TMDB, IMDb ou TVDB requis'
        });
      }

      if (!resolvedToken) {
        return res.status(400).json({ success: false, slug: null, error: 'Jeton Plex manquant' });
      }

      const headers: Record<string, string> = {
        'X-Plex-Product': 'SeenIt',
        'X-Plex-Version': '1.4.69',
        'X-Plex-Client-Identifier': plexClientId,
        'Accept': 'application/json'
      };

      if (resolvedToken) {
        headers['X-Plex-Token'] = resolvedToken;
      }

      /**
       * Extrait les résultats Plex quel que soit le format retourné.
       */
      const extractResults = (data: any): any[] => {
        const results =
          data?.MediaContainer?.SearchResult ||
          data?.MediaContainer?.Metadata ||
          data?.MediaContainer?.Hub?.flatMap((h: any) => h.Metadata || []) ||
          data?.SearchResult ||
          data?.Metadata;

        return Array.isArray(results) ? results : [];
      };

      /**
       * Extrait les GUID externes d'un résultat Plex.
       */
      const extractGuids = (item: any) => {
        const tmdbIds = new Set<number>();
        const imdbIds = new Set<string>();
        const tvdbIds = new Set<number>();

        const addGuid = (raw?: string) => {
          if (typeof raw !== 'string') return;

          const tmdbMatch =
            raw.match(/^tmdb:\/\/(\d+)(?:[?#][^\s]*)?$/i) ||
            raw.match(/^themoviedb:\/\/(\d+)(?:[?#][^\s]*)?$/i) ||
            raw.match(/^com\.plexapp\.agents\.themoviedb:\/\/(\d+)(?:[?#][^\s]*)?$/i);

          if (tmdbMatch) {
            tmdbIds.add(Number(tmdbMatch[1]));
          }

          const imdbMatch =
            raw.match(/^imdb:\/\/(tt\d+)(?:[?#][^\s]*)?$/i) ||
            raw.match(/^com\.plexapp\.agents\.imdb:\/\/(tt\d+)(?:[?#][^\s]*)?$/i);

          if (imdbMatch) {
            imdbIds.add(imdbMatch[1].toLowerCase());
          }

          const tvdbMatch =
            raw.match(/^tvdb:\/\/(\d+)(?:[?#][^\s]*)?$/i) ||
            raw.match(/^thetvdb:\/\/(\d+)(?:[?#][^\s]*)?$/i) ||
            raw.match(/^com\.plexapp\.agents\.thetvdb:\/\/(\d+)(?:[?#][^\s]*)?$/i);

          if (tvdbMatch) {
            tvdbIds.add(Number(tvdbMatch[1]));
          }
        };

        for (const guidList of [item?.Guid, item?.guids]) {
          if (!Array.isArray(guidList)) continue;
          for (const guid of guidList) {
            addGuid(typeof guid === 'string' ? guid : guid?.id);
          }
        }

        addGuid(item?.guid);
        addGuid(item?.grandparentGuid);
        addGuid(item?.parentGuid);

        return {
          tmdbIds,
          imdbIds,
          tvdbIds
        };
      };

      /**
       * Vérifie avec rigueur qu'un item Plex correspond au média recherché
       */
      const isItemStrictMatch = (item: any): boolean => {
        if (!item) return false;

        const itemType = String(item.type || '').toLowerCase();
        if (targetType === 'movie' && itemType && itemType !== 'movie') {
          return false;
        }
        if (
          targetType === 'show' &&
          itemType &&
          itemType !== 'show' &&
          itemType !== 'series'
        ) {
          return false;
        }

        const guids = extractGuids(item);

        // 1. Match par TMDB ID
        if (normalizedTmdbId && guids.tmdbIds.has(normalizedTmdbId)) {
          return true;
        }

        // 2. Match par IMDb ID
        if (normalizedImdbId && guids.imdbIds.has(normalizedImdbId)) {
          return true;
        }

        // 3. Match par TVDB ID
        if (normalizedTvdbId && guids.tvdbIds.has(normalizedTvdbId)) {
          return true;
        }

        return false;
      };

      const formatResponseItem = (item: any, sourceDesc: string) => {
        const guids = extractGuids(item);
        return {
          slug: item.slug,
          plexGuid: item.guid || null,
          guid: item.guid || null,
          type: targetType,
          title: item.title || null,
          year: item.year || null,
          tmdbId:
            guids.tmdbIds.size > 0
              ? [...guids.tmdbIds][0]
              : normalizedTmdbId,
          imdbId:
            guids.imdbIds.size > 0
              ? [...guids.imdbIds][0]
              : normalizedImdbId,
          tvdbId:
            guids.tvdbIds.size > 0
              ? [...guids.tvdbIds][0]
              : normalizedTvdbId,
          resolvedFrom: sourceDesc
        };
      };

      // --- ÉTAPE 1 : METADATA PROVIDER MATCHES (GUID exact - Implémentation officielle Plex) ---
      const queryMatchesEndpoint = async (guid: string): Promise<any | null> => {
        const matchesUrl = `https://metadata.provider.plex.tv/library/metadata/matches?guid=${encodeURIComponent(guid)}&type=${plexType}`;

        console.log(`[Plex Resolve Backend] [Étape 1] Recherche matches officielle : ${guid}`);

        try {
          const response = await fetch(matchesUrl, {
            headers,
            signal: AbortSignal.timeout(6000)
          });

          console.log(`[Plex Resolve Backend] [Étape 1] ${guid} → ${response.status} ${response.statusText}`);

          if (!response.ok) return null;

          const data = await response.json();
          const results = extractResults(data);

          if (results.length === 0) {
            console.log(`[Plex Resolve Backend] [Étape 1] Aucun résultat pour ${guid}`);
            return null;
          }

          const match = results.find(item => isItemStrictMatch(item) && item.slug);
          if (match && match.slug) {
            return formatResponseItem(match, guid.replace('://', ':'));
          }
          return null;
        } catch (error: any) {
          console.warn(`[Plex Resolve Backend] [Étape 1] Erreur ${guid}:`, error?.message || error);
          return null;
        }
      };

      // 1.A : TMDB ID
      if (normalizedTmdbId) {
        const resMatches = await queryMatchesEndpoint(`tmdb://${normalizedTmdbId}`);
        if (resMatches) {
          console.log(`[Plex Resolve Backend] ✅ [Étape 1] TMDB matches → ${resMatches.slug}`);
          return res.json({ success: true, ...resMatches });
        }
      }

      // 1.B : IMDb ID
      if (normalizedImdbId) {
        const resMatches = await queryMatchesEndpoint(`imdb://${normalizedImdbId}`);
        if (resMatches) {
          console.log(`[Plex Resolve Backend] ✅ [Étape 1] IMDb matches → ${resMatches.slug}`);
          return res.json({ success: true, ...resMatches });
        }
      }

      // 1.C : TVDB ID
      if (normalizedTvdbId) {
        const resMatches = await queryMatchesEndpoint(`tvdb://${normalizedTvdbId}`);
        if (resMatches) {
          console.log(`[Plex Resolve Backend] ✅ [Étape 1] TVDB matches → ${resMatches.slug}`);
          return res.json({ success: true, ...resMatches });
        }
      }

      console.warn(
        '[Plex Resolve Backend] ❌ Aucun match Plex exact trouvé pour les identifiants fournis.'
      );

      return res.json({
        success: false,
        slug: null,
        type: targetType,
        tmdbId: normalizedTmdbId,
        imdbId: normalizedImdbId
      });

    } catch (error: any) {
      console.error(
        '[Plex Resolve Backend] Erreur critique:',
        error
      );

      return res.status(500).json({
        success: false,
        slug: null,
        error: 'Erreur interne'
      });
    } finally {
      console.log(
        '[Plex Resolve Backend] --- FIN DE LA RÉSOLUTION DU SLUG PLEX ---'
      );
    }
  };

  app.get('/api/plex/resolve-slug', requireAuth, handleResolveSlug);
  app.post('/api/plex/resolve-slug', requireAuth, handleResolveSlug);

  app.post('/api/plex/availability', requireAuth, async (req, res) => {
    try {
      const { clientId, tmdbId, mediaType = 'movie' } = req.body || {};
      const token = typeof req.headers['x-plex-token'] === 'string' ? req.headers['x-plex-token'] : '';
      if (!token || !tmdbId) {
        return res.json({ available: false });
      }

      const plexClientIdentifier = clientId || 'tv-time-ai-studio';
      const seenItUserId = (req as AuthRequest).user?.uid || 'anonymous';
      const servers = await getPlexServers(token, plexClientIdentifier, 5000, seenItUserId);

      if (servers.length === 0) {
        return res.json({ available: false });
      }

      const extractTmdbId = (item: any): number | null =>
        extractPlexExternalIds(item).tmdbId;

      const isMatch = (item: any): boolean => {
        if (!item) return false;

        const itType = (item.type || '').toLowerCase();
        if (itType === 'episode' || itType === 'season' || itType === 'track') return false;
        if (mediaType === 'movie' && itType && itType !== 'movie') return false;
        if (mediaType === 'tv' && itType && itType !== 'show' && itType !== 'series') return false;

        const itTmdbId = extractTmdbId(item);
        if (tmdbId && itTmdbId && Number(itTmdbId) === Number(tmdbId)) {
          return true;
        }

        return false;
      };

      const extractItems = (data: any): any[] => {
        if (!data) return [];
        let items: any[] = [];
        if (data.MediaContainer?.Hub) {
          for (const hub of data.MediaContainer.Hub) {
            if (Array.isArray(hub.Metadata)) {
              items.push(...hub.Metadata);
            }
          }
        } else if (Array.isArray(data.MediaContainer?.Metadata)) {
          items = data.MediaContainer.Metadata;
        } else if (Array.isArray(data.Metadata)) {
          items = data.Metadata;
        }
        return items;
      };

      // Search all servers in parallel with fast direct GUID lookup only
      const serverSearchPromises = servers.map(async (server: any) => {
        const serverName = server.name || 'Serveur Plex';
        const serverAccessToken = server.accessToken || token;
        const rawConnections = server.connections || [];

        const sortedConnections = [...rawConnections].sort((a: any, b: any) => {
          const aIsRemoteHttps = !a.local && (a.uri || '').startsWith('https://');
          const bIsRemoteHttps = !b.local && (b.uri || '').startsWith('https://');
          if (aIsRemoteHttps && !bIsRemoteHttps) return -1;
          if (!aIsRemoteHttps && bIsRemoteHttps) return 1;

          if (a.relay && !b.relay) return -1;
          if (!a.relay && b.relay) return 1;

          if (!a.local && b.local) return -1;
          if (a.local && !b.local) return 1;

          return 0;
        });

        const hasRemoteOrRelay = sortedConnections.some((c: any) => !c.local || c.relay);
        const candidateConnections = hasRemoteOrRelay 
          ? sortedConnections.filter((c: any) => !c.local || c.relay)
          : sortedConnections;

        // Execute queries for a single connection (STRICT TMDB GUID MATCHING ONLY)
        const queryConnection = async (uri: string): Promise<any | null> => {
          const endpointsToTry = [
            `${uri}/library/all?guid=${encodeURIComponent(`tmdb://${tmdbId}`)}&includeGuids=1`,
            `${uri}/hubs/search?query=${encodeURIComponent(`tmdb://${tmdbId}`)}&limit=5&includeGuids=1`,
            `${uri}/library/all?guid=${encodeURIComponent(`com.plexapp.agents.themoviedb://${tmdbId}`)}&includeGuids=1`
          ];

          for (const ep of endpointsToTry) {
            try {
              const searchRes = await fetch(ep, {
                headers: { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                signal: AbortSignal.timeout(1200)
              });
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                const items = extractItems(searchData);
                for (const it of items) {
                  if (isMatch(it)) {
                    const itemTitle = it.title || null;
                    const itemYear = it.year || null;
                    const directPlexUrl = (server.clientIdentifier && it.ratingKey)
                      ? `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${it.ratingKey}`)}`
                      : 'https://app.plex.tv/desktop';

                    console.log(`[Plex Availability] STRICT TMDB GUID MATCH: tmdb://${tmdbId} ("${itemTitle}") on server "${serverName}"`);
                    return {
                      available: true,
                      serverName,
                      serverId: server.clientIdentifier,
                      title: itemTitle,
                      originalTitle: it.originalTitle || null,
                      year: itemYear,
                      ratingKey: it.ratingKey,
                      plexUrl: directPlexUrl
                    };
                  }
                }
              }
            } catch (e) {
              // Ignore timeout
            }
          }

          return null;
        };

        // Run connections in parallel for this server
        const connPromises = candidateConnections.slice(0, 3).map(c => c.uri ? queryConnection(c.uri) : Promise.resolve(null));
        const connResults = await Promise.all(connPromises);
        return connResults.find(r => r && r.available) || null;
      });

      const results = await Promise.all(serverSearchPromises);
      const found = results.find(r => r && r.available);

      if (found) {
        return res.json(found);
      }

      return res.json({ available: false });
    } catch (err: any) {
      console.error('[Plex Availability] Error:', err);
      return res.status(500).json({ error: err?.message || 'Erreur interne' });
    }
  });

  app.post(['/api/plex/history', '/api/plex-sync'], requireAuth, async (req, res) => {
    try {
      const { clientId, delta = false, since } = req.body || {};
      const token = typeof req.headers['x-plex-token'] === 'string' ? req.headers['x-plex-token'] : '';

      if (!token) {
        return res.status(400).json({ error: 'Jeton Plex (token) manquant. Veuillez reconnecter votre compte Plex.' });
      }

      const plexClientIdentifier = clientId || 'tv-time-ai-studio';
      const syncCursor = Date.now();
      console.log(`[Plex Sync] Starting sync for user (${delta ? 'DELTA MODE' : 'FULL SCAN'})...`);

      const allRawItems: any[] = [];
      const visitedSources: string[] = [];

      // Helper function to extract items array from various Plex response formats
      const extractItems = (data: any): any[] => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.activities)) return data.activities;
        if (data.MediaContainer && Array.isArray(data.MediaContainer.Metadata)) return data.MediaContainer.Metadata;
        if (data.mediaContainer && Array.isArray(data.mediaContainer.metadata)) return data.mediaContainer.metadata;
        if (Array.isArray(data.Metadata)) return data.Metadata;
        if (Array.isArray(data.metadata)) return data.metadata;
        if (Array.isArray(data.items)) return data.items;
        return [];
      };

      const fetchPlexPages = async (
        endpoint: string,
        headers: Record<string, string>,
        timeoutMs: number,
        maxPages: number,
        stopAtTimestamp?: number
      ): Promise<any[]> => {
        const pageSize = 100;
        const collected: any[] = [];
        let previousFingerprint = '';

        for (let page = 0; page < maxPages; page++) {
          const pageUrl = new URL(endpoint);
          pageUrl.searchParams.set('X-Plex-Container-Start', String(page * pageSize));
          pageUrl.searchParams.set('X-Plex-Container-Size', String(pageSize));
          pageUrl.searchParams.set('includeGuids', '1');

          const response = await fetch(pageUrl, {
            headers,
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (!response.ok) {
            throw new Error(`Pagination Plex incomplète (${pageUrl.pathname}, HTTP ${response.status}, page ${page + 1})`);
          }

          const data = await response.json();
          const items = extractItems(data);
          if (items.length === 0) break;

          const fingerprint = items
            .slice(0, 5)
            .map((item: any) => item.ratingKey || item.key || item.guid || '')
            .filter(Boolean)
            .join('|');
          if (page > 0 && fingerprint && fingerprint === previousFingerprint) {
            throw new Error(`Pagination Plex répétée (${pageUrl.pathname}, page ${page + 1})`);
          }
          previousFingerprint = fingerprint;
          collected.push(...items);

          if (stopAtTimestamp) {
            const reachedCursor = items.some((item: any) => {
              const rawTimestamp = item.lastViewedAt || item.viewedAt || item.date || item.createdAt || item.updatedAt;
              if (!rawTimestamp) return false;
              const timestamp = Number(rawTimestamp) < 10000000000
                ? Number(rawTimestamp) * 1000
                : Number(rawTimestamp);
              return Number.isFinite(timestamp) && timestamp <= stopAtTimestamp;
            });
            if (reachedCursor) break;
          }

          const container = data?.MediaContainer || {};
          const totalSize = Number(container.totalSize ?? container.total_size);
          const nextStart = (page + 1) * pageSize;
          if (items.length < pageSize || (Number.isFinite(totalSize) && nextStart >= totalSize)) break;

          if (page === maxPages - 1) {
            throw new Error(`Pagination Plex plafonnée (${pageUrl.pathname}, ${maxPages * pageSize} éléments)`);
          }
        }

        return collected;
      };

      const sourceStats = {
        cloudItems: 0,
        plexAccountHistoryItems: 0,
        plexAccountHistoryRetained: 0,
        pmsHistoryItems: 0,
        libraryWatchedItems: 0,
        libraryInventoryItems: 0,
        libraryInventoryScanSucceeded: false,
        libraryInventoryScanComplete: false,
        historyCollectionComplete: false
      };
      const libraryAvailabilityItems: any[] = [];
      const currentLibraryGuids = new Set<string>();
      const incompleteSources = new Set<string>();

      const getPlexAccountUuid = async (): Promise<string | null> => {
        try {
          const response = await fetch('https://plex.tv/api/v2/user', {
            headers: {
              'Accept': 'application/json',
              'X-Plex-Token': token,
              'X-Plex-Client-Identifier': plexClientIdentifier,
              'X-Plex-Product': 'SeenIt'
            },
            signal: AbortSignal.timeout(7000)
          });
          if (!response.ok) return null;
          const userData = await response.json();
          return typeof userData?.uuid === 'string' && userData.uuid.trim()
            ? userData.uuid.trim()
            : null;
        } catch (error: any) {
          console.log(`[Plex Sync] Plex account UUID unavailable: ${error?.message || error}`);
          return null;
        }
      };

      const fetchPlexAccountWatchHistory = async (): Promise<{ available: boolean; items: any[]; queryMode: string }> => {
        const uuid = await getPlexAccountUuid();
        if (!uuid) return { available: false, items: [], queryMode: 'none' };

        const runQuery = async (query: string, queryMode: string) => {
          const collected: any[] = [];
          const seenGuids = new Set<string>();
          let after: string | null = null;

          for (let page = 0; page < 50; page++) {
            const response = await fetch('https://community.plex.tv/api', {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Plex-Token': token,
                'X-Plex-Client-Identifier': plexClientIdentifier,
                'X-Plex-Product': 'SeenIt'
              },
              body: JSON.stringify({
                query,
                operationName: 'GetWatchHistoryHub',
                variables: { uuid, first: 100, ...(after ? { after } : {}) }
              }),
              signal: AbortSignal.timeout(10000)
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
              throw new Error(payload.errors.map((error: any) => error?.message || 'GraphQL error').join(' | '));
            }

            const history = payload?.data?.user?.watchHistory;
            const nodes = Array.isArray(history?.nodes) ? history.nodes : [];

            for (const node of nodes) {
              const normalized = normalizePlexAccountHistoryNode(node);
              if (!normalized?.guid || typeof normalized.guid !== 'string') continue;

              // Le Watch History du compte ne sert ici qu'à retrouver le GUID global.
              // Si les coordonnées S/E manquent, elles seront hydratées plus bas depuis
              // le véritable objet Metadata du provider Plex.
              const identity = normalized.guid.trim();
              if (!identity || seenGuids.has(identity)) continue;
              seenGuids.add(identity);
              collected.push(normalized);
            }

            const pageInfo = history?.pageInfo || {};
            if (!pageInfo.hasNextPage || !pageInfo.endCursor || nodes.length === 0) break;
            if (page === 49) {
              throw new Error('Watch History Plex plafonné à 5000 éléments');
            }
            after = String(pageInfo.endCursor);
          }

          return { available: true, items: collected, queryMode };
        };

        try {
          return await runQuery(PLEX_ACCOUNT_HISTORY_QUERY, 'rich');
        } catch (richError: any) {
          console.log(`[Plex Sync] Watch History GraphQL rich query unavailable, fallback minimal: ${richError?.message || richError}`);
          try {
            return await runQuery(PLEX_ACCOUNT_HISTORY_MINIMAL_QUERY, 'minimal');
          } catch (minimalError: any) {
            console.log(`[Plex Sync] Watch History Plex Account unavailable: ${minimalError?.message || minimalError}`);
            return { available: false, items: [], queryMode: 'none' };
          }
        }
      };

      // 1. Fetch from Plex Cloud Activity Feeds & Official Plex Watchlist
      const rawWatchlistItems: any[] = [];
      const watchlistEndpoints = [
        'https://discover.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
        'https://metadata.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
        'https://metadata.provider.plex.tv/library/sections/watchlist/today?includeUserState=1'
      ];

      let watchlistCollectionSucceeded = false;
      for (const wlEndpoint of watchlistEndpoints) {
        try {
          const items = await fetchPlexPages(wlEndpoint, {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': plexClientIdentifier,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }, delta ? 4000 : 7000, 50);
          watchlistCollectionSucceeded = true;
          if (items.length > 0) {
            console.log(`[Plex Sync] Fetched ${items.length} watchlist items from Plex Watchlist endpoint: ${wlEndpoint}`);
            rawWatchlistItems.push(...items);
            visitedSources.push(`Watchlist Plex (${items.length} éléments)`);
            break;
          }
        } catch (e: any) {
          console.log(`[Plex Sync] Watchlist endpoint skipped (${wlEndpoint}): ${e?.message || e}`);
        }
      }
      if (!watchlistCollectionSucceeded) {
        console.warn('[Plex Sync] Watchlist indisponible pour ce passage ; elle sera retentée indépendamment du curseur.');
      }

      const cloudEndpoints = delta
        ? [
            'https://discover.provider.plex.tv/activities?includeUserState=1'
          ]
        : [
            'https://discover.provider.plex.tv/activities?includeUserState=1',
            'https://discover.provider.plex.tv/library/metadata/userState?state=watched'
          ];

      let cloudCollectionSucceeded = false;
      for (const endpoint of cloudEndpoints) {
        try {
          const items = await fetchPlexPages(endpoint, {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': plexClientIdentifier,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }, delta ? 4000 : 7000, 50, delta ? Number(since) || undefined : undefined);
          cloudCollectionSucceeded = true;
          if (items.length > 0) {
            console.log(`[Plex Sync] Fetched ${items.length} items from Plex Cloud endpoint: ${endpoint}`);
            for (const it of items) {
              allRawItems.push({ raw: it, source: 'Plex Cloud Activity', sourceKind: 'cloud' });
            }
            sourceStats.cloudItems += items.length;
            visitedSources.push(`Plex Cloud (${items.length} éléments)`);
          }
        } catch (e: any) {
          console.log(`[Plex Sync] Cloud endpoint skipped (${endpoint}): ${e?.message || e}`);
        }
      }

      // En scan complet, récupérer l'historique lié au COMPTE Plex. Contrairement
      // au PMS /status/sessions/history, metadataItem.guid est une identité globale Plex.
      let accountHistoryAvailable = delta;
      if (!delta) {
        const accountHistory = await fetchPlexAccountWatchHistory();
        accountHistoryAvailable = accountHistory.available;
        if (accountHistory.available && accountHistory.items.length > 0) {
          for (const item of accountHistory.items) {
            allRawItems.push({
              raw: item,
              source: 'Plex Account Watch History',
              sourceKind: 'account-history'
            });
          }
          sourceStats.plexAccountHistoryItems = accountHistory.items.length;
          visitedSources.push(`Plex Account History (${accountHistory.items.length} GUID, mode ${accountHistory.queryMode})`);
          console.log(`[Plex Sync] Plex Account Watch History: ${accountHistory.items.length} identité(s) globale(s) récupérée(s) (${accountHistory.queryMode}).`);
        }
      }

      // 2. Fetch user's servers from Plex.tv (Both owned servers & shared servers from friends)
      const seenItUserId = (req as AuthRequest).user?.uid || 'anonymous';
      const servers = await getPlexServers(
        token,
        plexClientIdentifier,
        delta ? 6000 : 9000,
        seenItUserId
      );

      console.log(`[Plex Sync] Found ${servers.length} Plex server(s) (personal & shared)`);

      // 3. Interroger chaque serveur. En FULL, la bibliothèque actuelle gouverne les
      // imports Plex et la disponibilité, sans effacer les actions manuelles SeenIt. L'historique PMS n'est
      // qu'un fallback si le Watch History du compte Plex n'a fourni aucun GUID.
      const serverTimeout = delta ? 2500 : 5000;
      const usePmsHistoryInFull = !delta && !accountHistoryAvailable;
      let completeInventoryServers = 0;
      let completeHistoryServers = 0;
      const syncedServers: Array<{ id: string; name: string; watchedItems: number; inventoryItems: number }> = [];
      const skippedServers: Array<{ id: string; name: string; reason: string }> = [];

      const describeServerFailure = (message: unknown): string => {
        const normalized = String(message || '').toLowerCase();
        if (/abort|timeout|timed out|délai/.test(normalized)) return 'hors ligne ou délai dépassé';
        return 'inaccessible';
      };

      for (const server of servers) {
        const serverName = server.name || 'Serveur Plex';
        const serverId = String(server.clientIdentifier || serverName);
        const serverAccessToken = server.accessToken || token;
        const connections = server.connections || [];
        let serverItemCount = 0;
        let serverInventoryCount = 0;
        let serverHistoryComplete = false;
        let serverInventoryComplete = false;
        let lastFailure: unknown = 'aucune connexion disponible';

        const sortedConnections = [...connections].sort((a: any, b: any) => {
          const aIsRemote = !a.local && (a.uri || '').startsWith('https://');
          const bIsRemote = !b.local && (b.uri || '').startsWith('https://');
          if (aIsRemote && !bIsRemote) return -1;
          if (!aIsRemote && bIsRemote) return 1;
          return 0;
        });

        const isPrivateOrLocalUri = (uriStr: string): boolean => {
          try {
            const url = new URL(uriStr);
            const host = url.hostname;
            if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')) return true;
            if (host.startsWith('172.')) {
              const parts = host.split('.');
              if (parts.length >= 2) {
                const second = parseInt(parts[1], 10);
                if (second >= 16 && second <= 31) return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        };

        const hasRemoteConnection = sortedConnections.some((c: any) => c.uri && !isPrivateOrLocalUri(c.uri));

        for (const conn of sortedConnections) {
          const uri = conn.uri;
          if (!uri) continue;
          if (isPrivateOrLocalUri(uri) && hasRemoteConnection) continue;

          const connectionRawItems: any[] = [];
          const connectionAvailabilityItems: any[] = [];
          const connectionLibraryGuids = new Set<string>();
          let connectionHistoryComplete = !delta && !usePmsHistoryInFull;
          let connectionInventoryComplete = delta;
          let connectionInventoryCount = 0;
          let historyFoundOnConnection = 0;

          if (delta || usePmsHistoryInFull) {
            try {
              const items = await fetchPlexPages(
                `${uri}/status/sessions/history/all?sort=viewedAt:desc`,
                { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                serverTimeout,
                50,
                delta ? Number(since) || undefined : undefined
              );
              connectionHistoryComplete = true;
              if (items.length > 0) {
                for (const it of items) {
                  connectionRawItems.push({
                    raw: it,
                    source: serverName,
                    sourceKind: 'pms-history',
                    serverName,
                    serverId,
                    serverUri: uri,
                    serverToken: serverAccessToken
                  });
                }
                historyFoundOnConnection = items.length;
              }
            } catch (error: any) {
              lastFailure = error?.message || error;
              console.log(`[Plex Sync] Historique PMS inaccessible sur ${serverName}: ${error?.message || error}`);
            }
          }

          // Le recentlyViewed n'est qu'un fallback du delta si l'historique PMS n'est
          // pas accessible (cas de certains serveurs partagés). Il ne sert plus au FULL.
          if (delta && historyFoundOnConnection === 0) {
            try {
              const items = await fetchPlexPages(
                `${uri}/library/recentlyViewed?includeGuids=1`,
                { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                serverTimeout,
                10,
                Number(since) || undefined
              );
              connectionHistoryComplete = true;
              if (items.length > 0) {
                for (const it of items) {
                  connectionRawItems.push({
                    raw: it,
                    source: serverName,
                    sourceKind: 'pms-recent-fallback',
                    serverName,
                    serverId,
                    serverUri: uri,
                    serverToken: serverAccessToken
                  });
                }
              }
            } catch (error: any) {
              lastFailure = error?.message || error;
              console.log(`[Plex Sync] Recently viewed inaccessible sur ${serverName}: ${error?.message || error}`);
            }
          }

          if (!delta) {
            connectionInventoryComplete = true;
            try {
              const sectionsRes = await fetch(`${uri}/library/sections`, {
                headers: { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                signal: AbortSignal.timeout(serverTimeout)
              });

              if (!sectionsRes.ok) {
                throw new Error(`HTTP ${sectionsRes.status}`);
              }

              if (sectionsRes.ok) {
                const sectionsData = await sectionsRes.json();
                const sections = (sectionsData.MediaContainer && sectionsData.MediaContainer.Directory) || [];

                for (const sec of sections) {
                  const secKey = sec.key;
                  const secType = String(sec.type || '').toLowerCase();
                  if (!secKey || !['movie', 'show'].includes(secType)) continue;
                  const sourceName = `${serverName} - ${sec.title || 'Section'}`;

                  if (secType === 'movie') {
                    try {
                      const movies = await fetchPlexPages(
                        `${uri}/library/sections/${secKey}/all?sort=lastViewedAt:desc&includeGuids=1`,
                        { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                        serverTimeout,
                        100
                      );

                      for (const movie of movies) {
                        if (typeof movie?.guid === 'string' && movie.guid) connectionLibraryGuids.add(movie.guid);
                        connectionAvailabilityItems.push({ raw: movie, serverName, serverId });
                      }
                      connectionInventoryCount += movies.length;

                      const watchedMovies = movies.filter(isPlexLibraryItemWatched);
                      for (const movie of watchedMovies) {
                        connectionRawItems.push({
                          raw: movie,
                          source: sourceName,
                          sourceKind: 'library-watched',
                          availableOnServer: true,
                          serverName,
                          serverId,
                          serverUri: uri,
                          serverToken: serverAccessToken
                        });
                      }
                    } catch (error: any) {
                      connectionInventoryComplete = false;
                      lastFailure = error?.message || error;
                      console.log(`[Plex Sync] Movie section ${secKey} skipped on ${serverName}: ${error?.message || error}`);
                    }
                  }

                  if (secType === 'show') {
                    // 1) Liste des séries = index de disponibilité Plex pour les fiches SeenIt.
                    try {
                      const shows = await fetchPlexPages(
                        `${uri}/library/sections/${secKey}/all?includeGuids=1`,
                        { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                        serverTimeout,
                        100
                      );
                      for (const show of shows) {
                        if (typeof show?.guid === 'string' && show.guid) connectionLibraryGuids.add(show.guid);
                        connectionAvailabilityItems.push({ raw: show, serverName, serverId });
                      }
                      connectionInventoryCount += shows.length;
                    } catch (error: any) {
                      connectionInventoryComplete = false;
                      lastFailure = error?.message || error;
                      console.log(`[Plex Sync] Show inventory section ${secKey} skipped on ${serverName}: ${error?.message || error}`);
                    }

                    // 2) allLeaves = TOUS les épisodes. On filtre viewCount côté SeenIt,
                    // sans dépendre d'une syntaxe de filtre URL non garantie.
                    try {
                      const episodes = await fetchPlexPages(
                        `${uri}/library/sections/${secKey}/allLeaves?sort=lastViewedAt:desc&includeGuids=1`,
                        { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                        serverTimeout,
                        200
                      );
                      for (const episode of episodes) {
                        if (typeof episode?.guid === 'string' && episode.guid) connectionLibraryGuids.add(episode.guid);
                      }

                      const watchedEpisodes = episodes.filter(isPlexLibraryItemWatched);
                      for (const episode of watchedEpisodes) {
                        connectionRawItems.push({
                          raw: episode,
                          source: sourceName,
                          sourceKind: 'library-watched',
                          availableOnServer: true,
                          serverName,
                          serverId,
                          serverUri: uri,
                          serverToken: serverAccessToken
                        });
                      }
                    } catch (error: any) {
                      connectionInventoryComplete = false;
                      lastFailure = error?.message || error;
                      console.log(`[Plex Sync] Episode inventory section ${secKey} skipped on ${serverName}: ${error?.message || error}`);
                    }
                  }
                }

                if (connectionInventoryComplete) {
                  connectionInventoryComplete = true;
                }
              }
            } catch (error: any) {
              connectionInventoryComplete = false;
              lastFailure = error?.message || error;
              console.log(`[Plex Sync] Inventaire inaccessible sur ${serverName}: ${error?.message || error}`);
            }
          }

          const requiredConnectionComplete = delta
            ? connectionHistoryComplete
            : connectionInventoryComplete && connectionHistoryComplete;
          if (requiredConnectionComplete) {
            serverHistoryComplete = connectionHistoryComplete;
            serverInventoryComplete = connectionInventoryComplete;
            const historyItems = connectionRawItems.filter((entry) => (
              entry.sourceKind === 'pms-history' || entry.sourceKind === 'pms-recent-fallback'
            ));
            const libraryItems = connectionRawItems.filter((entry) => entry.sourceKind === 'library-watched');

            allRawItems.push(...historyItems);
            sourceStats.pmsHistoryItems += historyItems.filter((entry) => entry.sourceKind === 'pms-history').length;

            if (!delta) {
              allRawItems.push(...libraryItems);
              libraryAvailabilityItems.push(...connectionAvailabilityItems);
              connectionLibraryGuids.forEach((guid) => currentLibraryGuids.add(guid));
              sourceStats.libraryInventoryItems += connectionInventoryCount;
              sourceStats.libraryWatchedItems += libraryItems.length;
            }

            serverItemCount = historyItems.length + libraryItems.length;
            serverInventoryCount = connectionInventoryCount;
            visitedSources.push(`${serverName} (${serverItemCount} vu(s), ${serverInventoryCount} média(s) indexé(s))`);
            break;
          }
        }

        if (serverHistoryComplete) completeHistoryServers++;
        if (!delta && serverInventoryComplete) {
          completeInventoryServers++;
        }

        const serverSucceeded = delta ? serverHistoryComplete : serverInventoryComplete && serverHistoryComplete;
        if (serverSucceeded) {
          syncedServers.push({
            id: serverId,
            name: serverName,
            watchedItems: serverItemCount,
            inventoryItems: serverInventoryCount
          });
        } else {
          skippedServers.push({
            id: serverId,
            name: serverName,
            reason: describeServerFailure(lastFailure)
          });
        }
      }

      const sourceCompletion = evaluatePlexSourceCompletion({
        delta,
        serverCount: servers.length,
        completeInventoryServers,
        completeHistoryServers,
        accountHistoryAvailable,
        cloudCollectionSucceeded
      });
      sourceStats.libraryInventoryScanComplete = sourceCompletion.libraryInventoryScanComplete;
      sourceStats.libraryInventoryScanSucceeded = sourceCompletion.libraryInventoryScanSucceeded;
      sourceStats.historyCollectionComplete = sourceCompletion.historyCollectionComplete;
      if (!sourceCompletion.historyCollectionComplete) {
        incompleteSources.add(delta ? 'historique récent Plex' : 'historique complet Plex');
      }

      // Les médias toujours présents dans une bibliothèque actuelle sont gouvernés par
      // leur viewCount actuel. On retire donc leurs anciens événements Account History
      // par GUID exact. Les événements orphelins (GUID absent des bibliothèques) restent.
      let removedAccountDuplicates = 0;
      if (!delta && currentLibraryGuids.size > 0) {
        for (let index = allRawItems.length - 1; index >= 0; index--) {
          const entry = allRawItems[index];
          if (entry?.sourceKind !== 'account-history') continue;
          const guid = typeof entry?.raw?.guid === 'string' ? entry.raw.guid : '';
          if (guid && currentLibraryGuids.has(guid)) {
            allRawItems.splice(index, 1);
            removedAccountDuplicates++;
          }
        }
      }
      sourceStats.plexAccountHistoryRetained = Math.max(0, sourceStats.plexAccountHistoryItems - removedAccountDuplicates);

      console.log(
        `[Plex Sync] Sources FULL/DELTA: account=${sourceStats.plexAccountHistoryItems} ` +
        `(retained=${sourceStats.plexAccountHistoryRetained}), libraryWatched=${sourceStats.libraryWatchedItems}, ` +
        `libraryInventory=${sourceStats.libraryInventoryItems}, pmsHistory=${sourceStats.pmsHistoryItems}, cloud=${sourceStats.cloudItems}.`
      );

      console.log(`[Plex Sync] Collected a total of ${allRawItems.length} raw history records across all sources.`);

      // 4. Enrichir les entrées dépourvues d'identifiant externe via leur ratingKey serveur.
      // Pour un épisode, les GUID de l'épisode ne suffisent pas : on récupère aussi
      // explicitement les identifiants de la série parente.
      // Le jeton reste exclusivement dans l'en-tête et n'est jamais renvoyé au client.
      const metadataCache = new Map<string, any>();
      const providerMetadataCache = new Map<string, any>();

      const fetchProviderMetadata = async (rawGuid: unknown): Promise<any | null> => {
        if (typeof rawGuid !== 'string' || !rawGuid.trim()) return null;
        const plexId = extractPlexExternalIds({ guid: rawGuid }).plexGuid;
        if (!plexId) return null;
        if (providerMetadataCache.has(plexId)) return providerMetadataCache.get(plexId);

        try {
          const response = await fetch(`https://discover.provider.plex.tv/library/metadata/${encodeURIComponent(plexId)}?includeGuids=1`, {
            headers: {
              'Accept': 'application/json',
              'X-Plex-Token': token,
              'X-Plex-Client-Identifier': plexClientIdentifier,
              'X-Plex-Product': 'SeenIt'
            },
            signal: AbortSignal.timeout(6000)
          });
          if (!response.ok) return null;
          const payload = await response.json();
          const metadata = extractItems(payload)[0] || null;
          if (metadata) providerMetadataCache.set(plexId, metadata);
          return metadata;
        } catch {
          return null;
        }
      };

      const fetchServerMetadata = async (entry: any, ratingKey: unknown): Promise<any | null> => {
        if (!ratingKey || !entry.serverUri || !entry.serverToken) return null;

        const ratingKeyValue = String(ratingKey);
        const metadataKey = ratingKeyValue.match(/\/library\/metadata\/([^/?]+)/)?.[1] || ratingKeyValue;
        const cacheKey = `${entry.serverId || entry.serverUri}:${metadataKey}`;
        if (metadataCache.has(cacheKey)) return metadataCache.get(cacheKey);

        try {
          const metadataUrl = `${entry.serverUri}/library/metadata/${encodeURIComponent(metadataKey)}?includeGuids=1`;
          const metadataResponse = await fetch(metadataUrl, {
            headers: { 'Accept': 'application/json', 'X-Plex-Token': entry.serverToken },
            signal: AbortSignal.timeout(2500)
          });
          if (!metadataResponse.ok) return null;

          const metadataData = await metadataResponse.json();
          const metadata = extractItems(metadataData)[0] || null;
          if (metadata) metadataCache.set(cacheKey, metadata);
          return metadata;
        } catch {
          return null;
        }
      };

      const enrichEntry = async (entry: any): Promise<any> => {
        const originalRaw = entry.raw || {};
        let raw = originalRaw;
        let meta = unwrapPlexMediaItem(raw);

        // Le Watch History compte fournit un GUID global. On l'utilise immédiatement
        // pour charger l'objet Metadata documenté par Plex : ratingKey/key/guid et,
        // pour les épisodes, parentIndex/index/grandparentGuid deviennent disponibles.
        if (entry.sourceKind === 'account-history' && typeof meta?.guid === 'string') {
          const providerMetadata = await fetchProviderMetadata(meta.guid);
          if (providerMetadata) {
            raw = {
              ...originalRaw,
              ...providerMetadata,
              historyKey: originalRaw.historyKey,
              accountHistoryId: originalRaw.accountHistoryId,
              accountMetadataId: originalRaw.accountMetadataId,
              parentAccountMetadataId: originalRaw.parentAccountMetadataId,
              grandparentAccountMetadataId: originalRaw.grandparentAccountMetadataId
            };
            entry = { ...entry, raw };
            meta = unwrapPlexMediaItem(raw);
          }
        }

        const rawType = String(meta.type || raw.type || '').toLowerCase();
        const isEpisode = rawType === 'episode' || !!meta.grandparentTitle ||
          (meta.parentIndex !== undefined && meta.index !== undefined);
        const currentIds = extractPlexExternalIds(meta);
        const parentIds = extractPlexExternalIds(buildPlexParentShowIdentityItem(meta));
        const hasExternalIdentity = !!(currentIds.tmdbId || currentIds.imdbId || currentIds.tvdbId);
        const hasParentIdentity = !!(parentIds.tmdbId || parentIds.imdbId || parentIds.tvdbId || parentIds.plexGuid);

        if (!entry.serverUri || !entry.serverToken) return entry;
        if (!isEpisode && hasExternalIdentity) return entry;
        if (isEpisode && hasParentIdentity) return entry;

        // Un épisode d'historique peut perdre son propre ratingKey tout en conservant
        // grandparentKey/grandparentThumb. On résout alors DIRECTEMENT le show parent
        // sur le PMS, sans jamais utiliser le titre de la série.
        let parentMetadata: any | null = null;
        if (isEpisode) {
          const parentLookupKey =
            getPlexParentShowMetadataLookupKey(meta) ||
            getPlexParentShowMetadataLookupKey(raw);

          if (parentLookupKey) {
            parentMetadata = await fetchServerMetadata(entry, parentLookupKey);
            if (parentMetadata) {
              const resolvedParentIds = extractPlexExternalIds(parentMetadata);
              if (resolvedParentIds.tmdbId || resolvedParentIds.imdbId || resolvedParentIds.tvdbId || resolvedParentIds.plexGuid) {
                return {
                  ...entry,
                  raw: {
                    ...raw,
                    grandparentGuid: meta.grandparentGuid || raw.grandparentGuid || parentMetadata.guid,
                    grandparentGuids: meta.grandparentGuids || raw.grandparentGuids || parentMetadata.Guid || parentMetadata.guids,
                    grandparentRatingKey: meta.grandparentRatingKey || raw.grandparentRatingKey || parentMetadata.ratingKey || parentLookupKey,
                    grandparentKey: meta.grandparentKey || raw.grandparentKey || parentMetadata.key,
                    grandparentThumb: meta.grandparentThumb || raw.grandparentThumb || parentMetadata.thumb,
                    grandparentArt: meta.grandparentArt || raw.grandparentArt || parentMetadata.art
                  }
                };
              }
            }
          }
        }

        // Sinon, tenter de retrouver l'objet lui-même. getPlexMetadataLookupKey sait
        // désormais extraire le ratingKey depuis metadataItemID, thumb ou art.
        const ratingKey = getPlexMetadataLookupKey(meta) || getPlexMetadataLookupKey(raw);
        if (!ratingKey) return entry;

        const enriched = await fetchServerMetadata(entry, ratingKey);
        if (!enriched) return entry;
        if (!isEpisode) return { ...entry, raw: { ...raw, ...enriched } };

        const parentLookupKey =
          enriched.grandparentRatingKey ||
          getPlexParentShowMetadataLookupKey(enriched) ||
          getPlexParentShowMetadataLookupKey(meta) ||
          getPlexParentShowMetadataLookupKey(raw);

        if (!parentMetadata && parentLookupKey) {
          parentMetadata = await fetchServerMetadata(entry, parentLookupKey);
        }

        return {
          ...entry,
          raw: {
            ...raw,
            ...enriched,
            // Toujours préserver l'identité structurelle de l'épisode d'historique.
            type: meta.type || raw.type || enriched.type,
            title: meta.title || raw.title || enriched.title,
            grandparentTitle: meta.grandparentTitle || raw.grandparentTitle || enriched.grandparentTitle || parentMetadata?.title,
            parentIndex: meta.parentIndex ?? raw.parentIndex ?? enriched.parentIndex,
            index: meta.index ?? raw.index ?? enriched.index,
            grandparentGuid: enriched.grandparentGuid || meta.grandparentGuid || raw.grandparentGuid || parentMetadata?.guid,
            grandparentGuids: enriched.grandparentGuids || meta.grandparentGuids || raw.grandparentGuids || parentMetadata?.Guid || parentMetadata?.guids,
            grandparentRatingKey: enriched.grandparentRatingKey || meta.grandparentRatingKey || raw.grandparentRatingKey || parentMetadata?.ratingKey || parentLookupKey,
            grandparentKey: enriched.grandparentKey || meta.grandparentKey || raw.grandparentKey || parentMetadata?.key,
            grandparentThumb: enriched.grandparentThumb || meta.grandparentThumb || raw.grandparentThumb || parentMetadata?.thumb,
            grandparentArt: enriched.grandparentArt || meta.grandparentArt || raw.grandparentArt || parentMetadata?.art
          }
        };
      };

      const enrichedEntries: any[] = [];
      const ENRICH_CONCURRENCY = 6;
      for (let index = 0; index < allRawItems.length; index += ENRICH_CONCURRENCY) {
        const chunk = allRawItems.slice(index, index + ENRICH_CONCURRENCY);
        enrichedEntries.push(...await Promise.all(chunk.map(enrichEntry)));
      }

      // 5. Normaliser sans aucune déduplication par titre ou année.
      // La déduplication fiable a lieu côté client après résolution du TMDB ID.
      const normalizedHistory: any[] = [];
      const normalizedSince = Number.isFinite(Number(since)) ? Number(since) : undefined;

      for (const entry of enrichedEntries) {
        const raw = entry.raw || {};
        const meta = unwrapPlexMediaItem(raw);
        const source = entry.source;

        const rawType = (meta.type || raw.type || raw.activityType || '').toLowerCase();
        const isEpisode = rawType === 'episode' || !!meta.grandparentTitle || (meta.parentIndex !== undefined && meta.index !== undefined);
        const isMovie = rawType === 'movie' || (!isEpisode && (rawType === 'video' || rawType === 'film' || rawType === 'watch' || rawType === 'watched'));
        const type = isEpisode ? 'episode' : (isMovie ? 'movie' : (rawType || 'movie'));

        const title = meta.title || raw.title || meta.name || raw.name || '';
        const grandparentTitle = meta.grandparentTitle || raw.grandparentTitle || (isEpisode ? (meta.showTitle || raw.showTitle) : undefined);
        const parentIndex = meta.parentIndex ?? raw.parentIndex ?? meta.seasonNumber ?? raw.seasonNumber;
        const index = meta.index ?? raw.index ?? meta.episodeNumber ?? raw.episodeNumber;

        const rawViewed = meta.lastViewedAt || meta.viewedAt || raw.viewedAt || raw.lastViewedAt || raw.date || raw.createdAt || raw.updatedAt || meta.updatedAt || meta.addedAt || Date.now();
        const viewedTimestamp = rawViewed ? (Number(rawViewed) < 10000000000 ? Number(rawViewed) * 1000 : Number(rawViewed)) : Date.now();
        const sourceIdentity = getStrongPlexSourceIdentity({ ...meta, serverId: entry.serverId });

        if (!title && !grandparentTitle && !sourceIdentity) continue;

        // Extract item year (also check originallyAvailableAt or title string like 'Cinderella (2015)' if year property missing)
        let itemYear = meta.year || raw.year || meta.parentYear || meta.grandparentYear ? Number(meta.year || raw.year || meta.parentYear || meta.grandparentYear) : undefined;
        if (!itemYear && (meta.originallyAvailableAt || raw.originallyAvailableAt || meta.premiered || raw.premiered)) {
          const dateStr = String(meta.originallyAvailableAt || raw.originallyAvailableAt || meta.premiered || raw.premiered);
          const m = dateStr.match(/^(\d{4})/);
          if (m) itemYear = Number(m[1]);
        }
        if (!itemYear) {
          const matchYear = (title || '').match(/\((\d{4})\)/);
          if (matchYear) itemYear = Number(matchYear[1]);
        }

        if (delta && normalizedSince && viewedTimestamp <= normalizedSince) continue;

        normalizedHistory.push({
          type,
          title,
          grandparentTitle,
          parentTitle: meta.parentTitle || raw.parentTitle,
          parentIndex: parentIndex !== undefined ? Number(parentIndex) : undefined,
          index: index !== undefined ? Number(index) : undefined,
          viewedAt: viewedTimestamp,
          year: itemYear,
          guid: meta.guid || raw.guid,
          grandparentGuid: meta.grandparentGuid || raw.grandparentGuid,
          grandparentGuids: meta.grandparentGuids || raw.grandparentGuids,
          parentGuid: meta.parentGuid || raw.parentGuid,
          grandparentKey: meta.grandparentKey || raw.grandparentKey,
          parentKey: meta.parentKey || raw.parentKey,
          grandparentRatingKey: meta.grandparentRatingKey || raw.grandparentRatingKey,
          Guid: meta.Guid || raw.Guid,
          guids: meta.guids || raw.guids,
          ratingKey: meta.ratingKey || raw.ratingKey,
          key: meta.key || raw.key,
          metadataKey: meta.metadataKey || meta.metadata_key || raw.metadataKey || raw.metadata_key,
          metadataItemID: meta.metadataItemID || meta.metadataItemId || raw.metadataItemID || raw.metadataItemId,
          historyKey: meta.historyKey || raw.historyKey,
          librarySectionID: meta.librarySectionID || raw.librarySectionID,
          thumb: meta.thumb || raw.thumb,
          art: meta.art || raw.art,
          grandparentThumb: meta.grandparentThumb || raw.grandparentThumb,
          grandparentArt: meta.grandparentArt || raw.grandparentArt,
          serverId: entry.serverId,
          serverName: entry.serverName || source,
          sourceKind: entry.sourceKind || 'unknown',
          availableOnServer: entry.availableOnServer === true,
          sourceIdentity,
          source
        });
      }

      normalizedHistory.sort((a, b) => b.viewedAt - a.viewedAt);

      // Normaliser la Watchlist sans fusion par titre/année.
      const normalizedWatchlist: any[] = [];
      for (const rawItem of rawWatchlistItems) {
        const meta = unwrapPlexMediaItem(rawItem);
        const rawType = (meta.type || rawItem.type || '').toLowerCase();
        const type = (rawType === 'show' || rawType === 'series' || rawType === 'tv') ? 'show' : 'movie';
        const title = meta.title || rawItem.title || meta.name || '';
        const sourceIdentity = getStrongPlexSourceIdentity(meta);
        if (!title && !sourceIdentity) continue;

        let wlYear = meta.year || rawItem.year ? Number(meta.year || rawItem.year) : undefined;
        if (!wlYear) {
          const matchYear = title.match(/\((\d{4})\)/);
          if (matchYear) wlYear = Number(matchYear[1]);
        }

        normalizedWatchlist.push({
          type,
          title,
          year: wlYear,
          guid: meta.guid || rawItem.guid,
          grandparentGuid: meta.grandparentGuid || rawItem.grandparentGuid,
          parentGuid: meta.parentGuid || rawItem.parentGuid,
          Guid: meta.Guid || rawItem.Guid,
          guids: meta.guids || rawItem.guids,
          ratingKey: meta.ratingKey || rawItem.ratingKey,
          key: meta.key || rawItem.key,
          metadataKey: meta.metadataKey || meta.metadata_key || rawItem.metadataKey || rawItem.metadata_key,
          addedAt: meta.addedAt || rawItem.addedAt || null,
          sourceIdentity
        });
      }

      const normalizedLibraryAvailability: any[] = [];
      const availabilitySeen = new Set<string>();
      for (const entry of libraryAvailabilityItems) {
        const meta = unwrapPlexMediaItem(entry.raw || {});
        const rawType = String(meta.type || '').toLowerCase();
        const mediaType = rawType === 'show' || rawType === 'series' ? 'tv' : rawType === 'movie' ? 'movie' : null;
        if (!mediaType) continue;

        const ids = extractPlexExternalIds(meta);
        if (!ids.tmdbId) continue;
        const ratingKey = getPlexMetadataLookupKey(meta);
        if (!ratingKey || !entry.serverId) continue;

        // Le client ne conserve qu'une destination Plex par média TMDB. Éviter de
        // renvoyer le même média une fois par serveur réduit fortement le payload
        // des bibliothèques partagées sans introduire de rapprochement par titre.
        const availabilityKey = `${mediaType}:${ids.tmdbId}`;
        if (availabilitySeen.has(availabilityKey)) continue;
        availabilitySeen.add(availabilityKey);

        normalizedLibraryAvailability.push({
          tmdbId: ids.tmdbId,
          mediaType,
          serverName: entry.serverName || 'Plex',
          serverId: entry.serverId,
          ratingKey
        });
      }

      const stats = {
        ...sourceStats,
        rawItems: allRawItems.length,
        normalizedHistoryItems: normalizedHistory.length,
        availabilitySeedItems: normalizedLibraryAvailability.length
      };
      const integrity = {
        collectionComplete: incompleteSources.size === 0,
        libraryInventoryScanSucceeded: sourceStats.libraryInventoryScanSucceeded,
        libraryInventoryScanComplete: sourceStats.libraryInventoryScanComplete,
        incompleteSources: [...incompleteSources],
        syncedServers,
        skippedServers
      };

      console.log(`[Plex Sync] Returning ${normalizedHistory.length} history items, ${normalizedWatchlist.length} watchlist items and ${normalizedLibraryAvailability.length} availability item(s).`);
      console.log(
        `[Plex Sync] Serveurs synchronisés: ${syncedServers.map((server) => server.name).join(', ') || 'aucun'}; ` +
        `ignorés: ${skippedServers.map((server) => `${server.name} (${server.reason})`).join(', ') || 'aucun'}.`
      );
      if (!integrity.collectionComplete) {
        console.warn(`[Plex Sync] Collecte incomplète, curseur non validable : ${integrity.incompleteSources.join(', ')}`);
      }

      return res.status(200).json({ 
        history: normalizedHistory,
        watchlist: normalizedWatchlist,
        libraryAvailability: normalizedLibraryAvailability,
        stats,
        integrity,
        visitedSources,
        totalFound: normalizedHistory.length + normalizedWatchlist.length,
        cursor: syncCursor
      });
    } catch (err: any) {
      console.error('[Plex Sync Error]', err);
      return res.status(500).json({ error: err?.message || 'Erreur lors de la synchronisation de l\'historique Plex' });
    }
  });

  // Test de connexion C411 pour l'utilisateur authentifié
  app.post('/api/c411/test', requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Utilisateur non authentifie' });
      }

      const submittedApiKey =
        typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      if (submittedApiKey.length > 512) {
        return res.status(400).json({ success: false, error: 'Cle API C411 invalide' });
      }

      let apiKey = submittedApiKey;
      if (!apiKey) {
        const configSnapshot = await adminDb
          .doc(`users/${userId}/settings/downloadConfig`)
          .get();
        const storedApiKey = configSnapshot.get('c411ApiKey');
        apiKey = typeof storedApiKey === 'string' ? storedApiKey.trim() : '';
      }

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'Cle API C411 non configuree pour cet utilisateur'
        });
      }

      const response = await fetch(
        'https://c411.org/api/torrents?name=matrix&category=1',
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'User-Agent': 'SeenIt-App'
          },
          signal: AbortSignal.timeout(8000)
        }
      );

      if (response.status === 401 || response.status === 403) {
        return res.status(401).json({
          success: false,
          error: 'Cle API C411 refusee'
        });
      }

      if (!response.ok) {
        return res.status(502).json({
          success: false,
          error: `C411 a retourne le statut ${response.status}`
        });
      }

      return res.json({
        success: true,
        message: 'Connexion C411 reussie !'
      });
    } catch (error: any) {
      console.error('[C411 Test Error]', error);
      return res.status(502).json({
        success: false,
        error: error?.name === 'TimeoutError'
          ? 'C411 ne repond pas dans le delai imparti'
          : 'Impossible de tester la connexion C411'
      });
    }
  });

  // C411 Tracker API proxy
  app.post('/api/c411/search', requireAuth, async (req: AuthRequest, res) => {
    try {
      const query = (typeof req.body?.query === 'string' ? req.body.query : '').trim();
      const mediaType = typeof req.body?.mediaType === 'string' ? req.body.mediaType : 'movie';
      const year = typeof req.body?.year === 'string' ? req.body.year : undefined;
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: 'Utilisateur non authentifie', torrents: [] });
      }

      const configSnapshot = await adminDb
        .doc(`users/${userId}/settings/downloadConfig`)
        .get();
      const storedApiKey = configSnapshot.get('c411ApiKey');
      const apiKey = typeof storedApiKey === 'string' ? storedApiKey.trim() : '';

      if (!query) {
        return res.json({ torrents: [] });
      }
      if (!apiKey) {
        return res.status(400).json({
          error: 'Cle API C411 non configuree pour cet utilisateur',
          torrents: []
        });
      }

      // Nettoyage de la recherche pour C411
      const cleanQuery = query
        .replace(/[:’']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const searchParams = new URLSearchParams();
      searchParams.set('name', cleanQuery);
      searchParams.set('category', '1'); // Films & Vidéos
      
      // Filtrer par sous-catégorie si possible
      if (mediaType === 'tv') {
        searchParams.set('subcategory', '7'); // Séries TV
      } else if (mediaType === 'movie') {
        searchParams.set('subcategory', '6'); // Film
      }

      const c411Url = `https://c411.org/api/torrents?${searchParams.toString()}`;
      const response = await fetch(c411Url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'SeenIt-App'
        }
      });

      if (!response.ok) {
        // Fallback sans filtre de sous-catégorie
        const fallbackUrl = `https://c411.org/api/torrents?name=${encodeURIComponent(cleanQuery)}&category=1`;
        const fbRes = await fetch(fallbackUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'User-Agent': 'SeenIt-App'
          }
        });
        if (!fbRes.ok) {
          return res.json({ torrents: [] });
        }
        const fbData = await fbRes.json();
        return res.json({ torrents: fbData.data || [] });
      }

      const data = await response.json();
      let torrents = data.data || [];

      // Si aucun résultat avec la sous-catégorie, tentative élargie
      if (torrents.length === 0) {
        const broadUrl = `https://c411.org/api/torrents?name=${encodeURIComponent(cleanQuery)}`;
        const broadRes = await fetch(broadUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'User-Agent': 'SeenIt-App'
          }
        });
        if (broadRes.ok) {
          const broadData = await broadRes.json();
          torrents = broadData.data || [];
        }
      }

      return res.json({ torrents });
    } catch (error: any) {
      console.error('[C411 Search Error]', error);
      return res.status(500).json({ error: error.message, torrents: [] });
    }
  });

  // Remote Download Dispatcher (Sonarr / Radarr / qBittorrent)
  app.post('/api/downloads/push', requireAuth, express.json(), async (req, res) => {
    try {
      const {
        service,
        url,
        apiKey,
        username,
        password,
        torrent,
        mediaType,
        tmdbId,
        title,
        year
      } = req.body;

      if (!url) {
        return res.status(400).json({ error: 'URL du service manquante' });
      }

      const cleanUrl = url.replace(/\/+$/, '');

      // 1. Envoi vers Sonarr (Séries)
      if (service === 'sonarr') {
        const sonarrEndpoint = `${cleanUrl}/api/v3/release/push`;
        const payload = {
          title: torrent.name,
          downloadUrl: torrent.magnetUri,
          protocol: 'torrent',
          publishDate: torrent.createdAt || new Date().toISOString()
        };

        const sonarrRes = await secureServerFetch(sonarrEndpoint, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (sonarrRes.ok) {
          return res.json({ message: 'Release envoyée avec succès à Sonarr !' });
        } else {
          const errTxt = await sonarrRes.text();
          return res.status(sonarrRes.status).json({ error: `Sonarr a retourné : ${errTxt.substring(0, 150)}` });
        }
      }

      // 2. Envoi vers Radarr (Films)
      if (service === 'radarr') {
        const radarrEndpoint = `${cleanUrl}/api/v3/release/push`;
        const payload = {
          title: torrent.name,
          downloadUrl: torrent.magnetUri,
          protocol: 'torrent',
          publishDate: torrent.createdAt || new Date().toISOString()
        };

        const radarrRes = await secureServerFetch(radarrEndpoint, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (radarrRes.ok) {
          return res.json({ message: 'Release envoyée avec succès à Radarr !' });
        } else {
          const errTxt = await radarrRes.text();
          return res.status(radarrRes.status).json({ error: `Radarr a retourné : ${errTxt.substring(0, 150)}` });
        }
      }

      // 3. Envoi vers qBittorrent Web UI
      if (service === 'qbittorrent') {
        // Authentification session qBittorrent si username/password
        let cookieHeader = '';
        if (username || password) {
          const loginRes = await secureServerFetch(`${cleanUrl}/api/v2/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`
          });
          const setCookie = loginRes.headers.get('set-cookie');
          if (setCookie) {
            cookieHeader = setCookie.split(';')[0];
          }
        }

        const formData = new URLSearchParams();
        formData.append('urls', torrent.magnetUri);
        formData.append('category', mediaType === 'tv' ? 'tv' : 'movies');

        const addRes = await secureServerFetch(`${cleanUrl}/api/v2/torrents/add`, {
          method: 'POST',
          headers: {
            'Cookie': cookieHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        });

        if (addRes.ok) {
          return res.json({ message: 'Torrent ajouté avec succès à qBittorrent !' });
        } else {
          const errTxt = await addRes.text();
          return res.status(addRes.status).json({ error: `qBittorrent : ${errTxt}` });
        }
      }

      return res.status(400).json({ error: 'Service de téléchargement non reconnu' });
    } catch (err: any) {
      console.error('[Downloads Push Error]', err);
      return res.status(500).json({ error: err.message });
    }
  });

      app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const execAsync = promisify(exec);

  app.get('/api/git/status', async (req, res) => {
    try {
      const gitDirExists = fs.existsSync(path.join(process.cwd(), '.git'));
      if (!gitDirExists) {
        return res.json({
          configured: false,
          branch: 'main',
          commit: null,
          isClean: true,
          message: 'Dossier .git non initialisé (récupération automatique disponible au prochain pull)'
        });
      }

      const { stdout: commitInfo } = await execAsync('git log -n 1 --format="%h||%s||%cr||%an"');
      const [hash, message, time, author] = (commitInfo || '').trim().split('||');

      const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD');
      const { stdout: statusOut } = await execAsync('git status --porcelain');

      res.json({
        configured: true,
        branch: branchName.trim(),
        commit: {
          hash: hash || 'Inconnu',
          message: message || 'Dernier commit',
          time: time || '',
          author: author || ''
        },
        isClean: statusOut.trim().length === 0,
        message: 'Dépôt Git actif et synchronisé'
      });
    } catch (err: any) {
      console.error('[Git Status Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/git/pull', requireAuth, async (req, res) => {
    try {
      console.log('[Git Pull] Déclenchement de la synchronisation Git via API...');
      const { stdout, stderr } = await execAsync('bash scripts/pull.sh');
      console.log('[Git Pull Output]', stdout);
      if (stderr) console.warn('[Git Pull Stderr]', stderr);

      let commit = null;
      try {
        const { stdout: commitInfo } = await execAsync('git log -n 1 --format="%h||%s||%cr||%an"');
        const [hash, message, time, author] = (commitInfo || '').trim().split('||');
        commit = { hash, message, time, author };
      } catch {}

      res.json({
        success: true,
        message: 'Dépôt Git synchronisé avec succès !',
        output: stdout,
        commit
      });
    } catch (err: any) {
      console.error('[Git Pull Error]', err);
      res.status(500).json({
        success: false,
        error: err.message,
        stderr: err.stderr || ''
      });
    }
  });

  app.get('/api/update', async (req, res) => {
    try {
      const token = process.env.GITHUB_PAT || '';
      const repo = 'julfou7/seenit-app';
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SeenIt-Backend'
      };
      if (token) {
        headers['Authorization'] = `token ${token}`;
      }
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error('Error fetching update:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy pour les requêtes vers les services tiers (Sonarr, Radarr, qBittorrent, etc.) en mode Web
  app.post('/api/service-proxy', requireAuth, async (req, res) => {
    try {
      const { targetUrl, method = 'GET', headers = {}, body } = req.body;
      if (!targetUrl) {
        return res.status(400).json({ error: 'targetUrl requis' });
      }

      const normalizedMethod = String(method).toUpperCase();
      const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
      if (!allowedMethods.has(normalizedMethod)) {
        return res.status(400).json({ error: 'Methode HTTP non autorisee' });
      }

      await validateOutboundUrl(targetUrl);

      // Dériver Origin et Referer automatiquement pour qBittorrent et autres services avec vérification CSRF / Host
      const sanitizedHeaders = sanitizeProxyHeaders(headers);
      let origin = sanitizedHeaders['Origin'] || sanitizedHeaders['origin'];
      let referer = sanitizedHeaders['Referer'] || sanitizedHeaders['referer'];
      try {
        const parsedUrl = new URL(targetUrl);
        if (!origin) origin = parsedUrl.origin;
        if (!referer) referer = `${parsedUrl.origin}/`;
      } catch {}

      const cleanHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SeenIt/1.0',
        ...sanitizedHeaders
      };
      if (origin && !cleanHeaders['Origin'] && !cleanHeaders['origin']) cleanHeaders['Origin'] = origin;
      if (referer && !cleanHeaders['Referer'] && !cleanHeaders['referer']) cleanHeaders['Referer'] = referer;

      const fetchOptions: any = {
        method: normalizedMethod,
        headers: cleanHeaders,
        signal: AbortSignal.timeout(10000)
      };

      if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD' && body !== undefined && body !== null) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type'] && typeof body !== 'string') {
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      }

      const response = await secureServerFetch(targetUrl, fetchOptions);
      const text = await response.text();
      let data: any = text;
      try {
        data = JSON.parse(text);
      } catch {}

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });
      const setCookie = response.headers.get('set-cookie');

      res.status(200).json({
        status: response.status,
        ok: response.ok,
        data,
        headers: responseHeaders,
        cookie: setCookie
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.message?.includes('aborted') || err?.message?.includes('timeout')) {
        return res.status(200).json({
          status: 504,
          ok: false,
          error: 'TIMEOUT',
          message: 'Délai d\'attente dépassé (timeout) pour joindre le service cible.'
        });
      }
      res.status(200).json({
        status: 500,
        ok: false,
        error: 'PROXY_FETCH_ERROR',
        message: err?.message || 'Erreur lors de la requête proxy'
      });
    }
  });

  // Webhooks Sonarr & Radarr pour notifications instantanées
  app.post(['/api/webhook/sonarr', '/api/webhook/radarr'], requireWebhookSecret, async (req, res) => {
    try {
      const payload = req.body || {};
      const eventType = payload.eventType || payload.event_type || 'Unknown';
      console.log(`[Webhook ${req.path}] Event received:`, eventType, payload);

      if (eventType === 'Test') {
        return res.json({ success: true, message: 'Test webhook reçu avec succès par SeenIt !' });
      }

      let title = 'Notification Téléchargement';
      let body = 'Un événement de téléchargement a eu lieu.';

      if (eventType === 'Grab') {
        const mediaTitle = payload.series?.title || payload.movie?.title || payload.release?.releaseTitle || 'Média';
        title = 'Téléchargement démarré 🚀';
        body = `"${mediaTitle}" a été envoyé au client de téléchargement.`;
      } else if (eventType === 'Download') {
        const mediaTitle = payload.series?.title || payload.movie?.title || 'Média';
        const epInfo = payload.episodes?.[0] ? ` (S${payload.episodes[0].seasonNumber}E${payload.episodes[0].episodeNumber})` : '';
        title = 'Téléchargement terminé 🍿';
        body = `"${mediaTitle}${epInfo}" est prêt et disponible !`;
      }

      // Diffusion FCM push si Firebase Admin est configuré
      try {
        const db = adminDb;
        const usersSnap = await db.collection('users').get();
        const messaging = getMessaging();
        
        for (const userDoc of usersSnap.docs) {
          const userData = userDoc.data();
          if (userData.fcmToken) {
            try {
              await messaging.send({
                notification: { title, body },
                token: userData.fcmToken,
              });
            } catch (fcmErr) {
              console.warn('[Webhook] FCM send error for user:', userDoc.id, fcmErr);
            }
          }
        }
      } catch (dbErr) {
        console.warn('[Webhook] Error fetching users for push notifications:', dbErr);
      }

      return res.json({ success: true, eventType, message: 'Notification traitée avec succès' });
    } catch (err: any) {
      console.error('[Webhook Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/service-worker.js', '/firebase-messaging-sw.js'], (req, res) => {
    const filename = req.path.replace('/', '');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');

    const distFilePath = path.join(process.cwd(), 'dist', filename);
    const publicFilePath = path.join(process.cwd(), 'public', filename);

    if (process.env.NODE_ENV === 'production' && fs.existsSync(distFilePath)) {
      res.sendFile(distFilePath);
    } else if (fs.existsSync(publicFilePath)) {
      res.sendFile(publicFilePath);
    } else if (fs.existsSync(distFilePath)) {
      res.sendFile(distFilePath);
    } else {
      res.status(404).type('text/plain').send('Service worker file not found');
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  startCronJobs();
}

startServer();
