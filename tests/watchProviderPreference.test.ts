import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractOfficialStreamingProvider } from '../src/utils/providerLogos.ts';
import { resolvePassiveProviderState } from '../src/features/providers/passiveProviderState.ts';

const lionessProviders = {
  FR: {
    flatrate: [
      { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' },
      { provider_id: 531, provider_name: 'Paramount Plus', logo_path: '/paramount.jpg' },
    ],
    buy: [
      { provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple.jpg' },
    ],
  },
};

test('#337 Mes plateformes choisit Paramount+ parmi les diffuseurs FR réellement disponibles', () => {
  const provider = extractOfficialStreamingProvider(lionessProviders, [531]);

  assert.deepEqual(provider, {
    provider_id: 531,
    provider_name: 'Paramount Plus',
    logo_path: '/paramount.jpg',
  });
});

test('#337 le diffuseur public préféré reste prioritaire sur une disponibilité Plex', () => {
  const provider = extractOfficialStreamingProvider(lionessProviders, [531]);
  const state = resolvePassiveProviderState(
    'tv:125359:prefs:531',
    provider,
    { available: true, serverName: 'Maison' },
    true,
    [531],
  );

  assert.equal(state.name, 'Paramount Plus');
  assert.equal(state.logo, '/paramount.jpg');
});

test('#337 Plex reste masqué tant que la résolution publique de Lioness est en attente', () => {
  const state = resolvePassiveProviderState(
    'tv:125359:prefs:531',
    null,
    { available: true, serverName: 'Maison' },
    false,
  );

  assert.equal(state.name, null);
  assert.equal(state.logo, null);
});

test('#337 une réponse publique autoritative vide autorise ensuite le fallback Plex', () => {
  const state = resolvePassiveProviderState(
    'tv:125359:prefs:531',
    null,
    { available: true, serverName: 'Maison' },
    true,
  );

  assert.equal(state.name, 'Plex (Maison)');
  assert.ok(state.logo, 'le fallback Plex doit exposer son logo');
  assert.match(state.logo, /^data:image\/svg\+xml/i);
});

test('#337 une plateforme cochée mais absente du média n’est jamais inventée', () => {
  const provider = extractOfficialStreamingProvider(lionessProviders, [337]);

  assert.equal(provider?.provider_id, 8);
  assert.equal(provider?.provider_name, 'Netflix');
});

test('#337 une préférence hydratée après le premier rendu re-sélectionne le payload TMDB connu', () => {
  const beforeHydration = extractOfficialStreamingProvider(lionessProviders, []);
  const afterHydration = extractOfficialStreamingProvider(lionessProviders, [531]);

  assert.equal(beforeHydration?.provider_id, 8);
  assert.equal(afterHydration?.provider_id, 531);
  assert.equal(afterHydration?.provider_name, 'Paramount Plus');
});

test('#337 achat et location restent exclus du choix des diffuseurs', () => {
  const provider = extractOfficialStreamingProvider({
    FR: {
      buy: [{ provider_id: 531, provider_name: 'Paramount Plus', logo_path: '/paramount.jpg' }],
      rent: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }],
    },
  }, [531]);

  assert.equal(provider, null);
});

test('SEENIT-PROVIDER-001 applique Mes plateformes > Plex > fallback public', () => {
  const plex = { available: true, serverName: 'Maison' };
  for (const preferred of [[531], [], [531], [99]]) {
    const provider = extractOfficialStreamingProvider(lionessProviders, preferred);
    const state = resolvePassiveProviderState('tv:125359', provider, plex, true, preferred);
    assert.equal(state.name, preferred.includes(531) ? 'Paramount Plus' : 'Plex (Maison)');
  }
  assert.equal(resolvePassiveProviderState('tv:125359', extractOfficialStreamingProvider(lionessProviders), { available: false }, true, []).name, 'Netflix');
  assert.equal(resolvePassiveProviderState('tv:125359', null, plex, false, []).name, null);
});

test('SEENIT-PROVIDER-001 les cartes historiques passent par le résolveur réactif', () => {
  for (const file of ['components/cards/ContinueWatchingCard.tsx', 'components/cards/MovieWatchCard.tsx', 'components/cards/UpToDateShowCard.tsx', 'components/cards/UpcomingShowCard.tsx', 'components/EpisodeCard.tsx', 'components/HistoryFeed.tsx', 'screens/watchListPresentation.tsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /usePassiveWatchProvider\(/, file);
    assert.doesNotMatch(source, /hasKnownProvider:\s*Boolean\((?:show\.networks|item\.showNetworks)/, file);
    assert.match(source, /getFormattedProviderLogo\(providerLogo, providerName\)/, file);
  }
});
