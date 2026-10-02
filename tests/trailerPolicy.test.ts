import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTrailerLanguage, prepareTrailerVideos, trailerEmbedUrl } from '../src/features/trailers/trailerPolicy.ts';
import { createMediaDetailRenderSnapshot } from '../src/features/shows/mediaDetailRenderSnapshot.ts';

test('SEENIT-UX-013 ne confond jamais langue, VO et sous-titres français', () => {
  const classify = (name: string, iso_639_1?: string) => classifyTrailerLanguage({ name, iso_639_1 });
  assert.equal(classify('Trailer VO', 'en'), 'VO');
  assert.equal(classify('Trailer', 'en'), 'Anglais');
  assert.equal(classify('Bande-annonce', 'fr'), 'Français');
  assert.equal(classify('French trailer', 'fr'), 'Français');
  assert.equal(classify('Trailer VOST', 'en'), 'Anglais');
  assert.equal(classify('Trailer VOSTFR', 'fr'), 'VOSTFR');
  assert.equal(classify('Trailer VF', 'en'), 'VF');
  assert.equal(classify('Version française'), 'VF');
  assert.equal(classify('French dubbed trailer'), 'VF');
  assert.equal(classify('Trailer'), 'Langue non précisée');
  assert.equal(classify('Trailer VF / VOSTFR', 'fr'), 'Français');
  assert.equal(classify('Trailer', 'ja'), 'Japonais');
  assert.equal(classify('Trailer', 'invalid'), 'Langue non précisée');
});

test('les vidéos gardent leur identité, leur nom et leur type sans être réduites à deux variantes', () => {
  const videos = prepareTrailerVideos([
    { site: 'YouTube', key: 'clip', name: 'Extrait', type: 'Clip', official: true },
    { site: 'YouTube', key: 'teaser', name: 'Teaser', type: 'Teaser', official: true },
    { site: 'YouTube', key: 'vo', name: 'Premier montage VO', type: 'Trailer', official: true },
    { site: 'YouTube', key: 'vf', name: 'Autre montage VF', type: 'Trailer', official: false },
    { site: 'YouTube', key: 'vo', name: 'Doublon', type: 'Trailer', official: false },
    { site: 'Vimeo', key: 'other', name: 'Autre' },
  ]);
  assert.deepEqual(videos.map(video => video.key), ['vo', 'vf', 'teaser', 'clip']);
  assert.equal(videos[0].name, 'Premier montage VO');
  assert.equal(videos[0].languageLabel, 'VO');
  assert.equal(videos[1].languageLabel, 'VF');
  assert.equal(videos[2].typeLabel, 'Teaser');
  assert.equal(videos[3].typeLabel, 'Extrait');
});

test('la préférence YouTube ne transforme jamais une vidéo inconnue en VOSTFR', () => {
  for (const name of ['VO', 'Trailer', 'VOST', 'VF']) {
    assert.equal(new URL(trailerEmbedUrl({ key: 'abc', name })).searchParams.has('cc_load_policy'), false);
  }
  const params = new URL(trailerEmbedUrl({ key: 'abc', name: 'Trailer VOSTFR' })).searchParams;
  assert.equal(params.get('cc_lang_pref'), 'fr');
  assert.equal(params.get('controls'), '1');
  assert.equal(params.get('fs'), '1');
});

test('le snapshot de production privilégie les trailers avant sa borne de huit vidéos', () => {
  const snapshot = createMediaDetailRenderSnapshot({ id: 12, videos: { results: [
    ...Array.from({ length: 10 }, (_, index) => ({ site: 'YouTube', key: `clip-${index}`, name: 'Extrait', type: 'Clip' })),
    { site: 'YouTube', key: 'vf', name: 'Bande-annonce VF', type: 'Trailer', official: true, iso_639_1: 'fr', iso_3166_1: 'FR', published_at: '2026-01-01' },
  ] } }, 'movie');
  assert.equal(snapshot.videos.results.length, 8);
  assert.equal(snapshot.videos.results[0].key, 'vf');
  assert.equal(snapshot.videos.results[0].official, true);
  assert.equal(snapshot.videos.results[0].iso_3166_1, 'FR');
});

test('des libellés contradictoires pour la même identité restent neutres', () => {
  const [video] = prepareTrailerVideos([
    { site: 'YouTube', key: 'same', name: 'VF', iso_639_1: 'fr' },
    { site: 'YouTube', key: 'same', name: 'VOSTFR', iso_639_1: 'fr' },
  ]);
  assert.equal(video.languageLabel, 'Français');
  assert.equal(new URL(trailerEmbedUrl(video)).searchParams.has('cc_load_policy'), false);
});
