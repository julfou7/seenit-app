const fs = require('node:fs');

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  if (index < 0) throw new Error(`Bloc introuvable: ${label}`);
  if (content.indexOf(search, index + search.length) >= 0) throw new Error(`Bloc non unique: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + search.length);
}

function replaceRegexOnce(content, regex, replacement, label) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matches = [...content.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) throw new Error(`Regex ${label}: ${matches.length} occurrence(s)`);
  return content.replace(regex, replacement);
}

let server = fs.readFileSync('server.ts', 'utf8');

server = replaceOnce(
  server,
  `} from "./src/features/plex/plexIdentity.ts";\n`,
  `} from "./src/features/plex/plexIdentity.ts";\nimport {\n  isPlexLibraryItemWatched,\n  normalizePlexAccountHistoryNode,\n  PLEX_ACCOUNT_HISTORY_MINIMAL_QUERY,\n  PLEX_ACCOUNT_HISTORY_QUERY\n} from "./src/features/plex/plexAccountHistory.ts";\n`,
  'import Plex Account History'
);

const accountHistoryHelpers = `
      const sourceStats = {
        cloudItems: 0,
        plexAccountHistoryItems: 0,
        plexAccountHistoryRetained: 0,
        pmsHistoryItems: 0,
        libraryWatchedItems: 0,
        libraryInventoryItems: 0,
        libraryInventoryScanSucceeded: false
      };
      const libraryAvailabilityItems: any[] = [];
      const currentLibraryGuids = new Set<string>();

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
          console.log(\`[Plex Sync] Plex account UUID unavailable: \${error?.message || error}\`);
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
              throw new Error(\`HTTP \${response.status}\`);
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

              // Un épisode doit conserver ses coordonnées S/E. Le fallback GraphQL minimal
              // peut résoudre les films mais ne doit jamais inventer S1E1.
              if (normalized.type === 'episode' &&
                  (!Number.isFinite(normalized.parentIndex) || !Number.isFinite(normalized.index))) {
                continue;
              }

              const identity = normalized.guid.trim();
              if (!identity || seenGuids.has(identity)) continue;
              seenGuids.add(identity);
              collected.push(normalized);
            }

            const pageInfo = history?.pageInfo || {};
            if (!pageInfo.hasNextPage || !pageInfo.endCursor || nodes.length === 0) break;
            after = String(pageInfo.endCursor);
          }

          return { available: true, items: collected, queryMode };
        };

        try {
          return await runQuery(PLEX_ACCOUNT_HISTORY_QUERY, 'rich');
        } catch (richError: any) {
          console.log(\`[Plex Sync] Watch History GraphQL rich query unavailable, fallback minimal: \${richError?.message || richError}\`);
          try {
            return await runQuery(PLEX_ACCOUNT_HISTORY_MINIMAL_QUERY, 'minimal');
          } catch (minimalError: any) {
            console.log(\`[Plex Sync] Watch History Plex Account unavailable: \${minimalError?.message || minimalError}\`);
            return { available: false, items: [], queryMode: 'none' };
          }
        }
      };
`;

server = replaceOnce(
  server,
  `        return collected;\n      };\n\n      // 1. Fetch from Plex Cloud Activity Feeds & Official Plex Watchlist`,
  `        return collected;\n      };\n${accountHistoryHelpers}\n      // 1. Fetch from Plex Cloud Activity Feeds & Official Plex Watchlist`,
  'helpers history account'
);

server = replaceOnce(
  server,
  `            for (const it of items) {\n              allRawItems.push({ raw: it, source: 'Plex Cloud Activity' });\n            }\n            visitedSources.push(\`Plex Cloud (\${items.length} éléments)\`);`,
  `            for (const it of items) {\n              allRawItems.push({ raw: it, source: 'Plex Cloud Activity', sourceKind: 'cloud' });\n            }\n            sourceStats.cloudItems += items.length;\n            visitedSources.push(\`Plex Cloud (\${items.length} éléments)\`);`,
  'stats cloud'
);

server = replaceOnce(
  server,
  `      // 2. Fetch user's servers from Plex.tv (Both owned servers & shared servers from friends)`,
  `      // En scan complet, récupérer l'historique lié au COMPTE Plex. Contrairement\n      // au PMS /status/sessions/history, metadataItem.guid est une identité globale Plex.\n      if (!delta) {\n        const accountHistory = await fetchPlexAccountWatchHistory();\n        if (accountHistory.available && accountHistory.items.length > 0) {\n          for (const item of accountHistory.items) {\n            allRawItems.push({\n              raw: item,\n              source: 'Plex Account Watch History',\n              sourceKind: 'account-history'\n            });\n          }\n          sourceStats.plexAccountHistoryItems = accountHistory.items.length;\n          visitedSources.push(\`Plex Account History (\${accountHistory.items.length} GUID, mode \${accountHistory.queryMode})\`);\n          console.log(\`[Plex Sync] Plex Account Watch History: \${accountHistory.items.length} identité(s) globale(s) récupérée(s) (\${accountHistory.queryMode}).\`);\n        }\n      }\n\n      // 2. Fetch user's servers from Plex.tv (Both owned servers & shared servers from friends)`,
  'fetch account history'
);

const newServerScan = `      // 3. Interroger chaque serveur. En FULL, la bibliothèque actuelle est la source
      // de vérité pour l'état watched et pour la disponibilité. L'historique PMS n'est
      // qu'un fallback si le Watch History du compte Plex n'a fourni aucun GUID.
      const serverTimeout = delta ? 2500 : 5000;
      const usePmsHistoryInFull = !delta && sourceStats.plexAccountHistoryItems === 0;

      for (const server of servers) {
        const serverName = server.name || 'Serveur Plex';
        const serverAccessToken = server.accessToken || token;
        const connections = server.connections || [];
        let serverItemCount = 0;
        let serverInventoryCount = 0;

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

          let connectionSuccess = false;
          let historyFoundOnConnection = 0;

          if (delta || usePmsHistoryInFull) {
            try {
              const items = await fetchPlexPages(
                \`\${uri}/status/sessions/history/all?sort=viewedAt:desc\`,
                { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                serverTimeout,
                50,
                delta ? Number(since) || undefined : undefined
              );
              if (items.length > 0) {
                for (const it of items) {
                  allRawItems.push({
                    raw: it,
                    source: serverName,
                    sourceKind: 'pms-history',
                    serverName,
                    serverId: server.clientIdentifier,
                    serverUri: uri,
                    serverToken: serverAccessToken
                  });
                }
                historyFoundOnConnection = items.length;
                sourceStats.pmsHistoryItems += items.length;
                serverItemCount += items.length;
                connectionSuccess = true;
              }
            } catch {}
          }

          // Le recentlyViewed n'est qu'un fallback du delta si l'historique PMS n'est
          // pas accessible (cas de certains serveurs partagés). Il ne sert plus au FULL.
          if (delta && historyFoundOnConnection === 0) {
            try {
              const items = await fetchPlexPages(
                \`\${uri}/library/recentlyViewed?includeGuids=1\`,
                { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                serverTimeout,
                10,
                Number(since) || undefined
              );
              if (items.length > 0) {
                for (const it of items) {
                  allRawItems.push({
                    raw: it,
                    source: serverName,
                    sourceKind: 'pms-recent-fallback',
                    serverName,
                    serverId: server.clientIdentifier,
                    serverUri: uri,
                    serverToken: serverAccessToken
                  });
                }
                serverItemCount += items.length;
                connectionSuccess = true;
              }
            } catch {}
          }

          if (!delta) {
            try {
              const sectionsRes = await fetch(\`\${uri}/library/sections\`, {
                headers: { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                signal: AbortSignal.timeout(serverTimeout)
              });

              if (sectionsRes.ok) {
                connectionSuccess = true;
                sourceStats.libraryInventoryScanSucceeded = true;
                const sectionsData = await sectionsRes.json();
                const sections = (sectionsData.MediaContainer && sectionsData.MediaContainer.Directory) || [];

                for (const sec of sections) {
                  const secKey = sec.key;
                  const secType = String(sec.type || '').toLowerCase();
                  if (!secKey || !['movie', 'show'].includes(secType)) continue;
                  const sourceName = \`\${serverName} - \${sec.title || 'Section'}\`;

                  if (secType === 'movie') {
                    try {
                      const movies = await fetchPlexPages(
                        \`\${uri}/library/sections/\${secKey}/all?sort=lastViewedAt:desc&includeGuids=1\`,
                        { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                        serverTimeout,
                        100
                      );

                      for (const movie of movies) {
                        if (typeof movie?.guid === 'string' && movie.guid) currentLibraryGuids.add(movie.guid);
                        libraryAvailabilityItems.push({ raw: movie, serverName, serverId: server.clientIdentifier });
                      }
                      sourceStats.libraryInventoryItems += movies.length;
                      serverInventoryCount += movies.length;

                      const watchedMovies = movies.filter(isPlexLibraryItemWatched);
                      for (const movie of watchedMovies) {
                        allRawItems.push({
                          raw: movie,
                          source: sourceName,
                          sourceKind: 'library-watched',
                          availableOnServer: true,
                          serverName,
                          serverId: server.clientIdentifier,
                          serverUri: uri,
                          serverToken: serverAccessToken
                        });
                      }
                      sourceStats.libraryWatchedItems += watchedMovies.length;
                      serverItemCount += watchedMovies.length;
                    } catch (error: any) {
                      console.log(\`[Plex Sync] Movie section \${secKey} skipped on \${serverName}: \${error?.message || error}\`);
                    }
                  }

                  if (secType === 'show') {
                    // 1) Liste des séries = index de disponibilité Plex pour les fiches SeenIt.
                    try {
                      const shows = await fetchPlexPages(
                        \`\${uri}/library/sections/\${secKey}/all?includeGuids=1\`,
                        { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                        serverTimeout,
                        100
                      );
                      for (const show of shows) {
                        if (typeof show?.guid === 'string' && show.guid) currentLibraryGuids.add(show.guid);
                        libraryAvailabilityItems.push({ raw: show, serverName, serverId: server.clientIdentifier });
                      }
                      sourceStats.libraryInventoryItems += shows.length;
                      serverInventoryCount += shows.length;
                    } catch (error: any) {
                      console.log(\`[Plex Sync] Show inventory section \${secKey} skipped on \${serverName}: \${error?.message || error}\`);
                    }

                    // 2) allLeaves = TOUS les épisodes. On filtre viewCount côté SeenIt,
                    // sans dépendre d'une syntaxe de filtre URL non garantie.
                    try {
                      const episodes = await fetchPlexPages(
                        \`\${uri}/library/sections/\${secKey}/allLeaves?sort=lastViewedAt:desc&includeGuids=1\`,
                        { 'Accept': 'application/json', 'X-Plex-Token': serverAccessToken },
                        serverTimeout,
                        200
                      );
                      for (const episode of episodes) {
                        if (typeof episode?.guid === 'string' && episode.guid) currentLibraryGuids.add(episode.guid);
                      }

                      const watchedEpisodes = episodes.filter(isPlexLibraryItemWatched);
                      for (const episode of watchedEpisodes) {
                        allRawItems.push({
                          raw: episode,
                          source: sourceName,
                          sourceKind: 'library-watched',
                          availableOnServer: true,
                          serverName,
                          serverId: server.clientIdentifier,
                          serverUri: uri,
                          serverToken: serverAccessToken
                        });
                      }
                      sourceStats.libraryWatchedItems += watchedEpisodes.length;
                      serverItemCount += watchedEpisodes.length;
                    } catch (error: any) {
                      console.log(\`[Plex Sync] Episode inventory section \${secKey} skipped on \${serverName}: \${error?.message || error}\`);
                    }
                  }
                }
              }
            } catch {}
          }

          if (connectionSuccess) {
            visitedSources.push(\`\${serverName} (\${serverItemCount} vu(s), \${serverInventoryCount} média(s) indexé(s))\`);
            break;
          }
        }
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
        \`[Plex Sync] Sources FULL/DELTA: account=\${sourceStats.plexAccountHistoryItems} \` +
        \`(retained=\${sourceStats.plexAccountHistoryRetained}), libraryWatched=\${sourceStats.libraryWatchedItems}, \` +
        \`libraryInventory=\${sourceStats.libraryInventoryItems}, pmsHistory=\${sourceStats.pmsHistoryItems}, cloud=\${sourceStats.cloudItems}.\`
      );`;

server = replaceRegexOnce(
  server,
  /      \/\/ 3\. Query EACH server \(do NOT stop at the first server!\)[\s\S]*?\n      console\.log\(`\[Plex Sync\] Collected a total of \$\{allRawItems\.length\} raw history records across all sources\.`\);/,
  `${newServerScan}\n\n      console.log(\`[Plex Sync] Collected a total of \${allRawItems.length} raw history records across all sources.\`);`,
  'server scan full/delta'
);

server = replaceOnce(
  server,
  `          serverId: entry.serverId,\n          sourceIdentity,\n          source`,
  `          serverId: entry.serverId,\n          serverName: entry.serverName || source,\n          sourceKind: entry.sourceKind || 'unknown',\n          availableOnServer: entry.availableOnServer === true,\n          sourceIdentity,\n          source`,
  'normalised history source metadata'
);

server = replaceOnce(
  server,
  `      console.log(\`[Plex Sync] Returning \${normalizedHistory.length} history items and \${normalizedWatchlist.length} watchlist items.\`);\n\n      return res.status(200).json({ \n        history: normalizedHistory,\n        watchlist: normalizedWatchlist,\n        visitedSources,\n        totalFound: normalizedHistory.length + normalizedWatchlist.length,\n        cursor: syncCursor\n      });`,
  `      const normalizedLibraryAvailability: any[] = [];\n      const availabilitySeen = new Set<string>();\n      for (const entry of libraryAvailabilityItems) {\n        const meta = unwrapPlexMediaItem(entry.raw || {});\n        const rawType = String(meta.type || '').toLowerCase();\n        const mediaType = rawType === 'show' || rawType === 'series' ? 'tv' : rawType === 'movie' ? 'movie' : null;\n        if (!mediaType) continue;\n\n        const ids = extractPlexExternalIds(meta);\n        if (!ids.tmdbId) continue;\n        const ratingKey = getPlexMetadataLookupKey(meta);\n        if (!ratingKey || !entry.serverId) continue;\n\n        const availabilityKey = \`\${entry.serverId}:\${mediaType}:\${ids.tmdbId}\`;\n        if (availabilitySeen.has(availabilityKey)) continue;\n        availabilitySeen.add(availabilityKey);\n\n        const plexUrl = \`https://app.plex.tv/desktop/#!/server/\${entry.serverId}/details?key=\${encodeURIComponent(\`/library/metadata/\${ratingKey}\`)}\`;\n        normalizedLibraryAvailability.push({\n          tmdbId: ids.tmdbId,\n          mediaType,\n          serverName: entry.serverName || 'Plex',\n          serverId: entry.serverId,\n          ratingKey,\n          plexUrl,\n          watchUrl: plexUrl,\n          title: meta.title || null,\n          year: meta.year ? Number(meta.year) : undefined\n        });\n      }\n\n      const stats = {\n        ...sourceStats,\n        rawItems: allRawItems.length,\n        normalizedHistoryItems: normalizedHistory.length,\n        availabilitySeedItems: normalizedLibraryAvailability.length\n      };\n\n      console.log(\`[Plex Sync] Returning \${normalizedHistory.length} history items, \${normalizedWatchlist.length} watchlist items and \${normalizedLibraryAvailability.length} availability item(s).\`);\n\n      return res.status(200).json({ \n        history: normalizedHistory,\n        watchlist: normalizedWatchlist,\n        libraryAvailability: normalizedLibraryAvailability,\n        stats,\n        visitedSources,\n        totalFound: normalizedHistory.length + normalizedWatchlist.length,\n        cursor: syncCursor\n      });`,
  'response availability and stats'
);

fs.writeFileSync('server.ts', server);

let sync = fs.readFileSync('src/features/plex/syncPlex.ts', 'utf8');

sync = replaceOnce(
  sync,
  `  // 7. ratingKey / key (e.g. "/library/metadata/12345" or "12345")\n  const key = getPlexMetadataLookupKey(item);\n  if (key) {\n    const keyStr = String(key).trim();\n    if (keyStr) return keyStr;\n  }\n\n  return null;`,
  `  // Un ratingKey/key PMS local n'est PAS un GUID provider global.\n  // S'il n'existe aucun guid, la résolution serveur doit enrichir l'objet avant Discover.\n  return null;`,
  'getPlexGuid local key confusion'
);

sync = replaceOnce(
  sync,
  `      appLogger.success('plex', \`Données Plex reçues : \${histLen} visionnage(s), \${watchLen} watchlist\`);\n      return data;`,
  `      appLogger.success('plex', \`Données Plex reçues : \${histLen} visionnage(s), \${watchLen} watchlist\`);\n      if (data.stats) {\n        appLogger.info('plex',\n          \`[Plex Sync] Sources : bibliothèque=\${data.stats.libraryWatchedItems || 0} vu(s) / \${data.stats.libraryInventoryItems || 0} indexé(s), \` +\n          \`compte Plex=\${data.stats.plexAccountHistoryItems || 0} (retenus=\${data.stats.plexAccountHistoryRetained || 0}), \` +\n          \`historique PMS=\${data.stats.pmsHistoryItems || 0}, cloud=\${data.stats.cloudItems || 0}.\`\n        );\n      }\n      return data;`,
  'client source stats log'
);

sync = replaceOnce(
  sync,
  `      const { history = [], watchlist = [], visitedSources = [] } = plexData || {};\n      const nextSyncCursor = Number(plexData?.cursor) || Date.now();`,
  `      const { history = [], watchlist = [], libraryAvailability = [], visitedSources = [] } = plexData || {};\n      const nextSyncCursor = Number(plexData?.cursor) || Date.now();\n\n      if (!delta && plexData?.stats?.libraryInventoryScanSucceeded) {\n        const availabilityStore = usePlexAvailabilityStore.getState();\n        availabilityStore.clearUserCache(user.uid);\n        let seededAvailability = 0;\n        const seededKeys = new Set<string>();\n\n        for (const entry of libraryAvailability) {\n          const tmdbId = Number(entry?.tmdbId);\n          const mediaType: 'movie' | 'tv' | null = entry?.mediaType === 'tv' ? 'tv' : entry?.mediaType === 'movie' ? 'movie' : null;\n          if (!Number.isFinite(tmdbId) || !mediaType || !entry?.serverId || !entry?.ratingKey) continue;\n\n          const key = getPlexMediaKey(tmdbId, mediaType, user.uid);\n          if (seededKeys.has(key)) continue;\n          seededKeys.add(key);\n          availabilityStore.setMediaAvailability(key, {\n            available: true,\n            serverName: entry.serverName,\n            serverId: entry.serverId,\n            ratingKey: String(entry.ratingKey),\n            plexUrl: entry.plexUrl,\n            watchUrl: entry.watchUrl || entry.plexUrl,\n            title: entry.title || undefined,\n            year: entry.year ? Number(entry.year) : undefined,\n            lastChecked: Date.now()\n          });\n          seededAvailability++;\n        }\n\n        appLogger.info('plex', \`[Plex Availability] Cache reconstruit depuis le full scan : \${seededAvailability} média(s) disponible(s).\`);\n      }`,
  'availability seed from full scan'
);

sync = replaceOnce(
  sync,
  `        if (isEpisode) {\n          const seasonNum = item.parentIndex !== undefined ? Number(item.parentIndex) : 1;\n          const episodeNum = item.index !== undefined ? Number(item.index) : 1;`,
  `        if (isEpisode) {\n          const seasonNum = item.parentIndex !== undefined ? Number(item.parentIndex) : NaN;\n          const episodeNum = item.index !== undefined ? Number(item.index) : NaN;\n          if (!Number.isFinite(seasonNum) || !Number.isFinite(episodeNum)) {\n            unresolvedCount++;\n            recordUnresolvedItem(item, 'episode');\n            appLogger.warn('plex', '[Plex Sync] Épisode ignoré : coordonnées saison/épisode absentes, aucun S1E1 inventé.');\n            continue;\n          }`,
  'do not invent S1E1'
);

fs.writeFileSync('src/features/plex/syncPlex.ts', sync);

let detail = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

detail = replaceOnce(
  detail,
  `import { checkPlexAvailability, PlexMediaInfo } from '../features/plex/plexAvailability';\n`,
  ``,
  'remove duplicate availability import'
);

detail = replaceOnce(
  detail,
  `  const [plexMediaInfo, setPlexMediaInfo] = useState<PlexMediaInfo | null>(null);\n`,
  ``,
  'remove duplicate plex state'
);

detail = detail.replace(`    setPlexMediaInfo(null);\n`, '');

detail = replaceRegexOnce(
  detail,
  /\n        \/\/ Fetch \/ update Plex availability with the verified TMDB details[\s\S]*?\n        tmdb\.getUniverseAndCollection/,
  `\n        // La disponibilité Plex est gérée une seule fois par useMediaPresence, qui\n        // réutilise le cache persisté et préchauffé par le full scan.\n\n        tmdb.getUniverseAndCollection`,
  'remove forced Plex availability request'
);

detail = replaceOnce(
  detail,
  `  });\n\n  const openEpisodeModal = (seasonNum: number, ep: any) => {`,
  `  });\n\n  const plexMediaInfo = presence.plexInfo || null;\n\n  const openEpisodeModal = (seasonNum: number, ep: any) => {`,
  'reuse media presence Plex info'
);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', detail);

console.log('Refonte Plex 1.4.51 appliquée.');
