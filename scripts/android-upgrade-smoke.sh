#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE_ID="com.seenit.app"
TEST_RUNNER="com.seenit.app.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS="com.seenit.app.UpgradeContractInstrumentedTest"
BASELINE_APK="${1:?APK baseline manquant}"
CURRENT_APK="${2:?APK courante manquante}"
TEST_APK="${3:?APK de test instrumenté manquante}"
REPORT_DIR="${4:?Répertoire de rapport manquant}"
API_LEVEL="${5:?Niveau API manquant}"
ADB_TIMEOUT_SECONDS="${ADB_TIMEOUT_SECONDS:-60}"
ADB_DIAGNOSTIC_TIMEOUT_SECONDS="${ADB_DIAGNOSTIC_TIMEOUT_SECONDS:-10}"

mkdir -p "$REPORT_DIR"

adb_bounded() {
  timeout --foreground "${ADB_TIMEOUT_SECONDS}s" adb "$@"
}

collect_diagnostics() {
  timeout --foreground "${ADB_DIAGNOSTIC_TIMEOUT_SECONDS}s" adb shell dumpsys package "$PACKAGE_ID" > "$REPORT_DIR/package.txt" 2>&1 || true
  timeout --foreground "${ADB_DIAGNOSTIC_TIMEOUT_SECONDS}s" adb logcat -d > "$REPORT_DIR/logcat.txt" 2>&1 || true
  timeout --foreground "${ADB_DIAGNOSTIC_TIMEOUT_SECONDS}s" adb exec-out screencap -p > "$REPORT_DIR/final-screen.png" 2>/dev/null || true
}
trap collect_diagnostics EXIT

for file in "$BASELINE_APK" "$CURRENT_APK" "$TEST_APK"; do
  test -s "$file" || { echo "Artefact APK absent ou vide : $file"; exit 1; }
done

BUILD_TOOLS_DIR="$(find "$ANDROID_SDK_ROOT/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
APKSIGNER="$BUILD_TOOLS_DIR/apksigner"
AAPT="$BUILD_TOOLS_DIR/aapt"
test -x "$APKSIGNER" || { echo "apksigner introuvable"; exit 1; }
test -x "$AAPT" || { echo "aapt introuvable"; exit 1; }

preflight_failure() {
  echo "[APK Upgrade] Échec préflight : $1" | tee -a "$REPORT_DIR/preflight.txt" >&2
  exit 1
}

apk_field() {
  local apk="$1"
  local field="$2"
  local label="$3"
  local badging
  local package_line
  if ! badging="$("$AAPT" dump badging "$apk" 2>&1)"; then
    printf '%s\n' "$badging" > "$REPORT_DIR/aapt-$label.txt"
    preflight_failure "aapt n’a pas pu lire l’APK $label."
  fi
  printf '%s\n' "$badging" > "$REPORT_DIR/aapt-$label.txt"
  package_line="${badging%%$'\n'*}"
  # L’espace avant l’attribut est obligatoire : `name` ne doit jamais capturer
  # le suffixe de `compileSdkVersionCodename`.
  sed -n "s/^package:.*[[:space:]]${field}='\([^']*\)'.*/\1/p" <<< "$package_line"
}

apk_signer() {
  local apk="$1"
  local label="$2"
  local certificates
  local digest
  if ! certificates="$("$APKSIGNER" verify --print-certs "$apk" 2>&1)"; then
    printf '%s\n' "$certificates" > "$REPORT_DIR/apksigner-$label.txt"
    preflight_failure "apksigner n’a pas pu vérifier l’APK $label."
  fi
  printf '%s\n' "$certificates" > "$REPORT_DIR/apksigner-$label.txt"
  digest="$(sed -n 's/^.*certificate SHA-256 digest:[[:space:]]*//p' <<< "$certificates")"
  digest="${digest%%$'\n'*}"
  digest="${digest//$'\r'/}"
  printf '%s' "${digest,,}"
}

require_equal() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  [[ "$actual" == "$expected" ]] \
    || preflight_failure "$label inattendu ('$actual', attendu '$expected')."
}

require_nonempty() {
  local label="$1"
  local actual="$2"
  [[ -n "$actual" ]] || preflight_failure "$label absent."
}

SIGNING_MIGRATION_MODE="$(node -p "require('./docs/specifications/android-contract.json').signing.migration.mode")"
LEGACY_SIGNER="$(node -p "require('./docs/specifications/android-contract.json').signing.migration.legacySignerSha256")"
EXPECTED_CURRENT_SIGNER="$(node -p "require('./docs/specifications/android-contract.json').signing.migration.currentSignerSha256")"

