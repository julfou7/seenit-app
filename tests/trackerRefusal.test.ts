import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trackerRefusal } from '../src/features/downloads/trackerRefusal.ts';
import { downloadGroup, downloadProblem } from '../src/features/downloads/downloadGroups.ts';

// Retour terrain du 16/11 : « bloqué faute de ratio insuffisant ; dans SeenIt je vois seulement le téléchargement bloqué à
// 0 % sans explication ».
test('refus du tracker lu dans qBittorrent et expliqué en français', () => {
  const dht = { url: '** [DHT] **', status: 2, msg: '' };
  assert.equal(trackerRefusal([dht, { url: 'https://tracker.example/announce', status: 4, msg: 'Your ratio is too low to download' }]), 'Bloqué par le tracker : ratio insuffisant.');
  assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 4, msg: 'Téléchargement bloqué : crédit insuffisant' }]), 'Bloqué par le tracker : ratio insuffisant.');
  assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 4, msg: 'Unregistered torrent' }]), 'Bloqué par le tracker : ce torrent n’y existe plus.');
  assert.match(trackerRefusal([{ url: 'https://t.example/a', status: 4, msg: 'Compte suspendu : téléchargement interdit' }]) || '', /^Bloqué par le tracker : « Compte suspendu : téléchargement interdit »\.$/);
  assert.equal(trackerRefusal([{ url: 'udp://public.example:1337', status: 4, msg: 'Connection timed out' }]), null, 'revue Codex #1072 : une panne n’est pas un refus');
  assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 2, msg: 'Bienvenue !' }]), null, 'message anodin d’un tracker qui fonctionne : rien');
  assert.equal(trackerRefusal([{ url: '** [PeX] **', status: 4, msg: 'ratio' }]), null, 'DHT/PeX/LSD ignorés');
  assert.equal(trackerRefusal(null), null);

  const note = 'Bloqué par le tracker : ratio insuffisant.';
  assert.equal(downloadGroup({ status: 'warning', progress: 0, errorMessage: note }), 'attention', 'dans « À régler », plus une attente muette à 0 %');
  const problem = downloadProblem(note);
  assert.equal(problem.title, 'Bloqué par le tracker : ratio insuffisant');
  assert.match(problem.hint, /ratio sur ce tracker est trop bas/);
});

test('le suivi qBittorrent relit les trackers d’un torrent à l’arrêt, au plus une fois par minute', () => {
  const live = readFileSync('src/services/sonarrRadarrLive.ts', 'utf8');
  assert.match(live, /const TRACKER_NOTE_TTL_MS = 60_000;/);
  assert.match(live, /\.sort\(\(a, b\) => \(trackerNotes\.get\(a\)\?\.at \?\? 0\) - \(trackerNotes\.get\(b\)\?\.at \?\? 0\)\)\.slice\(0, 5\)/, 'revue Codex #1072 : rotation, jamais toujours les 5 mêmes');
  assert.match(live, /for \(const hash of stopped\) \{ const note = trackerNotes\.get\(hash\)\?\.note;/, 'notes valides rendues pour tous');
  assert.match(live, /qbitGet\(config, `\/api\/v2\/torrents\/trackers\?hash=\$\{encodeURIComponent\(hash\)\}`\)/);
  assert.match(live, /const trackerNote = !isQbitError && !isDone \? refusals\.get\(String\(t\.hash\)\) : undefined;/);
  assert.match(live, /existing\.errorMessage = trackerNote;/);
});
