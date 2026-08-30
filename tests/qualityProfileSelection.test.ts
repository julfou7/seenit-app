import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAutoQualityProfile,
  resolveEffectiveQualityProfileId
} from '../src/features/downloads/qualityProfileSelection.ts';

const profiles = [
  { id: 1, name: 'Any' },
  { id: 2, name: 'HD - 720p/1080p' },
  { id: 3, name: 'HD-720p' },
  { id: 4, name: 'HD-1080p' },
  { id: 5, name: 'SD' },
  { id: 6, name: 'Ultra-HD' }
];

test('Auto 1080p privilégie le profil 1080p dédié au profil mixte 720p/1080p', () => {
  assert.deepEqual(resolveAutoQualityProfile(profiles, '1080p'), { id: 4, name: 'HD-1080p' });
});

test('Auto 4K sélectionne le profil Ultra-HD', () => {
  assert.deepEqual(resolveAutoQualityProfile(profiles, '4k'), { id: 6, name: 'Ultra-HD' });
});

test('un profil explicitement configuré reste toujours prioritaire sur Auto', () => {
  assert.equal(resolveEffectiveQualityProfileId(profiles, '1080p', 2), 2);
  assert.equal(resolveEffectiveQualityProfileId(profiles, '4k', 1), 1);
});

test('Auto 1080p accepte un profil mixte uniquement si aucun profil 1080p dédié n’existe', () => {
  const withoutDedicated1080 = profiles.filter(profile => profile.id !== 4);
  assert.equal(resolveAutoQualityProfile(withoutDedicated1080, '1080p')?.id, 2);
});

test('une liste vide ne fabrique aucun identifiant de profil', () => {
  assert.equal(resolveAutoQualityProfile([], '1080p'), null);
  assert.equal(resolveEffectiveQualityProfileId([], '4k'), undefined);
});
