import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupeProvidersByName, getCleanProviderName, storeChannelService } from '../src/features/providers/providerNames.ts';

// Retour terrain du 18/11 (Dexter: Resurrection, « Où regarder ») : « Apple TV+ n'est pas du tout diffuseur » et « Prime ne
// fait que du on demand ». TMDB listait en abonnement les chaînes Paramount+ vendues par Amazon et Apple TV ; SeenIt les
// renommait « Prime Video » et « Apple TV+ » parce que leur nom contient « amazon » et « apple ».
const dexter = [
  { provider_id: 381, provider_name: 'Canal+', logo_path: '/canal.jpg' },
  { provider_id: 531, provider_name: 'Paramount Plus', logo_path: '/paramount.jpg' },
  { provider_id: 582, provider_name: 'Paramount+ Amazon Channel', logo_path: '/paramount-prime.jpg' },
  { provider_id: 1853, provider_name: 'Paramount Plus Apple TV Channel ', logo_path: '/paramount-apple.jpg' },
];

test('Où regarder : une chaîne vendue par Amazon ou Apple TV est le service qu’elle vend, jamais Prime Video ni Apple TV+', () => {
  const rows = dedupeProvidersByName(dexter);
  assert.deepEqual(rows.map(row => [row.provider_id, row.provider_name, row.logo_path]), [[381, 'Canal+', '/canal.jpg'], [531, 'Paramount+', '/paramount.jpg']], 'cas terrain : Canal+ et Paramount+ seulement');
  assert.ok(!rows.some(row => /prime|apple/i.test(row.provider_name)));
});

test('Où regarder : le service direct l’emporte sur sa chaîne, à la même place ; une chaîne seule garde le nom du service', () => {
  assert.deepEqual(dedupeProvidersByName([dexter[2], dexter[0], dexter[1]]).map(row => [row.provider_id, row.provider_name]), [[531, 'Paramount+'], [381, 'Canal+']], 'logo et identifiant du service direct, rang de la première apparition');
  assert.deepEqual(dedupeProvidersByName([dexter[3]]).map(row => [row.provider_id, row.provider_name]), [[1853, 'Paramount+']], 'chaîne seule : le service, pas la boutique');
});

test('Où regarder : toutes les boutiques de chaînes, et les vrais services inchangés', () => {
  for (const [name, expected] of [
    ['OCS Amazon Channel', 'OCS'],
    ['MGM Plus Amazon Channel', 'MGM+'],
    ['Max Amazon Channel', 'Max'],
    ['Starz Roku Premium Channel', 'Starz'],
    ['Paramount+ Apple TV Channel', 'Paramount+'],
    ['Canal+ Séries Prime Video Channel', 'Canal+'],
  ] as const) assert.equal(getCleanProviderName({ provider_name: name }), expected, name);
  for (const [name, expected] of [
    ['Amazon Prime Video', 'Prime Video'],
    ['Amazon Prime Video with Ads', 'Prime Video'],
    ['Apple TV Plus', 'Apple TV+'],
    ['Apple TV', 'Apple TV+'],
    ['Netflix Standard with Ads', 'Netflix'],
  ] as const) assert.equal(getCleanProviderName({ provider_name: name }), expected, name);
  assert.equal(storeChannelService('Amazon Prime Video'), null);
  assert.equal(storeChannelService('Paramount+ Amazon Channel'), 'Paramount+');
});

test('Où regarder : la fiche série et la fiche épisode passent par ce même dédoublonnage', () => {
  assert.match(readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8'), /dedupeProvidersByName\(\[\.\.\.\(providers\.flatrate \|\| \[\]\), \.\.\.\(providers\.ads \|\| \[\]\), \.\.\.\(providers\.free \|\| \[\]\)\]\)/);
  assert.match(readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8'), /dedupeProvidersByName\(\[\.\.\.\(fr\?\.flatrate \|\| \[\]\), \.\.\.\(fr\?\.ads \|\| \[\]\), \.\.\.\(fr\?\.free \|\| \[\]\)\]\)/);
});
