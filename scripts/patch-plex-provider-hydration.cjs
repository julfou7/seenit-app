const fs = require('node:fs');

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  if (index < 0) throw new Error(`Bloc introuvable: ${label}`);
  if (content.indexOf(search, index + search.length) >= 0) throw new Error(`Bloc non unique: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + search.length);
}

let server = fs.readFileSync('server.ts', 'utf8');

server = replaceOnce(
  server,
  `              // Un épisode doit conserver ses coordonnées S/E. Le fallback GraphQL minimal\n              // peut résoudre les films mais ne doit jamais inventer S1E1.\n              if (normalized.type === 'episode' &&\n                  (!Number.isFinite(normalized.parentIndex) || !Number.isFinite(normalized.index))) {\n                continue;\n              }\n\n              const identity = normalized.guid.trim();`,
  `              // Le Watch History du compte ne sert ici qu'à retrouver le GUID global.\n              // Si les coordonnées S/E manquent, elles seront hydratées plus bas depuis\n              // le véritable objet Metadata du provider Plex.\n              const identity = normalized.guid.trim();`,
  'ne plus jeter les épisodes sans index GraphQL'
);

server = replaceOnce(
  server,
  `      const metadataCache = new Map<string, any>();\n\n      const fetchServerMetadata = async`,
  `      const metadataCache = new Map<string, any>();\n      const providerMetadataCache = new Map<string, any>();\n\n      const fetchProviderMetadata = async (rawGuid: unknown): Promise<any | null> => {\n        if (typeof rawGuid !== 'string' || !rawGuid.trim()) return null;\n        const plexId = extractPlexExternalIds({ guid: rawGuid }).plexGuid;\n        if (!plexId) return null;\n        if (providerMetadataCache.has(plexId)) return providerMetadataCache.get(plexId);\n\n        try {\n          const response = await fetch(\`https://discover.provider.plex.tv/library/metadata/\${encodeURIComponent(plexId)}?includeGuids=1\`, {\n            headers: {\n              'Accept': 'application/json',\n              'X-Plex-Token': token,\n              'X-Plex-Client-Identifier': plexClientIdentifier,\n              'X-Plex-Product': 'SeenIt'\n            },\n            signal: AbortSignal.timeout(6000)\n          });\n          if (!response.ok) return null;\n          const payload = await response.json();\n          const metadata = extractItems(payload)[0] || null;\n          if (metadata) providerMetadataCache.set(plexId, metadata);\n          return metadata;\n        } catch {\n          return null;\n        }\n      };\n\n      const fetchServerMetadata = async`,
  'provider metadata helper'
);

server = replaceOnce(
  server,
  `      const enrichEntry = async (entry: any): Promise<any> => {\n        const raw = entry.raw || {};\n        const meta = unwrapPlexMediaItem(raw);\n        const rawType = String(meta.type || raw.type || '').toLowerCase();`,
  `      const enrichEntry = async (entry: any): Promise<any> => {\n        const originalRaw = entry.raw || {};\n        let raw = originalRaw;\n        let meta = unwrapPlexMediaItem(raw);\n\n        // Le Watch History compte fournit un GUID global. On l'utilise immédiatement\n        // pour charger l'objet Metadata documenté par Plex : ratingKey/key/guid et,\n        // pour les épisodes, parentIndex/index/grandparentGuid deviennent disponibles.\n        if (entry.sourceKind === 'account-history' && typeof meta?.guid === 'string') {\n          const providerMetadata = await fetchProviderMetadata(meta.guid);\n          if (providerMetadata) {\n            raw = {\n              ...originalRaw,\n              ...providerMetadata,\n              historyKey: originalRaw.historyKey,\n              accountHistoryId: originalRaw.accountHistoryId,\n              accountMetadataId: originalRaw.accountMetadataId,\n              parentAccountMetadataId: originalRaw.parentAccountMetadataId,\n              grandparentAccountMetadataId: originalRaw.grandparentAccountMetadataId\n            };\n            entry = { ...entry, raw };\n            meta = unwrapPlexMediaItem(raw);\n          }\n        }\n\n        const rawType = String(meta.type || raw.type || '').toLowerCase();`,
  'hydrate account history via provider Metadata'
);

fs.writeFileSync('server.ts', server);
console.log('Hydratation Metadata Plex appliquée.');
