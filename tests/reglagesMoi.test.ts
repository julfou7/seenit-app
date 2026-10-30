import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const core = readFileSync('src/screens/SettingsScreenCore.tsx', 'utf8');
const ui = readFileSync('src/components/settings/SettingsUi.tsx', 'utf8');
const wrapper = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const profile = readFileSync('src/screens/ProfileScreen.tsx', 'utf8');
const quick = readFileSync('src/components/QuickAccountSheet.tsx', 'utf8');
const downloads = readFileSync('src/components/DownloadFeatureSettingsCard.tsx', 'utf8');
const css = readFileSync('src/screens/reglages.css', 'utf8');

test('Réglages · cinq lignes avec leur état, déconnexion confirmée en bas', () => {
  assert.match(core, /<SettingsHeader title="Réglages" onBack=\{onClose\}/);
  for (const label of ['Mes plateformes', 'Notifications', 'Plex', 'Appareils', 'Application']) {
    assert.match(core, new RegExp(`<SettingsRow icon=\\{\\w+\\} label="${label}"`), `ligne ${label}`);
  }
  assert.match(core, /<SettingsGroup title="Connexions">/);
  assert.match(core, /badge=\{hasUpdate && latestRelease \? 'Mise à jour' : undefined\}/);
  assert.match(core, /className="reg-danger" onClick=\{\(\) => setConfirm\('logout'\)\}/);
  assert.match(core, /onConfirm=\{\(\) => \{ setConfirm\(null\); void handleLogout\(\); \}\}/);
  assert.match(core, /<span className="reg-version">SeenIt \{currentVersion\}<\/span>/);
});

test('Réglages · un écran par sujet, un niveau Retour chacun', () => {
  assert.match(core, /type SettingsPage = 'plats' \| 'notifs' \| 'plex' \| 'devices' \| 'compte' \| 'app'/);
  assert.match(core, /<SettingsSubscreen title=\{pages\[page\]\.title\} onClose=\{\(\) => setPage\(null\)\}>/);
  assert.match(ui, /<DialogLayer\s+label=\{title\}\s+onDismiss=\{onClose\}\s+historyMode="local"/);
  assert.match(ui, /event\.stopPropagation\(\)/, 'le swipe du sous-écran ne referme pas tous les Réglages');
  assert.match(ui, /if \(dx > EDGE_SWIPE_DISTANCE && Math\.abs\(touch\.clientY - origin\.y\) < dx\) onClose\(\)/);
  assert.match(ui, /role=\{isToggle \? 'switch' : undefined\}/);
  assert.match(css, /\.reg-back\{[^}]*width:44px;height:44px/);
  assert.match(css, /\.reg-row\{min-height:62px/);
});

test('Réglages · aucune fonction historique ne disparaît', () => {
  for (const wiring of [
    /onClick=\{\(\) => handleTogglePlatform\(platform\.id\)\}/,
    /handleToggleNotif\('release_today_tv'/, /handleToggleNotif\('season_d7'/, /handleToggleNotif\('news'/,
    /handleToggleNotif\('movie_theater'/, /handleToggleNotif\('movie_dvd_vod'/,
    /triggerTestNotif\(test\.type\)/, /NotificationSettings\.open\(\)/, /void handleRequestNotifications\(\)/,
    /onClick=\{handlePlexLogin\}/, /onClick=\{handleCancelPlexLogin\}/, /handlePlexSync\(true\)/, /handlePlexSync\(false\)/,
    /purgeAllPlexSlugsInDb\(\)/, /void handlePlexLogout\(\)/,
    /void handleBackupToCloud\(\)/, /void handleRestoreFromCloud\(\)/, /onClick=\{handleLogin\}/,
    /onClick=\{handleStartUpdate\}/, /onClick=\{handleCheckUpdates\}/, /onClick=\{openVersionNotes\}/,
    /setAnimatedBadges\(!animatedBadges\)/, /<DownloadFeatureSettingsRow \/>/, /<CsvImporter \/>/,
    /void handleForceSync\(\)/, /\{showLogsPanel && <div className="reg-inline">\{logsPanel\}<\/div>\}/,
  ]) assert.match(core, wiring);
  assert.match(downloads, /export function DownloadFeatureSettingsRow\(\)/);
  assert.match(quick, /<DownloadFeatureSettingsCard \/>/, 'les réglages rapides gardent leur carte');
});

test('Réglages · états réels uniquement', () => {
  assert.match(core, /PushNotifications\.checkPermissions\(\)/);
  assert.match(core, /getPlexLastSyncTimestamp\(user\?\.uid\)/);
  assert.match(core, /'plex_last_sync_report_v1'/);
  assert.match(core, /tone: Date\.now\(\) - plexLastSync < PLEX_FRESH_MS \? 'ok' : 'warn'/);
  assert.match(core, /La dissociation se fait depuis la TV/);
  assert.doesNotMatch(core, /TV du salon|Galaxy S25|julian@exemple/);
});

test('Réglages · un seul en-tête dans Moi et dans les réglages rapides', () => {
  assert.match(profile, /<SettingsScreen onClose=\{handleAnimatedBackSettings\} \/>/);
  assert.doesNotMatch(profile, /<ArrowLeft/);
  assert.match(quick, /<SettingsScreen onClose=\{\(\) => closeTopDialog\(\)\} \/>/);
  assert.doesNotMatch(quick, />Retour<\/button>/);
  assert.doesNotMatch(wrapper, /createPortal|querySelector/);
});