BASELINE_PACKAGE="$(apk_field "$BASELINE_APK" name baseline)"
CURRENT_PACKAGE="$(apk_field "$CURRENT_APK" name candidate)"
BASELINE_CODE="$(apk_field "$BASELINE_APK" versionCode baseline)"
CURRENT_CODE="$(apk_field "$CURRENT_APK" versionCode candidate)"
BASELINE_VERSION="$(apk_field "$BASELINE_APK" versionName baseline)"
CURRENT_VERSION="$(apk_field "$CURRENT_APK" versionName candidate)"
BASELINE_SIGNER="$(apk_signer "$BASELINE_APK" baseline)"
CURRENT_SIGNER="$(apk_signer "$CURRENT_APK" candidate)"

{
  echo "Baseline package=$BASELINE_PACKAGE version=$BASELINE_VERSION code=$BASELINE_CODE signer=$BASELINE_SIGNER"
  echo "Candidate package=$CURRENT_PACKAGE version=$CURRENT_VERSION code=$CURRENT_CODE signer=$CURRENT_SIGNER"
  echo "Signer release attendu=$EXPECTED_CURRENT_SIGNER legacy=$LEGACY_SIGNER mode=$SIGNING_MIGRATION_MODE"
} | tee "$REPORT_DIR/preflight.txt"

require_equal "Package baseline" "$BASELINE_PACKAGE" "$PACKAGE_ID"
require_equal "Package candidat" "$CURRENT_PACKAGE" "$PACKAGE_ID"
require_nonempty "Signature baseline" "$BASELINE_SIGNER"
require_equal "Signature candidate" "$CURRENT_SIGNER" "$EXPECTED_CURRENT_SIGNER"
[[ "$BASELINE_CODE" =~ ^[0-9]+$ ]] || preflight_failure "versionCode baseline invalide ('$BASELINE_CODE')."
[[ "$CURRENT_CODE" =~ ^[0-9]+$ ]] || preflight_failure "versionCode candidat invalide ('$CURRENT_CODE')."
(( CURRENT_CODE > BASELINE_CODE )) \
  || preflight_failure "versionCode candidat $CURRENT_CODE non supérieur à $BASELINE_CODE."
require_nonempty "versionName baseline" "$BASELINE_VERSION"
require_nonempty "versionName candidat" "$CURRENT_VERSION"
[[ "$CURRENT_VERSION" != "$BASELINE_VERSION" ]] \
  || preflight_failure "versionName candidat identique à la baseline ('$CURRENT_VERSION')."

if [[ "$BASELINE_SIGNER" == "$EXPECTED_CURRENT_SIGNER" ]]; then
  SMOKE_MODE="upgrade-in-place"
elif [[ "$SIGNING_MIGRATION_MODE" == "reinstall-once" && "$BASELINE_SIGNER" == "$LEGACY_SIGNER" ]]; then
  SMOKE_MODE="signature-rotation-reinstall"
else
  preflight_failure "signature baseline non autorisée pour la candidate release ('$BASELINE_SIGNER')."
fi

echo "Mode de smoke=$SMOKE_MODE" | tee -a "$REPORT_DIR/preflight.txt"

adb_bounded wait-for-device
adb_bounded shell settings put global window_animation_scale 0
adb_bounded shell settings put global transition_animation_scale 0
adb_bounded shell settings put global animator_duration_scale 0

adb_bounded install -r -t "$BASELINE_APK" | tee "$REPORT_DIR/install-baseline.txt"
grep -q '^Success' "$REPORT_DIR/install-baseline.txt"

if [[ "$SMOKE_MODE" == "upgrade-in-place" ]]; then
  if [ "$API_LEVEL" -ge 33 ]; then
    adb_bounded shell pm grant "$PACKAGE_ID" android.permission.POST_NOTIFICATIONS
  fi

  adb_bounded install -r -t "$TEST_APK" | tee "$REPORT_DIR/install-test-harness.txt"
  grep -q '^Success' "$REPORT_DIR/install-test-harness.txt"

  adb_bounded shell am instrument -w -r \
    -e class "$TEST_CLASS#seedUpgradeState" \
    "$TEST_RUNNER" | tee "$REPORT_DIR/instrumentation-seed.txt"
  grep -q '^OK (1 test)' "$REPORT_DIR/instrumentation-seed.txt"

  # Le -r est intentionnel : après la rotation initiale, N+1 doit remplacer N sans supprimer les données.
  adb_bounded install -r -t "$CURRENT_APK" | tee "$REPORT_DIR/install-upgrade.txt"
  grep -q '^Success' "$REPORT_DIR/install-upgrade.txt"

  adb_bounded shell am instrument -w -r \
    -e class "$TEST_CLASS#verifyUpgradeStateAndNativeContracts" \
    "$TEST_RUNNER" | tee "$REPORT_DIR/instrumentation-verify.txt"
  grep -q '^OK (1 test)' "$REPORT_DIR/instrumentation-verify.txt"
