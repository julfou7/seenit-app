from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: attendu 1 occurrence, trouvé {count}")
    return text.replace(old, new, 1)


# Helper backend-only : un item de Watch History n'est pas un état vu courant.
Path('src/features/runtime/plexAccountCurrentState.ts').write_text("""/**
 * Lit uniquement un état vu/non-vu EXPLICITE renvoyé par Plex.
 * L'appartenance au Watch History n'est jamais convertie implicitement en \"vu\".
 */
export function readExplicitPlexCurrentWatchState(payload: any): boolean | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload,
    payload?.MediaContainer,
    payload?.mediaContainer,
    payload?.MediaContainer?.Metadata?.[0],
    payload?.MediaContainer?.metadata?.[0],
    payload?.mediaContainer?.Metadata?.[0],
    payload?.mediaContainer?.metadata?.[0],
    payload?.Metadata?.[0],
    payload?.metadata?.[0],
    payload?.userState,
    payload?.UserState
  ].filter(Boolean);

  for (const candidate of candidates) {
    const raw = candidate?.viewCount ?? candidate?.view_count;
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const viewCount = Number(raw);
    if (Number.isFinite(viewCount) && viewCount >= 0) return viewCount > 0;
  }

  return null;
}
""")

# Backend Plex.
path = Path('server.ts')
text = path.read_text()
text = replace_once(
    text,
    'import { buildPlexLibraryWatchState, mergePlexLibraryWatchStates } from "./src/features/plex/plexLibraryWatchState.ts";\n',
    'import { buildPlexLibraryWatchState, mergePlexLibraryWatchStates } from "./src/features/plex/plexLibraryWatchState.ts";\n'
    'import { readExplicitPlexCurrentWatchState } from "./src/features/runtime/plexAccountCurrentState.ts";\n',
    'import current state'
)
text = replace_once(
    text,
    '        plexAccountHistoryItems: 0,\n        plexAccountHistoryRetained: 0,\n        pmsHistoryItems: 0,',
    '        plexAccountHistoryItems: 0,\n'
    '        plexAccountHistoryRetained: 0,\n'
    '        plexAccountCurrentStateResolved: 0,\n'
    '        plexAccountCurrentWatched: 0,\n'
    '        plexAccountCurrentUnwatched: 0,\n'
    '        plexAccountCurrentStateUnknown: 0,\n'
    '        pmsHistoryItems: 0,',
    'stats current state'
)
text = replace_once(
    text,
    'fetch(`https://discover.provider.plex.tv/library/metadata/${encodeURIComponent(plexId)}?includeGuids=1`, {',
    'fetch(`https://discover.provider.plex.tv/library/metadata/${encodeURIComponent(plexId)}?includeGuids=1&includeUserState=1`, {',
    'provider metadata user state'
)
boundary = """      };

      const fetchServerMetadata = async (entry: any, ratingKey: unknown): Promise<any | null> => {"""
helper = """      };

      const fetchProviderUserState = async (rawGuid: unknown): Promise<any | null> => {
        if (typeof rawGuid !== 'string' || !rawGuid.trim()) return null;
        const plexId = extractPlexExternalIds({ guid: rawGuid }).plexGuid;
        if (!plexId) return null;

        try {
          const response = await fetch(`https://metadata.provider.plex.tv/library/metadata/${encodeURIComponent(plexId)}/userState`, {
            headers: {
              'Accept': 'application/json',
              'X-Plex-Token': token,
              'X-Plex-Client-Identifier': plexClientIdentifier,
              'X-Plex-Product': 'SeenIt'
            },
            signal: AbortSignal.timeout(4000)
          });
          if (!response.ok) return null;
          return await response.json();
        } catch {
          return null;
        }
      };

      const fetchServerMetadata = async (entry: any, ratingKey: unknown): Promise<any | null> => {"""
text = replace_once(text, boundary, helper, 'provider userState helper')

old_account = """        if (entry.sourceKind === 'account-history' && typeof meta?.guid === 'string') {
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
        }"""
