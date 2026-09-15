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
    { available: true, serverId: 'server-1', ratingKey: '42' },
  );

  assert.equal(state.name, 'Paramount Plus');
  assert.equal(state.logo, '/paramount.jpg');
});

test('#337 une plateforme cochée mais absente du média n’est jamais inventée', () => {
  const provider = extractOfficialStreamingProvider(lionessProviders, [337]);

  assert.equal(provider?.provider_id, 8);
  assert.equal(provider?.provider_name, 'Netflix');
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
