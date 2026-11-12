import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sections = readFileSync('src/screens/mediaDetail/detailSections.tsx', 'utf8');
const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');

test('SEENIT-UX-019 #871 la saga v2 numérote l’ordre TMDB, situe le film affiché et pose le tampon VU', () => {
  const saga = sections.slice(sections.indexOf('export function SagaTimeline'), sections.indexOf('export function RelationList'));
  // Même source qu'avant : la collection TMDB passée par la fiche, l'identité de chaque membre reste type:tmdbId.
  assert.match(view, /<RelationList title=\{tmdbDetails\?\.belongs_to_collection\?\.name \|\| 'Ordre de visionnage'\}[^>]*parts=\{collectionData\.parts\}[^>]*timeline /);
  assert.match(sections, /if \(timeline\) return <SagaTimeline /);
  assert.match(saga, /here: mediaKeyFrom\(part as Parameters<typeof mediaKeyFrom>\[0\]\) === currentKey, \.\.\.libraryState\(part, shows\)/, 'le film affiché garde son statut vu');
  // Repères numérotés 1…N, en-tête X / N vus et barre segmentée, ligne du film affiché encadrée avec TU ES ICI.
  assert.match(saga, /\{index \+ 1\}<\/span>/);
  assert.match(saga, /<strong className="font-extrabold text-white">\{seenCount\}<\/strong> \/ \{rows\.length\} vus/);
  assert.match(saga, /data-saga-segment/);
  assert.match(saga, /aria-current=\{here \? 'page' : undefined\}/);
  assert.match(saga, /TU ES ICI/);
  // Saga v3 (07/11, « beaucoup de jaune ») : l'or ne sert qu'au film affiché (repère plein, segment, titre, contour) ;
  // traits, repères et segments des films vus sont neutres.
  assert.match(saga, /background: previousSeen && seen \? '#71717A' : '#3F3F46'/);
  assert.match(saga, /background: seen && nextSeen \? '#71717A' : '#3F3F46'/);
  assert.match(saga, /here \? 'bg-\[#E5A93D\] text-\[#1A1206\] shadow-\[0_0_0_4px_rgba\(229,169,61,0\.2\)\]' : seen \? 'bg-zinc-700 text-zinc-100'/);
  assert.match(saga, /style=\{\{ background: row\.here \? '#E5A93D' : row\.seen \? '#A1A1AA' : '#3F3F46' \}\}/);
  // Statut vu = tampon VU de l'accueil sur l'affiche, annoncé aux lecteurs d'écran ; non vu = « À voir » en texte.
  assert.match(saga, /\{seen && <><span aria-hidden="true" className="absolute inset-0 bg-\[rgba\(9,9,11,0\.35\)\]" \/><SeenItWatchedStamp className="seenit-watched-stamp--mini" \/><\/>\}/);
  assert.match(saga, /<span className="sr-only">, vu<\/span>/);
  assert.match(saga, /<span className="font-extrabold text-zinc-300">À voir<\/span>/);
  // Retour v1.4.301 (Coco 2, sortie en 2029) : un titre pas encore sorti, ou sans date, est « À venir », jamais « À voir ».
  assert.match(saga, /const upcoming = !releaseDate \|\| releaseDate > getTodayStr\(\);/);
  assert.match(saga, /\{upcoming \? <span className="font-extrabold text-sky-300">À venir<\/span> : <span className="font-extrabold text-zinc-300">À voir<\/span>\}/);
  // Repère, trait et affiche sur le même axe : traits ancrés au centre du repère, ligne centrée verticalement.
  assert.match(sections, /const SAGA_AXIS = 20;/);
  assert.match(saga, /style=\{\{ left: SAGA_AXIS, height: 'calc\(50% \+ 2px\)'/);
  assert.match(saga, /flex w-full min-h-\[104px\] items-center gap-3/);
  // Titre en or seulement pour le film affiché ; vus en gris, à voir en blanc (exception validée à #874).
  assert.match(saga, /here \? 'seenit-media-title' : seen \? 'text-zinc-400' : 'text-zinc-100'/);
});
