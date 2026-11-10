import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatNoticeTime, isValidNoticeTime, reconcileFirstSeen } from '../src/features/notifications/notificationNoticeTime.ts';

test('SEENIT-NOTIFICATION-010 les notifications gardent leur heure réelle et les cartes calculées leur première apparition', () => {
  const first = Date.parse('2026-11-10T18:13:00Z');
  const current = { 'plex:film:movie': first };
  const reopened = reconcileFirstSeen(current, ['plex:film:movie'], first + 3_600_000);
  assert.equal(reopened.changed, false);
  assert.equal(reopened.times['plex:film:movie'], first, 'le refresh ne décale pas une notification Plex');
  const added = reconcileFirstSeen(reopened.times, ['plex:film:movie', 'reminder:serie:2026-11-10'], first + 4_000);
  assert.equal(added.times['plex:film:movie'], first);
  assert.equal(added.times['reminder:serie:2026-11-10'], first + 4_000);
  assert.equal(formatNoticeTime(first, 'received', 'Europe/Paris'), 'Reçue le 10 nov. · 19:13');
  assert.equal(formatNoticeTime(first, 'first-seen', 'Europe/Paris'), 'Repérée le 10 nov. · 19:13');
  assert.equal(isValidNoticeTime('2026-11-10'), false);
  assert.equal(formatNoticeTime(Number.NaN, 'first-seen'), null);
});

test('SEENIT-NOTIFICATION-010 purge les timestamps invalides, borne les anciennes cartes et ne partage aucun UID', () => {
  const now = Date.parse('2026-11-10T18:13:00Z');
  const dates = { old: now - 120_000, a: now - 60_000, b: now + 900_000, c: Number.NaN };
  const result = reconcileFirstSeen(dates, ['b', 'new'], now, 2);
  assert.deepEqual(result.times, { b: now, new: now }, 'un timestamp invalide ne devient jamais une heure réelle');
  assert.equal(result.changed, true);
  const source = readFileSync('src/components/HomeNotifications.tsx', 'utf8');
  assert.match(source, /readUserScopedJson<Record<string, number>>\(uid, NOTICE_FIRST_SEEN_FIELD, \{\}\)/);
  assert.match(source, /auth\.currentUser\?\.uid !== uid/);
  assert.match(source, /receivedAt: item\.receivedAt/);
  const page = readFileSync('src/components/HomeNotificationsPage.tsx', 'utf8');
  assert.match(page, /<NoticeTimeLabel notice=\{notice\} \/>/);
  assert.match(page, /dateTime=\{new Date\(time\)\.toISOString\(\)\}/);
  const inbox = readFileSync('src/features/notifications/notificationInbox.ts', 'utf8');
  assert.match(inbox, /const original = previous\.find\(entry => entry\.id === id\)/);
  assert.match(inbox, /isValidNoticeTime\(original\?\.receivedAt\)/);
});
