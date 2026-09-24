import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canStartEpisodeSwipeFromTarget,
  resolveEpisodeNavigationDirectionFromKey,
  resolveLoadedAdjacentEpisode,
} from '../src/features/navigation/episodeNavigation.ts';

const coreSource = readFileSync(
  new URL('../src/screens/EpisodeDetailModalCore.tsx', import.meta.url),
  'utf8',
);

test('SEENIT-UX-008 ←/→ naviguent hors saisie sans répétition implicite', () => {
  assert.equal(resolveEpisodeNavigationDirectionFromKey({ key: 'ArrowLeft' }), 'previous');
  assert.equal(resolveEpisodeNavigationDirectionFromKey({ key: 'ArrowRight' }), 'next');
  assert.equal(resolveEpisodeNavigationDirectionFromKey({ key: 'ArrowRight', repeat: true }), null);
  assert.equal(resolveEpisodeNavigationDirectionFromKey({ key: 'ArrowLeft', ctrlKey: true }), null);
  assert.equal(
    resolveEpisodeNavigationDirectionFromKey({ key: 'ArrowRight', target: { tagName: 'INPUT' } }),
    null,
  );
  assert.equal(
    resolveEpisodeNavigationDirectionFromKey({ key: 'ArrowLeft', target: { isContentEditable: true } }),
    null,
  );
});

test('SEENIT-UX-008 le swipe ne démarre jamais depuis une action interactive', () => {
  assert.equal(canStartEpisodeSwipeFromTarget({ tagName: 'BUTTON' }), false);
  assert.equal(canStartEpisodeSwipeFromTarget({ tagName: 'A' }), false);
  assert.equal(
    canStartEpisodeSwipeFromTarget({ tagName: 'SPAN', closest: () => ({ tagName: 'BUTTON' }) }),
    false,
  );
  assert.equal(canStartEpisodeSwipeFromTarget({ tagName: 'DIV', closest: () => null }), true);
});

test('SEENIT-UX-008 résout épisode voisin et frontières de saison sans saut inventé', () => {
  const current = [{ episode_number: 1 }, { episode_number: 2 }];
  const nextSeason = [{ episode_number: 1 }, { episode_number: 2 }];
  const previousSeason = [{ episode_number: 1 }, { episode_number: 3 }];

  assert.deepEqual(resolveLoadedAdjacentEpisode({
    direction: 'next',
    currentSeason: 2,
    currentEpisodeNumber: 1,
    minSeason: 1,
    currentSeasonEpisodes: current,
  }), { season: 2, episode: current[1] });

  assert.deepEqual(resolveLoadedAdjacentEpisode({
    direction: 'next',
    currentSeason: 2,
    currentEpisodeNumber: 2,
    minSeason: 1,
    currentSeasonEpisodes: current,
    adjacentSeasonEpisodes: nextSeason,
  }), { season: 3, episode: nextSeason[0] });

  assert.deepEqual(resolveLoadedAdjacentEpisode({
    direction: 'previous',
    currentSeason: 2,
    currentEpisodeNumber: 1,
    minSeason: 1,
    currentSeasonEpisodes: current,
    adjacentSeasonEpisodes: previousSeason,
  }), { season: 1, episode: previousSeason[1] });

  assert.equal(resolveLoadedAdjacentEpisode({
    direction: 'next',
    currentSeason: 2,
    currentEpisodeNumber: 2,
    minSeason: 1,
    currentSeasonEpisodes: current,
    adjacentSeasonEpisodes: [],
  }), null);
});

test('SEENIT-UX-008 respecte la saison spéciale 0 comme frontière explicite', () => {
  const specials = [{ episode_number: 1 }, { episode_number: 4 }];
  const target = resolveLoadedAdjacentEpisode({
    direction: 'previous',
    currentSeason: 1,
    currentEpisodeNumber: 1,
    minSeason: 0,
    currentSeasonEpisodes: [{ episode_number: 1 }],
    adjacentSeasonEpisodes: specials,
  });

  assert.deepEqual(target, { season: 0, episode: specials[1] });
  assert.equal(resolveLoadedAdjacentEpisode({
    direction: 'previous',
    currentSeason: 0,
    currentEpisodeNumber: 1,
    minSeason: 0,
    currentSeasonEpisodes: specials,
  }), null);
});

test('SEENIT-UX-008 expose boutons, clavier, garde stale et navigation sans mutation métier', () => {
  assert.match(coreSource, /aria-label="Épisode précédent"/);
  assert.match(coreSource, /aria-label="Épisode suivant"/);
  assert.match(coreSource, /min-h-\[44px\]/);
  assert.match(coreSource, /resolveEpisodeNavigationDirectionFromKey\(/);
  assert.match(coreSource, /window\.addEventListener\('keydown'/);
  assert.match(coreSource, /dragListener=\{false\}/);
  assert.match(coreSource, /canStartEpisodeSwipeFromTarget\(event\.target\)/);
  assert.match(coreSource, /navigationRequestRef\.current !== requestId/);
  assert.match(coreSource, /Impossible de charger l’épisode suivant\. Réessaie\./);

  const navigationStart = coreSource.indexOf('const finishNavigationRequest');
  const navigationEnd = coreSource.indexOf('const toggleSeen');
  const navigationBlock = coreSource.slice(navigationStart, navigationEnd);
  assert.doesNotMatch(
    navigationBlock,
    /updateShow|toggleSeen|openPlexWatchUrl|setIsDownloadOpen/,
    'naviguer entre épisodes ne doit jamais muter progression, Plex ou téléchargements',
  );
});
