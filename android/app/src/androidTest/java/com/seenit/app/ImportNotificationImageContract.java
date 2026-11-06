package com.seenit.app;

import static org.junit.Assert.*;
import android.app.Notification;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.drawable.BitmapDrawable;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Map;

/** Exécuté par le smoke natif : vrai builder, vrai cache disque et vrais styles Android. */
final class ImportNotificationImageContract {
    static void verify(Context context) throws Exception {
        String url = "https://image.tmdb.org/t/p/w342/seenit_native_contract.png";
        File cached = NotificationPosterCache.file(context, url);
        assertNotNull(cached);
        assertEquals("48421796.img", cached.getName()); // Identique au cache notificationMedia.ts.
        Map<String, String> message = new HashMap<>();
        message.put("tmdbId", "42");
        message.put("mediaType", "movie");
        message.put("title", "Film de contrôle");
        message.put("eventKey", "native-image-contract");
        message.put("posterUrl", url);
        message.put("ownerUidHash", "0123456789abcdef");
        try {
            if (cached.exists()) assertTrue(cached.delete());
            assertNull(NotificationPosterCache.read(context, url));
            Notification text = PlexAvailabilityWorker.buildImportNotification(context, message).build();
            assertNull(text.getLargeIcon());
            assertEquals("Import Plex terminé", text.extras.getCharSequence(Notification.EXTRA_TEXT).toString());
            assertNotNull(text.contentIntent);
            assertTrue(cached.getParentFile().isDirectory() || cached.getParentFile().mkdirs());
            Bitmap source = Bitmap.createBitmap(40, 80, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(source);
            canvas.drawColor(Color.BLUE);
            Paint paint = new Paint();
            paint.setColor(Color.RED);
            canvas.drawRect(0, 40, 40, 80, paint);
            try (FileOutputStream output = new FileOutputStream(cached)) { assertTrue(source.compress(Bitmap.CompressFormat.PNG, 100, output)); }
            source.recycle();
            assertTrue(NotificationPosterCache.warm(context, url)); // Cache valide : aucun accès réseau.
            Notification rich = PlexAvailabilityWorker.buildImportNotification(context, message).build();
            assertEquals(text.contentIntent, rich.contentIntent);
            assertTrue((rich.flags & Notification.FLAG_ONLY_ALERT_ONCE) != 0);
            assertNotNull(rich.getLargeIcon());
            Bitmap compact = ((BitmapDrawable) rich.getLargeIcon().loadDrawable(context)).getBitmap();
            assertEquals(160, compact.getWidth());
            assertEquals(160, compact.getHeight());
            assertEquals(Color.BLUE, compact.getPixel(80, 2));
            assertEquals(Color.RED, compact.getPixel(80, 157));
            assertEquals(0xFF18181B, compact.getPixel(2, 80));
            Bitmap picture = rich.extras.getParcelable(Notification.EXTRA_PICTURE);
            assertNotNull(picture);
            assertEquals(512, picture.getWidth());
            assertEquals(288, picture.getHeight());
            assertNull(rich.extras.getParcelable("android.largeIcon.big"));
            assertEquals("Film de contrôle", rich.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
            assertEquals("Import Plex terminé", rich.extras.getCharSequence(Notification.EXTRA_TEXT).toString());
            assertEquals("import", rich.extras.getString("downloadPhase"));
            try (FileOutputStream output = new FileOutputStream(cached)) { output.write(new byte[] { 1, 2, 3 }); }
            assertNull(NotificationPosterCache.read(context, url));
            assertNull(PlexAvailabilityWorker.buildImportNotification(context, message).build().getLargeIcon());
            try (FileOutputStream output = new FileOutputStream(cached)) { output.write(new byte[NotificationPosterCache.MAX_BYTES + 1]); }
            assertNull(NotificationPosterCache.read(context, url));
            for (String invalid : new String[] { "http://image.tmdb.org/t/p/w342/a.jpg", "https://evil.example/a.jpg", "https://image.tmdb.org/t/p/w342/../a.jpg", "file:///tmp/a.png", "https://image.tmdb.org:443/t/p/w342/a.jpg" }) {
                assertFalse(NotificationPosterCache.allowed(invalid));
                assertFalse(NotificationPosterCache.warm(context, invalid));
                assertNull(NotificationPosterCache.read(context, invalid));
            }
        } finally { if (cached.exists()) assertTrue(cached.delete()); }
    }
}