new_account = """        if (entry.sourceKind === 'account-history' && typeof meta?.guid === 'string') {
          let accountCurrentWatched: boolean | null = null;
          const providerMetadata = await fetchProviderMetadata(meta.guid);
          if (providerMetadata) {
            accountCurrentWatched = readExplicitPlexCurrentWatchState(providerMetadata);
            raw = {
              ...originalRaw,
              ...providerMetadata,
              historyKey: originalRaw.historyKey,
              accountHistoryId: originalRaw.accountHistoryId,
              accountMetadataId: originalRaw.accountMetadataId,
              parentAccountMetadataId: originalRaw.parentAccountMetadataId,
              grandparentAccountMetadataId: originalRaw.grandparentAccountMetadataId
            };
            meta = unwrapPlexMediaItem(raw);
          }

          // includeUserState=1 évite normalement un second appel. Si Plex ne renvoie
          // pas viewCount avec Metadata, interroger explicitement le userState courant.
          if (accountCurrentWatched === null) {
            accountCurrentWatched = readExplicitPlexCurrentWatchState(
              await fetchProviderUserState(meta.guid || originalRaw.guid)
            );
          }

          // Pour un épisode hors bibliothèque PMS, enrichir aussi la série parente
          // afin de conserver l'identité canonique TMDB du show.
          const accountType = String(meta?.type || '').toLowerCase();
          if (accountType === 'episode') {
            const parentIdentity = buildPlexParentShowIdentityItem(meta);
            const parentIds = extractPlexExternalIds(parentIdentity);
            if (!parentIds.tmdbId && typeof meta?.grandparentGuid === 'string') {
              const parentMetadata = await fetchProviderMetadata(meta.grandparentGuid);
              if (parentMetadata) {
                raw = {
                  ...raw,
                  grandparentGuid: meta.grandparentGuid || parentMetadata.guid,
                  grandparentGuids: parentMetadata.Guid || parentMetadata.guids || meta.grandparentGuids
                };
                meta = unwrapPlexMediaItem(raw);
              }
            }
          }

          entry = { ...entry, raw, accountCurrentWatched };
        }"""
text = replace_once(text, old_account, new_account, 'account current state enrichment')

marker = """      const normalizedHistory: any[] = [];
      const normalizedSince = Number.isFinite(Number(since)) ? Number(since) : undefined;"""
account_states = """      let accountCurrentStateResolved = 0;
      let accountCurrentWatched = 0;
      let accountCurrentUnwatched = 0;
      let accountCurrentStateUnknown = 0;

      for (const entry of enrichedEntries) {
        if (entry?.sourceKind !== 'account-history') continue;
        if (typeof entry?.accountCurrentWatched !== 'boolean') {
          accountCurrentStateUnknown++;
          continue;
        }

        accountCurrentStateResolved++;
        if (entry.accountCurrentWatched) accountCurrentWatched++;
        else accountCurrentUnwatched++;

        const meta = unwrapPlexMediaItem(entry.raw || {});
        const rawType = String(meta?.type || '').toLowerCase();
        let watchState = null;

        if (rawType === 'movie') {
          watchState = buildPlexLibraryWatchState(
            { ...meta, viewCount: entry.accountCurrentWatched ? 1 : 0 },
            { mediaType: 'movie', serverName: 'Plex Account' }
          );
        } else if (rawType === 'episode') {
          const parentTmdbId = Number(extractPlexExternalIds(buildPlexParentShowIdentityItem(meta)).tmdbId);
          watchState = buildPlexLibraryWatchState(
            { ...meta, viewCount: entry.accountCurrentWatched ? 1 : 0 },
            {
              mediaType: 'episode',
              parentTmdbId: Number.isInteger(parentTmdbId) && parentTmdbId > 0 ? parentTmdbId : null,
              serverName: 'Plex Account'
            }
          );
        }

        if (watchState) libraryWatchStateItems.push(watchState);
      }

      sourceStats.plexAccountCurrentStateResolved = accountCurrentStateResolved;
      sourceStats.plexAccountCurrentWatched = accountCurrentWatched;
      sourceStats.plexAccountCurrentUnwatched = accountCurrentUnwatched;
      sourceStats.plexAccountCurrentStateUnknown = accountCurrentStateUnknown;
      // « retenus » représente désormais les éléments réellement confirmés vus.
      sourceStats.plexAccountHistoryRetained = accountCurrentWatched;

      console.log(
        `[Plex Sync] Account current state: resolved=${accountCurrentStateResolved}, ` +
        `watched=${accountCurrentWatched}, unwatched=${accountCurrentUnwatched}, unknown=${accountCurrentStateUnknown}.`
      );

      const normalizedHistory: any[] = [];
      const normalizedSince = Number.isFinite(Number(since)) ? Number(since) : undefined;"""
text = replace_once(text, marker, account_states, 'account current watch states')

loop = """      for (const entry of enrichedEntries) {
        const raw = entry.raw || {};"""
guarded_loop = """      for (const entry of enrichedEntries) {
        // Le Watch History est un journal d'événements, pas l'état courant.
        // Sans confirmation viewCount > 0, il ne peut jamais créer un « vu ».
        if (entry?.sourceKind === 'account-history' && entry?.accountCurrentWatched !== true) continue;

        const raw = entry.raw || {};"""
text = replace_once(text, loop, guarded_loop, 'account history import guard')
path.write_text(text)

