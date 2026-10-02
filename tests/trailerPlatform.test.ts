import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { trailerPresentationAdapter } from '../src/features/trailers/trailerPlatform.ts';
import { startTrailerPresentation } from '../src/features/trailers/trailerPresentation.ts';

test('le chemin PWA de production demande le plein écran avant tout await puis libère le paysage', async () => {
  const calls: string[] = [];
  const doc = { fullscreenElement: null as HTMLElement | null, exitFullscreen: async () => { calls.push('exit'); doc.fullscreenElement = null; } };
  const orientation = { lock: async () => { calls.push('landscape'); }, unlock: () => { calls.push('unlock'); } };
  const element = { requestFullscreen: async () => { calls.push('fullscreen'); doc.fullscreenElement = element; } } as unknown as HTMLElement;
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  Object.defineProperty(globalThis, 'screen', { value: { orientation }, configurable: true });
  const session = startTrailerPresentation(trailerPresentationAdapter(element));
  assert.deepEqual(calls, ['fullscreen']);
  await session.ready;
  await session.close();
  assert.deepEqual(calls, ['fullscreen', 'landscape', 'unlock', 'exit']);
});

test('le refus orientation ne bloque ni la lecture ni la sortie et un plein écran extérieur est préservé', async () => {
  let exits = 0;
  const doc = { fullscreenElement: null as HTMLElement | null, exitFullscreen: async () => { exits++; doc.fullscreenElement = null; } };
  const element = { requestFullscreen: async () => { doc.fullscreenElement = element; } } as unknown as HTMLElement;
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  Object.defineProperty(globalThis, 'screen', { value: { orientation: { lock: async () => { throw new Error('denied'); } } }, configurable: true });
  const session = startTrailerPresentation(trailerPresentationAdapter(element));
  await session.ready;
  assert.equal(doc.fullscreenElement, element);
  await session.close();
  assert.equal(exits, 1);
  doc.fullscreenElement = {} as HTMLElement;
  const other = startTrailerPresentation(trailerPresentationAdapter(element));
  await other.ready;
  await other.close();
  assert.equal(exits, 1);
});

test('le lecteur partagé et le bridge Android conservent la pile Retour et restaurent le réglage de lecture', () => {
  const modal = readFileSync('src/components/TrailerModal.tsx', 'utf8');
  const activity = readFileSync('android/app/src/main/java/com/seenit/app/MainActivity.java', 'utf8');
  const plugin = readFileSync('android/app/src/main/java/com/seenit/app/SeenItTrailerPlugin.java', 'utf8');
  assert.match(modal, /<DialogLayer onDismiss={onClose}/);
  assert.match(modal, /presentationRef\.current\?\.close\(\)/);
  assert.match(modal, /src={trailerEmbedUrl\(currentVideo\)}/);
  assert.match(activity, /registerPlugin\(SeenItTrailerPlugin.class\)/);
  assert.match(plugin, /SCREEN_ORIENTATION_SENSOR_LANDSCAPE/);
  assert.match(plugin, /SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(plugin, /setMediaPlaybackRequiresUserGesture\(playbackRequiresGesture\)/);
  assert.match(plugin, /handleOnDestroy\(\)/);
});
