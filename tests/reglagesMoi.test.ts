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
    /void handlePlexLogout\(\)/,
    /void handleBackupToCloud\(\)/, /void handleRestoreFromCloud\(\)/, /onClick=\{handleLogin\}/,
    /onClick=\{handleStartUpdate\}/, /onClick=\{handleCheckUpdates\}/, /onClick=\{openVersionNotes\}/,
    /setAnimatedBadges\(!animatedBadges\)/, /<DownloadFeatureSettingsRow \/>/, /<CsvImporter \/>/,
    /void handleForceSync\(\)/, /\{showLogsPanel && <div className="reg-inline">\{logsPanel\}<\/div>\}/,
  ]) assert.match(core, wiring);
  assert.doesNotMatch(core, /purgeAllPlexSlugsInDb|Vider les liens Plex/, 'les liens Plex en cache ne servent plus');
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

const logStore = readFileSync('src/store/logStore.ts', 'utf8');
const plugin = readFileSync('android/app/src/main/java/com/seenit/app/SeenItNotificationSettingsPlugin.java', 'utf8');
const navCss = readFileSync('src/components/bottomNav.css', 'utf8');
const logos = readFileSync('src/features/providers/platformLogos.ts', 'utf8');

test('SEENIT-NOTIFICATION-006 les Réglages ouvrent le canal Android exact, limité aux canaux SeenIt', () => {
  for (const channel of ['seenit_reminders', 'seenit_downloads', 'seenit_app']) assert.match(core, new RegExp(`channelId: '${channel}'`));
  assert.match(core, /NotificationSettings\.openChannel\(\{ channelId: alert\.channelId \}\)/);
  assert.match(plugin, /public void openChannel\(PluginCall call\)/);
  assert.match(plugin, /Settings\.ACTION_CHANNEL_NOTIFICATION_SETTINGS/);
  assert.match(plugin, /channelId\.matches\("seenit_\[a-z\]\{2,20\}"\)/, 'seuls les canaux SeenIt sont ouverts');
  assert.match(plugin, /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.O/, 'avant Android 8 : écran de l’application');
});

test('Réglages · retours v1.4.238 : journal désactivable, barre visible, vrais logos', () => {
  assert.match(core, /toggle=\{diagnosticsEnabled\} onClick=\{\(\) => setDiagnosticsEnabled\(!diagnosticsEnabled\)\}/);
  assert.match(logStore, /if \(!diagnosticsEnabled && \(actualLevel === 'info' \|\| actualLevel === 'success'\)\) \{/);
  assert.match(logStore, /recordClientOperationalSignal\(quietCode\)/, 'le signal opérationnel reste calculé');

  assert.match(profile, /blocking=\{false\} data-settings-layer=""/);
  assert.match(ui, /blocking=\{false\}\s+data-settings-layer=""/);
  assert.match(navCss, /body:has\(\[data-dialog-layer\]:not\(\[data-settings-layer\]\)\) \.bottom-nav-shell\{display:none\}/);
  assert.match(profile, /window\.addEventListener\('app-close-modals', handleCloseModals\)/);

  assert.match(core, /loadPlatformLogos\(STREAMING_PLATFORMS\.map\(platform => platform\.id\)\)/);
  assert.match(logos, /'\/api\/media\/tmdb\/watch\/providers\/tv\?language=fr-FR&watch_region=FR'/);
  assert.match(core, /onError=\{\(\) => setBrokenLogos/, 'un logo indisponible retombe sur la pastille');
});


test('Accueil · raccourci Plex : rapide ou complète, appui long, point d’état', () => {
  const home = readFileSync('src/components/HomeSyncIndicator.tsx', 'utf8');
  assert.match(home, /const plexConnected = Boolean\(getStoredPlexToken\(uid\)\)/);
  assert.match(home, /if \(!plex && !details && !open && !plexConnected\) return null;/, 'l’icône reste dès que Plex est connecté');
  assert.match(home, /onClick=\{\(\) => \{ setOpen\(false\); void launch\(true\); \}\}>Synchro rapide<\/button>/);
  assert.match(home, /onClick=\{\(\) => \{ setOpen\(false\); void launch\(false\); \}\}>Complète<\/button>/);
  assert.match(home, /const LONG_PRESS_MS = 480;/);
  assert.match(home, /await import\('\.\.\/features\/plex\/syncPlex'\)/, 'le moteur Plex reste hors du bundle de l’accueil');
  assert.match(home, /lastSync && Date\.now\(\) - lastSync < PLEX_FRESH_MS \? 'ok' : 'warn'/);
});