# TNR ciblés.
path = Path('tests/plexAccountHistory.test.ts')
text = path.read_text()
text = replace_once(
    text,
    "} from '../src/features/plex/plexAccountHistory.ts';\n",
    "} from '../src/features/plex/plexAccountHistory.ts';\n"
    "import { readExplicitPlexCurrentWatchState } from '../src/features/runtime/plexAccountCurrentState.ts';\n"
    "import { readFileSync } from 'node:fs';\n",
    'test imports'
)
text += """

test('SEENIT-PLEX-005 le Watch History du compte exige un userState courant explicite', () => {
  assert.equal(readExplicitPlexCurrentWatchState({ guid: 'plex://movie/history-only' }), null);
  assert.equal(readExplicitPlexCurrentWatchState({ MediaContainer: { Metadata: [{ viewCount: 0 }] } }), false);
  assert.equal(readExplicitPlexCurrentWatchState({ MediaContainer: { Metadata: [{ viewCount: 2 }] } }), true);
  assert.equal(readExplicitPlexCurrentWatchState({ view_count: '0' }), false);
});

test('SEENIT-PLEX-005 le backend refuse un historique compte sans état courant vu', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.ok(serverSource.includes('metadata.provider.plex.tv/library/metadata/'));
  assert.ok(serverSource.includes('/userState'));
  assert.ok(serverSource.includes("sourceKind === 'account-history'"));
  assert.ok(serverSource.includes('accountCurrentWatched !== true'));
  assert.ok(serverSource.includes('plexAccountCurrentUnwatched'));
});
"""
path.write_text(text)

# SPEC : corriger l'hypothèse erronée « account-history = preuve actuelle ».
path = Path('docs/specifications/seenit.md')
text = path.read_text()
old = """- **SEENIT-PLEX-005** — Un média Plex ne devient vu qu'avec une preuve de visionnage autoritative.
  Une activité `cloud` qui porte exactement la même identité technique qu'un film de la watchlist
  reste ambiguë et est exclue de l'historique tant qu'une source forte (`account-history`, historique
  PMS ou `viewCount > 0`) ne confirme pas le visionnage. Le rapprochement ne se fait jamais par
  titre ou année ; en cas d'ambiguïté SeenIt conserve l'état non vu."""
new = """- **SEENIT-PLEX-005** — Un média Plex ne devient vu qu'avec une preuve de visionnage autoritative.
  Une activité `cloud` qui porte exactement la même identité technique qu'un film de la watchlist
  reste ambiguë. L'appartenance au **Watch History du compte Plex est elle aussi historique et ne
  représente jamais, à elle seule, l'état courant** : en full scan, chaque entrée `account-history`
  doit être validée par le `userState` provider de la même identité Plex. Seul un `viewCount > 0`
  explicite permet son import comme vu ; un `viewCount = 0` explicite alimente la réconciliation
  non-vue, et un état courant indisponible n'ajoute aucune progression. L'historique PMS récent et
  les états `viewCount` explicites restent des preuves selon leur contrat. Le rapprochement ne se
  fait jamais par titre ou année ; en cas d'ambiguïté SeenIt conserve l'état non vu."""
text = replace_once(text, old, new, 'SPEC PLEX-005')
path.write_text(text)

# Catalogue des exigences.
path = Path('docs/specifications/requirements.json')
data = json.loads(path.read_text())
req = next((item for item in data['requirements'] if item['id'] == 'SEENIT-PLEX-005'), None)
if req is None:
    raise SystemExit('SEENIT-PLEX-005 introuvable')
for item in [
    {
        'file': 'tests/plexAccountHistory.test.ts',
        'contains': 'SEENIT-PLEX-005 le Watch History du compte exige un userState courant explicite'
    },
    {
        'file': 'tests/plexAccountHistory.test.ts',
        'contains': 'SEENIT-PLEX-005 le backend refuse un historique compte sans état courant vu'
    }
]:
    if item not in req['tests']:
        req['tests'].append(item)
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

# Registre durable.
path = Path('docs/requests/registry.md')
text = path.read_text()
old = "| USR-2026-09-02-003 | 2026-09-02 | Une synchronisation Plex ne marque jamais un média vu depuis une simple watchlist ou une activité Cloud ambiguë ; seule une preuve de visionnage autoritative peut faire progresser l'état. | `SEENIT-PLEX-005`, [issue #26](https://github.com/julfou7/seenit-app/issues/26) | active |"
new = "| USR-2026-09-02-003 | 2026-09-02 | Une synchronisation Plex ne marque jamais un média vu depuis une simple watchlist, une activité Cloud ambiguë ou la seule présence d'un GUID dans le Watch History du compte. En full scan, une entrée de compte doit être confirmée par son `userState.viewCount` courant ; seule une preuve autoritative peut faire progresser l'état. | `SEENIT-PLEX-005`, [issue #26](https://github.com/julfou7/seenit-app/issues/26) | active |"
text = replace_once(text, old, new, 'registry Plex #26')
path.write_text(text)
