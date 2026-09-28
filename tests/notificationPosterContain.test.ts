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
  assert.ok(plexWorker.includes('if (poster != null) {'));
  assert.ok(plexWorker.includes('.setStyle(new NotificationCompat.BigTextStyle().bigText("Disponible dans Plex"))'));
});
