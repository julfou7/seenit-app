import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { analyzeDist, enforceBudgets } = require('../scripts/quality-bundle-budget.cjs') as {
  analyzeDist: (distDir: string) => any;
  enforceBudgets: (report: any, config: any) => { failures: string[] };
};

const qualityConfig = JSON.parse(fs.readFileSync('docs/specifications/quality-gates.json', 'utf8'));

test('SEENIT-QUALITY-001 garde les parcours PWA/APK critiques, l’accessibilité et les budgets de performance sous des garde-fous bloquants', () => {
  assert.equal(qualityConfig.issue, 15);
  assert.deepEqual(
    qualityConfig.journeys.map((journey: any) => journey.id),
    ['login', 'library', 'plex', 'downloads', 'update', 'notifications']
  );
  assert.deepEqual(
    qualityConfig.pwa.viewports.map((viewport: any) => viewport.width),
    [360, 412, 1280]
  );
  assert.equal(qualityConfig.pwa.minTouchTargetCssPx, 44);
  assert.deepEqual(qualityConfig.budgets.bundle, {
    entryGzipKiB: 280,
    initialJsGzipKiB: 560,
    initialCssGzipKiB: 30,
    lazyChunkGzipKiB: 40,
  });
  assert.deepEqual(qualityConfig.budgets.android, {
    coldStartMs: 9000,
    resumeMs: 2500,
  });

  for (const journey of qualityConfig.journeys) {
    assert.ok(journey.targets.length > 0, `${journey.id}: cible manquante`);
    assert.ok(journey.evidence.length > 0, `${journey.id}: preuve manquante`);
    for (const evidence of journey.evidence) {
      assert.equal(fs.existsSync(evidence), true, `${journey.id}: preuve absente ${evidence}`);
    }
  }
});

test('le budget bundle distingue le graphe initial des imports dynamiques', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-quality-bundle-'));
  try {
    const assets = path.join(directory, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), `
      <link rel="stylesheet" href="/assets/index.css">
      <script type="module" src="/assets/index.js"></script>
    `);
    fs.writeFileSync(path.join(assets, 'index.css'), '.app{display:block}'.repeat(10));
    fs.writeFileSync(path.join(assets, 'index.js'), `import { value } from './vendor.js'; import('./lazy.js'); console.log(value);`);
    fs.writeFileSync(path.join(assets, 'vendor.js'), `export const value = '${'v'.repeat(500)}';`);
    fs.writeFileSync(path.join(assets, 'lazy.js'), `export const lazy = '${'l'.repeat(2_000)}';`);

    const report = analyzeDist(directory);
    assert.equal(report.entry.file, 'assets/index.js');
    assert.deepEqual(report.initialJs.files.map((item: any) => item.file).sort(), ['assets/index.js', 'assets/vendor.js']);
    assert.equal(report.lazyChunks.some((item: any) => item.file === 'assets/lazy.js'), true);

    const generous = enforceBudgets(report, {
      budgets: { bundle: { entryGzipKiB: 100, initialJsGzipKiB: 100, initialCssGzipKiB: 100, lazyChunkGzipKiB: 100 } },
    });
    assert.deepEqual(generous.failures, []);

    const blocked = enforceBudgets(report, {
      budgets: { bundle: { entryGzipKiB: 0, initialJsGzipKiB: 0, initialCssGzipKiB: 0, lazyChunkGzipKiB: 0 } },
    });
    assert.equal(blocked.failures.length, 4);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('les preuves qualité sont exécutées sur le chemin CI sans ajouter de grosse dépendance navigateur', () => {
  const validateScript = fs.readFileSync('scripts/validate-change.cjs', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/build-apk.yml', 'utf8');
  const remoteWorkflow = fs.readFileSync('.github/workflows/agent-remote-validate.yml', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.match(validateScript, /quality-bundle-budget\.cjs/);
  assert.match(validateScript, /SEENIT_QUALITY_BUNDLE_SECONDS/);
  assert.match(workflow, /Run PWA Browser Quality Gate/);
  assert.match(workflow, /node scripts\/pwa-browser-smoke\.cjs/);
  assert.match(workflow, /SeenIt-Quality-Gates-/);
  assert.match(workflow, /quality-reports/);
  assert.match(remoteWorkflow, /Run PWA Browser Quality Gate/);
  assert.match(remoteWorkflow, /SeenIt-Agent-Quality-Gates-/);
  assert.equal(Boolean(packageJson.devDependencies?.playwright || packageJson.devDependencies?.puppeteer), false);

  const browserSmoke = fs.readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8');
  assert.match(
    browserSmoke,
    /listenForDevtools\(processHandle, timeoutMs = 30_000\)/,
    'Chrome dispose de 30 s pour publier DevTools afin d’éviter les faux rouges de démarrage CI',
  );
});


test('SEENIT-UX-009 exécute un rendu navigateur avant/après des actions communes', () => {
  const browserSmoke = fs.readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8');
  const fixture = fs.readFileSync('tests/fixtures/seenitCheckButton.issue180.before.tsx', 'utf8');

  assert.match(browserSmoke, /buildComponentActionHarness/);
  assert.match(browserSmoke, /testComponentActionHarness/);
  assert.match(browserSmoke, /component-actions-before-after-\$\{viewport\.id\}\.png/);
  assert.match(browserSmoke, /legacyClicks !== 2/);
  assert.match(browserSmoke, /pendingState\.count !== 1/);
  assert.match(browserSmoke, /Marquer comme non vu/);
  assert.match(browserSmoke, /metrics\.before\.width >= minTouchTargetCssPx/);
  assert.match(fixture, /setTimeout\(\(\) => setIsTapped\(false\), 1200\)/);
});

test('le smoke Android applique les budgets de démarrage et publie leur preuve', () => {
  const smoke = fs.readFileSync('scripts/android-upgrade-smoke.sh', 'utf8');
  assert.match(smoke, /quality-gates\.json/);
  assert.match(smoke, /coldStartMs/);
  assert.match(smoke, /resumeMs/);
  assert.match(smoke, /performance\.txt/);
  assert.match(smoke, /cold start Android/);
  assert.match(smoke, /reprise Android/);
});
