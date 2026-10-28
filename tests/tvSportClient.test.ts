import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../tv-samsung/sport.js', import.meta.url), 'utf8');
function harness() {
  const requests: Array<{ url: string; aborted?: boolean; readyState: number; status: number; responseText: string; onreadystatechange?: () => void }> = [];
  const store = new Map<string, string>(); let changes = 0;
  const document = { hidden: false };
  const context = vm.createContext({ document, Date, JSON, console, XMLHttpRequest: function (this: Record<string, unknown>) {
    this.open = (_method: string, url: string) => { this.url = url; };
    this.send = () => { requests.push(this as unknown as typeof requests[number]); };
    this.abort = () => { this.aborted = true; };
  } });
  vm.runInContext(source, context);
  const api = vm.runInContext('TVSport', context);
  api.init({ getItem: (k: string) => store.get(k), setItem: (k: string, v: string) => store.set(k, v) }, () => changes++);
  function respond(index = 0) {
    const r = requests[index]; r.status = 200; r.readyState = 4;
    r.responseText = JSON.stringify({ fetchedAt: Date.now(), sources: [{ id: 'monaco', state: 'ready' }], events: [
      { id: 'future', sourceId: 'monaco', kickoff: new Date(Date.now() + 86400000).toISOString(), home: { name: 'A' }, away: { name: 'B' }, competition: 'Cup' },
      { id: 'past', sourceId: 'monaco', kickoff: new Date(Date.now() - 86400000).toISOString(), home: { name: 'A' }, away: { name: 'B' }, competition: 'Cup' },
    ] }); r.onreadystatechange?.();
  }
  return { api, requests, store, document, respond, changes: () => changes };
}
test('SEENIT-TV-003 client réel : normalisation, sélection et aucun polling au repos', () => {
  const h = harness(); h.api.refresh(false); h.api.refresh(false); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://seenit.ai.studio/api/tv/sport');
  h.respond(); assert.equal(h.api.view(['monaco']).events.length, 1);
  assert.equal(h.api.view(['france-men']).events.length, 0);
  h.api.refresh(false); assert.equal(h.requests.length, 1);
  assert.equal(h.store.size, 1); assert.doesNotMatch(source, /setInterval|setTimeout|Authorization|token|apiKey/);
});
test('SEENIT-TV-003 annule en arrière-plan et ignore une réponse devenue obsolète', () => {
  const h = harness(); h.api.refresh(false); const callback = h.requests[0].onreadystatechange;
  h.document.hidden = true; h.api.pause(); assert.equal(h.requests[0].aborted, true);
  h.respond(); callback?.(); assert.equal(h.changes(), 0); assert.equal(h.api.view(['monaco']).events.length, 0);
  h.api.refresh(true); assert.equal(h.requests.length, 1);
  h.document.hidden = false; h.api.refresh(false); assert.equal(h.requests.length, 2);
});
