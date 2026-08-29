const fs = require('node:fs');

function replaceOnce(content, search, replacement, label) {
  const first = content.indexOf(search);
  if (first < 0) throw new Error(`Bloc introuvable: ${label}`);
  if (content.indexOf(search, first + search.length) >= 0) throw new Error(`Bloc non unique: ${label}`);
  return content.slice(0, first) + replacement + content.slice(first + search.length);
}

function replaceRegexOnce(content, regex, replacement, label) {
  const matches = [...content.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`Regex ${label}: ${matches.length} occurrence(s)`);
  return content.replace(regex, replacement);
}

let server = fs.readFileSync('server.ts', 'utf8');

server = replaceOnce(
  server,
  `  getPlexMetadataLookupKey,\n  getStrongPlexSourceIdentity,`,
  `  getPlexMetadataLookupKey,\n  getPlexParentShowMetadataLookupKey,\n  getStrongPlexSourceIdentity,`,
  'import parent show metadata key'
);

const newEnrichEntry = `      const enrichEntry = async (entry: any): Promise<any> => {
        const raw = entry.raw || {};
        const meta = unwrapPlexMediaItem(raw);
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
      };`;

server = replaceRegexOnce(
  server,
  /      const enrichEntry = async \(entry: any\): Promise<any> => \{[\s\S]*?\n      \};(?=\n\n      const enrichedEntries)/,
  newEnrichEntry,
  'enrichEntry'
);

server = replaceOnce(
  server,
  `          metadataKey: meta.metadataKey || meta.metadata_key || raw.metadataKey || raw.metadata_key,\n          serverId: entry.serverId,`,
  `          metadataKey: meta.metadataKey || meta.metadata_key || raw.metadataKey || raw.metadata_key,\n          metadataItemID: meta.metadataItemID || meta.metadataItemId || raw.metadataItemID || raw.metadataItemId,\n          historyKey: meta.historyKey || raw.historyKey,\n          librarySectionID: meta.librarySectionID || raw.librarySectionID,\n          thumb: meta.thumb || raw.thumb,\n          art: meta.art || raw.art,\n          grandparentThumb: meta.grandparentThumb || raw.grandparentThumb,\n          grandparentArt: meta.grandparentArt || raw.grandparentArt,\n          serverId: entry.serverId,`,
  'normalized history technical fields'
);

fs.writeFileSync('server.ts', server);

let sync = fs.readFileSync('src/features/plex/syncPlex.ts', 'utf8');

sync = replaceOnce(
  sync,
  `        const lookupKey = getPlexMetadataLookupKey(item);\n        const reference = item.sourceIdentity ||\n          (ids.tmdbId ? \`tmdb:\${ids.tmdbId}\` : null) ||\n          (ids.imdbId ? \`imdb:\${ids.imdbId}\` : null) ||\n          (ids.tvdbId ? \`tvdb:\${ids.tvdbId}\` : null) ||\n          (ids.plexGuid ? \`plex:\${ids.plexGuid}\` : null) ||\n          (lookupKey ? \`metadata:\${lookupKey}\` : null) ||\n          'aucune';`,
  `        const lookupKey = getPlexMetadataLookupKey(item);\n        const historyKey = typeof item.historyKey === 'string' ? item.historyKey.trim() : '';\n        const reference = item.sourceIdentity ||\n          (ids.tmdbId ? \`tmdb:\${ids.tmdbId}\` : null) ||\n          (ids.imdbId ? \`imdb:\${ids.imdbId}\` : null) ||\n          (ids.tvdbId ? \`tvdb:\${ids.tvdbId}\` : null) ||\n          (ids.plexGuid ? \`plex:\${ids.plexGuid}\` : null) ||\n          (lookupKey ? \`metadata:\${lookupKey}\` : null) ||\n          (historyKey ? \`history:\${historyKey}\` : null) ||\n          'aucune';`,
  'unresolved history reference'
);

fs.writeFileSync('src/features/plex/syncPlex.ts', sync);
console.log('Plex history fix applied successfully.');
