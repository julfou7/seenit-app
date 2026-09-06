import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');

function extractShowsLoop(): string {
  const marker = 'for (const s of shows) {';
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'la boucle de traitement des médias doit exister');

  const openingBrace = source.indexOf('{', markerIndex);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }

  throw new Error('boucle des rappels non refermée');
}

const loop = extractShowsLoop();

function firstNotificationScheduleIndex(): number {
  const candidates = [
    'sendMediaReminderNotification(',
    'sendNativeNotification('
  ]
    .map(marker => loop.indexOf(marker))
    .filter(index => index >= 0);

  assert.ok(candidates.length > 0, 'un appel de planification de notification doit exister dans la boucle');
  return Math.min(...candidates);
}

test('issue #94 ignore chaque média inéligible sans interrompre les suivants', () => {
  assert.doesNotMatch(loop, /\breturn\s*;/, 'aucun média ne doit pouvoir quitter processReminders depuis la boucle');

  assert.match(loop, /if \(s\.isArchived \|\| s\.status === 'dropped'\) continue;/);
  assert.match(loop, /if \(s\.mediaType === 'movie' && !s\.firstAirDate\) continue;/);
  assert.match(loop, /if \(!upcoming \|\| !upcoming\.air_date\) continue;/);

  const invalidDateGuards = loop.match(/if \(!year \|\| !month \|\| !day\) continue;/g) || [];
  assert.equal(invalidDateGuards.length, 2, 'film et série doivent ignorer indépendamment une date invalide');
});

test('issue #94 ne programme rien avant les garde-fous d’éligibilité', () => {
  const firstNotificationSchedule = firstNotificationScheduleIndex();
  assert.ok(firstNotificationSchedule > loop.indexOf("if (s.isArchived || s.status === 'dropped') continue;"));
  assert.ok(firstNotificationSchedule > loop.indexOf("if (s.mediaType === 'movie' && !s.firstAirDate) continue;"));

  const tvSchedule = loop.indexOf('const scheduleTvAlert');
  assert.ok(tvSchedule > loop.indexOf('if (!upcoming || !upcoming.air_date) continue;'));
});

test('issue #94 conserve les rappels à 09:00 et leurs clés anti-doublon', () => {
  const nineAmDates = loop.match(/new Date\(year, month - 1, day, 9, 0, 0, 0\)/g) || [];
  assert.equal(nineAmDates.length, 2, 'films et séries doivent rester programmés à 09:00 locale');

  assert.match(loop, /scheduled_9am_\$\{s\.id\}_\$\{tag\}_\$\{targetStr\}/);
  assert.match(loop, /scheduled_9am_\$\{s\.id\}_\$\{tagPrefix\}_S\$\{sNum\}E\$\{eNum\}_\$\{targetStr\}/);
  assert.match(loop, /notified_today_\$\{s\.id\}_\$\{tag\}_\$\{todayStr\}/);
  assert.match(loop, /notified_today_\$\{s\.id\}_\$\{tagPrefix\}_S\$\{sNum\}E\$\{eNum\}_\$\{targetStr\}/);
});
