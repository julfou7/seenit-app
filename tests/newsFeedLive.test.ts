import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('#437 phase A : le fil Actualités et la cloche suivent users/{uid}/news en direct, bornés', () => {
  const feed = readFileSync('src/components/ShowNewsFeed.tsx', 'utf8');
  assert.match(feed, /return onSnapshot\(q, snapshot => \{/, 'le fil se désabonne au changement de compte');
  assert.match(feed, /query\(newsRef, orderBy\('createdAt', 'desc'\), limit\(NEWS_FEED_LIMIT\)\)/);
  assert.match(feed, /export const NEWS_FEED_LIMIT = 50;/);
  assert.doesNotMatch(feed, /getDocs\(/, 'plus de lecture ponctuelle');

  const bell = readFileSync('src/components/HomeNotifications.tsx', 'utf8');
  assert.match(bell, /const unsubscribeFeed = uid \? onSnapshot\(query\(collection\(db, 'users', uid, 'news'\), orderBy\('createdAt', 'desc'\), limit\(50\)\)/);
  assert.match(bell, /unsubscribeDismissed\(\); unsubscribeFeed\(\); \};/, 'écoute arrêtée au démontage ou au changement d’UID');
  assert.match(bell, /setNews\(items\); writeUserScopedJson\(uid, 'home_news', items\); setLoading\(false\);/, 'copie locale conservée hors ligne');
});
