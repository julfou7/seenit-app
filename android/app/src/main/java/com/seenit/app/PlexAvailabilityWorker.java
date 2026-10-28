package com.seenit.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.seenit.app.PlexBackgroundCredentialStore.Credentials;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class PlexAvailabilityWorker extends Worker {
    public static final String PUSH_TYPE = "PLEX_AVAILABILITY_CHECK";
    private static final String CHANNEL_ID = "seenit_downloads";
    private static final int MAX_ATTEMPTS = 12;

    public PlexAvailabilityWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static void enqueue(Context context, Map<String, String> message) {
        int tmdbId = positiveInt(message.get("tmdbId"));
        String ownerUidHash = clean(message.get("ownerUidHash"), 16);
        String traceId = clean(message.get("traceId"), 36);
        if (tmdbId <= 0 || ownerUidHash.length() != 16) {
            PlexAvailabilityDiagnosticStore.record(
                context, ownerUidHash, traceId, "work_enqueue", "invalid_payload", 0
            );
            return;
        }

        String mediaType = "movie".equals(message.get("mediaType")) ? "movie" : "tv";
        int season = nonNegativeInt(message.get("season"));
        int episode = positiveInt(message.get("episode"));
        String eventKey = clean(message.get("eventKey"), 128);
        if (eventKey.isEmpty()) {
            eventKey = mediaType + ":" + tmdbId + ":" + season + ":" + episode;
        }

        Data input = new Data.Builder()
            .putString("ownerUidHash", ownerUidHash)
            .putString("mediaType", mediaType)
            .putInt("tmdbId", tmdbId)
            .putInt("season", season)
            .putInt("episode", episode)
            .putString("title", clean(message.get("title"), 180))
            .putString("eventKey", eventKey)
            .putString("traceId", traceId)
            .build();

        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(PlexAvailabilityWorker.class)
            .setInputData(input)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
            .addTag("seenit-plex-availability")
            .build();

        String workName = "seenit-plex-availability-" + Integer.toUnsignedString(eventKey.hashCode());
        WorkManager.getInstance(context).enqueueUniqueWork(workName, ExistingWorkPolicy.KEEP, request);
        PlexAvailabilityDiagnosticStore.record(
            context, ownerUidHash, traceId, "work_enqueue", "enqueued", 0
        );
    }

    @NonNull
    @Override
    public Result doWork() {
        String expectedUidHash = getInputData().getString("ownerUidHash");
        int attempt = getRunAttemptCount() + 1;
        recordDiagnostic("worker", "started", attempt);
        if (expectedUidHash == null || expectedUidHash.length() != 16) {
            recordDiagnostic("input", "invalid_payload", attempt);
            return Result.failure();
        }

        boolean canRetry = attempt < MAX_ATTEMPTS;
        Credentials credentials = PlexBackgroundCredentialStore.read(getApplicationContext());
        if (credentials == null) {
            recordDiagnostic("credentials", canRetry ? "missing_retry" : "missing_exhausted", attempt);
            return canRetry ? Result.retry() : Result.success();
        }
        if (!expectedUidHash.equals(credentials.uidHash)) {
            recordDiagnostic("identity", "uid_mismatch", attempt);
            return Result.success();
        }

        int tmdbId = getInputData().getInt("tmdbId", 0);
        String mediaType = getInputData().getString("mediaType");
        int season = getInputData().getInt("season", -1);
        int episode = getInputData().getInt("episode", 0);
        if (tmdbId <= 0 || (!"movie".equals(mediaType) && !"tv".equals(mediaType))) {
            recordDiagnostic("input", "invalid_payload", attempt);
            return Result.failure();
        }

        try {
            AvailabilityMatch match = findAvailabilityMatch(credentials.token, tmdbId, mediaType, season, episode);
            if (match != null) {
                recordDiagnostic("plex_check", "available", attempt);
                recordDiagnostic("notification", showPlexAvailableNotification(match, credentials.token), attempt);
                return Result.success();
            }
            recordDiagnostic(
                "plex_check",
                canRetry ? "not_available_retry" : "not_available_exhausted",
                attempt
            );
        } catch (Exception ignored) {
            recordDiagnostic("plex_check", canRetry ? "error_retry" : "error_exhausted", attempt);
        }

        if (canRetry) return Result.retry();
        return Result.success();
    }

    private void recordDiagnostic(String stage, String outcome, int attempt) {
        PlexAvailabilityDiagnosticStore.record(
            getApplicationContext(),
            getInputData().getString("ownerUidHash"),
            getInputData().getString("traceId"),
            stage,
            outcome,
            attempt
        );
    }

    private AvailabilityMatch findAvailabilityMatch(
        String token,
        int tmdbId,
        String mediaType,
        int season,
        int episode
    ) throws Exception {
        JSONArray resources = fetchJsonArray(
            "https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1",
            token
        );

        for (int resourceIndex = 0; resourceIndex < resources.length(); resourceIndex++) {
            JSONObject resource = resources.optJSONObject(resourceIndex);
            if (resource == null || !resource.optString("provides", "").contains("server")) continue;

            String serverToken = resource.optString("accessToken", token);
            JSONArray connections = resource.optJSONArray("connections");
            if (connections == null) continue;

            for (int connectionIndex = 0; connectionIndex < connections.length(); connectionIndex++) {
                JSONObject connection = connections.optJSONObject(connectionIndex);
                if (connection == null) continue;
                String uri = trimTrailingSlash(connection.optString("uri", ""));
                if (uri.isEmpty()) continue;
                try {
                    AvailabilityMatch match = findAvailabilityOnServer(
                        uri, serverToken, tmdbId, mediaType, season, episode
                    );
                    if (match != null) return match;
                } catch (Exception ignored) {
                    // Essayer la connexion Plex suivante sans transformer une panne en absence.
                }
            }
        }
        return null;
    }

    private AvailabilityMatch findAvailabilityOnServer(
        String serverUri,
        String token,
        int tmdbId,
        String mediaType,
        int season,
        int episode
    ) throws Exception {
        String rawGuid = "tmdb://" + tmdbId;
        String guid = URLEncoder.encode(rawGuid, StandardCharsets.UTF_8);
        String[] endpoints = new String[] {
            serverUri + "/library/all?guid=" + guid + "&includeGuids=1",
            serverUri + "/hubs/search?query=" + guid + "&limit=5&includeGuids=1"
        };

        for (String endpoint : endpoints) {
            JSONObject search;
            try {
                search = fetchJsonObject(endpoint, token);
            } catch (Exception ignored) {
                continue;
            }

            for (JSONObject item : extractItems(search)) {
                String type = item.optString("type", "").toLowerCase();
                if ("movie".equals(mediaType)) {
                    if ("movie".equals(type) && hasExactTmdbGuid(item, tmdbId)) {
                        return new AvailabilityMatch(serverUri, token, item.optString("thumb", ""));
                    }
                    continue;
                }

                if (!("show".equals(type) || "series".equals(type)) || !hasExactTmdbGuid(item, tmdbId)) continue;
                String posterPath = item.optString("thumb", "");
                if (season < 0 || episode <= 0) {
                    return new AvailabilityMatch(serverUri, token, posterPath);
                }

                String ratingKey = item.optString("ratingKey", "").trim();
                if (ratingKey.isEmpty()) continue;

                JSONObject leaves = fetchJsonObject(
                    serverUri + "/library/metadata/" + URLEncoder.encode(ratingKey, StandardCharsets.UTF_8) + "/allLeaves?includeGuids=1",
                    token
                );
                for (JSONObject leaf : extractItems(leaves)) {
                    if (!"episode".equalsIgnoreCase(leaf.optString("type", "episode"))) continue;
                    if (leaf.optInt("parentIndex", -1) == season && leaf.optInt("index", -1) == episode) {
                        return new AvailabilityMatch(serverUri, token, posterPath);
                    }
                }
            }
        }
        return null;
    }

    private static final class AvailabilityMatch {
        final String serverUri;
        final String serverToken;
        final String posterPath;

        AvailabilityMatch(String serverUri, String serverToken, String posterPath) {
            this.serverUri = serverUri;
            this.serverToken = serverToken;
            this.posterPath = posterPath == null ? "" : posterPath.trim();
        }
    }

    private static boolean hasExactTmdbGuid(JSONObject item, int tmdbId) {
        if (matchesTmdbGuid(item.optString("guid", ""), tmdbId)) return true;
        JSONArray guids = item.optJSONArray("Guid");
        if (guids == null) return false;
        for (int index = 0; index < guids.length(); index++) {
            Object value = guids.opt(index);
            String guid = value instanceof JSONObject
                ? ((JSONObject) value).optString("id", "")
                : String.valueOf(value);
            if (matchesTmdbGuid(guid, tmdbId)) return true;
        }
        return false;
    }

    private static boolean matchesTmdbGuid(String rawGuid, int tmdbId) {
        if (rawGuid == null) return false;
        String guid = rawGuid.trim().toLowerCase();
        int query = guid.indexOf('?');
        if (query >= 0) guid = guid.substring(0, query);
        String expected = String.valueOf(tmdbId);
        return guid.equals("tmdb://" + expected)
            || guid.equals("themoviedb://" + expected)
            || guid.equals("com.plexapp.agents.themoviedb://" + expected);
    }

    private static List<JSONObject> extractItems(JSONObject payload) {
        List<JSONObject> items = new ArrayList<>();
        JSONObject container = payload.optJSONObject("MediaContainer");
        if (container == null) container = payload;
        appendObjects(items, container.optJSONArray("Metadata"));
        appendObjects(items, container.optJSONArray("SearchResult"));
        JSONArray hubs = container.optJSONArray("Hub");
        if (hubs != null) {
            for (int index = 0; index < hubs.length(); index++) {
                JSONObject hub = hubs.optJSONObject(index);
                if (hub != null) appendObjects(items, hub.optJSONArray("Metadata"));
            }
        }
        return items;
    }

    private static void appendObjects(List<JSONObject> target, JSONArray values) {
        if (values == null) return;
        for (int index = 0; index < values.length(); index++) {
            JSONObject value = values.optJSONObject(index);
            if (value != null) target.add(value);
        }
    }

    private static JSONArray fetchJsonArray(String url, String token) throws Exception {
        return new JSONArray(fetchBody(url, token));
    }

    private static JSONObject fetchJsonObject(String url, String token) throws Exception {
        return new JSONObject(fetchBody(url, token));
    }

    private static String fetchBody(String url, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(4000);
        connection.setReadTimeout(5000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Plex-Token", token);
        connection.setRequestProperty("X-Plex-Client-Identifier", "seenit-android-background");
        connection.setRequestProperty("X-Plex-Product", "SeenIt");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("PLEX_HTTP_" + status);
            try (InputStream stream = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    body.append(line);
                    if (body.length() > 4_000_000) throw new IllegalStateException("PLEX_RESPONSE_TOO_LARGE");
                }
                return body.toString();
            }
        } finally {
            connection.disconnect();
        }
    }

    private static Bundle inboxExtras(String ownerUidHash, int tmdbId, String mediaType, int season, int episode) {
        Bundle extras = new Bundle();
        extras.putString("ownerUidHash", ownerUidHash);
        extras.putInt("tmdbId", tmdbId);
        extras.putString("mediaType", mediaType);
        extras.putInt("season", season);
        extras.putInt("episode", episode);
        extras.putString("type", "PLEX_AVAILABLE");
        return extras;
    }

    static void showImportNotification(Context context, Map<String, String> message) {
        ensureChannel(context);
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;

        String mediaType = "movie".equals(message.get("mediaType")) ? "movie" : "tv";
        int tmdbId = positiveInt(message.get("tmdbId"));
        int season = nonNegativeInt(message.get("season"));
        int episode = positiveInt(message.get("episode"));
        String title = clean(message.get("title"), 180);
        if (title.isEmpty()) title = "Téléchargement";
        String eventKey = clean(message.get("eventKey"), 128);
        int notificationId = notificationId(eventKey, mediaType, tmdbId, season, episode);
        String compactText = episodeFact("Import terminé", season, episode);

        PendingIntent seenItIntent = buildSeenItPendingIntent(
            context, notificationId, tmdbId, mediaType, season, episode
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .addExtras(inboxExtras(message.get("ownerUidHash"), tmdbId, mediaType, season, episode))
            .setSmallIcon(R.drawable.ic_stat_seenit)
            .setSubText("Téléchargement")
            .setContentTitle(title)
            .setContentText(compactText)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(compactText))
            .setContentIntent(seenItIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS);

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (SecurityException ignored) {
            // La permission Android reste sous le contrôle de l'utilisateur.
        }
    }

    private String showPlexAvailableNotification(AvailabilityMatch match, String plexToken) {
        Context context = getApplicationContext();
        ensureChannel(context);
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return "disabled";

        String mediaType = getInputData().getString("mediaType");
        int tmdbId = getInputData().getInt("tmdbId", 0);
        int season = getInputData().getInt("season", -1);
        int episode = getInputData().getInt("episode", 0);
        String title = clean(getInputData().getString("title"), 180);
        if (title.isEmpty()) title = "Téléchargement";
        String eventKey = clean(getInputData().getString("eventKey"), 128);
        int notificationId = notificationId(eventKey, mediaType, tmdbId, season, episode);
        String compactText = episodeFact("Disponible dans Plex", season, episode);

        PendingIntent seenItIntent = buildSeenItPendingIntent(
            context, notificationId, tmdbId, mediaType, season, episode
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .addExtras(inboxExtras(getInputData().getString("ownerUidHash"), tmdbId, mediaType, season, episode))
            .setSmallIcon(R.drawable.ic_stat_seenit)
            .setSubText("Plex")
            .setContentTitle(title)
            .setContentText(compactText)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(compactText))
            .setContentIntent(seenItIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS);

        Bitmap poster = fetchPosterBitmap(match);
        if (poster != null) {
            Bitmap largeIcon = fitPosterInside(poster, 160, 160);
            Bitmap bigPicture = fitPosterInside(poster, 512, 288);
            builder.setLargeIcon(largeIcon);
            builder.setStyle(
                new NotificationCompat.BigPictureStyle()
                    .bigPicture(bigPicture)
                    .bigLargeIcon((Bitmap) null)
                    .setSummaryText("La copie exacte est maintenant indexée par Plex.")
            );
            poster.recycle();
        }

        String discoverUrl = resolvePlexDiscoverUrl(plexToken, tmdbId, mediaType);
        if (discoverUrl != null) {
            Intent plexIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(discoverUrl));
            plexIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent plexPendingIntent = PendingIntent.getActivity(
                context,
                notificationId ^ 0x00504C58,
                plexIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(0, "Lire sur Plex", plexPendingIntent);
        }

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
            return "shown";
        } catch (SecurityException ignored) {
            return "security_error";
        }
    }

    private static PendingIntent buildSeenItPendingIntent(
        Context context,
        int requestCode,
        int tmdbId,
        String mediaType,
        int season,
        int episode
    ) {
        Uri.Builder deepLink = new Uri.Builder()
            .scheme("com.seenit.app")
            .authority("media")
            .appendQueryParameter("tmdbId", String.valueOf(tmdbId))
            .appendQueryParameter("mediaType", "movie".equals(mediaType) ? "movie" : "tv");
        if (season >= 0 && episode > 0) {
            deepLink.appendQueryParameter("season", String.valueOf(season));
            deepLink.appendQueryParameter("episode", String.valueOf(episode));
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, deepLink.build(), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static int notificationId(String eventKey, String mediaType, int tmdbId, int season, int episode) {
        String key = clean(eventKey, 128);
        if (key.isEmpty()) key = mediaType + ":" + tmdbId + ":" + season + ":" + episode;
        return 1_300_000_000 + Math.abs(key.hashCode() % 300_000_000);
    }

    private static String episodeFact(String fact, int season, int episode) {
        if (season < 0 || episode <= 0) return fact;
        return "S" + String.format(java.util.Locale.ROOT, "%02d", season)
            + " | E" + String.format(java.util.Locale.ROOT, "%02d", episode)
            + " · " + fact;
    }

    private static String resolvePlexDiscoverUrl(String token, int tmdbId, String mediaType) {
        if (token == null || token.trim().isEmpty() || tmdbId <= 0) return null;
        try {
            int plexType = "movie".equals(mediaType) ? 1 : 2;
            String rawGuid = "tmdb://" + tmdbId;
            JSONObject matches = fetchJsonObject(
                "https://metadata.provider.plex.tv/library/metadata/matches?guid="
                    + URLEncoder.encode(rawGuid, StandardCharsets.UTF_8)
                    + "&type=" + plexType,
                token
            );
            for (JSONObject item : extractItems(matches)) {
                if (!hasExactTmdbGuid(item, tmdbId)) continue;
                String slug = clean(item.optString("slug", ""), 160);
                if (!slug.matches("[A-Za-z0-9][A-Za-z0-9-]{0,159}")) continue;
                return "https://watch.plex.tv/" + ("movie".equals(mediaType) ? "movie" : "show") + "/" + slug;
            }
        } catch (Exception ignored) {
            // Pas de fallback titre/année/accueil : sans slug exact, l'action Plex est omise.
        }
        return null;
    }

    private static Bitmap fetchPosterBitmap(AvailabilityMatch match) {
        if (match == null || match.posterPath.isEmpty()) return null;
        String posterUrl = match.posterPath.startsWith("http://") || match.posterPath.startsWith("https://")
            ? match.posterPath
            : match.serverUri + (match.posterPath.startsWith("/") ? "" : "/") + match.posterPath;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(posterUrl).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(5000);
            connection.setRequestProperty("Accept", "image/*");
            connection.setRequestProperty("X-Plex-Token", match.serverToken);
            connection.setRequestProperty("X-Plex-Client-Identifier", "seenit-android-background");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return null;
            int declaredLength = connection.getContentLength();
            if (declaredLength > 4_000_000) return null;

            byte[] bytes;
            try (InputStream stream = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int total = 0;
                int read;
                while ((read = stream.read(buffer)) >= 0) {
                    if (read == 0) continue;
                    total += read;
                    if (total > 4_000_000) return null;
                    output.write(buffer, 0, read);
                }
                bytes = output.toByteArray();
            }

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            int sample = 1;
            while (bounds.outWidth / sample > 512 || bounds.outHeight / sample > 512) sample *= 2;
            BitmapFactory.Options decode = new BitmapFactory.Options();
            decode.inSampleSize = sample;
            Bitmap source = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, decode);
            if (source == null) return null;
            return source;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Bitmap fitPosterInside(Bitmap source, int targetWidth, int targetHeight) {
        if (source.getWidth() <= 0 || source.getHeight() <= 0 || targetWidth <= 0 || targetHeight <= 0) {
            return source;
        }
        Bitmap output = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        canvas.drawColor(0xFF18181B);
        float scale = Math.min(
            targetWidth / (float) source.getWidth(),
            targetHeight / (float) source.getHeight()
        );
        float width = source.getWidth() * scale;
        float height = source.getHeight() * scale;
        float left = (targetWidth - width) / 2f;
        float top = (targetHeight - height) / 2f;
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.drawBitmap(source, null, new RectF(left, top, left + width, top + height), paint);
        return output;
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Téléchargements SeenIt",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Disponibilité Plex après un téléchargement SeenIt");
        manager.createNotificationChannel(channel);
    }

    private static int nonNegativeInt(String value) {
        if (value == null) return -1;
        try {
            int parsed = Integer.parseInt(value);
            return parsed >= 0 ? parsed : -1;
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private static int positiveInt(String value) {
        if (value == null) return 0;
        try {
            int parsed = Integer.parseInt(value);
            return parsed > 0 ? parsed : 0;
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String clean(String value, int maxLength) {
        if (value == null) return "";
        String clean = value.trim().replaceAll("\\s+", " ");
        return clean.length() <= maxLength ? clean : clean.substring(0, maxLength);
    }

    private static String trimTrailingSlash(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }
}
