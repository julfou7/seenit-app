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
  assert.match(saga, /<strong className="font-extrabold text-\[#F2C36B\]">\{seenCount\}<\/strong> \/ \{rows\.length\} vus/);
  assert.match(saga, /data-saga-segment/);
  assert.match(saga, /aria-current=\{here \? 'page' : undefined\}/);
  assert.match(saga, /TU ES ICI/);
  // Trait or seulement entre deux films vus ; repère or plein vu, creux avec halo pour le film affiché, gris sinon.
  assert.match(saga, /background: previousSeen && seen \? '#E5A93D' : '#3F3F46'/);
  assert.match(saga, /background: seen && nextSeen \? '#E5A93D' : '#3F3F46'/);
  assert.match(saga, /here \? 'bg-\[#141417\] text-\[#F2C36B\] shadow-\[inset_0_0_0_3px_#E5A93D,0_0_0_4px_rgba\(229,169,61,0\.2\)\]' : seen \? 'bg-\[#E5A93D\]/);
  // Statut vu = tampon VU de l'accueil sur l'affiche, annoncé aux lecteurs d'écran ; non vu = « À voir » en texte.
  assert.match(saga, /\{seen && <><span aria-hidden="true" className="absolute inset-0 bg-\[rgba\(9,9,11,0\.35\)\]" \/><SeenItWatchedStamp className="seenit-watched-stamp--mini" \/><\/>\}/);
  assert.match(saga, /<span className="sr-only">, vu<\/span>/);
  assert.match(saga, /<span className="font-extrabold text-zinc-300">À voir<\/span>/);
  // Repère, trait et affiche sur le même axe : traits ancrés au centre du repère, ligne centrée verticalement.
  assert.match(sections, /const SAGA_AXIS = 20;/);
  assert.match(saga, /style=\{\{ left: SAGA_AXIS, height: 'calc\(50% \+ 2px\)'/);
  assert.match(saga, /flex w-full min-h-\[104px\] items-center gap-3/);
  assert.match(saga, /seenit-media-title block text-\[15px\]/, 'titre média en or (#874)');
});
