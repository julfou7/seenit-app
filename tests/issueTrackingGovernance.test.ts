import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('SEENIT-QUALITY-004 maintient les issues et leurs checkboxes à jour pendant le travail', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  assert.match(agents, /issue active.*mise à jour.*jalons utiles/is);
  assert.match(agents, /Cochez un critère.*réellement prouvé/is);
  assert.match(spec, /SEENIT-QUALITY-004/);
  assert.match(spec, /jalons significatifs[\s\S]*critère.*réellement satisfait/i);
});

test('SEENIT-QUALITY-004 impose le contexte GitHub complet avant toute intervention', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');

  assert.match(agents, /Avant toute analyse, proposition ou modification/i);
  assert.match(agents, /branche GitHub `main`[\s\S]*source de vérité/i);
  assert.match(agents, /nouveau chantier[\s\S]*issues GitHub \*\*ouvertes et fermées liées au sujet\*\*/i);
  assert.match(agents, /Réutiliser ou rouvrir l'issue pertinente[\s\S]*éviter les doublons/i);
  assert.match(agents, /Reprise identifiée : pas de recherche globale/i);
  assert.match(agents, /sans relancer la recherche générale[\s\S]*périmètre[\s\S]*checkpoint[\s\S]*contradiction pertinente/is);

  assert.match(bootstrap, /branche GitHub `main`[\s\S]*canonique/i);
  assert.match(bootstrap, /nouveau chantier[\s\S]*issues GitHub \*\*ouvertes et fermées liées au sujet\*\*/i);
  assert.match(bootstrap, /réutiliser ou rouvrir l'issue adéquate[\s\S]*éviter les doublons/i);
  assert.match(bootstrap, /Reprise identifiée : pas de recherche globale/i);
  assert.match(bootstrap, /reprise identifiée[\s\S]*sans rejouer cette recherche globale/i);

  assert.match(spec, /SEENIT-QUALITY-004[\s\S]*issues GitHub ouvertes et fermées liées au sujet/i);
});

test('SEENIT-QUALITY-004 reprend API-first sans clone obligatoire ni bootstrap redondant', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = fs.readFileSync('docs/process/delivery.md', 'utf8');
  const requestRegistry = fs.readFileSync('docs/requests/registry.md', 'utf8');

  assert.match(agents, /API-first/);
  assert.match(agents, /read-only[\s\S]*sans clone/is);
  assert.match(agents, /nouveau prompt[\s\S]*jamais une raison de recloner/is);
  assert.match(agents, /issue[\s\S]*PR[\s\S]*branche[\s\S]*prochaine action exacte/is);
  assert.match(agents, /SHA\/branche\/PR/i);
  assert.match(agents, /tests déjà verts/i);
  assert.match(agents, /prochaine action exacte/i);

  assert.match(bootstrap, /API-first/);
  assert.match(bootstrap, /nouveau prompt[\s\S]*jamais une raison de recloner/is);

  assert.match(delivery, /Acquisition du workspace et reprise d'intervention/);
  assert.match(delivery, /demande read-only[\s\S]*sans clone/is);
  assert.match(delivery, /--depth|clone partiel|checkout partiel/i);
  assert.match(delivery, /npm ci[\s\S]*(absentes|incompatibles)/is);
  assert.match(delivery, /issue[\s\S]*PR[\s\S]*branche[\s\S]*prochaine action exacte/is);
  assert.match(delivery, /SHA[\s\S]*branche[\s\S]*PR[\s\S]*tests[\s\S]*prochaine action/is);
  assert.match(delivery, /moins de 2 minutes|< 2 minutes/i);

  assert.doesNotMatch(agents, /clon(?:e|er)[^\n]*à chaque intervention/i);
  assert.doesNotMatch(delivery, /clon(?:e|er)[^\n]*à chaque intervention/i);
  assert.match(requestRegistry, /USR-2026-09-07-001/);
});

test('SEENIT-QUALITY-004 sérialise les écritures concurrentes par un bail GitHub', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = fs.readFileSync('docs/process/delivery.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  const requestRegistry = fs.readFileSync('docs/requests/registry.md', 'utf8');

  for (const source of [agents, bootstrap, delivery]) {
    assert.match(source, /<!-- seenit-agent-lease -->/);
    assert.match(source, /90 minutes/i);
  }

  assert.match(agents, /bail `ACTIVE`[\s\S]*autre conversation[\s\S]*non actionnable/i);
  assert.match(agents, /plus petit[\s\S]*identifiant de commentaire GitHub gagne/i);
  assert.match(agents, /Avant chaque push, merge, fermeture d'issue ou commande[\s\S]*release/i);
  assert.match(agents, /HANDOFF_READY[\s\S]*WAITING[\s\S]*DONE/);
  assert.match(bootstrap, /tâche planifiée[\s\S]*ne concurrence jamais une session interactive/i);
  assert.match(delivery, /worktree[\s\S]*GitHub reste partagé/i);
  assert.match(spec, /SEENIT-QUALITY-004[\s\S]*bail GitHub visible[\s\S]*borné à 90 minutes/i);
  assert.match(requestRegistry, /USR-2026-09-12-001/);
});
