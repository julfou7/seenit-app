import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasFrenchTheatricalCinemaEvidence } from '../src/features/shows/cinemaPolicy.ts';

const relativeIso = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const movieWithFrenchRelease = (type: number, days: number, id?: number) => ({
  id,
  media_type: 'movie',
  release_date: relativeIso(days).slice(0, 10),
  release_dates: { results: [{ iso_3166_1: 'FR', release_dates: [{ type, release_date: relativeIso(days) }] }] },
});

test('SEENIT-DISCOVER-001 exige une sortie théâtrale française pour Au cinéma', () => {
  assert.equal(hasFrenchTheatricalCinemaEvidence(movieWithFrenchRelease(3, -10)), true);
  assert.equal(hasFrenchTheatricalCinemaEvidence(movieWithFrenchRelease(2, -10)), true);
  assert.equal(hasFrenchTheatricalCinemaEvidence(movieWithFrenchRelease(4, -10)), false);
  assert.equal(hasFrenchTheatricalCinemaEvidence({ media_type: 'movie', release_date: relativeIso(-10).slice(0, 10) }), false, 'une date générique récente ne prouve plus une sortie cinéma');
});

test('SEENIT-DISCOVER-001 respecte la fenêtre cinéma et le marqueur issu de la requête théâtrale', () => {
  assert.equal(hasFrenchTheatricalCinemaEvidence(movieWithFrenchRelease(3, -76)), false);
  assert.equal(hasFrenchTheatricalCinemaEvidence(movieWithFrenchRelease(3, 11)), false);
  assert.equal(hasFrenchTheatricalCinemaEvidence({ media_type: 'movie', seenitFrenchTheatrical: true, seenitFrenchTheatricalCheckedAt: Date.now() }), true);
  assert.equal(hasFrenchTheatricalCinemaEvidence({ media_type: 'movie', seenitFrenchTheatrical: true, seenitFrenchTheatricalCheckedAt: Date.now() - (7 * 60 * 60 * 1000) }), false, 'une preuve interne périmée ne doit pas maintenir le badge indéfiniment');
  assert.equal(hasFrenchTheatricalCinemaEvidence({ mediaType: 'movie', tmdbId: 841, seenitFrenchTheatrical: true, seenitFrenchTheatricalCheckedAt: Date.now() }), false, 'un objet de suivi ne peut pas réactiver un marqueur de liste via le fallback historique');
});

test('SEENIT-DISCOVER-001 donne la priorité au payload release_dates sans réchauffer les cartes par navigation', () => {
  const id = 910091;
  assert.equal(hasFrenchTheatricalCinemaEvidence(movieWithFrenchRelease(3, -5, id)), true);
  assert.equal(hasFrenchTheatricalCinemaEvidence({ id, media_type: 'movie' }), false, 'ouvrir une fiche positive ne doit pas rendre une carte partielle positive par effet de bord');
  assert.equal(hasFrenchTheatricalCinemaEvidence({
    ...movieWithFrenchRelease(4, -5, id),
    seenitFrenchTheatrical: true,
    seenitFrenchTheatricalCheckedAt: Date.now(),
  }), false, 'un payload détaillé digital reste autoritatif face à un marqueur inline positif');
});

test('SEENIT-DISCOVER-001 exclut une projection événementielle terminée sans exclure une ressortie générale', () => {
  const now = new Date('2026-09-05T12:00:00+02:00');
  const dune1984 = {
    id: 841,
    media_type: 'movie',
    release_dates: {
      results: [{
        iso_3166_1: 'FR',
        release_dates: [
          { type: 3, release_date: '2026-06-24T19:00:00.000Z', note: 'Projection exceptionnelle à l’Institut Lumière, Lyon' },
          { type: 2, release_date: '2026-07-11T18:00:00.000Z', note: 'Séance spéciale — Institut Lumière' },
          { type: 3, release_date: '2026-07-16T18:00:00.000Z', note: 'Festival / projection événementielle' },
        ],
      }],
    },
  };
  assert.equal(hasFrenchTheatricalCinemaEvidence(dune1984, now), false, 'Dune 1984 ne doit pas rester Au cinéma après des séances événementielles terminées');

  const nationwideRerelease = {
    id: 910092,
    media_type: 'movie',
    release_dates: {
      results: [{
        iso_3166_1: 'FR',
        release_dates: [{ type: 3, release_date: '2026-08-28T00:00:00.000Z', note: 'Ressortie France' }],
      }],
    },
  };
  assert.equal(hasFrenchTheatricalCinemaEvidence(nationwideRerelease, now), true, 'une note de ressortie générale ne doit pas être confondue avec une séance ponctuelle');
});

test('SEENIT-DISCOVER-001 contraint Explorer aux release types TMDB 2 ou 3 en France', () => {
  const source = fs.readFileSync('src/features/shows/tmdbCore.ts', 'utf8');
  const cinemaBlock = source.match(/if \(category === 'Au cinéma' && mediaType === 'movie'\) \{[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.ok(cinemaBlock, 'le bloc de requête Au cinéma doit rester identifiable');
  assert.match(cinemaBlock, /region'\s*,\s*'FR'/);
  assert.match(cinemaBlock, /with_release_type'\s*,\s*'2\|3'/);
  assert.match(cinemaBlock, /release_date\.gte/);
  assert.match(cinemaBlock, /release_date\.lte/);
  assert.doesNotMatch(cinemaBlock, /primary_release_date\.gte/);
  assert.match(source, /getMovieDetails/, 'les détails film doivent alimenter la même preuve utilisée par les badges');
});

test('SEENIT-DISCOVER-001 intègre Au cinéma au chip principal de la fiche film sans doublon', () => {
  const source = fs.readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  const chipStart = source.indexOf('<div className="mb-2 flex items-center gap-2 flex-wrap min-h-[24px]">');
  const logoStart = source.indexOf('<div className="my-2 min-h-[64px] flex items-center">', chipStart);
  const chipSource = source.slice(chipStart, logoStart);

  assert.ok(chipStart >= 0 && logoStart > chipStart, 'le chip principal doit rester identifiable dans le hero');
  assert.equal((source.match(/const isAtCinema =/g) || []).length, 1, 'la décision cinéma est partagée au niveau de la fiche');
  assert.ok(source.indexOf('const isAtCinema =') < chipStart, 'la décision cinéma doit être disponible avant le chip principal');
  assert.match(chipSource, /isAtCinema \? <>🎟 AU CINÉMA • \{formatRuntime\(tmdbDetails\?\.runtime\)\}<\/>/);
  assert.match(chipSource, /: <>🎬 FILM • \{formatRuntime\(tmdbDetails\?\.runtime\)\}<\/>/);
  assert.match(chipSource, /border-\[#E5A93D\]\/30 shrink-0/);
  assert.match(chipSource, /flex-wrap/);
  assert.doesNotMatch(source, /<Ticket[\s\S]{0,160}Au cinéma/);
  assert.doesNotMatch(source, />Au cinéma<\/span>/);
  assert.match(source, /isUpcoming && <span className="text-purple-400/);
});
