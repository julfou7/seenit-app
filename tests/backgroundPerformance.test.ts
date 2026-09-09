import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');
const analyticsSource = readFileSync(new URL('../src/hooks/useProAnalytics.ts', import.meta.url), 'utf8');
const logStoreSource = readFileSync(new URL('../src/store/logStore.ts', import.meta.url), 'utf8');

test('#229 suspend les Effects des onglets montés mais cachés sans perdre leur état', () => {
  assert.match(appSource, /import \{ Activity,/);
  assert.match(appSource, /<Activity mode=\{currentTab === 'watchlist' \? 'visible' : 'hidden'\}>/);
  assert.match(appSource, /<Activity mode=\{currentTab === 'discover' \? 'visible' : 'hidden'\}>/);
  assert.match(appSource, /<Activity mode=\{currentTab === 'downloads' \? 'visible' : 'hidden'\}>/);
  assert.match(
    appSource,
    /<Activity mode=\{\(currentTab === 'profile' \|\| currentTab === 'settings'\) \? 'visible' : 'hidden'\}>/,
  );
  assert.doesNotMatch(
    appSource,
    /currentTab !== 'watchlist' && "hidden"/,
    'display:none seul laisserait les abonnements/effects du contenu caché actifs',
  );
});

test('#229 coupe aussi le travail lourd interne du Profil lorsqu’il est recouvert', () => {
  assert.match(profileSource, /new IntersectionObserver/);
  assert.match(profileSource, /const renderHeavyContent = isProfileVisible && !showSettings/);
  assert.match(profileSource, /renderHeavyContent && \(activeTab === 'stats'/);
  assert.match(profileSource, /showSettings && isProfileVisible/);
  assert.match(
    profileSource,
    /<LibraryScreen[\s\S]*isEmbedded=\{true\}/,
    'Ma Liste reste fonctionnellement inchangée lorsqu’elle est réellement visible',
  );
});

test('#229 rend les analytics progressifs, stables et reprenables après navigation', () => {
  assert.match(analyticsSource, /const analyticsContributionCache = new Map/);
  assert.match(analyticsSource, /const analyticsResultCache = new Map/);
  assert.match(analyticsSource, /auth\.currentUser\?\.uid \|\| 'anonymous'/);
  assert.match(analyticsSource, /const analyticsSignature = buildAnalyticsSignature\(shows \|\| \[\]\)/);
  assert.match(analyticsSource, /const batchSize = 12/);
  assert.match(analyticsSource, /const cached = readContributionCache\(cacheKey\)/);
  assert.match(analyticsSource, /writeContributionCache\(cacheKey, contribution\)/);
  assert.match(
    analyticsSource,
    /batchIndex === 0 \|\| \(batchIndex \+ 1\) % 4 === 0 \|\| isLastBatch/,
    'le premier lot doit publier de vraies données sans attendre la fin de toute la bibliothèque',
  );
  assert.match(analyticsSource, /await new Promise<void>\(resolve => setTimeout\(resolve, 0\)\)/);
  assert.match(analyticsSource, /writeResultCache\(analyticsCacheKey, finalData\)/);
  assert.match(analyticsSource, /\}, \[analyticsCacheKey\]\);/);
});

test('#229 regroupe les rafales de logs hors du chemin synchrone par ligne', () => {
  assert.match(logStoreSource, /const LOG_FLUSH_DELAY_MS = 250/);
  assert.match(logStoreSource, /let pendingLogEntries: AppLogEntry\[\] = \[\]/);
  assert.match(logStoreSource, /pendingLogEntries\.unshift\(newEntry\)/);
  assert.match(logStoreSource, /scheduleLogFlush\(\)/);
  assert.match(logStoreSource, /const updated = \[\.\.\.entries, \.\.\.state\.logs\]\.slice\(0, MAX_LOGS\)/);
  assert.doesNotMatch(
    logStoreSource,
    /set\(\(state\) => \{\s*const updated = \[newEntry, \.\.\.state\.logs\]/,
    'une ligne Plex ne doit plus sérialiser et publier tout le journal immédiatement',
  );
});