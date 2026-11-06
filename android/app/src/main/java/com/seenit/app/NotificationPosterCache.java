package com.seenit.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;

/** Même répertoire et clé FNV-1a que notificationMedia.ts, sans bitmap dans WorkManager. */
final class NotificationPosterCache {
    static final int MAX_BYTES = 512 * 1024;
    private NotificationPosterCache() {}

    static boolean allowed(String url) {
        if (url == null || url.length() > 512) return false;
        try {
            URI parsed = new URI(url);
            return "https".equals(parsed.getScheme()) && "image.tmdb.org".equals(parsed.getHost())
                && parsed.getPort() == -1 && parsed.getRawUserInfo() == null
                && parsed.getRawQuery() == null && parsed.getRawFragment() == null
                && parsed.getRawPath().matches("/t/p/w342/[A-Za-z0-9_-]+\\.(jpg|png|webp)");
        } catch (Exception ignored) { return false; }
    }

    static File file(Context context, String url) throws Exception {
        if (!allowed(url)) return null;
        int hash = 0x811c9dc5;
        for (int index = 0; index < url.length(); index++) hash = (hash ^ url.charAt(index)) * 16777619;
        File root = context.getFilesDir().getCanonicalFile();
        File file = new File(root, "notification-media/" + Integer.toHexString(hash) + ".img").getCanonicalFile();
        return file.getPath().startsWith(root.getPath() + File.separator) ? file : null;
    }

    static Bitmap read(Context context, String url) {
        try {
            File cached = file(context, url);
            if (cached == null || !cached.isFile() || cached.length() <= 0 || cached.length() > MAX_BYTES) return null;
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(cached.getPath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 8192 || bounds.outHeight > 8192) return null;
            int sample = 1;
            while (bounds.outWidth / sample > 512 || bounds.outHeight / sample > 768) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            return BitmapFactory.decodeFile(cached.getPath(), options);
        } catch (Exception ignored) { return null; }
    }

    // Les appels froids sont coalescés ; la lecture du cache dans FCM ne prend jamais ce verrou réseau.
    static synchronized boolean warm(Context context, String url) {
        Bitmap existing = read(context, url);
        if (existing != null) { existing.recycle(); return true; }
        HttpURLConnection connection = null;
        try {
            File target = file(context, url);
            if (target == null) return false;
            connection = (HttpURLConnection) new java.net.URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(2500);
            connection.setReadTimeout(2500);
            connection.setRequestProperty("Accept", "image/*");
            if (connection.getResponseCode() != 200 || connection.getContentLength() > MAX_BYTES) return false;
            byte[] bytes;
            long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (android.os.SystemClock.elapsedRealtime() > deadline || output.size() + count > MAX_BYTES) return false;
                    output.write(buffer, 0, count);
                }
                bytes = output.toByteArray();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 8192 || bounds.outHeight > 8192) return false;
            File directory = target.getParentFile();
            if (!directory.isDirectory() && !directory.mkdirs()) return false;
            long totalBytes = 0;
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) totalBytes += file.length();
            // Ne pas purger les affiches des rappels déjà programmés pour remplir ce cache.
            if (totalBytes + bytes.length > 32L * 1024 * 1024) return false;
            AtomicFile atomic = new AtomicFile(target);
            FileOutputStream output = null;
            try {
                output = atomic.startWrite();
                output.write(bytes);
                atomic.finishWrite(output);
            } catch (Exception error) {
                atomic.failWrite(output);
                return false;
            }
            return true;
        } catch (Exception ignored) { return false; }
        finally { if (connection != null) connection.disconnect(); }
    }
}
