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
  assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 4, msg: 'Your account is banned' }]), 'Bloqué par le tracker : compte suspendu.', 'revue Codex #1072 : traduit');
  assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 4, msg: 'Download not allowed for this torrent' }]), 'Bloqué par le tracker : téléchargement refusé.', 'jamais le texte brut anglais');
  assert.equal(trackerRefusal([{ url: 'udp://public.example:1337', status: 4, msg: 'Connection timed out' }]), null, 'revue Codex #1072 : une panne n’est pas un refus');
  assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 2, msg: 'Bienvenue !' }]), null, 'message anodin d’un tracker qui fonctionne : rien');
  for (const msg of ['Your account has been suspended', 'Votre compte est banni'])
    assert.equal(trackerRefusal([{ url: 'https://t.example/a', status: 4, msg }]), 'Bloqué par le tracker : compte suspendu.', `revue Codex #1072 : « ${msg} »`);
  for (const msg of ['Operation timed out', 'Operation canceled', 'Connection refused', 'Configuration error'])
    assert.equal(trackerRefusal([{ url: 'udp://public.example:1337', status: 4, msg }]), null, `revue Codex #1072 : « ${msg} » n’est pas un refus`);
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
  // #1078 : la mémoire (TTL, rotation, âge maximal, connexion) est testée en exécution dans
  // downloadReplacementBehavior.test.ts ; ici seul le câblage du suivi qBittorrent est vérifié.
  const scopeKey = /const scope = buildQbitSessionScopeKey\(auth\.currentUser\?\.uid, cleanUrl\(config\.qbittorrentUrl \|\| ''\), config\.qbittorrentUsername\);/;
  assert.match(live, scopeKey, 'note propre à la connexion qBittorrent');
  assert.match(live, /return collectTrackerRefusals\(trackerNotes, torrents, scope,\s*hash => qbitGet\(config, `\/api\/v2\/torrents\/trackers\?hash=\$\{encodeURIComponent\(hash\)\}`\)\);/);
  assert.match(live, /const trackerNote = !isQbitError && !isDone \? refusals\.get\(String\(t\.hash\)\) \?\?/);
  assert.match(live, /existing\.errorMessage = trackerNote;/);
});
