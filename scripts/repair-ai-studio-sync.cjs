const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const VERSION = '1.4.100';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

const gradlePath = 'android/app/build.gradle';
let gradle = read(gradlePath);
if (!/versionName\s+["']\d+\.\d+\.\d+["']/.test(gradle)) {
  throw new Error('versionName Android introuvable');
}
gradle = gradle.replace(/versionName\s+["']\d+\.\d+\.\d+["']/, `versionName "${VERSION}"`);
write(gradlePath, gradle);

execFileSync(process.execPath, ['scripts/sync-app-version.cjs'], { stdio: 'inherit' });

const testPath = 'tests/firebaseIdentityGuardrails.test.ts';
let tests = read(testPath);
const testName = 'SEENIT-QUALITY-005 protège les fichiers Android suivis et les droits exécutables';
if (!tests.includes(testName)) {
  tests += `\n\ntest('${testName}', () => {\n`;
  tests += `  assert.equal(fs.existsSync('android/app/google-services.json'), true, 'google-services.json doit rester suivi');\n`;
  tests += `  assert.equal(fs.existsSync('android/app/debug.keystore'), true, 'la clé de signature historique doit rester suivie');\n`;
  tests += `  if (process.platform !== 'win32') {\n`;
  tests += `    for (const path of ['android/gradlew', 'scripts/pull.sh']) {\n`;
  tests += `      assert.notEqual(fs.statSync(path).mode & 0o111, 0, \\`${'${path}'} doit rester exécutable dans Git\\`);\n`;
  tests += `    }\n`;
  tests += `  }\n`;
  tests += `});\n`;
  write(testPath, tests);
}

const requirementsPath = 'docs/specifications/requirements.json';
const requirements = JSON.parse(read(requirementsPath));
const quality = requirements.requirements.find(item => item.id === 'SEENIT-QUALITY-005');
if (!quality) throw new Error('SEENIT-QUALITY-005 introuvable');
quality.tests ||= [];
if (!quality.tests.some(item => item.contains === testName)) {
  quality.tests.push({ file: testPath, contains: testName });
}
write(requirementsPath, `${JSON.stringify(requirements, null, 2)}\n`);

const specPath = 'docs/specifications/seenit.md';
let spec = read(specPath);
const anchor = "  réintroduire silencieusement.";
const addition = "  réintroduire silencieusement. Les fichiers Android canoniques suivis (`google-services.json`, clé de\\n  signature historique) doivent rester présents et les scripts Unix requis au build doivent conserver leur bit\\n  exécutable ; une normalisation AI Studio de ces éléments est une régression bloquante.";
if (!spec.includes('une normalisation AI Studio de ces éléments est une régression bloquante')) {
  if (!spec.includes(anchor)) throw new Error('Ancre SEENIT-QUALITY-005 introuvable dans la SPEC');
  spec = spec.replace(anchor, addition);
  write(specPath, spec);
}

console.log(`[Repair] SeenIt ${VERSION} aligné avec garde-fous AI Studio.`);
