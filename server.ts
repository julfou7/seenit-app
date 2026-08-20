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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  const upload = multer();

  app.post('/api/plex/availability', async (req, res) => {
    try {
      const { token, clientId, tmdbId, title, originalTitle, year, mediaType = 'movie' } = req.body || {};
      if (!token || (!title && !tmdbId)) {
        return res.status(400).json({ error: 'Paramètres manquants' });
      }

      const plexClientIdentifier = clientId || 'tv-time-ai-studio';

      let servers: any[] = [];
      try {
        const resourcesRes = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
          headers: {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': plexClientIdentifier
          },
          signal: AbortSignal.timeout(5000)
        });

        if (resourcesRes.ok) {
          const resources = await resourcesRes.json();
          if (Array.isArray(resources)) {
            servers = resources.filter((r: any) => r.provides && r.provides.includes('server'));
          }
        }
      } catch (err: any) {
        console.warn('[Plex Availability] Resources fetch error:', err?.message);
      }

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

      const normTitle = normalizeStr(title);
      const normOriginal = originalTitle ? normalizeStr(originalTitle) : '';

      const extractTmdbId = (item: any): number | null => {
        if (!item) return null;
        if (Array.isArray(item.Guid)) {
          for (const g of item.Guid) {
            if (typeof g?.id === 'string') {
              const match = g.id.match(/^tmdb:\/\/(\d+)/i);
              if (match) return Number(match[1]);
            }
          }
        }
        for (const field of [item.guid, item.grandparentGuid, item.parentGuid]) {
          if (typeof field === 'string') {
            const match = field.match(/themoviedb:\/\/(\d+)|tmdb:\/\/(\d+)/i);
            if (match) return Number(match[1] || match[2]);
          }
        }
        return null;
      };

      const searchQueries = new Set<string>();
      if (title && title.trim()) searchQueries.add(title.trim());
      if (originalTitle && originalTitle.trim() && originalTitle !== title) searchQueries.add(originalTitle.trim());
      if (normTitle && normTitle.length >= 3) searchQueries.add(normTitle);

      for (const server of servers) {
        const serverName = server.name || 'Serveur Plex';
        const serverAccessToken = server.accessToken || token;
        const rawConnections = server.connections || [];

        // Sort connections: Prioritize remote HTTPS plex.direct and relays over private local IPs
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

        // If remote / relay connections exist, filter out private LAN IPs to prevent slow timeouts from cloud
        const hasRemoteOrRelay = sortedConnections.some((c: any) => !c.local || c.relay);
        const candidateConnections = hasRemoteOrRelay 
          ? sortedConnections.filter((c: any) => !c.local || c.relay)
          : sortedConnections;

        for (const conn of candidateConnections) {
          const uri = conn.uri;
          if (!uri) continue;

          let foundOnServer = false;

          for (const q of Array.from(searchQueries)) {
            if (foundOnServer) break;
            try {
              const searchUrl = `${uri}/hubs/search?query=${encodeURIComponent(q)}&limit=15&X-Plex-Token=${serverAccessToken}`;
              const searchRes = await fetch(searchUrl, {
                headers: { 
                  'Accept': 'application/json',
                  'X-Plex-Token': serverAccessToken 
                },
                signal: AbortSignal.timeout(3000)
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
                  // 1. Direct TMDB ID match (highest confidence)
                  const itTmdbId = extractTmdbId(it);
                  if (tmdbId && itTmdbId && Number(itTmdbId) === Number(tmdbId)) {
                    foundOnServer = true;
                    const directPlexUrl = (server.clientIdentifier && it.ratingKey)
                      ? `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${it.ratingKey}`)}`
                      : 'https://app.plex.tv/desktop';

                    console.log(`[Plex Availability] TMDB ID match: ${it.title} on ${serverName}`);
                    return res.json({
                      available: true,
                      serverName,
                      serverId: server.clientIdentifier,
                      title: it.title,
                      year: it.year,
                      ratingKey: it.ratingKey,
                      plexUrl: directPlexUrl
                    });
                  }

                  // 2. Title & Year matching
                  const itTitle = normalizeStr(it.title || it.grandparentTitle);
                  const itOriginal = normalizeStr(it.originalTitle);

                  const titleMatch = 
                    (normTitle && (itTitle === normTitle || (normTitle.length >= 4 && (itTitle.includes(normTitle) || normTitle.includes(itTitle))))) ||
                    (normOriginal && (itTitle === normOriginal || itOriginal === normOriginal));

                  if (titleMatch) {
                    if (year && it.year) {
                      const diff = Math.abs(Number(year) - Number(it.year));
                      if (diff > 2) continue;
                    }

                    foundOnServer = true;
                    const directPlexUrl = (server.clientIdentifier && it.ratingKey)
                      ? `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${it.ratingKey}`)}`
                      : 'https://app.plex.tv/desktop';

                    console.log(`[Plex Availability] Title match: ${it.title} (${it.year}) on ${serverName}`);
                    return res.json({
                      available: true,
                      serverName,
                      serverId: server.clientIdentifier,
                      title: it.title,
                      year: it.year,
                      ratingKey: it.ratingKey,
                      plexUrl: directPlexUrl
                    });
                  }
                }
              }
            } catch (e) {
              // Try next query or next connection
            }
          }

          if (foundOnServer) break;
        }
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
      let servers: any[] = [];
      try {
        const resourcesRes = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
          headers: {
            'X-Plex-Token': token,
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': plexClientIdentifier
          },
          signal: AbortSignal.timeout(delta ? 4000 : 8000)
        });

        if (resourcesRes.ok) {
          const resources = await resourcesRes.json();
          if (Array.isArray(resources)) {
            servers = resources.filter((r: any) => r.provides && r.provides.includes('server'));
          }
        } else {
          console.warn('[Plex Sync] Failed to fetch resources:', resourcesRes.status);
        }
      } catch (err: any) {
        console.warn('[Plex Sync] Resources fetch timed out or failed:', err?.message);
      }

      console.log(`[Plex Sync] Found ${servers.length} Plex server(s) (personal & shared)`);

      // 3. Query EACH server (do NOT stop at the first server!)
      const serverTimeout = delta ? 2000 : 3500;
      const historyLimit = delta ? 25 : 100;

      for (const server of servers) {
        const serverName = server.name || 'Serveur Plex';
        const serverAccessToken = server.accessToken || token;
        const connections = server.connections || [];
        let serverItemCount = 0;

        // Try reachable connections for this server
        for (const conn of connections) {
          const uri = conn.uri;
          if (!uri) continue;

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

        // Create deduplication key
        let dedupeKey = '';
        if (type === 'episode') {
          const sNum = parentIndex !== undefined ? parentIndex : 0;
          const eNum = index !== undefined ? index : 0;
          dedupeKey = `ep:${normalizeStr(grandparentTitle || title)}:${sNum}:${eNum}`;
        } else {
          dedupeKey = `mov:${normalizeStr(title)}`;
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
            year: meta.year || raw.year ? Number(meta.year || raw.year) : undefined,
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

        const dedupeKey = `wl:${type}:${normalizeStr(title)}`;
        if (!watchlistMap.has(dedupeKey)) {
          watchlistMap.set(dedupeKey, {
            type,
            title,
            year: meta.year || rawItem.year ? Number(meta.year || rawItem.year) : undefined,
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

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get('/api/update', async (req, res) => {
    try {
      const token = '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';
      const repo = 'julfou7/seenit-app';
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${token}`,
          'User-Agent': 'SeenIt-Backend'
        }
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
