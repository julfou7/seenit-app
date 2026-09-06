import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  collectLocalRuntimeDependencies,
  hasBackendRuntimeImpact
} = require('../scripts/backend-runtime-impact.cjs');

test('SEENIT-RUNTIME-001 suit les dépendances backend réellement importées par server.ts', () => {
  const dependencies: Set<string> = collectLocalRuntimeDependencies();

  assert.ok(dependencies.has('server.ts'));
  assert.ok(dependencies.has('src/features/release/releaseUpdatePushBackend.ts'));
  assert.ok(dependencies.has('src/features/release/releaseUpdatePushCore.ts'));
  assert.ok(dependencies.has('src/features/runtime/backendRuntime.ts'));
  assert.ok(dependencies.has('src/features/downloads/downloadBackendSecurity.ts'));
});

test('SEENIT-RUNTIME-001 déploie un module serveur partagé sans déployer un fichier UI sans lien runtime', () => {
  const dependencies: Set<string> = collectLocalRuntimeDependencies();

  assert.equal(
    hasBackendRuntimeImpact(['src/features/release/releaseUpdatePushBackend.ts'], dependencies),
    true
  );
  assert.equal(
    hasBackendRuntimeImpact(['src/components/MediaCard.tsx'], dependencies),
    false
  );
  assert.equal(hasBackendRuntimeImpact(['docs/runtime-cutover.md'], dependencies), false);
});

test('SEENIT-RUNTIME-001 traite les dépendances npm, Buildpacks et gardes de déploiement comme impact runtime conservateur', () => {
  const dependencies: Set<string> = collectLocalRuntimeDependencies();

  assert.equal(hasBackendRuntimeImpact(['package.json'], dependencies), true);
  assert.equal(hasBackendRuntimeImpact(['package-lock.json'], dependencies), true);
  assert.equal(hasBackendRuntimeImpact(['project.toml'], dependencies), true);
  assert.equal(hasBackendRuntimeImpact(['.github/workflows/deploy-backend.yml'], dependencies), true);
  assert.equal(hasBackendRuntimeImpact(['scripts/backend-runtime-impact.cjs'], dependencies), true);
  assert.equal(hasBackendRuntimeImpact(['scripts/prepare-cloud-run-candidate.cjs'], dependencies), true);
});
