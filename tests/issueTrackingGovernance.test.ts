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
  assert.match(agents, /next issue[\s\S]*plus ancienne issue ouverte actionnable[\s\S]*date de création/i);
  assert.match(agents, /Ne sauter une issue[\s\S]*WAITING[\s\S]*bail concurrent actif/i);
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
  assert.match(spec, /SEENIT-QUALITY-004[\s\S]*bail GitHub visible[\s\S]*90 minutes/i);
  assert.match(requestRegistry, /USR-2026-09-12-001/);
});

test('SEENIT-QUALITY-004 conserve les chantiers Codex pendant un arrêt de quota', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = fs.readFileSync('docs/process/delivery.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  const requestRegistry = fs.readFileSync('docs/requests/registry.md', 'utf8');

  assert.match(agents, /Origine: CODEX/);
  assert.match(agents, /quota[\s\S]*n'est pas un `HANDOFF_READY`/i);
  assert.match(agents, /expiration[\s\S]*90 minutes[\s\S]*ne transfère jamais/i);
  assert.match(agents, /Automation\/Schedule[\s\S]*même thread/i);
  assert.match(agents, /HANDOFF_READY[\s\S]*instruction utilisateur explicite de transfert/i);
  assert.match(bootstrap, /quota[\s\S]*expiration des 90 minutes ne vaut jamais transfert/i);
  assert.match(bootstrap, /Automations\/Schedules[\s\S]*même thread/i);
  assert.match(delivery, /Quota Codex[\s\S]*même thread/i);
  assert.match(delivery, /quota[\s\S]*HANDOFF_READY/i);
  assert.match(spec, /SEENIT-QUALITY-004[\s\S]*quota Codex[\s\S]*HANDOFF_READY/i);
  assert.match(requestRegistry, /USR-2026-09-13-006/);
});

test('SEENIT-QUALITY-004 transmet une APK déléguée par un relais release distinct', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = fs.readFileSync('docs/process/delivery.md', 'utf8');
  const releaseControl = fs.readFileSync('docs/specifications/release-control.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  const requestRegistry = fs.readFileSync('docs/requests/registry.md', 'utf8');

  for (const source of [agents, bootstrap, delivery, releaseControl, spec]) {
    assert.match(source, /<!-- seenit-apk-release-handoff -->/);
    assert.match(source, /HANDOFF_READY/);
    assert.match(source, /#102/);
    assert.match(source, /WAITING Terrain/);
  }
  assert.match(agents, /acquiert d'abord[\s\S]*bail `ACTIVE` sur #102[\s\S]*HANDOFF_READY/i);
  assert.match(agents, /demande utilisateur[\s\S]*SHA `main`[\s\S]*dernière release officielle[\s\S]*commits APK non publiés/i);
  assert.match(agents, /destinataire[\s\S]*\/prepare-release-apk[\s\S]*\/release-apk/i);
  assert.match(agents, /déjà publiée[\s\S]*sans doublon[\s\S]*main` a avancé/i);
  assert.match(agents, /sans demande\/délégation[\s\S]*ne crée pas[\s\S]*release automatique/i);
  assert.match(agents, /promet une publication par une autre tâche[\s\S]*relire #102/i);
  assert.match(delivery, /prochaine exécution/i);
  assert.match(releaseControl, /n'est \*\*pas\*\* une commande/i);
  assert.match(requestRegistry, /USR-2026-09-15-001/);
});

test('SEENIT-QUALITY-004 ouvre proactivement une issue d’amélioration continue pour toute difficulté corrigeable et réutilisable', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  const requestRegistry = fs.readFileSync('docs/requests/registry.md', 'utf8');

  for (const source of [agents, bootstrap, spec]) {
    assert.match(source, /difficulté réellement rencontrée[\s\S]*corrigeable[\s\S]*prochaine intervention/i);
    assert.match(source, /issues GitHub ouvertes[\s\S]*fermées/i);
    assert.match(source, /réutilise(?:r)?[\s\S]*rouvr(?:e|ir)/i);
    assert.match(source, /ouvr(?:e|ir) immédiatement[\s\S]*issue d'amélioration continue/i);
    assert.match(source, /contexte[\s\S]*impact concret[\s\S]*cause racine[\s\S]*hypothèse[\s\S]*amélioration durable[\s\S]*bénéfice attendu[\s\S]*critères de validation\/fin/i);
    assert.match(source, /chantier principal continue/i);
  }

  assert.match(agents, /non reproductible[\s\S]*non corrigeable[\s\S]*difficulté inventée/i);
  assert.match(bootstrap, /non reproductible[\s\S]*non corrigeable[\s\S]*difficulté inventée/i);
  assert.match(spec, /non reproductible[\s\S]*non corrigeable[\s\S]*difficulté inventée/i);
  assert.match(requestRegistry, /USR-2026-09-21-014/);
  assert.match(requestRegistry, /issue #496/);
});
