import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseBadges, releaseReadableTitle } from '../src/features/downloads/releaseBadges.ts';

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

test('SEENIT-C411-003 titre lisible de la release : reconnaître le bon torrent sans le nom technique', () => {
  assert.deepEqual(releaseReadableTitle('Spider.Man.Brand.New.Day.2026.MULTI.VFF.1080p.WEB.AC3.5.1.H265-Slay3R'), { title: 'Spider Man Brand New Day', year: '2026', episode: undefined });
  // Un nombre du titre n'est pas l'année : la dernière année avant les marqueurs l'est.
  assert.deepEqual(releaseReadableTitle('Blade.Runner.2049.2017.MULTi.2160p.UHD.BluRay.x265-GRP'), { title: 'Blade Runner 2049', year: '2017', episode: undefined });
  assert.deepEqual(releaseReadableTitle('1917.2019.MULTI.1080p.BluRay.x264'), { title: '1917', year: '2019', episode: undefined });
  assert.deepEqual(releaseReadableTitle('L.Arene.S01E03.FRENCH.1080p.WEB.H264-NoTag.mkv'), { title: 'L Arene', year: undefined, episode: 'S01E03' });
  assert.deepEqual(releaseReadableTitle('The.Bear.S03.MULTI.1080p.WEB.H264-GRP'), { title: 'The Bear', year: undefined, episode: 'S03' });
  assert.equal(releaseReadableTitle('Spider-Man.No.Way.Home.2021.MULTi.1080p.WEB').title, 'Spider-Man No Way Home');
  assert.equal(releaseReadableTitle('Titre Sans Marqueur').title, 'Titre Sans Marqueur');
  // Revue Codex : un mot du titre qui ressemble à un marqueur (« French », « Web ») ne coupe jamais le titre.
  assert.deepEqual(releaseReadableTitle('The.French.Dispatch.2021.MULTi.1080p.WEB.H264-GRP'), { title: 'The French Dispatch', year: '2021', episode: undefined });
  assert.deepEqual(releaseReadableTitle('La.French.2014.FRENCH.1080p.BluRay.x264-GRP'), { title: 'La French', year: '2014', episode: undefined });
  assert.deepEqual(releaseReadableTitle('French.Kiss.1995.FRENCH.720p.x264'), { title: 'French Kiss', year: '1995', episode: undefined });
  assert.equal(releaseReadableTitle('Charlottes.Web.FRENCH.1080p.x264').title, 'Charlottes Web');
  // Revue Codex : une plage d'épisodes ou de saisons est gardée entière (un pack n'est pas un épisode).
  assert.equal(releaseReadableTitle('Show.S01E01-E02.FRENCH.1080p.WEB.H264-GRP').episode, 'S01E01-E02');
  assert.equal(releaseReadableTitle('Show.S01E01-E10.FRENCH.1080p.WEB.H264-GRP').episode, 'S01E01-E10');
  assert.equal(releaseReadableTitle('Show.S01-S05.MULTI.1080p.WEB.H264-GRP').episode, 'S01-S05');
  assert.equal(releaseReadableTitle('Show.S01E01E02.MULTI.1080p.WEB.H264-GRP').episode, 'S01E01E02');
  assert.equal(releaseReadableTitle('Show.S01E03-NoTag').episode, 'S01E03');
  assert.equal(releaseReadableTitle('Show.S01E01-E02.FRENCH.1080p.WEB.H264-GRP').title, 'Show');
  // Revue Codex : un épisode sans préfixe de saison garde son numéro (E01 et E02 restent distincts).
  assert.deepEqual(releaseReadableTitle('Show.E01.FRENCH.1080p.WEB.H264-GRP'), { title: 'Show', year: undefined, episode: 'E01' });
  assert.equal(releaseReadableTitle('Show.E02.FRENCH.1080p.WEB.H264-GRP').episode, 'E02');
  assert.equal(releaseReadableTitle('Show.E01-E04.FRENCH.1080p.WEB.H264-GRP').episode, 'E01-E04');
  // Un « E » isolé ou un mot du titre n'est jamais pris pour un épisode.
  assert.equal(releaseReadableTitle('WALL.E.2008.MULTi.1080p.BluRay.x264').episode, undefined);
  assert.equal(releaseReadableTitle('WALL.E.2008.MULTi.1080p.BluRay.x264').title, 'WALL E');
});
