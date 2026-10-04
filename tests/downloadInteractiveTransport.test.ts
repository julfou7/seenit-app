import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleDownloadRuntime } from './helpers/downloadRuntime.ts';
import { downloadServiceTimeoutMs } from '../src/features/downloads/downloadServiceTimeout.ts';

const state = { native: false, calls: [] as Array<{ path: string; init: RequestInit }>, fails: false };
(globalThis as Record<string, unknown>).__interactiveFixture = state;
const runtime = await bundleDownloadRuntime(`export { executeArrInteractiveGet, executeArrInteractivePost } from './src/services/sonarrRadarrTransport.ts';`, {
  firebase: `export const auth={currentUser:{uid:'fixture'}};`,
  '@capacitor/core': `export const Capacitor={isNativePlatform:()=>globalThis.__interactiveFixture.native};
    export const CapacitorHttp={post:async init=>{const s=globalThis.__interactiveFixture;s.calls.push({path:init.url,init});if(s.fails)throw new Error('timeout');return {status:200,data:{}};}};`,
  apiAuth: `export const authenticatedFetch=async(path,init)=>{const s=globalThis.__interactiveFixture;s.calls.push({path,init});
    if(s.fails)throw new Error('timeout');return {ok:true,json:async()=>({ok:true,data:[]})};};`
});
test('le proxy borne recherche et grab à 30 secondes, sans allonger le polling ordinaire', () => {
  assert.equal(downloadServiceTimeoutMs('GET', 'https://arr.example/api/v3/release?movieId=3'), 30_000);
  assert.equal(downloadServiceTimeoutMs('POST', 'https://arr.example/api/v3/release'), 30_000);
  assert.equal(downloadServiceTimeoutMs('GET', 'https://arr.example/api/v3/queue'), 10_000);
});
test('les transports PWA et Android conservent la clé de soumission et ne rejouent pas un POST ambigu', async () => {
  for (const native of [false, true]) {
    state.native = native; state.calls = []; state.fails = true;
    await assert.rejects(runtime.executeArrInteractivePost('https://arr.example/api/v3/release', { guid: 'exact', indexerId: 2 }, { 'X-SeenIt-Request-Id': 'stable' }), /timeout/);
    assert.equal(state.calls.length, 1);
    const init = state.calls[0].init;
    const headers = native ? init.headers : JSON.parse(String(init.body)).headers;
    assert.equal(headers['X-SeenIt-Request-Id'], 'stable');
  }
  state.native = false; state.calls = []; state.fails = false;
  await runtime.executeArrInteractiveGet('https://arr.example/api/v3/release?movieId=3', {});
  assert.equal(JSON.parse(String(state.calls[0].init.body)).method, 'GET');
});
