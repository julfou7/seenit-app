import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHistoryEntries, groupHistoryRows, historyGroupCode, historyPeriod, historyPeriodSummary, type TimelineEntry } from '../src/features/history/historyTimeline.ts';
import { buildMovieCollectionProgress } from '../src/features/watchlist/movieCollectionProgress.ts';
import { actorAge, actorCreditKey, actorRole, partitionActorCredits } from '../src/features/people/actorProfile.ts';

const now = new Date(2026, 9, 24, 22).getTime();
const episode = (key: string, number: number, offset = 0): TimelineEntry => ({key, showId:'series', mediaType:'tv', season:1, episode:number, watchedAt:now-offset});
test('SEENIT-UX-015 regroupe seulement les épisodes consécutifs adjacents et datés', () => {
  const items = [episode('3',3),episode('2',2,60_000),{...episode('film',0,120_000),mediaType:'movie' as const},episode('1',1,180_000),episode('old',0,86_400_000)];
  const rows = groupHistoryRows(items, () => 3);
  assert.deepEqual(rows.map(row => row.members.map(item => item.key)), [['3','2'],['film'],['1'],['old']]);
  assert.equal(historyGroupCode(rows[0]), 'S01·E02 → E03');
  assert.equal(historyGroupCode(rows[1]), undefined);
  assert.equal(groupHistoryRows([episode('3',3),episode('1',1)],()=>3).length,2,'un trou sépare les sessions');
  assert.equal(groupHistoryRows([{...episode('2',2),watchedTimeKnown:false},episode('1',1)],()=>3).length,2,'une heure inconnue ne prouve pas une session');
  const cross = [{...episode('next',1),season:2},episode('last',3,60_000)];
  assert.equal(historyGroupCode(groupHistoryRows(cross,()=>3)[0]),'S01·E03 → S02·E01');
  assert.equal(groupHistoryRows(cross,()=>null).length,2,'la fin de saison doit être confirmée');
});
test('SEENIT-UX-015 périodes calendaires et durées sans minutes inventées', () => {
  assert.deepEqual([0,1,2,6,7,13,14,40].map(days=>historyPeriod(now-days*86_400_000,now).label),['Aujourd’hui','Hier','Cette semaine','Cette semaine','La semaine dernière','La semaine dernière','Plus tôt en octobre','Septembre']);
  const rows = groupHistoryRows([episode('2',2),episode('1',1,60_000)],()=>2);
  assert.deepEqual(historyPeriodSummary(rows,()=>42),{episodes:2,films:0,duration:'1 h 24'});
  assert.equal(historyPeriodSummary(rows,item=>item.key==='2'?42:null).duration,'≥ 0 h 42');
  assert.equal(historyPeriodSummary(rows,()=>null).duration,null);
});
test('SEENIT-UX-014 film 3 : trois membres exacts de collection, aucun compte déduit du titre', () => {
  const parts = [{id:1,release_date:'2018-01-01'},{id:2,release_date:'2021-01-01'},{id:3,release_date:'2027-07-28'}];
  const progress = buildMovieCollectionProgress(parts,3,[{tmdbId:1,mediaType:'movie',seenEpisodes:['movie']}],'2026-10-24');
  assert.equal(progress?.segments.length,3);
  assert.deepEqual(progress?.segments.map(segment=>segment.state),['seen','unseen','current']);
  assert.equal(buildMovieCollectionProgress(parts,9,[],'2026-10-24'),undefined,'pas de collection étrangère');
  assert.equal(buildMovieCollectionProgress([],3,[],'2026-10-24'),undefined,'pas de faux total 3 sans fournisseur');
});
test('SEENIT-UX-018 fiche acteur : sections disjointes, liste prioritaire et rôles en français', () => {
  const credits = Array.from({length:15},(_,index)=>({id:index+1,media_type:'movie' as const,title:`Titre${index+1}`,release_date:index===0?'2027-01-01':'2020-01-01'}));
  const sections = partitionActorCredits(credits,new Set(['movie:2']),[{mediaType:'movie',tmdbId:15}],'2026-10-24');
  assert.equal(sections.future[0].id,1);assert.equal(sections.seen[0].id,2);assert.equal(sections.todo.length,4);assert.equal(sections.todo[0].id,15);
  const all=[...sections.future,...sections.todo,...sections.seen,...sections.rest].map(actorCreditKey);
  assert.equal(all.length,15);assert.equal(new Set(all).size,15,'aucun titre dupliqué entre sections');
  assert.equal(actorRole('Buzz (voice)'),'Buzz · voix');
  assert.equal(actorAge({birthday:'1971-02-25'},new Date(2026,1,24)),54);
});

test('SEENIT-UX-015 saison entière : les égalités du vrai tri précèdent le regroupement et la pagination', () => {
  const entries=Array.from({length:12},(_,index)=>({...episode(`series:1x${index+1}`,index+1),watchedTimeKnown:true}));
  const sorted=entries.sort(compareHistoryEntries);
  assert.deepEqual(sorted.map(item=>item.episode),[12,11,10,9,8,7,6,5,4,3,2,1]);
  const rows=groupHistoryRows(sorted,()=>12);
  assert.equal(rows.length,1);assert.equal(rows[0].members.length,12);assert.equal(historyGroupCode(rows[0]),'S01·E01 → E12');
  const mixed=[...entries,{...episode('film:movie',0),showId:'film',mediaType:'movie' as const}].sort(compareHistoryEntries);
  assert.equal(groupHistoryRows(mixed,()=>12).length,2,'le film ex æquo reste une ligne distincte');
  const unknown=entries.map(item=>({...item,watchedTimeKnown:false})).sort(compareHistoryEntries);
  assert.equal(groupHistoryRows(unknown,()=>12).length,12,'une heure non prouvée ne devient pas un visionnage consécutif');
});
