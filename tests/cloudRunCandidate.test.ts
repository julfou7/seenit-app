import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { deriveCandidateTag, prepareCandidateService } = require('../scripts/prepare-cloud-run-candidate.cjs');

const image = `us-west1-docker.pkg.dev/gen-lang-client-0201895414/cloud-run-source-deploy/seenit-app@sha256:${'a'.repeat(64)}`;
const baseOptions = {
  image,
  service: 'seenit-app',
  previousRevision: 'seenit-app-00014-wjw',
  candidateRevision: 'seenit-app-gh-12345'
};

const exportedService = `apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  annotations:
    run.googleapis.com/ingress: all
  name: seenit-app
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: '2'
        run.googleapis.com/base-images: '{"default":"nodejs24"}'
        run.googleapis.com/sources: '{"default":"gs://legacy/source.tgz"}'
      labels:
        client.knative.dev/nonce: keep-me
      name: seenit-app-00014-wjw
    spec:
      containerConcurrency: 80
      containers:
      - env:
        - name: NODE_ENV
          value: development
        - name: KEEP_ENV
          value: keep-value
        image: us-west1-docker.pkg.dev/legacy/source/app:old
        resources:
          limits:
            cpu: 1000m
            memory: 512Mi
      runtimeClassName: run.googleapis.com/linux-base-image-update
      serviceAccountName: runtime@example.iam.gserviceaccount.com
  traffic:
  - percent: 100
    revisionName: seenit-app-00014-wjw
`;

test('SEENIT-RUNTIME-001 prépare une candidate image en conservant la configuration et le trafic', () => {
  const prepared = prepareCandidateService(exportedService, baseOptions);

  assert.match(prepared, /name: seenit-app-gh-12345/);
  assert.match(prepared, new RegExp(image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(prepared, /run\.googleapis\.com\/sources/);
  assert.doesNotMatch(prepared, /run\.googleapis\.com\/base-images/);
  assert.doesNotMatch(prepared, /runtimeClassName:\s*run\.googleapis\.com\/linux-base-image-update/);

  assert.match(prepared, /run\.googleapis\.com\/ingress: all/);
  assert.match(prepared, /autoscaling\.knative\.dev\/maxScale: '2'/);
  assert.match(prepared, /client\.knative\.dev\/nonce: keep-me/);
  assert.match(prepared, /KEEP_ENV/);
  assert.match(prepared, /keep-value/);
  assert.match(prepared, /memory: 512Mi/);
  assert.match(prepared, /serviceAccountName: runtime@example\.iam\.gserviceaccount\.com/);
  assert.match(prepared, /name: NODE_ENV\n\s+value: production/);
  assert.doesNotMatch(prepared, /name: NODE_ENV\n\s+value: development/);
  assert.equal((prepared.match(/name: NODE_ENV/g) || []).length, 1);
  assert.match(prepared, /percent: 100\n    revisionName: seenit-app-00014-wjw/);
  assert.match(prepared, /percent: 0\n    revisionName: seenit-app-gh-12345\n    tag: candidate-12345/);
});

test('SEENIT-RUNTIME-001 retire les anciennes cibles à 0 % avant de créer la candidate', () => {
  const stale = exportedService.replace(
    '  - percent: 100\n    revisionName: seenit-app-00014-wjw\n',
    `  - percent: 100\n    revisionName: seenit-app-00014-wjw\n  - percent: 0\n    revisionName: seenit-app-gh-old-1\n    tag: candidate-old-1\n`
  );
  const prepared = prepareCandidateService(stale, baseOptions);

  assert.doesNotMatch(prepared, /seenit-app-gh-old-1/);
  assert.doesNotMatch(prepared, /candidate-old-1/);
  assert.equal((prepared.match(/- percent:/g) || []).length, 2);
  assert.match(prepared, /percent: 100\n    revisionName: seenit-app-00014-wjw/);
  assert.match(prepared, /percent: 0\n    revisionName: seenit-app-gh-12345\n    tag: candidate-12345/);
});

test('SEENIT-RUNTIME-001 refuse toute autre cible de trafic active', () => {
  const unsafe = exportedService.replace(
    '  - percent: 100\n    revisionName: seenit-app-00014-wjw\n',
    `  - percent: 100\n    revisionName: seenit-app-00014-wjw\n  - percent: 1\n    revisionName: seenit-app-other\n`
  );

  assert.throws(
    () => prepareCandidateService(unsafe, baseOptions),
    /exclusivement fixé/
  );
});

test('SEENIT-RUNTIME-001 ajoute NODE_ENV=production quand le service exporté n’a pas de bloc env', () => {
  const noEnv = exportedService.replace(
    `      - env:\n        - name: NODE_ENV\n          value: development\n        - name: KEEP_ENV\n          value: keep-value\n        image:`,
    '      - image:'
  );
  const prepared = prepareCandidateService(noEnv, baseOptions);

  assert.match(prepared, /- env:\n\s+- name: NODE_ENV\n\s+value: production\n\s+image:/);
});

test('SEENIT-RUNTIME-001 dérive le tag candidat attendu par le workflow', () => {
  assert.equal(deriveCandidateTag('seenit-app', 'seenit-app-gh-34014482896-1'), 'candidate-34014482896-1');
  assert.throws(
    () => deriveCandidateTag('seenit-app', 'seenit-app-blue'),
    /hors convention seenit-app-gh-/
  );
});

test('SEENIT-RUNTIME-001 refuse un export dont le trafic suit latestRevision', () => {
  const unsafe = exportedService
    .replace('  - percent: 100\n    revisionName: seenit-app-00014-wjw', '  - latestRevision: true\n    percent: 100');

  assert.throws(
    () => prepareCandidateService(unsafe, baseOptions),
    /latestRevision=true/
  );
});

test('SEENIT-RUNTIME-001 refuse une configuration multi-conteneurs ambiguë', () => {
  const ambiguous = exportedService.replace(
    '        resources:\n',
    `        resources:\n      - image: us-west1-docker.pkg.dev/sidecar/image:latest\n`
  );

  assert.throws(
    () => prepareCandidateService(ambiguous, baseOptions),
    /2 ligne\(s\) image détectée\(s\)/
  );
});
