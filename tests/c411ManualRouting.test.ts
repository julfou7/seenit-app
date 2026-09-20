import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getC411ManualMediaTypeLabel,
  planC411ManualDownload,
  resolveC411ManualMediaType
} from '../src/features/downloads/c411ManualRouting.ts';

const VALID_MAGNET = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=release`;

test('SEENIT-C411-003 dérive Film et Série uniquement des sous-catégories C411 exactes', () => {
  assert.equal(resolveC411ManualMediaType({ subcategory: { id: 6 } }), 'movie');
  assert.equal(resolveC411ManualMediaType({ subcategory: { id: '7' } }), 'tv');
  assert.equal(getC411ManualMediaTypeLabel('movie'), 'Film C411');
  assert.equal(getC411ManualMediaTypeLabel('tv'), 'Série C411');

  assert.equal(resolveC411ManualMediaType({
    name: 'MobLand.2025.S02E01.2160p',
    subcategory: { id: 999 }
  }), null, 'le nom et ses marqueurs TV ne doivent jamais classifier la release');
});

test('SEENIT-C411-003 route le mode Tous vers qBittorrent sans choix redondant', () => {
  assert.deepEqual(planC411ManualDownload({
    name: 'MobLand.2025.S02E01.2160p',
    magnetUri: VALID_MAGNET,
    subcategory: { id: 7 }
  }, {
    qbittorrentConfigured: true,
    sonarrConfigured: true
  }), {
    kind: 'qbittorrent',
    mediaType: 'tv'
  });
});

test('SEENIT-C411-003 ne contacte jamais Arr sans identité SeenIt canonique', () => {
  assert.deepEqual(planC411ManualDownload({
    name: 'Film.Homonyme.2026.1080p',
    magnetUri: VALID_MAGNET,
    subcategory: { id: 6 }
  }, {
    qbittorrentConfigured: false,
    sonarrConfigured: true,
    radarrConfigured: true
  }), {
    kind: 'magnet',
    mediaType: 'movie'
  });

  assert.deepEqual(planC411ManualDownload({
    name: 'MobLand.2025.S02E01.2160p',
    magnetUri: VALID_MAGNET
  }, {
    qbittorrentConfigured: true,
    sonarrConfigured: true
  }), {
    kind: 'magnet',
    mediaType: null
  }, 'sans sous-catégorie explicite, même qBittorrent ne reçoit pas une catégorie inventée');
});

test('la recherche manuelle bloque une release sans BTIH valide avant toute mutation', () => {
  const plan = planC411ManualDownload({
    name: 'Release sans identité physique',
    magnetUri: 'https://example.test/torrent',
    subcategory: { id: 7 }
  }, {
    qbittorrentConfigured: true
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.mediaType, 'tv');
});

test('le flux de production global n’envoie jamais le titre brut à Sonarr ou Radarr', () => {
  const source = readFileSync(new URL('../src/screens/DownloadsScreenCore.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const handleSendTorrent = async');
  const end = source.indexOf('const copyMagnet = async', start);
  const handler = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'le handler de production doit rester identifiable');
  assert.match(handler, /planC411ManualDownload/);
  assert.match(handler, /if \(sendInFlightRef\.current\) return/);
  assert.match(handler, /sendInFlightRef\.current = true/);
  assert.match(handler, /service:\s*'qbittorrent'/);
  assert.doesNotMatch(handler, /service:\s*'sonarr'|service:\s*'radarr'/);
  assert.doesNotMatch(handler, /mediaInfo:\s*\{\s*title:\s*torrent\.name/);
});
