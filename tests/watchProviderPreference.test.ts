import test from 'node:test';
import assert from 'node:assert/strict';
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
