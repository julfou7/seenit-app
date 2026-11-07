import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeReleases, formatReleaseSize, matchesVersionFilter, releaseAgeLabel, releaseLanguage, releaseQualityLabel } from '../src/features/downloads/releaseVersions.ts';

const now = Date.parse('2026-11-07T12:00:00Z');
const release = (id: number, name: string, seeders: number, extra: Record<string, unknown> = {}) => ({ id, name, size: 2.1 * 1024 ** 3, seeders, ...extra });

test('SEENIT-DOWNLOAD-014 #879 version précise : qualité et langue lues dans le nom de la release', () => {
  assert.equal(releaseQualityLabel({ name: 'Show.S01E03.MULTi.2160p.NF.WEB-DL.mkv' }), '4K');
  assert.equal(releaseQualityLabel({ name: 'Show S01E03 UHD HDR' }), '4K');
  assert.equal(releaseQualityLabel({ name: 'Show.S01E03.FRENCH.1080p.WEB.mkv' }), '1080p');
  assert.equal(releaseQualityLabel({ name: 'Show.S01E03.720p.HDTV' }), '720p');
  assert.equal(releaseQualityLabel({ name: 'Show.S01E03.HDTV' }), 'SD');
  assert.equal(releaseLanguage({ name: 'Show.S01E03.VOSTFR.1080p' }), 'VO sous-titrée');
  assert.equal(releaseLanguage({ name: 'Show.S01E03.MULTi.1080p' }), 'Multi');
  assert.equal(releaseLanguage({ name: 'Show.S01E03.TRUEFRENCH.1080p' }), 'Français');
  assert.equal(releaseLanguage({ name: 'Show.S01E03.1080p', language: 'Français' }), 'Français');
  assert.equal(releaseLanguage({ name: 'Show.S01E03.1080p.WEB' }), 'VO');
  // Un mot du titre qui contient « French » n'est pas un marqueur de langue.
  assert.equal(releaseLanguage({ name: 'Frenchie.S01E03.1080p' }), 'VO');
});

test('SEENIT-DOWNLOAD-014 #879 version précise : une seule « Conseillée », en tête, puis par sources', () => {
  const described = describeReleases([
    release(1, 'Show.S01E03.MULTi.2160p.WEB', 400),
    release(2, 'Show.S01E03.FRENCH.1080p.HDLight.x264', 300),
    release(3, 'Show.S01E03.FRENCH.1080p.WEB', 120, { createdAt: '2026-11-05T12:00:00Z' }),
    release(4, 'Show.S01E03.VOSTFR.1080p', 150),
    release(5, 'Show.S01E03.FRENCH.1080p.WEB.lent', 3)
  ], '1080p', now);
  assert.deepEqual(described.map(entry => entry.release.id), [3, 1, 2, 4, 5], 'français 1080p non Light d’abord, puis par sources');
  assert.deepEqual(described.map(entry => entry.recommended), [true, false, false, false, false]);
  assert.equal(described[0].ageDays, 2);
  assert.deepEqual(described.map(entry => entry.speedLabel), ['Rapide', 'Rapide', 'Rapide', 'Rapide', 'Lent']);
  assert.equal(described.find(entry => entry.release.id === 2)?.light, true);
  // Préférence 4K : la Multi 4K devient la conseillée.
  assert.equal(describeReleases([release(3, 'Show.FRENCH.1080p', 120), release(1, 'Show.MULTi.2160p', 40)], '4k', now)[0].release.id, 1);
  // Sans version française, la mieux partagée reste conseillée : rien n'est masqué.
  const vo = describeReleases([release(7, 'Show.1080p.WEB', 9), release(8, 'Show.720p.WEB', 30)], '1080p', now);
  assert.deepEqual(vo.map(entry => [entry.release.id, entry.recommended]), [[8, true], [7, false]]);
  assert.deepEqual(describeReleases([], '1080p', now), []);
});

test('SEENIT-DOWNLOAD-014 #879 version précise : filtres, taille et âge en français', () => {
  const entry = (quality: string, language: string) => ({ quality, language }) as Parameters<typeof matchesVersionFilter>[0];
  assert.equal(matchesVersionFilter(entry('4K', 'Multi'), 'Toutes'), true);
  assert.equal(matchesVersionFilter(entry('4K', 'Multi'), '1080p'), false);
  assert.equal(matchesVersionFilter(entry('4K', 'Multi'), '4K'), true);
  assert.equal(matchesVersionFilter(entry('1080p', 'Multi'), 'Français'), true, 'Multi contient la piste française');
  assert.equal(matchesVersionFilter(entry('1080p', 'Multi'), 'VO'), true, 'Multi contient aussi la VO');
  assert.equal(matchesVersionFilter(entry('1080p', 'Français'), 'VO'), false);
  assert.equal(matchesVersionFilter(entry('1080p', 'VO sous-titrée'), 'Français'), false);
  assert.equal(formatReleaseSize(2.1 * 1024 ** 3), '2,1 Go');
  assert.equal(formatReleaseSize(850 * 1024 ** 2), '850 Mo');
  assert.deepEqual([undefined, 0, 1, 2, 45, 400].map(releaseAgeLabel), ['', "mis en ligne aujourd'hui", 'mis en ligne hier', 'mis en ligne il y a 2 j', 'mis en ligne il y a 1 mois', 'mis en ligne il y a 1 an']);
});

test('SEENIT-DOWNLOAD-014 #879 version précise : une page, la même voie d’envoi que la popup', () => {
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  const page = readFileSync('src/screens/mediaDetail/PreciseVersionPage.tsx', 'utf8');
  const modal = readFileSync('src/components/DownloadModal.tsx', 'utf8');
  // Un seul envoi manuel : la popup et la page appellent sendReleaseToClient, plus aucun pushReleaseDirectly direct.
  assert.match(modal, /await sendReleaseToClient\(\{/);
  assert.match(page, /await sendReleaseToClient\(\{/);
  assert.doesNotMatch(modal + page, /pushReleaseDirectly/);
  // Page pleine hauteur sous le gate, chargée paresseusement, ouverte pour un seul épisode sorti.
  assert.match(view, /const PreciseVersionPage = lazy\(\(\) => import\('\.\/mediaDetail\/PreciseVersionPage'\)\);/);
  assert.match(view, /\{preciseTarget && downloadsEnabled && effectiveTmdbId && <Suspense/);
  assert.match(view, /if \(pickedNow\.length !== 1 \|\| !effectiveTmdbId\) return;/);
  assert.match(page, /className="fixed inset-0 z-\[180\] max-w-md mx-auto/);
  assert.doesNotMatch(page, /bottom-0[^"]*rounded-t/, 'jamais une feuille du bas');
  // Une panne C411 reste une panne, distincte d'une absence de version.
  assert.match(page, /\{state === 'error' && <p role="alert"/);
});
