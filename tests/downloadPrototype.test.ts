import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadGroup, downloadProblem } from '../src/features/downloads/downloadGroups.ts';
import { episodeDownloadPresentation } from '../src/features/downloads/episodeDownloadPresentation.ts';
import { matchesLightFilter, releaseVariantLabel } from '../src/features/downloads/releaseQuality.ts';
import { readFileSync } from 'node:fs';
import { fetchC411Torrents } from '../src/features/downloads/c411Backend.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarrLive.ts';
import { isDownloadInHistorySection } from '../src/features/downloads/downloadStatePolicy.ts';
import { selectArrSeasonReleases } from '../src/features/downloads/seasonReleaseSelection.ts';
import { hasActiveDownloadInScope } from '../src/features/downloads/downloadSearchGuard.ts';

test('SEENIT-DOWNLOAD-013 le sélecteur reste utilisable après un terminé et bloque seulement le scope actif', () => {
  const target = { mediaType: 'tv' as const, tmdbId: 99, seasonNumber: 1, episodeNumber: 2 };
  const completed = { ...target, status: 'completed', progress: 100, importState: 'confirmed' as const };
  assert.equal(hasActiveDownloadInScope([completed], target), false);
  assert.equal(hasActiveDownloadInScope([{ ...completed, importState: 'pending' }], target), true);
  assert.equal(hasActiveDownloadInScope([{ ...completed, status: 'downloading', progress: 40 }], target), true);
  assert.equal(hasActiveDownloadInScope([{ ...completed, status: 'downloading', progress: 40, episodeNumber: 3 }], target), false);
  assert.equal(hasActiveDownloadInScope([{ ...completed, status: 'error', errorMessage: 'Import bloqué' }], target), false);
});

test('SEENIT-DOWNLOAD-013 les groupes sont exclusifs et un import bloqué à 100 reste à traiter', () => {
  const groups = [
    [{ status: 'warning', progress: 100 }, 'attention'],
    [{ status: 'completed', progress: 100, errorMessage: 'Manual import required' }, 'attention'],
    [{ status: 'waiting', progress: 0 }, 'waiting'],
    [{ status: 'downloading', progress: 50 }, 'active'],
    [{ status: 'completed', progress: 100 }, 'completed'],
    [{ status: 'cancelled', progress: 99 }, 'cancelled']
  ] as const;
  for (const [item, expected] of groups) assert.equal(downloadGroup(item), expected);
  assert.equal(isDownloadInHistorySection({ status: 'warning', progress: 100 }, 'completed'), false);
  assert.equal(isDownloadInHistorySection({ status: 'warning', progress: 100 }, 'error'), true);
  assert.equal(downloadGroup({ status: 'completed', progress: 100, importState: 'pending' }), 'active');
  assert.equal(downloadGroup({ status: 'completed', progress: 100, importState: 'confirmed' }), 'completed');
  assert.equal(downloadProblem('Manual import required').title, 'Import manuel requis');
  assert.doesNotMatch(downloadProblem('Manual import required').hint, /Disponible dans Plex/);
});

test('SEENIT-DOWNLOAD-013 une saison réutilise ses épisodes mappés sans doublon ou son pack confirmé', () => {
  const first = { title: 'E1', episodeNumbers: [1] }, second = { title: 'E2', mappedEpisodeNumbers: [2] };
  assert.deepEqual(selectArrSeasonReleases([first, first, second]), [first, second]);
  const pack = { title: 'Saison complète', fullSeason: true };
  assert.deepEqual(selectArrSeasonReleases([first, pack, second]), [pack]);
  assert.throws(() => selectArrSeasonReleases([{ title: 'Sans mapping' }]), /ne précise pas/);
});

