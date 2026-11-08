import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseBadges } from '../src/features/downloads/releaseBadges.ts';

// Retour terrain du 08/11 : le type de release en badges lisibles plutôt que le nom technique.
test('SEENIT-C411-003 badges de release : édition, image, langue, son, source, vidéo et plateforme', () => {
  assert.deepEqual(releaseBadges('Spider.Man.Brand.New.Day.2026.MULTI.VFF.1080p.WEB.AC3.5.1.H265-Slay3R'), ['MULTI', 'VFF', 'AC3 5.1', 'WEB', 'H.265']);
  assert.deepEqual(releaseBadges('Dune.Part.Two.2024.IMAX.MULTi.2160p.WEB-DL.DV.HDR10+.DDP5.1.Atmos.H265-FW'), ['IMAX', 'Dolby Vision', 'HDR10+', 'MULTI', 'Atmos 5.1', 'WEB-DL', 'H.265']);
  assert.deepEqual(releaseBadges('The.Arena.S01E03.VOSTFR.1080p.NF.WEB-DL.DDP5.1.x264.mkv'), ['VOSTFR', 'DD+ 5.1', 'WEB-DL', 'H.264', 'Netflix']);
  assert.deepEqual(releaseBadges('Oppenheimer.2023.MULTi.TRUEFRENCH.2160p.UHD.BluRay.REMUX.HDR.DTS-HD.MA.5.1-GROUP'), ['Remux', 'HDR', 'MULTI', 'VFF', 'DTS-HD 5.1', 'Blu-ray']);
  // « FRENCH » seul donne VF ; jamais de doublon VF si VFF/VFQ est déjà là.
  assert.deepEqual(releaseBadges('L.Arene.S01E03.FRENCH.1080p.WEB.H264-NoTag.mkv'), ['VF', 'WEB', 'H.264']);
  assert.deepEqual(releaseBadges('Film.2020.VFQ.FRENCH.1080p.WEBRip.x264'), ['VFQ', 'WEBRip', 'H.264']);
});

test('SEENIT-C411-003 badges de release : ni qualité, ni groupe, ni faux positif sur le titre', () => {
  const badges = releaseBadges('Dark.Matter.S01E01.1080p.WEB.H264-NTb');
  assert.deepEqual(badges, ['WEB', 'H.264']);
  // La qualité (1080p, 4K) est affichée à part ; le groupe de release n'est jamais repris.
  assert.ok(!badges.some(badge => /1080|NTb/i.test(badge)));
  // Un mot du titre qui contient une marque (« Multiverse », « Webster ») n'en déclenche pas.
  assert.deepEqual(releaseBadges('Multiverse.of.Webster.2022.1080p.BluRay.x265'), ['Blu-ray', 'H.265']);
  assert.deepEqual(releaseBadges('Titre.Sans.Marqueur'), []);
  assert.deepEqual(releaseBadges('Titre.2020.1080p.WEB.x264', true).at(-1), 'Light');
});
