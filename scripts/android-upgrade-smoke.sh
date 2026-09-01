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

mkdir -p "$REPORT_DIR"

collect_diagnostics() {
  adb shell dumpsys package "$PACKAGE_ID" > "$REPORT_DIR/package.txt" 2>&1 || true
  adb logcat -d > "$REPORT_DIR/logcat.txt" 2>&1 || true
  adb exec-out screencap -p > "$REPORT_DIR/final-screen.png" 2>/dev/null || true
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

apk_field() {
  local apk="$1"
  local field="$2"
  local badging
  local package_line
  badging="$("$AAPT" dump badging "$apk")"
  package_line="${badging%%$'\n'*}"
  sed -n "s/^package:.*${field}='\([^']*\)'.*/\1/p" <<< "$package_line"
}

apk_signer() {
  local certificates
  certificates="$("$APKSIGNER" verify --print-certs "$1")"
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$certificates" \
    | tr '[:upper:]' '[:lower:]'
}

preflight_failure() {
  echo "[APK Upgrade] Échec préflight : $1" | tee -a "$REPORT_DIR/preflight.txt" >&2
  exit 1
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

BASELINE_PACKAGE="$(apk_field "$BASELINE_APK" name)"
CURRENT_PACKAGE="$(apk_field "$CURRENT_APK" name)"
BASELINE_CODE="$(apk_field "$BASELINE_APK" versionCode)"
CURRENT_CODE="$(apk_field "$CURRENT_APK" versionCode)"
BASELINE_VERSION="$(apk_field "$BASELINE_APK" versionName)"
CURRENT_VERSION="$(apk_field "$CURRENT_APK" versionName)"
BASELINE_SIGNER="$(apk_signer "$BASELINE_APK")"
CURRENT_SIGNER="$(apk_signer "$CURRENT_APK")"

{
  echo "Baseline package=$BASELINE_PACKAGE version=$BASELINE_VERSION code=$BASELINE_CODE signer=$BASELINE_SIGNER"
  echo "Candidate package=$CURRENT_PACKAGE version=$CURRENT_VERSION code=$CURRENT_CODE signer=$CURRENT_SIGNER"
} | tee "$REPORT_DIR/preflight.txt"

require_equal "Package baseline" "$BASELINE_PACKAGE" "$PACKAGE_ID"
require_equal "Package candidat" "$CURRENT_PACKAGE" "$PACKAGE_ID"
require_nonempty "Signature baseline" "$BASELINE_SIGNER"
require_equal "Signature candidate" "$CURRENT_SIGNER" "$BASELINE_SIGNER"
[[ "$BASELINE_CODE" =~ ^[0-9]+$ ]] || preflight_failure "versionCode baseline invalide ('$BASELINE_CODE')."
[[ "$CURRENT_CODE" =~ ^[0-9]+$ ]] || preflight_failure "versionCode candidat invalide ('$CURRENT_CODE')."
(( CURRENT_CODE > BASELINE_CODE )) \
  || preflight_failure "versionCode candidat $CURRENT_CODE non supérieur à $BASELINE_CODE."
require_nonempty "versionName baseline" "$BASELINE_VERSION"
require_nonempty "versionName candidat" "$CURRENT_VERSION"
[[ "$CURRENT_VERSION" != "$BASELINE_VERSION" ]] \
  || preflight_failure "versionName candidat identique à la baseline ('$CURRENT_VERSION')."

adb wait-for-device
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

adb install -r -t "$BASELINE_APK" | tee "$REPORT_DIR/install-baseline.txt"
grep -q '^Success' "$REPORT_DIR/install-baseline.txt"

if [ "$API_LEVEL" -ge 33 ]; then
  adb shell pm grant "$PACKAGE_ID" android.permission.POST_NOTIFICATIONS
fi

adb install -r -t "$TEST_APK" | tee "$REPORT_DIR/install-test-harness.txt"
grep -q '^Success' "$REPORT_DIR/install-test-harness.txt"

adb shell am instrument -w -r \
  -e class "$TEST_CLASS#seedUpgradeState" \
  "$TEST_RUNNER" | tee "$REPORT_DIR/instrumentation-seed.txt"
grep -q '^OK (1 test)' "$REPORT_DIR/instrumentation-seed.txt"

# Le -r est intentionnel : la nouvelle APK remplace N sans désinstaller l'application ni ses données.
adb install -r -t "$CURRENT_APK" | tee "$REPORT_DIR/install-upgrade.txt"
grep -q '^Success' "$REPORT_DIR/install-upgrade.txt"

adb shell am instrument -w -r \
  -e class "$TEST_CLASS#verifyUpgradeStateAndNativeContracts" \
  "$TEST_RUNNER" | tee "$REPORT_DIR/instrumentation-verify.txt"
grep -q '^OK (1 test)' "$REPORT_DIR/instrumentation-verify.txt"

adb logcat -c
adb shell am force-stop "$PACKAGE_ID"
adb shell am start -W -n "$PACKAGE_ID/.MainActivity" | tee "$REPORT_DIR/cold-start.txt"
grep -q 'Status: ok' "$REPORT_DIR/cold-start.txt"

adb shell input keyevent KEYCODE_HOME
adb shell am start -W -n "$PACKAGE_ID/.MainActivity" | tee "$REPORT_DIR/resume.txt"
grep -q 'Status: ok' "$REPORT_DIR/resume.txt"

adb shell am start -W -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d 'com.seenit.app://upgrade-smoke' "$PACKAGE_ID" | tee "$REPORT_DIR/deep-link.txt"
grep -q 'Status: ok' "$REPORT_DIR/deep-link.txt"

adb shell input keyevent KEYCODE_BACK
sleep 1
adb logcat -d > "$REPORT_DIR/runtime-logcat.txt"
if grep -A 8 'FATAL EXCEPTION' "$REPORT_DIR/runtime-logcat.txt" | grep -q "Process: $PACKAGE_ID"; then
  echo "Crash SeenIt détecté pendant le cycle démarrage/reprise/Retour."
  exit 1
fi

{
  echo "# Smoke de mise à jour APK"
  echo
  echo "- API Android : $API_LEVEL"
  echo "- Baseline : $BASELINE_VERSION ($BASELINE_CODE)"
  echo "- Version testée : $CURRENT_VERSION ($CURRENT_CODE)"
  echo "- Package : $PACKAGE_ID"
  echo "- Signature conservée : $CURRENT_SIGNER"
  echo "- Résultat : installation N → N+1, données/session, icône, notifications, deep link et cycle de vie validés"
} > "$REPORT_DIR/summary.md"

echo "[APK Upgrade] Android $API_LEVEL : v$BASELINE_VERSION → v$CURRENT_VERSION validé."
