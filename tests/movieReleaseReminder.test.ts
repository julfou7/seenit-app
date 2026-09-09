import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveFrenchMovieReleaseReminderDate,
  toLocalReminderDate,
} from '../src/features/notifications/movieReleaseReminder';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');

test('issue #106 utilise la vraie sortie digitale FR de The Punisher: One Last Kill', () => {
  const fixture = {
    id: 1536795,
    release_date: '2026-05-13',
    release_dates: {
      results: [
        {
          iso_3166_1: 'FR',
          release_dates: [
            { type: 4, release_date: '2026-05-13T00:00:00.000Z' },
          ],
        },
        {
          iso_3166_1: 'US',
          release_dates: [
            { type: 3, release_date: '2026-05-01T00:00:00.000Z' },
          ],
        },
      ],
    },
  };

  assert.equal(resolveFrenchMovieReleaseReminderDate(fixture, 'home'), '2026-05-13');
  assert.equal(resolveFrenchMovieReleaseReminderDate(fixture, 'theater'), null);
});

test('issue #106 refuse une date générique et ne recrée jamais une disponibilité J+120', () => {
  const withoutFrenchEvidence = {
    release_date: '2026-05-13',
    release_dates: {
      results: [{
        iso_3166_1: 'US',
        release_dates: [{ type: 4, release_date: '2026-05-13T00:00:00.000Z' }],
      }],
    },
  };

  assert.equal(resolveFrenchMovieReleaseReminderDate(withoutFrenchEvidence, 'home'), null);
  assert.equal(resolveFrenchMovieReleaseReminderDate(withoutFrenchEvidence, 'theater'), null);
  assert.doesNotMatch(reminderSource, /120\s*\*\s*24|120\s*jours|\+\s*120/i);
  assert.match(reminderSource, /tmdb\.getMovieDetails\(tmdbId\)/);
  assert.match(reminderSource, /resolveFrenchMovieReleaseReminderDate\(detailsResult\.value, 'home'\)/);
});

test('issue #106 distingue les sorties FR cinéma, digitales et physiques', () => {
  const fixture = {
    release_dates: {
      results: [{
        iso_3166_1: 'FR',
        release_dates: [
          { type: 2, release_date: '2026-03-01T00:00:00.000Z' },
          { type: 3, release_date: '2026-03-15T00:00:00.000Z' },
          { type: 5, release_date: '2026-07-10T00:00:00.000Z' },
          { type: 4, release_date: '2026-06-20T00:00:00.000Z' },
          { type: 6, release_date: '2026-02-01T00:00:00.000Z' },
        ],
      }],
    },
  };

  assert.equal(resolveFrenchMovieReleaseReminderDate(fixture, 'theater'), '2026-03-15');
  assert.equal(resolveFrenchMovieReleaseReminderDate(fixture, 'home'), '2026-06-20');
});

test('issue #106 programme la date canonique à 09:00 locale', () => {
  const reminder = toLocalReminderDate('2026-05-13');
  assert.ok(reminder);
  assert.equal(reminder.getFullYear(), 2026);
  assert.equal(reminder.getMonth(), 4);
  assert.equal(reminder.getDate(), 13);
  assert.equal(reminder.getHours(), 9);
  assert.equal(reminder.getMinutes(), 0);
  assert.equal(toLocalReminderDate('2026-02-31'), null);
});
