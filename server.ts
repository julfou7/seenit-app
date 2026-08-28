import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { getMessaging } from "firebase-admin/messaging";
import { adminAuth, adminDb } from "./src/lib/firebase-admin.ts";
import { DecodedIdToken } from "firebase-admin/auth";
import multer from "multer";
import dns from "node:dns/promises";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

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

// In-memory cache for Plex servers by token (TTL 5 minutes) to avoid repeated slow fetches and timeouts
const plexServersCache = new Map<string, { servers: any[]; timestamp: number }>();

async function getPlexServers(token: string, clientId: string, timeoutMs: number = 7000): Promise<any[]> {
  const cached = plexServersCache.get(token);
  if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
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
        plexServersCache.set(token, { servers, timestamp: Date.now() });
      }
    }
  } catch (err: any) {
    // If timeout or network glitch, return previously cached if available
    if (cached && cached.servers.length > 0) {
      return cached.servers;
    }
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
        title,
        originalTitle,
        year,
        type,
        clientId,
        token,
        plexToken: paramPlexToken
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

      const cleanTitle = typeof title === 'string' ? title.trim() : '';
      const cleanOriginalTitle = typeof originalTitle === 'string' ? originalTitle.trim() : '';
      const cleanYear = year ? Number(year) : null;

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
        (typeof token === 'string' && token) ||
        (typeof paramPlexToken === 'string' && paramPlexToken) ||
        process.env.PLEX_TOKEN ||
        process.env.PLEX_AUTH_TOKEN ||
        '';

      console.log(
        `[Plex Resolve Backend] ` +
        `tmdbId=${normalizedTmdbId ?? 'ABSENT'}, ` +
        `imdbId=${normalizedImdbId ?? 'ABSENT'}, ` +
        `tvdbId=${normalizedTvdbId ?? 'ABSENT'}, ` +
        `hasExternalId=${hasExternalId}, ` +
        `title="${cleanTitle || cleanOriginalTitle || 'ABSENT'}", ` +
        `year=${cleanYear ?? 'ABSENT'}, ` +
        `type=${targetType}, ` +
        `token=${resolvedToken ? `PRÉSENT (${resolvedToken.substring(0, 4)}...)` : 'ABSENT'}`
      );

      if (!hasExternalId && !cleanTitle && !cleanOriginalTitle) {
        console.warn(
          '[Plex Resolve Backend] Aucun identifiant ni titre valide fourni.'
        );

        return res.status(400).json({
          success: false,
          slug: null,
          error: 'TMDB, IMDb, TVDB ou Titre requis'
        });
      }

      const headers: Record<string, string> = {
        'X-Plex-Product': 'SeenIt',
        'X-Plex-Version': '1.4.17',
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
            raw.match(/^tmdb:\/\/(\d+)$/i) ||
            raw.match(/^themoviedb:\/\/(\d+)$/i) ||
            raw.match(/^com\.plexapp\.agents\.themoviedb:\/\/(\d+)$/i);

          if (tmdbMatch) {
            tmdbIds.add(Number(tmdbMatch[1]));
          }

          const imdbMatch =
            raw.match(/^imdb:\/\/(tt\d+)$/i) ||
            raw.match(/^com\.plexapp\.agents\.imdb:\/\/(tt\d+)$/i);

          if (imdbMatch) {
            imdbIds.add(imdbMatch[1].toLowerCase());
          }

          const tvdbMatch =
            raw.match(/^tvdb:\/\/(\d+)$/i) ||
            raw.match(/^thetvdb:\/\/(\d+)$/i) ||
            raw.match(/^com\.plexapp\.agents\.thetvdb:\/\/(\d+)$/i);

          if (tvdbMatch) {
            tvdbIds.add(Number(tvdbMatch[1]));
          }
        };

        if (Array.isArray(item?.Guid)) {
          for (const guid of item.Guid) {
            addGuid(guid?.id);
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

        // 4. Match par Titre + Année (uniquement si aucun ID externe n'est fourni)
        if (!hasExternalId) {
          const normalizeStr = (s: string) =>
            s
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]/g, '');

          const itemTitleNorm = normalizeStr(item.title || '');
          const itemOrigTitleNorm = normalizeStr(item.originalTitle || '');
          const searchTitleNorm = cleanTitle ? normalizeStr(cleanTitle) : '';
          const searchOrigTitleNorm = cleanOriginalTitle ? normalizeStr(cleanOriginalTitle) : '';

          const titleMatches =
            (searchTitleNorm && (itemTitleNorm === searchTitleNorm || itemOrigTitleNorm === searchTitleNorm)) ||
            (searchOrigTitleNorm && (itemTitleNorm === searchOrigTitleNorm || itemOrigTitleNorm === searchOrigTitleNorm));

          if (titleMatches) {
            if (cleanYear && item.year) {
              const yearDiff = Math.abs(Number(item.year) - Number(cleanYear));
              if (yearDiff <= 1) {
                return true;
              }
            } else if (!cleanYear) {
              return true;
            }
          }
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

          const match = results.find(item => isItemStrictMatch(item) && item.slug) || (results[0]?.slug ? results[0] : null);
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

      // SI DES IDENTIFIANTS EXTERNES ÉTAIENT FOURNIS, ON NE TENTE SURTOUT PAS DE FALLBACK PAR TITRE
      if (hasExternalId) {
        console.warn(
          `[Plex Resolve Backend] ❌ Échec de la résolution par identifiants externes (${[
            normalizedTmdbId ? `tmdb:${normalizedTmdbId}` : '',
            normalizedImdbId ? `imdb:${normalizedImdbId}` : '',
            normalizedTvdbId ? `tvdb:${normalizedTvdbId}` : ''
          ].filter(Boolean).join(', ')}). Fallback titre désactivé pour empêcher tout faux positif.`
        );

        return res.json({
          success: false,
          slug: null,
          error: 'Aucun match Plex exact pour les identifiants fournis'
        });
      }

      // --- ÉTAPE 2 : DISCOVER SEARCH GLOBALE (discover.provider.plex.tv) - UNIQUEMENT SI SANS IDENTIFIANT EXTERNE ---
      const queryDiscoverSearch = async (queryText: string): Promise<any | null> => {
        if (!queryText) return null;

        const searchUrl =
          'https://discover.provider.plex.tv/library/search' +
          `?query=${encodeURIComponent(queryText)}` +
          `&searchTypes=${plexType === 1 ? 'movies' : 'tv'}` +
          `&includeGuids=1` +
          `&includeMeta=1` +
          `&limit=15`;

        console.log(`[Plex Resolve Backend] [Étape 2] Recherche discover.provider.plex.tv : "${queryText}"`);

        try {
          const response = await fetch(searchUrl, {
            headers,
            signal: AbortSignal.timeout(6000)
          });

          console.log(`[Plex Resolve Backend] [Étape 2] "${queryText}" → ${response.status} ${response.statusText}`);

          if (!response.ok) return null;

          const data = await response.json();
          const results = extractResults(data);

          if (results.length === 0) return null;

          const match = results.find(item => isItemStrictMatch(item) && item.slug);
          if (match) {
            return formatResponseItem(match, `discover:${queryText}`);
          }
          return null;
        } catch (error: any) {
          console.warn(`[Plex Resolve Backend] [Étape 2] Erreur "${queryText}":`, error?.message || error);
          return null;
        }
      };

      // 2.A : Recherche Discover par Titre / Titre original
      const discoverQueries = new Set<string>();
      if (cleanTitle) discoverQueries.add(cleanTitle);
      if (cleanOriginalTitle) discoverQueries.add(cleanOriginalTitle);

      for (const q of discoverQueries) {
        const resDiscover = await queryDiscoverSearch(q);
        if (resDiscover) {
          console.log(`[Plex Resolve Backend] ✅ [Étape 2] Discover "${q}" → ${resDiscover.slug}`);
          return res.json({ success: true, ...resDiscover });
        }
      }

      // --- ÉTAPE 3 : METADATA SEARCH HUBS (metadata.provider.plex.tv/library/search) ---
      const queryMetadataHubs = async (queryText: string): Promise<any | null> => {
        if (!queryText) return null;

        const hubsUrl =
          'https://metadata.provider.plex.tv/library/search' +
          `?query=${encodeURIComponent(queryText)}` +
          `&searchTypes=${plexType === 1 ? 'movies' : 'tv'}` +
          `&includeGuids=1` +
          `&limit=15`;

        console.log(`[Plex Resolve Backend] [Étape 3] Recherche metadata.provider.plex.tv/library/search : "${queryText}"`);

        try {
          const response = await fetch(hubsUrl, {
            headers,
            signal: AbortSignal.timeout(6000)
          });

          console.log(`[Plex Resolve Backend] [Étape 3] "${queryText}" → ${response.status} ${response.statusText}`);

          if (!response.ok) return null;

          const data = await response.json();
          const results = extractResults(data);

          if (results.length === 0) return null;

          const match = results.find(item => isItemStrictMatch(item) && item.slug);
          if (match) {
            return formatResponseItem(match, `metadata-search:${queryText}`);
          }
          return null;
        } catch (error: any) {
          console.warn(`[Plex Resolve Backend] [Étape 3] Erreur "${queryText}":`, error?.message || error);
          return null;
        }
      };

      for (const q of discoverQueries) {
        const resHubs = await queryMetadataHubs(q);
        if (resHubs) {
          console.log(`[Plex Resolve Backend] ✅ [Étape 3] Metadata Hubs "${q}" → ${resHubs.slug}`);
          return res.json({ success: true, ...resHubs });
        }
      }

      console.warn(
        '[Plex Resolve Backend] ❌ Aucun match Plex exact trouvé après toutes les étapes.'
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
      const { token, clientId, tmdbId, title, originalTitle, year, mediaType = 'movie' } = req.body || {};
      if (!token || !tmdbId) {
        return res.json({ available: false });
      }

      const plexClientIdentifier = clientId || 'tv-time-ai-studio';
      const servers = await getPlexServers(token, plexClientIdentifier, 5000);

      if (servers.length === 0) {
        return res.json({ available: false });
      }

      const extractTmdbId = (item: any): number | null => {
        if (!item) return null;
        if (Array.isArray(item.Guid)) {
          for (const g of item.Guid) {
            if (typeof g?.id === 'string') {
              const match = g.id.match(/^tmdb:\/\/(\d+)/i) || g.id.match(/^themoviedb:\/\/(\d+)/i);
              if (match) return Number(match[1]);
            }
          }
        }
        for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
          if (typeof field === 'string') {
            const match = field.match(/themoviedb:\/\/(\d+)|tmdb:\/\/(\d+)|com\.plexapp\.agents\.themoviedb:\/\/(\d+)/i);
            if (match) return Number(match[1] || match[2] || match[3]);
          }
        }
        return null;
      };

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
                    const itemTitle = it.title || title;
                    const itemYear = it.year || year;
                    const directPlexUrl = (server.clientIdentifier && it.ratingKey)
                      ? `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${it.ratingKey}`)}`
                      : 'https://app.plex.tv/desktop';

                    console.log(`[Plex Availability] STRICT TMDB GUID MATCH: tmdb://${tmdbId} ("${itemTitle}") on server "${serverName}"`);
                    return {
                      available: true,
                      serverName,
                      serverId: server.clientIdentifier,
                      title: itemTitle,
                      originalTitle: it.originalTitle || originalTitle,
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
      const { token, clientId, delta = false, since } = req.body || {};

      if (!token) {
        return res.status(400).json({ error: 'Jeton Plex (token) manquant. Veuillez reconnecter votre compte Plex.' });
      }

      const plexClientIdentifier = clientId || 'tv-time-ai-studio';
      console.log(`[Plex Sync] Starting sync for user (${delta ? 'DELTA MODE' : 'FULL SCAN'})...`);

      const allRawItems: any[] = [];
      const visitedSources: string[] = [];

      // Helper function to extract items array from various Plex response formats
      const extractItems = (data: any): any[] => {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.activities)) return data.activities;
        if (data.MediaContainer && Array.isArray(data.MediaContainer.Metadata)) return data.MediaContainer.Metadata;
        if (Array.isArray(data.Metadata)) return data.Metadata;
        if (Array.isArray(data.items)) return data.items;
        return [];
      };

      // 1. Fetch from Plex Cloud Activity Feeds & Official Plex Watchlist
      const rawWatchlistItems: any[] = [];
      const watchlistEndpoints = [
        'https://discover.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
        'https://metadata.provider.plex.tv/library/sections/watchlist/all?includeUserState=1',
        'https://metadata.provider.plex.tv/library/sections/watchlist/today?includeUserState=1'
      ];

      for (const wlEndpoint of watchlistEndpoints) {
        try {
          const wlRes = await fetch(wlEndpoint, {
            headers: {
              'X-Plex-Token': token,
              'Accept': 'application/json',
              'X-Plex-Client-Identifier': plexClientIdentifier,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: AbortSignal.timeout(delta ? 4000 : 7000)
          });
          if (wlRes.ok) {
            const wlData = await wlRes.json();
            const items = extractItems(wlData);
            if (items.length > 0) {
              console.log(`[Plex Sync] Fetched ${items.length} watchlist items from Plex Watchlist endpoint: ${wlEndpoint}`);
              for (const it of items) {
                rawWatchlistItems.push(it);
              }
              visitedSources.push(`Watchlist Plex (${items.length} éléments)`);
              break; // Watchlist successfully retrieved from primary endpoint
            }
          }
        } catch (e: any) {
          console.log(`[Plex Sync] Watchlist endpoint skipped (${wlEndpoint}): ${e?.message || e}`);
        }
      }

      const cloudEndpoints = delta
        ? [
            'https://discover.provider.plex.tv/activities?includeUserState=1&limit=25'
          ]
        : [
            'https://discover.provider.plex.tv/activities?includeUserState=1&limit=100',
            'https://discover.provider.plex.tv/library/metadata/userState?state=watched&limit=100'
          ];

      for (const endpoint of cloudEndpoints) {
        try {
          const cloudRes = await fetch(endpoint, {
            headers: {
              'X-Plex-Token': token,
              'Accept': 'application/json',
              'X-Plex-Client-Identifier': plexClientIdentifier,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: AbortSignal.timeout(delta ? 4000 : 7000)
          });
          if (cloudRes.ok) {
            const cloudData = await cloudRes.json();
            const items = extractItems(cloudData);
            if (items.length > 0) {
              console.log(`[Plex Sync] Fetched ${items.length} items from Plex Cloud endpoint: ${endpoint}`);
              for (const it of items) {
                allRawItems.push({ raw: it, source: 'Plex Cloud Activity' });
              }
              visitedSources.push(`Plex Cloud (${items.length} éléments)`);
            }
          }
        } catch (e: any) {
          // Non-blocking cloud fetch fallback
          console.log(`[Plex Sync] Cloud endpoint skipped (${endpoint}): ${e?.message || e}`);
        }
      }

      // 2. Fetch user's servers from Plex.tv (Both owned servers & shared servers from friends)
      const servers = await getPlexServers(token, plexClientIdentifier, delta ? 6000 : 9000);

      console.log(`[Plex Sync] Found ${servers.length} Plex server(s) (personal & shared)`);

      // 3. Query EACH server (do NOT stop at the first server!)
      const serverTimeout = delta ? 2000 : 3500;
      const historyLimit = delta ? 25 : 100;

      for (const server of servers) {
        const serverName = server.name || 'Serveur Plex';
        const serverAccessToken = server.accessToken || token;
        const connections = server.connections || [];
        let serverItemCount = 0;

        // Sort connections: prioritize remote HTTPS / plex.direct connections over unreachable LAN IPs
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

        // Try reachable connections for this server
        for (const conn of sortedConnections) {
          const uri = conn.uri;
          if (!uri) continue;

          // Skip LAN IPs if running on Cloud Run server when a public remote connection exists
          if (isPrivateOrLocalUri(uri) && hasRemoteConnection) {
            continue;
          }

          let connectionSuccess = false;

          // A. Try session history (admin / owner endpoint)
          try {
            const histRes = await fetch(`${uri}/status/sessions/history/all?X-Plex-Token=${serverAccessToken}&sort=viewedAt:desc&limit=${historyLimit}`, {
              headers: { 'Accept': 'application/json' },
              signal: AbortSignal.timeout(serverTimeout)
            });
            if (histRes.ok) {
              const histData = await histRes.json();
              const items = extractItems(histData);
              if (items.length > 0) {
                for (const it of items) {
                  allRawItems.push({ raw: it, source: serverName });
                }
                serverItemCount += items.length;
                connectionSuccess = true;
              }
            }
          } catch (e) {
            // Proceed to other endpoints
          }

          // B. Try recently viewed endpoint (works for shared/friend users too)
          try {
            const recentRes = await fetch(`${uri}/library/recentlyViewed?X-Plex-Token=${serverAccessToken}&limit=${historyLimit}`, {
              headers: { 'Accept': 'application/json' },
              signal: AbortSignal.timeout(serverTimeout)
            });
            if (recentRes.ok) {
              const recentData = await recentRes.json();
              const items = extractItems(recentData);
              if (items.length > 0) {
                for (const it of items) {
                  allRawItems.push({ raw: it, source: serverName });
                }
                serverItemCount += items.length;
                connectionSuccess = true;
              }
            }
          } catch (e) {}

          // In Full Scan mode only: try library all & section scans
          if (!delta) {
            // C. Try library all watched items
            try {
              const allWatchedRes = await fetch(`${uri}/library/all?viewCount>=1&sort=lastViewedAt:desc&limit=100&X-Plex-Token=${serverAccessToken}`, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(serverTimeout)
              });
              if (allWatchedRes.ok) {
                const allWatchedData = await allWatchedRes.json();
                const items = extractItems(allWatchedData);
                if (items.length > 0) {
                  for (const it of items) {
                    allRawItems.push({ raw: it, source: serverName });
                  }
                  serverItemCount += items.length;
                  connectionSuccess = true;
                }
              }
            } catch (e) {}

            // D. Query library sections (movies & TV shows) on this server
            try {
              const sectionsRes = await fetch(`${uri}/library/sections?X-Plex-Token=${serverAccessToken}`, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(serverTimeout)
              });
              if (sectionsRes.ok) {
                const sectionsData = await sectionsRes.json();
                const sections = (sectionsData.MediaContainer && sectionsData.MediaContainer.Directory) || [];
                
                for (const sec of sections) {
                  const secKey = sec.key;
                  if (!secKey) continue;
                  
                  // Fetch recently viewed in this specific section
                  try {
                    const secRecentRes = await fetch(`${uri}/library/sections/${secKey}/recentlyViewed?X-Plex-Token=${serverAccessToken}&limit=50`, {
                      headers: { 'Accept': 'application/json' },
                      signal: AbortSignal.timeout(2500)
                    });
                    if (secRecentRes.ok) {
                      const secRecentData = await secRecentRes.json();
                      const items = extractItems(secRecentData);
                      for (const it of items) {
                        allRawItems.push({ raw: it, source: `${serverName} - ${sec.title || 'Section'}` });
                      }
                      serverItemCount += items.length;
                      connectionSuccess = true;
                    }
                  } catch (e) {}

                  // Fetch all watched in this section
                  try {
                    const secWatchedRes = await fetch(`${uri}/library/sections/${secKey}/all?viewCount>=1&sort=lastViewedAt:desc&limit=50&X-Plex-Token=${serverAccessToken}`, {
                      headers: { 'Accept': 'application/json' },
                      signal: AbortSignal.timeout(2500)
                    });
                    if (secWatchedRes.ok) {
                      const secWatchedData = await secWatchedRes.json();
                      const items = extractItems(secWatchedData);
                      for (const it of items) {
                        allRawItems.push({ raw: it, source: `${serverName} - ${sec.title || 'Section'}` });
                      }
                      serverItemCount += items.length;
                      connectionSuccess = true;
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
          }

          // If this connection worked for this server, we don't need to re-query redundant relay connections
          if (connectionSuccess && serverItemCount > 0) {
            visitedSources.push(`${serverName} (${serverItemCount} éléments)`);
            break;
          }
        }
      }

      console.log(`[Plex Sync] Collected a total of ${allRawItems.length} raw history records across all sources.`);

      // 4. Normalize & Deduplicate all history items
      const normalizeStr = (s?: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

      const itemMap = new Map<string, any>();

      for (const entry of allRawItems) {
        const raw = entry.raw || {};
        const meta = raw.Metadata || raw.media || raw.item || raw;
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

        if (!title && !grandparentTitle) continue;

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

        // Create deduplication key
        let dedupeKey = '';
        if (type === 'episode') {
          const sNum = parentIndex !== undefined ? parentIndex : 0;
          const eNum = index !== undefined ? index : 0;
          dedupeKey = `ep:${normalizeStr(grandparentTitle || title)}:${sNum}:${eNum}`;
        } else {
          dedupeKey = `mov:${normalizeStr(title)}:${itemYear || ''}`;
        }

        const existing = itemMap.get(dedupeKey);
        if (!existing || viewedTimestamp > existing.viewedAt) {
          itemMap.set(dedupeKey, {
            type,
            title,
            grandparentTitle,
            parentIndex: parentIndex !== undefined ? Number(parentIndex) : undefined,
            index: index !== undefined ? Number(index) : undefined,
            viewedAt: viewedTimestamp,
            year: itemYear,
            guid: meta.guid || raw.guid || meta.grandparentGuid || raw.grandparentGuid,
            Guid: meta.Guid || raw.Guid || meta.guids || raw.guids,
            source
          });
        }
      }

      const deduplicatedHistory = Array.from(itemMap.values()).sort((a, b) => b.viewedAt - a.viewedAt);

      // Normalize & Deduplicate Watchlist items
      const watchlistMap = new Map<string, any>();
      for (const rawItem of rawWatchlistItems) {
        const meta = rawItem.Metadata || rawItem.media || rawItem.item || rawItem;
        const rawType = (meta.type || rawItem.type || '').toLowerCase();
        const type = (rawType === 'show' || rawType === 'series' || rawType === 'tv') ? 'show' : 'movie';
        const title = meta.title || rawItem.title || meta.name || '';
        if (!title) continue;

        let wlYear = meta.year || rawItem.year ? Number(meta.year || rawItem.year) : undefined;
        if (!wlYear) {
          const matchYear = title.match(/\((\d{4})\)/);
          if (matchYear) wlYear = Number(matchYear[1]);
        }

        const dedupeKey = `wl:${type}:${normalizeStr(title)}:${wlYear || ''}`;
        if (!watchlistMap.has(dedupeKey)) {
          watchlistMap.set(dedupeKey, {
            type,
            title,
            year: wlYear,
            guid: meta.guid || rawItem.guid || meta.grandparentGuid,
            Guid: meta.Guid || rawItem.Guid || meta.guids || rawItem.guids,
            addedAt: meta.addedAt || rawItem.addedAt || Date.now()
          });
        }
      }

      const deduplicatedWatchlist = Array.from(watchlistMap.values());
      console.log(`[Plex Sync] Returning ${deduplicatedHistory.length} history items and ${deduplicatedWatchlist.length} watchlist items.`);

      return res.status(200).json({ 
        history: deduplicatedHistory,
        watchlist: deduplicatedWatchlist,
        visitedSources,
        totalFound: deduplicatedHistory.length + deduplicatedWatchlist.length
      });
    } catch (err: any) {
      console.error('[Plex Sync Error]', err);
      return res.status(500).json({ error: err?.message || 'Erreur lors de la synchronisation de l\'historique Plex' });
    }
  });

  // C411 Tracker API proxy
  app.post('/api/c411/search', requireAuth, async (req, res) => {
    try {
      const query = (typeof req.body?.query === 'string' ? req.body.query : '').trim();
      const mediaType = typeof req.body?.mediaType === 'string' ? req.body.mediaType : 'movie';
      const year = typeof req.body?.year === 'string' ? req.body.year : undefined;
      const apiKey = process.env.C411_API_KEY || (typeof req.body?.apiKey === 'string' ? req.body.apiKey : '');

      if (!query) {
        return res.json({ torrents: [] });
      }
      if (!apiKey) {
        return res.status(503).json({
          error: 'Cle API C411 non configuree',
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
