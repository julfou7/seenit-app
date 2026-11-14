import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nativePatchSource = readFileSync('scripts/patch-local-notifications.cjs', 'utf8').replace(/\r\n/g, '\n');
const plexWorker = readFileSync(
  'android/app/src/main/java/com/seenit/app/PlexAvailabilityWorker.java',
  'utf8'
).replace(/\r\n/g, '\n');

test('SEENIT-NOTIFICATION-002 et #443 conservent l’affiche complète sans doublon visuel Android', () => {
  assert.match(nativePatchSource, /fitSeenItBitmapInside\(/);
  assert.match(
    nativePatchSource,
    /Math\.min\([\s\S]*?targetWidth\.toFloat\(\) \/ source\.width\.toFloat\(\)[\s\S]*?targetHeight\.toFloat\(\) \/ source\.height\.toFloat\(\)/
  );
  assert.ok(nativePatchSource.includes('fitSeenItBitmapInside(source, 192, 192)'));
  assert.ok(nativePatchSource.includes('fitSeenItBitmapInside(source, 512, 288)'));
  assert.ok(
    nativePatchSource.split('.bigLargeIcon(null as android.graphics.Bitmap?)').length - 1 >= 4,
    'les chemins immédiat et AlarmManager, y compris leur migration, doivent masquer le largeIcon dans l’état développé'
  );
  assert.doesNotMatch(
    nativePatchSource,
    /Bitmap\.createScaledBitmap\([^\n]+targetWidth[^\n]+targetHeight/,
    'aucune affiche ne doit être étirée directement aux dimensions du cadre'
  );
});

test('SEENIT-NOTIFICATION-003 et #443 appliquent le même contain au post-import Plex', () => {
  assert.ok(plexWorker.includes('fitPosterInside(poster, 160, 160)'));
  assert.ok(plexWorker.includes('fitPosterInside(poster, 512, 288)'));
  assert.ok(plexWorker.includes('new NotificationCompat.BigPictureStyle()'));
  assert.ok(plexWorker.includes('.bigLargeIcon((Bitmap) null)'));
  assert.match(
    plexWorker,
    /Math\.min\([\s\S]*?targetWidth \/ \(float\) source\.getWidth\(\)[\s\S]*?targetHeight \/ \(float\) source\.getHeight\(\)/
  );
  assert.doesNotMatch(plexWorker, /Bitmap\.createScaledBitmap\(/);
  assert.ok(plexWorker.includes('if (poster == null && backdrop == null) return;'));
  assert.match(plexWorker, /applyPoster\(\s*builder,\s*NotificationPosterCache\.read\(context, message\.get\("posterUrl"\)\),\s*NotificationPosterCache\.read\(context, message\.get\("backdropUrl"\)\),\s*compactText\s*\)/);
  assert.ok(plexWorker.includes('applyPoster(builder, poster, backdrop, "La copie exacte est maintenant indexée par Plex.")'));
  assert.ok(plexWorker.includes('.setStyle(new NotificationCompat.BigTextStyle().bigText(compactText))'));
});

test('#443 décision du 06/11 : notification développée en image paysage, affiche entière en petit', () => {
  const applyPoster = plexWorker.slice(plexWorker.indexOf('private static void applyPoster('), plexWorker.indexOf('private static Bitmap fillLandscape('));
  // Repliée : l'affiche reste en contain ; développée : le backdrop prime, l'affiche n'est qu'un repli.
  assert.match(applyPoster, /if \(poster != null\) builder\.setLargeIcon\(fitPosterInside\(poster, 160, 160\)\)/);
  assert.match(applyPoster, /backdrop != null\s*\?\s*fillLandscape\(backdrop, 512, 288\)\s*:\s*fitPosterInside\(poster, 512, 288\)/);
  assert.match(applyPoster, /\.bigLargeIcon\(\(Bitmap\) null\)/, 'un seul grand visuel en état développé');
  // Cover sans étirement : même échelle sur les deux axes, la plus grande des deux.
  const fill = plexWorker.slice(plexWorker.indexOf('private static Bitmap fillLandscape('));
  assert.match(fill, /Math\.max\([\s\S]*?targetWidth \/ \(float\) source\.getWidth\(\)[\s\S]*?targetHeight \/ \(float\) source\.getHeight\(\)/);
  // L'image paysage suit le même transport que l'affiche : URL TMDB bornée, cache privé, aucun octet dans WorkManager.
  assert.match(plexWorker, /\.putString\("backdropUrl", NotificationPosterCache\.allowed\(message\.get\("backdropUrl"\)\)/);
  assert.match(plexWorker, /"posterUrl", "backdropUrl" \}/, 'le reçu enrichi transmet aussi l’image paysage');
  const cache = readFileSync('android/app/src/main/java/com/seenit/app/NotificationPosterCache.java', 'utf8');
  assert.match(cache, /\/t\/p\/\(w342\|w780\)\//);
});
