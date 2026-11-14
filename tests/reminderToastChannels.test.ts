import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keepToastsForOpenChannels, type ReminderToastCandidate } from '../src/features/notifications/reminderToastSummary.ts';

test('Revue Codex #1012 une catégorie Android coupée fait aussi taire la bannière interne', () => {
  const candidates: ReminderToastCandidate[] = [
    { key: 'movie', title: 'Film', body: 'Au cinéma', channelId: 'seenit_movies' },
    { key: 'episode', title: 'Série', body: 'Nouvel épisode', channelId: 'seenit_episodes' },
    { key: 'bell', title: 'Série', body: 'Rappel', channelId: 'seenit_reminders' },
    { key: 'legacy', title: 'Ancien', body: 'Sans canal' },
  ];
  assert.deepEqual(keepToastsForOpenChannels(candidates, new Set(['seenit_movies'])).map(c => c.key), ['episode', 'bell', 'legacy']);
  assert.deepEqual(keepToastsForOpenChannels(candidates, new Set()).map(c => c.key), ['movie', 'episode', 'bell', 'legacy'], 'PWA / aucun canal bloqué');

  const notifier = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
  assert.match(notifier, /buildReminderToastSummary\(keepToastsForOpenChannels\(dueToastCandidates, await readBlockedSeenItChannels\(\)\)\)/);
  assert.match(notifier, /channelId: 'seenit_movies',/);
  assert.match(notifier, /channelId: isSpecificReminder \? 'seenit_reminders' : 'seenit_episodes',\n\s*\}\);/);
  const channels = readFileSync('src/features/notifications/notificationChannels.ts', 'utf8');
  assert.match(channels, /channel\.importance === 0/, 'importance NONE = canal bloqué par l’utilisateur');
  assert.match(channels, /if \(Capacitor\.getPlatform\(\) !== 'android'\) return new Set\(\);/);
});
