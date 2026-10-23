import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_TABS, HOME_PAGE_SIZE, HISTORY_PAGE_SIZE, upcomingGroup, seriesStatus, canOfferPlexWatchedAction } from '../src/features/watchlist/homePresentation.ts';
import { readFileSync } from 'node:fs';

test('SEENIT-UX-018 refuse une preuve Plex globale de série pour proposer Vu', () => {
  assert.equal(canOfferPlexWatchedAction('tv', true, false), false, 'série partielle : aucun épisode prouvé');
  assert.equal(canOfferPlexWatchedAction('tv', false, false), false);
  assert.equal(canOfferPlexWatchedAction('movie', true, false), true, 'film exact disponible et non vu');
  assert.equal(canOfferPlexWatchedAction('movie', false, false), false);
  assert.equal(canOfferPlexWatchedAction('movie', true, true), false);
});

test('SEENIT-UX-018 classe les sorties par jour local sans dérive au changement d’heure', () => {
  for (const today of ['2026-10-22', '2026-10-25', '2026-03-29']) {
    const date = new Date(`${today}T12:00:00`);
    const day = (offset: number) => { const value = new Date(date); value.setDate(value.getDate() + offset); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; };
    assert.equal(upcomingGroup(today, today), 'Aujourd’hui');
    assert.equal(upcomingGroup(day(1), today), 'Cette semaine');
    assert.equal(upcomingGroup(day(6), today), 'Cette semaine');
    assert.equal(upcomingGroup(day(7), today), 'Cette semaine');
    assert.equal(upcomingGroup(day(8), today), 'Plus tard');
    assert.equal(upcomingGroup(day(30), today), 'Plus tard');
  }
});
test('SEENIT-UX-018 conserve trois onglets sans compteurs et les limites des deux paginations', () => {
  assert.deepEqual(HOME_TABS.map(tab => tab.label), ['À regarder', 'À venir', 'Historique']);
  assert.equal(HOME_PAGE_SIZE, 6);
  assert.equal(HISTORY_PAGE_SIZE, 10);
  const screen = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(screen, /getBoundingClientRect\(\)|activeTabRef|tab-scroll/);
  const view = readFileSync(new URL('../src/screens/WatchListView.tsx', import.meta.url), 'utf8');
  assert.match(view, /hidden=\{activeTab !== 'upcoming'\}/);
  assert.match(view, /role="tablist"/);
});
test('SEENIT-UX-018 présente les statuts sans emoji ni compteur restant redondant', () => {
  assert.deepEqual(seriesStatus('🔥 Sorti aujourd’hui'), { label: 'Aujourd’hui', tone: 'today' });
  assert.deepEqual(seriesStatus('🆕 Il y a 3 jours'), { label: 'Nouveau', tone: 'new' });
  assert.equal(seriesStatus('Pas vu depuis 72 jours')?.tone, 'stale');
  assert.equal(seriesStatus('Final de saison')?.tone, 'final');
  assert.equal(seriesStatus('Plus que 2')?.tone, 'remaining');
  assert.equal(seriesStatus('Dispo')?.tone, 'available');
  assert.equal(seriesStatus('2 restants'), null);
  assert.equal(seriesStatus(), null);
});