else
  # La seule transition de signature autorisée doit d'abord prouver qu'Android refuse la mise à jour sur place.
  if adb_bounded install -r -t "$CURRENT_APK" > "$REPORT_DIR/install-rotation-rejected.txt" 2>&1; then
    cat "$REPORT_DIR/install-rotation-rejected.txt"
    preflight_failure "Android a accepté à tort une mise à jour sur place entre les deux signatures."
  fi
  cat "$REPORT_DIR/install-rotation-rejected.txt"
  if ! grep -Eqi 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures.*do not match|signature.*mismatch' "$REPORT_DIR/install-rotation-rejected.txt"; then
    preflight_failure "le refus de mise à jour n'est pas explicitement attribué au changement de signature."
  fi

  adb_bounded uninstall "$PACKAGE_ID" | tee "$REPORT_DIR/uninstall-legacy.txt"
  grep -q '^Success' "$REPORT_DIR/uninstall-legacy.txt"

  adb_bounded install -t "$CURRENT_APK" | tee "$REPORT_DIR/install-fresh.txt"
  grep -q '^Success' "$REPORT_DIR/install-fresh.txt"

  if [ "$API_LEVEL" -ge 33 ]; then
    adb_bounded shell pm grant "$PACKAGE_ID" android.permission.POST_NOTIFICATIONS
  fi

  adb_bounded install -r -t "$TEST_APK" | tee "$REPORT_DIR/install-test-harness.txt"
  grep -q '^Success' "$REPORT_DIR/install-test-harness.txt"

  adb_bounded shell am instrument -w -r \
    -e class "$TEST_CLASS#verifyFreshInstallNativeContracts" \
    "$TEST_RUNNER" | tee "$REPORT_DIR/instrumentation-fresh.txt"
  grep -q '^OK (1 test)' "$REPORT_DIR/instrumentation-fresh.txt"
fi

adb_bounded logcat -c
adb_bounded shell am force-stop "$PACKAGE_ID"
adb_bounded shell am start -W -n "$PACKAGE_ID/.MainActivity" | tee "$REPORT_DIR/cold-start.txt"
grep -q 'Status: ok' "$REPORT_DIR/cold-start.txt"

adb_bounded shell input keyevent KEYCODE_HOME
adb_bounded shell am start -W -n "$PACKAGE_ID/.MainActivity" | tee "$REPORT_DIR/resume.txt"
grep -q 'Status: ok' "$REPORT_DIR/resume.txt"

adb_bounded shell am start -W -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d 'com.seenit.app://upgrade-smoke' "$PACKAGE_ID" | tee "$REPORT_DIR/deep-link.txt"
grep -q 'Status: ok' "$REPORT_DIR/deep-link.txt"

adb_bounded shell input keyevent KEYCODE_BACK
sleep 1
adb_bounded logcat -d > "$REPORT_DIR/runtime-logcat.txt"
if grep -A 8 'FATAL EXCEPTION' "$REPORT_DIR/runtime-logcat.txt" | grep -q "Process: $PACKAGE_ID"; then
  echo "Crash SeenIt détecté pendant le cycle démarrage/reprise/Retour."
  exit 1
fi

if [[ "$SMOKE_MODE" == "upgrade-in-place" ]]; then
  RESULT_TEXT="installation N → N+1, données/session, icône, notifications, deep link et cycle de vie validés"
else
  RESULT_TEXT="rotation historique → release validée par refus de mise à jour, désinstallation contrôlée, installation fraîche, icône, notifications, deep link et cycle de vie validés"
fi

{
  echo "# Smoke APK SeenIt"
  echo
  echo "- API Android : $API_LEVEL"
  echo "- Baseline : $BASELINE_VERSION ($BASELINE_CODE)"
  echo "- Version testée : $CURRENT_VERSION ($CURRENT_CODE)"
  echo "- Package : $PACKAGE_ID"
  echo "- Signature baseline : $BASELINE_SIGNER"
  echo "- Signature candidate : $CURRENT_SIGNER"
  echo "- Mode : $SMOKE_MODE"
  echo "- Résultat : $RESULT_TEXT"
} > "$REPORT_DIR/summary.md"

echo "[APK Upgrade] Android $API_LEVEL : v$BASELINE_VERSION → v$CURRENT_VERSION validé ($SMOKE_MODE)."
