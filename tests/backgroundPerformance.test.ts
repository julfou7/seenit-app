import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profileSource = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');
const analyticsSource = readFileSync(new URL('../src/hooks/useProAnalytics.ts', import.meta.url), 'utf8');
const logStoreSource = readFileSync(new URL('../src/store/logStore.ts', import.meta.url), 'utf8');

test('SEENIT-PERF-001 coupe le travail lourd des écrans Profil cachés', () => {
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

test('SEENIT-PERF-001 interrompt les analytics Profil entre les lots après navigation', () => {
  assert.match(analyticsSource, /const batchSize = 6/);
  assert.match(analyticsSource, /for \(let b = 0; b < watchedItems\.length; b \+= batchSize\) \{\s*if \(!isMounted\) return;/);
  assert.match(analyticsSource, /const results = await Promise\.all\(promises\);\s*if \(!isMounted\) return;/);
  assert.match(analyticsSource, /if \(!isMounted\) return;\s*\n\s*const totalGenreWeight/);
});

test('SEENIT-PERF-001 regroupe les rafales de logs hors du chemin synchrone par ligne', () => {
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