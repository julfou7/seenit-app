import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { getMessaging } from "firebase-admin/messaging";
import { adminAuth, adminDb } from "./src/lib/firebase-admin.ts";
import { DecodedIdToken } from "firebase-admin/auth";
import multer from "multer";

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
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  const upload = multer();

  app.get('/api/plex/resolve-slug', async (req, res) => {
    console.log(`[Plex Resolve Backend] --- DÉBUT DE LA RÉSOLUTION ---`);
    try {
      const { tmdbId, imdbId, type, token, clientId } = req.query || {};
      console.log(`[Plex Resolve Backend] Paramètres reçus: tmdbId=${tmdbId}, imdbId=${imdbId}, type=${type}, token=${token ? 'PRÉSENT' : 'ABSENT'}, clientId=${clientId}`);

      const targetType = type === 'show' || type === 'series' ? 'show' : 'movie';
      const plexType = targetType === 'show' ? 2 : 1;
      const plexAgent = targetType === 'show' ? 'tv.plex.agents.series' : 'tv.plex.agents.movie';
      const matchQuery = tmdbId ? `tmdb-${tmdbId}` : (imdbId ? `imdb-${imdbId}` : '');

      console.log(`[Plex Resolve Backend] Mappe vers: targetType=${targetType}, plexType=${plexType}, plexAgent=${plexAgent}, matchQuery=${matchQuery}`);

      if (!matchQuery) {
        console.warn(`[Plex Resolve Backend] Aucun ID externe fourni (tmdbId ou imdbId)`);
        return res.json({ slug: null });
      }

      const matchesUrl = `https://metadata.provider.plex.tv/library/metadata/matches?manual=1&title=${encodeURIComponent(matchQuery)}&type=${plexType}&agent=${encodeURIComponent(plexAgent)}`;
      console.log(`[Plex Resolve Backend] Appel de l'URL Plex: ${matchesUrl}`);

      const headers: Record<string, string> = {
        'X-Plex-Product': 'SeenIt',
        'X-Plex-Version': '1.4.03',
        'X-Plex-Client-Identifier': (clientId as string) || 'seenit-app-server',
        'Accept': 'application/json'
      };
      if (token) {
        headers['X-Plex-Token'] = token as string;
      }

      console.log(`[Plex Resolve Backend] En-têtes envoyés à Plex:`, {
        'X-Plex-Product': headers['X-Plex-Product'],
        'X-Plex-Version': headers['X-Plex-Version'],
        'X-Plex-Client-Identifier': headers['X-Plex-Client-Identifier'],
        'Accept': headers['Accept'],
        'X-Plex-Token': headers['X-Plex-Token'] ? 'PRÉSENT (Masqué)' : 'ABSENT'
      });

      const response = await fetch(matchesUrl, {
        headers,
        signal: AbortSignal.timeout(5000)
      });

      console.log(`[Plex Resolve Backend] Statut de la réponse Plex: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        console.error(`[Plex Resolve Backend] Échec de l'API Plex: ${response.status} ${response.statusText}`);
        return res.json({ slug: null });
      }

      const data = await response.json();
      console.log(`[Plex Resolve Backend] Données reçues de Plex pour TMDB:`, JSON.stringify(data, null, 2));

      const searchResults = data?.MediaContainer?.SearchResult || data?.MediaContainer?.Metadata || data?.SearchResult;
      const match = Array.isArray(searchResults) && searchResults.length > 0 ? searchResults[0] : null;

      if (match) {
        console.log(`[Plex Resolve Backend] Match trouvé pour TMDB ! Titre: "${match.title}", Année: "${match.year}", Slug: "${match.slug}", Type: "${match.type}"`);
        if (match.slug) {
          const resType = match.type || targetType;
          const mediaTypeStr = (resType === 'show' || resType === 'series' || resType === 2 || targetType === 'show') ? 'show' : 'movie';
          console.log(`[Plex Resolve Backend] ✅ Résolution TMDB réussie! Renvoi du slug: ${match.slug}, type: ${mediaTypeStr}`);
          return res.json({ slug: match.slug, type: mediaTypeStr });
        } else {
          console.warn(`[Plex Resolve Backend] Le match TMDB n'a pas de champ 'slug' !`);
        }
      } else {
        console.warn(`[Plex Resolve Backend] Aucun match trouvé dans la liste pour TMDB.`);
      }

      // Si tmdbId a échoué et que imdbId est fourni, faire un fallback automatique côté serveur
      if (imdbId) {
        console.log(`[Plex Resolve Backend] Déclenchement du fallback IMDb car TMDB n'a rien renvoyé. IMDb ID: imdb-${imdbId}`);
        const matchesUrlImdb = `https://metadata.provider.plex.tv/library/metadata/matches?manual=1&title=imdb-${imdbId}&type=${plexType}&agent=${encodeURIComponent(plexAgent)}`;
        console.log(`[Plex Resolve Backend] Appel de l'URL de fallback IMDb Plex: ${matchesUrlImdb}`);

        const responseImdb = await fetch(matchesUrlImdb, {
          headers,
          signal: AbortSignal.timeout(5000)
        });

        console.log(`[Plex Resolve Backend] Statut de la réponse de fallback IMDb Plex: ${responseImdb.status} ${responseImdb.statusText}`);

        if (responseImdb.ok) {
          const dataImdb = await responseImdb.json();
          console.log(`[Plex Resolve Backend] Données reçues de Plex pour IMDb fallback:`, JSON.stringify(dataImdb, null, 2));

          const searchResultsImdb = dataImdb?.MediaContainer?.SearchResult || dataImdb?.MediaContainer?.Metadata || dataImdb?.SearchResult;
          const matchImdb = Array.isArray(searchResultsImdb) && searchResultsImdb.length > 0 ? searchResultsImdb[0] : null;

          if (matchImdb) {
            console.log(`[Plex Resolve Backend] Match trouvé pour IMDb fallback ! Titre: "${matchImdb.title}", Année: "${matchImdb.year}", Slug: "${matchImdb.slug}", Type: "${matchImdb.type}"`);
            if (matchImdb.slug) {
              const resType = matchImdb.type || targetType;
              const mediaTypeStr = (resType === 'show' || resType === 'series' || resType === 2 || targetType === 'show') ? 'show' : 'movie';
              console.log(`[Plex Resolve Backend] ✅ Résolution IMDb de fallback réussie! Renvoi du slug: ${matchImdb.slug}, type: ${mediaTypeStr}`);
              return res.json({ slug: matchImdb.slug, type: mediaTypeStr });
            } else {
              console.warn(`[Plex Resolve Backend] Le match IMDb de fallback n'a pas de champ 'slug' !`);
            }
          } else {
            console.warn(`[Plex Resolve Backend] Aucun match trouvé dans la liste pour IMDb de fallback.`);
          }
        } else {
          console.error(`[Plex Resolve Backend] Échec de l'appel de fallback IMDb Plex: ${responseImdb.status}`);
        }
      }

      console.error(`[Plex Resolve Backend] ❌ Impossible de résoudre le média sur Plex Discover (ni par TMDB, ni par IMDb).`);
      return res.json({ slug: null });
    } catch (error: any) {
      console.error('[Plex Resolve Backend] Erreur critique rencontrée:', error);
      return res.json({ slug: null });
    } finally {
      console.log(`[Plex Resolve Backend] --- FIN DE LA RÉSOLUTION ---`);
    }
  });

  app.post('/api/plex/availability', async (req, res) => {
    try {
      const { token, clientId, tmdbId, imdbId, title, originalTitle, year, mediaType = 'movie' } = req.body || {};
      if (!token || (!title && !tmdbId)) {
        return res.status(400).json({ error: 'Paramètres manquants' });
      }

      const plexClientIdentifier = clientId || 'tv-time-ai-studio';
      const servers = await getPlexServers(token, plexClientIdentifier, 7000);

      if (servers.length === 0) {
        return res.json({ available: false });
      }

      const normalizeStr = (s?: string) => 
        (s || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const STOP_WORDS = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'a', 'au', 'aux', 'the', 'of', 'in', 'and', 'for', 'to', 'a', 'an']);

      const getSignificantWords = (s?: string): string[] => {
        return normalizeStr(s)
          .split(' ')
          .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
      };

      const normTitle = normalizeStr(title);
      const normOriginal = originalTitle ? normalizeStr(originalTitle) : '';
      const targetWords = Array.from(new Set([...getSignificantWords(title), ...getSignificantWords(originalTitle)]));

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

      const extractImdbId = (item: any): string | null => {
        if (!item) return null;
        if (Array.isArray(item.Guid)) {
          for (const g of item.Guid) {
            if (typeof g?.id === 'string') {
              const match = g.id.match(/^imdb:\/\/(tt\d+)/i);
              if (match) return match[1].toLowerCase();
            }
          }
        }
        for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
          if (typeof field === 'string') {
            const match = field.match(/imdb:\/\/(tt\d+)|com\.plexapp\.agents\.imdb:\/\/(tt\d+)/i);
            if (match) return (match[1] || match[2]).toLowerCase();
          }
        }
        return null;
      };

      const isMatch = (item: any): boolean => {
        if (!item) return false;

        // Si le client précise 'movie' ou 'tv', on peut ignorer les autres types
        const itType = (item.type || '').toLowerCase();
        if (itType === 'episode' || itType === 'season' || itType === 'track') return false;
        if (mediaType === 'movie' && itType && itType !== 'movie') return false;
        if (mediaType === 'tv' && itType && itType !== 'show' && itType !== 'series') return false;

        // 1. Direct TMDB ID match
        const itTmdbId = extractTmdbId(item);
        if (tmdbId && itTmdbId && Number(itTmdbId) === Number(tmdbId)) {
          return true;
        }

        // 2. Direct IMDB ID match
        const itImdbId = extractImdbId(item);
        if (imdbId && itImdbId && itImdbId === String(imdbId).toLowerCase()) {
          return true;
        }

        // NO TITLE MATCHING. STRICT ID MATCHING ONLY.
        return false;
      };

      
      const searchQueries = new Set<string>();
      if (title) searchQueries.add(title);
      if (originalTitle) searchQueries.add(originalTitle);
      
      const queriesArray = Array.from(searchQueries);



      // Search all servers in parallel
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

        for (const conn of candidateConnections) {
          const uri = conn.uri;
          if (!uri) continue;

          // Run all query variations in parallel for this connection
          const searchTasks = queriesArray.map(async (q: string) => {
            const ep = `${uri}/hubs/search?query=${encodeURIComponent(q)}&limit=20limit=20&X-Plex-TokenincludeGuids=1limit=20&X-Plex-TokenX-Plex-Token=${serverAccessToken}`;
            try {
              const searchRes = await fetch(ep, {
                headers: { 
                  'Accept': 'application/json',
                  'X-Plex-Token': serverAccessToken 
                },
                signal: AbortSignal.timeout(2500)
              });

              if (searchRes.ok) {
                const searchData = await searchRes.json();
                let items: any[] = [];
                if (searchData.MediaContainer?.Hub) {
                  for (const hub of searchData.MediaContainer.Hub) {
                    if (Array.isArray(hub.Metadata)) {
                      items.push(...hub.Metadata);
                    }
                  }
                } else if (Array.isArray(searchData.MediaContainer?.Metadata)) {
                  items = searchData.MediaContainer.Metadata;
                }

                for (const it of items) {
                  if (isMatch(it)) {
                    const itemTitle = it.title || title;
                    const itemYear = it.year || year;
                    const isShow = (it.type === 'show' || it.type === 'series' || mediaType === 'tv');
                    
                    const directPlexUrl = (server.clientIdentifier && it.ratingKey)
                      ? `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${it.ratingKey}`)}`
                      : 'https://app.plex.tv/desktop';

                    console.log(`[Plex Availability] MATCH FOUND: "${itemTitle}" (${itemYear}) on server "${serverName}"`);
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
              // Ignore single query error
            }
            return null;
          });

          const results = await Promise.all(searchTasks);
          const match = results.find(r => r && r.available);
          if (match) return match;
        }

        return null;
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

  app.post(['/api/plex/history', '/api/plex-sync'], async (req, res) => {
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
  app.get('/api/c411/search', async (req, res) => {
    try {
      const query = (req.query.query as string || '').trim();
      const mediaType = req.query.mediaType as string || 'movie';
      const year = req.query.year as string;
      const apiKey = (req.query.apiKey as string) || '2d4baaf4fdd1dacd26f8dc96b1ab6aa06fc95140a7509456b25c8c0b9b5ac55a';

      if (!query) {
        return res.json({ torrents: [] });
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


  // Sonarr Webhook (Advanced)
  app.post('/api/webhook/sonarr', express.json(), async (req, res) => {
    try {
      const payload = req.body;
      console.log("[Sonarr Webhook] Received:", payload.eventType);
      
      let title = "Téléchargement Sonarr";
      let body = "Un téléchargement a été mis à jour.";
      
      if (payload.eventType === 'Grab') {
        title = "Téléchargement lancé";
        body = `${payload.series?.title || 'Une série'} a commencé le téléchargement.`;
      } else if (payload.eventType === 'Download') {
        title = "Épisode importé";
        body = `${payload.series?.title || 'Série'} S${payload.episodes?.[0]?.seasonNumber || 'X'}E${payload.episodes?.[0]?.episodeNumber || 'X'} est disponible !`;
      } else {
        return res.status(200).send("Ignored event type");
      }
      
      const usersSnapshot = await adminDb.collection('users').get();
      const tokens = [];
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.fcmToken) {
          tokens.push(data.fcmToken);
        }
      });
      
      if (tokens.length > 0) {
        await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title, body }
        });
        console.log("[Sonarr Webhook] Sent FCM to", tokens.length, "users");
      }
      
      return res.status(200).send("OK");
    } catch(e) {
      console.error("[Sonarr Webhook Error]", e);
      return res.status(500).send(e.toString());
    }
  });

  // Remote Download Dispatcher (Sonarr / Radarr / qBittorrent)
  app.post('/api/downloads/push', express.json(), async (req, res) => {
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

        const sonarrRes = await fetch(sonarrEndpoint, {
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

        const radarrRes = await fetch(radarrEndpoint, {
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
          const loginRes = await fetch(`${cleanUrl}/api/v2/auth/login`, {
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

        const addRes = await fetch(`${cleanUrl}/api/v2/torrents/add`, {
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
  app.post('/api/service-proxy', async (req, res) => {
    try {
      const { targetUrl, method = 'GET', headers = {}, body } = req.body;
      if (!targetUrl) {
        return res.status(400).json({ error: 'targetUrl requis' });
      }

      // Si c'est une adresse IP locale privée (192.168.x.x, 10.x.x.x, 172.16-31.x.x, localhost, 127.0.0.1)
      const isLocalIp = /^(https?:\/\/)?(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:|\/|$)/i.test(targetUrl);
      if (isLocalIp) {
        return res.status(400).json({
          error: 'IP_LOCALE_INACCESSIBLE',
          message: 'L\'adresse IP locale ne peut pas être contactée par le serveur Cloud. Utilisez un tunnel HTTPS (ngrok, Cloudflare Tunnel, DuckDNS) pour tester sur le Web ou utilisez l\'APK Android connecté à votre Wi-Fi.'
        });
      }

      // Dériver Origin et Referer automatiquement pour qBittorrent et autres services avec vérification CSRF / Host
      let origin = headers['Origin'] || headers['origin'];
      let referer = headers['Referer'] || headers['referer'];
      try {
        const parsedUrl = new URL(targetUrl);
        if (!origin) origin = parsedUrl.origin;
        if (!referer) referer = `${parsedUrl.origin}/`;
      } catch {}

      const cleanHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SeenIt/1.0',
        ...headers
      };
      if (origin && !cleanHeaders['Origin'] && !cleanHeaders['origin']) cleanHeaders['Origin'] = origin;
      if (referer && !cleanHeaders['Referer'] && !cleanHeaders['referer']) cleanHeaders['Referer'] = referer;

      const fetchOptions: any = {
        method,
        headers: cleanHeaders,
        signal: AbortSignal.timeout(10000)
      };

      if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type'] && typeof body !== 'string') {
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(targetUrl, fetchOptions);
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
  app.post(['/api/webhook/sonarr', '/api/webhook/radarr'], async (req, res) => {
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