test('SEENIT-DOWNLOAD-013 un épisode vu ne prouve jamais sa présence et un transfert terminé reste téléchargeable', () => {
  const item = { status: 'completed', progress: 100 } as LiveDownloadItem;
  assert.equal(episodeDownloadPresentation(5, true, false, item).kind, 'available');
  assert.equal(episodeDownloadPresentation(5, true, true, item).kind, 'present');
  assert.equal(episodeDownloadPresentation(5, true, false, { ...item, status: 'downloading', progress: 20 }).disabled, true);
  assert.equal(episodeDownloadPresentation(5, false, false).kind, 'future');
  assert.equal(episodeDownloadPresentation(5, true, false, { ...item, status: 'warning' }).kind, 'attention');
});

test('SEENIT-DOWNLOAD-013 Light dépend de la release explicite, jamais de son poids ni de HDR', () => {
  assert.equal(matchesLightFilter('Film.HDLight.1080p', 'light'), true);
  assert.equal(matchesLightFilter('Film.BR-Light.1080p', 'light'), true);
  assert.equal(matchesLightFilter('Moonlight.HDR.1080p', 'light'), false);
  assert.equal(matchesLightFilter('Film.BluRay.1080p', 'standard'), true);
  assert.equal(matchesLightFilter('Film.HDLight.1080p', 'standard'), false);
});

test('SEENIT-DOWNLOAD-013 #293 la variante HD Light ou Standard reste visible dans la file et le choix s’explique', () => {
  assert.equal(releaseVariantLabel('Film.2024.MULTi.1080p.HDLight.x264'), 'HD Light');
  assert.equal(releaseVariantLabel('Film.2024.MULTi.1080p.BluRay.x264'), 'Standard');
  assert.equal(releaseVariantLabel('Moonlight.2016.HDR.2160p'), 'Standard', 'mention explicite seulement');
  assert.equal(releaseVariantLabel(undefined), null, 'release inconnue : aucune variante supposée');
  assert.equal(releaseVariantLabel('  '), null);
  const card = readFileSync('src/components/DownloadItemCard.tsx', 'utf8');
  assert.match(card, /const variant = releaseVariantLabel\(item\.releaseTitle\);/);
  assert.match(card, /\['Film', item\.quality, variant\]/);
  const filter = readFileSync('src/components/ReleaseLightFilter.tsx', 'utf8');
  for (const label of ['Toutes les versions', 'HD Light · fichier plus léger', 'Standard · meilleure qualité']) assert.ok(filter.includes(label), label);
});

test('SEENIT-DOWNLOAD-013 C411 transmet Referer dès le premier appel et distingue panne et catalogue vide', async () => {
  const run = async (responses: Response[]) => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const torrents = await fetchC411Torrents({ apiKey: 'fixture', query: 'Titre', searchParams: new URLSearchParams({ name: 'Titre', subcategory: '2' }), signal: () => AbortSignal.timeout(1000), fetcher: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      assert.equal(calls.at(-1)?.headers.get('Referer'), 'https://c411.org/torrents');
      const response = responses.shift();
      if (!response) throw new Error('appel non prévu');
      return response;
    } });
    return { torrents, calls };
  };
  const valid = await run([Response.json({ data: [{ id: 1 }] })]);
  assert.deepEqual(valid.torrents, [{ id: 1 }]);
  assert.equal(valid.calls.length, 1);
  const fallback = await run([new Response('', { status: 500 }), Response.json({ data: [{ id: 2 }] })]);
  assert.deepEqual(fallback.torrents, [{ id: 2 }]);
  assert.deepEqual((await run([Response.json({ data: [] }), Response.json({ data: [] }), Response.json({ data: [] })])).torrents, []);
  await assert.rejects(run([new Response('', { status: 500 }), new Response('', { status: 503 })]), /503/);
  await assert.rejects(run([new Response('', { status: 429 })]), /429/);
  await assert.rejects(run([Response.json({ data: [] }), Response.json({ data: [] }), new Response('', { status: 502 })]), /502/);
  await assert.rejects(run([Response.json({ error: 'bad' })]), /invalide/);
});
