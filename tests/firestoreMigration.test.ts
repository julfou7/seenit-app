import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  canonicalDocumentLine,
  canonicalizeFirestoreValue,
  digestDatabase
} = require('../scripts/firestore-database-digest.cjs') as {
  canonicalDocumentLine: (path: string, data: unknown) => string;
  canonicalizeFirestoreValue: (value: unknown) => unknown;
  digestDatabase: (databaseId: string, options: { projectId: string; client: unknown }) => Promise<{
    databaseId: string;
    documentCount: number;
    digest: string;
  }>;
};

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('SEENIT-DATA-006 borne la migration unique de default par export, répétition, maintenance et rollback', () => {
  const script = read('scripts/migrate-firestore-default.sh');
  const workflow = read('.github/workflows/firestore-default-migration.yml');
  const lockdown = JSON.parse(read('firebase.migration-lockdown.json'));
  const lifecycle = JSON.parse(read('config/firestore-export-lifecycle.json'));
  const bucketGuard = 'config/firestore-export-bucket-guard.jq';

  assert.match(workflow, /github\.event\.issue\.number == 23/);
  assert.match(workflow, /github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(workflow, /sha=\(\[0-9a-f\]\{40\}\)/);
  assert.match(script, /SEENIT_MIGRATION_CONFIRMATION/);
  assert.match(script, /readonly ROLLBACK_ARTIFACT_DATABASE='\(default\)'/);
  assert.match(
    script,
    /write_digest "\$ROLLBACK_ARTIFACT_DATABASE"[\s\S]*\.documentCount == 0[\s\S]*delete_database_if_present "\$ROLLBACK_ARTIFACT_DATABASE"/
  );
  assert.match(script, /readonly DEFAULT_DATABASE='default'/);
  assert.doesNotMatch(script, /readonly DEFAULT_DATABASE='\(default\)'/);
  assert.match(script, /lock_public_traffic[\s\S]*firebase\.migration-lockdown\.json/);
  assert.match(script, /write_digest "\$DEFAULT_DATABASE"[\s\S]*gcloud firestore export/);
  assert.match(script, /write_digest "\$AI_DATABASE"[\s\S]*gcloud firestore export/);
  assert.match(script, /default-rehearsal-digest[\s\S]*compare_digests/);
  assert.match(script, /ai-rehearsal-digest[\s\S]*compare_digests/);
  assert.match(script, /firestore indexes composite list/);
  assert.match(script, /firestore indexes fields list/);
  assert.match(script, /firestore fields ttls list/);
  assert.equal(
    (script.match(/select\(\(\.deleteTime \/\/ ""\) == ""\)/g) ?? []).length,
    3,
    'les tombstones Firestore doivent être ignorés dans les deux topologies de préflight et la topologie finale'
  );
  assert.match(script, /recover_on_failure[\s\S]*restore_default_after_cutover_failure/);
  assert.match(script, /ROLLBACK INCOMPLET[\s\S]*maintenance conservée/);
  assert.match(script, /restore_rules_if_locked[\s\S]*restore_public_traffic/);
  assert.match(script, /RULES_LOCKED=true[\s\S]*deploy_rules firebase\.migration-lockdown\.json/);
  assert.match(script, /-f config\/firestore-export-bucket-guard\.jq/);
  assert.deepEqual(
    lockdown.firestore.map((entry: { database: string }) => entry.database),
    ['default', 'ai-studio-seenit-065aead8-cc5a-4b86-9f25-dd812194ffa4']
  );
  assert.equal(JSON.stringify(lockdown).includes('(default)'), false);
  assert.equal(lifecycle.rule[0].action.type, 'Delete');
  assert.equal(lifecycle.rule[0].condition.age, 30);
  if (process.platform !== 'win32') {
    execFileSync('bash', ['-n', 'scripts/migrate-firestore-default.sh']);
    const currentGcloudShape = {
      location: 'EU',
      uniform_bucket_level_access: true,
      public_access_prevention: 'enforced',
      lifecycle_config: lifecycle
    };
    const legacyRestShape = {
      location: 'EU',
      iamConfiguration: {
        uniformBucketLevelAccess: { enabled: true },
        publicAccessPrevention: 'enforced'
      },
      lifecycle
    };
    for (const bucket of [currentGcloudShape, legacyRestShape]) {
      execFileSync('jq', ['-e', '--arg', 'location', 'EU', '-f', bucketGuard], {
        input: JSON.stringify(bucket)
      });
    }
  }
});

test('SEENIT-COST-001 transfère le quota gratuit vers default sans stockage permanent', () => {
  const script = read('scripts/migrate-firestore-default.sh');
  const workflowPolicy = read('scripts/validate-workflow-policy.cjs');
  assert.match(script, /--public-access-prevention/);
  assert.match(script, /--soft-delete-duration=0s/);
  assert.match(script, /firestore-export-lifecycle\.json/);
  assert.match(script, /AI_DELETED=true/);
  assert.match(script, /\.freeTier == true/);
  assert.match(script, /\.deleteProtectionState == "DELETE_PROTECTION_ENABLED"/);
  assert.match(script, /\.locationId == \$location[\s\S]*\.databaseEdition == "STANDARD"/);
  assert.match(workflowPolicy, /firestore-default-migration\.yml[^\n]*id-token[^\n]*issues/);
});

test('le digest Firestore est déterministe et ne journalise pas les données', () => {
  const first = {
    z: 4,
    a: {
      second: true,
      first: Buffer.from('secret-value')
    },
    list: [Number.NaN, -0, Infinity]
  };
  const second = {
    list: [Number.NaN, -0, Infinity],
    a: {
      first: Buffer.from('secret-value'),
      second: true
    },
    z: 4
  };
  assert.deepEqual(canonicalizeFirestoreValue(first), canonicalizeFirestoreValue(second));
  const firstLine = canonicalDocumentLine('users/example', first);
  const secondLine = canonicalDocumentLine('users/example', second);
  assert.equal(firstLine, secondLine);
  assert.equal(
    crypto.createHash('sha256').update(firstLine).digest('hex'),
    crypto.createHash('sha256').update(secondLine).digest('hex')
  );

  const digestScript = read('scripts/firestore-database-digest.cjs');
  assert.match(digestScript, /listDocuments[\s\S]*showMissing: true/);
  assert.match(digestScript, /documentCount[\s\S]*collectionGroupCounts[\s\S]*digest/);
  assert.equal(digestScript.includes('console.log(document.data'), false);
  assert.equal(digestScript.includes('JSON.stringify(report, null'), false);
});


test('le digest liste les collections avant les documents et distingue default de (default)', async () => {
  const documentRequests: Array<Record<string, unknown>> = [];
  const collectionParents: string[] = [];
  const client = {
    async listCollectionIds(request: { parent: string }) {
      collectionParents.push(request.parent);
      return [['users']];
    },
    async listDocuments(request: Record<string, unknown>) {
      documentRequests.push(request);
      return [[]];
    }
  };

  const named = await digestDatabase('default', {
    projectId: 'seenit-test',
    client
  });
  const reserved = await digestDatabase('(default)', {
    projectId: 'seenit-test',
    client
  });

  assert.equal(named.documentCount, 0);
  assert.equal(reserved.documentCount, 0);
  assert.equal(named.digest, crypto.createHash('sha256').digest('hex'));
  assert.deepEqual(collectionParents, [
    'projects/seenit-test/databases/default/documents',
    'projects/seenit-test/databases/(default)/documents'
  ]);
  assert.equal(documentRequests.length, 2);
  for (const request of documentRequests) {
    assert.equal(request.collectionId, 'users');
    assert.equal(request.showMissing, true);
  }
});
