import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesBadge, pauseDuration, seriesPause } from '../src/features/watchlist/seriesBadges.ts';
import { buildSeriesSeasonProgress } from '../src/features/watchlist/seriesCardPresentation.ts';
import type { Show } from '../src/types.ts';
const now = new Date(2026, 9, 24, 12).getTime();
const show = { id:'series',tmdbId:42,mediaType:'tv',seenEpisodes:[],episodeRecords:{},createdAt:now - 92 * 86_400_000 } as unknown as Show;
const episode = { season_number:1,episode_number:1,episode_count:6,air_date:'2026-10-24' };
const progress = buildSeriesSeasonProgress(show,episode,'watch','2026-10-24');
test('SEENIT-UX-014 B07 ruban unique utile, priorité et aucune disponibilité', () => {
 assert.deepEqual(seriesBadge(show,episode,progress,false,'2026-10-24',now),{label:'Ce soir',tone:'today'});
 assert.equal(seriesBadge(show,{...episode,air_date:'2026-10-23'},progress,false,'2026-10-24',now)?.label,'Sorti hier');
 assert.equal(seriesBadge(show,{...episode,air_date:'2026-10-22'},progress,false,'2026-10-24',now)?.label,'Nouveau');
 assert.equal(seriesBadge(show,{...episode,air_date:'2026-10-01'},progress,false,'2026-10-24',now),null);
 assert.equal(seriesBadge({...show,seenEpisodes:['1x1']},episode,progress,false,'2026-10-24',now),null);
 assert.equal(seriesBadge(show,{...episode,episode_number:6},progress,false,'2026-10-24',now)?.tone,'today');
 assert.equal(seriesBadge(show,{...episode,episode_number:6,air_date:'2026-10-20'},progress,false,'2026-10-24',now)?.tone,'season');
 assert.equal(seriesBadge(show,{...episode,air_date:'2026-10-20'},{...progress,availableUnseen:3},false,'2026-10-24',now)?.label,'Plus que 3');
 assert.equal(seriesBadge({...show,seriesEnded:true},{...episode,episode_number:6,air_date:'2026-10-20',last_season_number:3},progress,false,'2026-10-24',now)?.tone,'season','la fin de S1 ne devient pas un final de série à trois saisons');
 assert.equal(seriesBadge(show,episode,progress,true,'2026-10-24',now)?.tone,'never','la section ancienne ne met jamais une sortie en avant');
});
test('SEENIT-UX-014 pause et jamais commencée : durée correcte sans badge de disponibilité', () => {
 assert.deepEqual([45,74,92,400,560].map(pauseDuration),['6 SEM.','2 MOIS','3 MOIS','1 AN','1 AN ½']);
 assert.equal(seriesPause(show,now).started,false);
 const started={...show,seenEpisodes:['1x1'],episodeRecords:{'1x1':{watchedAt:now-74*86_400_000}}};
 assert.equal(seriesBadge(started,episode,progress,true,'2026-10-24',now)?.tone,'pause');
 assert.equal(seriesPause(started,now).description,'En pause depuis 2 mois');
 assert.equal(seriesBadge({...show,createdAt:now-10*86_400_000},episode,progress,true,'2026-10-24',now),null);
});
