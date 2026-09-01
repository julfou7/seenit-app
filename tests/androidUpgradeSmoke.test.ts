import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  selectPreviousRelease,
  verifyArtifactPair
} = require('../scripts/download-upgrade-baseline.cjs') as {
  selectPreviousRelease: (releases: unknown[], currentVersion: string) => {
    version: string;
    apk: { name: string; digest?: string };
  };
  verifyArtifactPair: (
    apk: Buffer,
    checksum: Buffer,
    asset: { digest?: string }
  ) => string;
};

const release = (version: string, options: { draft?: boolean; prerelease?: boolean } = {}) => ({
  tag_name: `v${version}`,
  draft: options.draft ?? false,
  prerelease: options.prerelease ?? false,
  assets: [
    { name: `SeenIt-v${version}.apk`, url: `https://api.github.test/${version}/apk` },
    { name: `SeenIt-v${version}.apk.sha256`, url: `https://api.github.test/${version}/sha` }
  ]
});

test('SEENIT-APK-003 sélectionne uniquement la dernière release strictement antérieure et vérifiée', () => {
  const selected = selectPreviousRelease([
    release('1.4.86'),
    release('1.4.88'),
    release('1.4.87'),
    release('1.5.0', { prerelease: true }),
    release('not-semver')
  ], '1.4.88');
  assert.equal(selected.version, '1.4.87');
  assert.equal(selected.apk.name, 'SeenIt-v1.4.87.apk');
});

test('SEENIT-APK-003 bloque toute baseline APK dont l’empreinte est incohérente', () => {
  const apk = Buffer.from('apk-seenit-fiable');
  const digest = crypto.createHash('sha256').update(apk).digest('hex');
  const checksum = Buffer.from(`${digest}  SeenIt-v1.4.87.apk\n`);
  assert.equal(verifyArtifactPair(apk, checksum, { digest: `sha256:${digest}` }), digest);
  assert.throws(
    () => verifyArtifactPair(Buffer.from('apk-altérée'), checksum, { digest: `sha256:${digest}` }),
    /Empreinte APK baseline invalide/
  );
});

test('SEENIT-APK-003 installe réellement N puis N+1 sans désinstaller les données', () => {
  const smoke = fs.readFileSync('scripts/android-upgrade-smoke.sh', 'utf8');
  const instrumentation = fs.readFileSync(
    'android/app/src/androidTest/java/com/seenit/app/UpgradeContractInstrumentedTest.java',
    'utf8'
  );

  assert.match(smoke, /adb install -r -t "\$BASELINE_APK"/);
  assert.match(smoke, /adb install -r -t "\$CURRENT_APK"/);
  assert.doesNotMatch(smoke, /adb\s+uninstall/);
  assert.match(smoke, /BASELINE_SIGNER.*CURRENT_SIGNER/s);
  assert.match(smoke, /cold-start\.txt/);
  assert.match(smoke, /resume\.txt/);
  assert.match(smoke, /deep-link\.txt/);

  assert.match(instrumentation, /seenit-upgrade-private-data-probe/);
  assert.match(instrumentation, /firebase_auth_session_probe/);
  assert.match(instrumentation, /getApplicationIcon/);
  assert.match(instrumentation, /POST_NOTIFICATIONS/);
  assert.match(instrumentation, /com\.seenit\.app:\/\/upgrade-smoke/);
});

test('SEENIT-APK-003 exécute le smoke sur Android 12 et la cible Android courante avant publication', () => {
  const workflow = fs.readFileSync('.github/workflows/build-apk.yml', 'utf8');
  assert.match(workflow, /android_upgrade_smoke:/);
  assert.match(workflow, /api-level: \[31, 36\]/);
  assert.match(
    workflow,
    /reactivecircus\/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d # v2\.38\.0/
  );
  assert.match(workflow, /:app:assembleDebug :app:assembleDebugAndroidTest/);
  assert.doesNotMatch(workflow, /\.\/gradlew --no-daemon assembleDebug assembleDebugAndroidTest/);
  assert.match(workflow, /needs: \[build, android_upgrade_smoke\]/);
  assert.match(workflow, /SeenIt-APK-Upgrade-Smoke-Android-/);
});
