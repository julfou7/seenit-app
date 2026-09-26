package com.seenit.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
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
        if (tmdbId <= 0 || ownerUidHash.length() != 16) return;

        String mediaType = "movie".equals(message.get("mediaType")) ? "movie" : "tv";
        int season = positiveInt(message.get("season"));
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
    }

    @NonNull
    @Override
    public Result doWork() {
        Credentials credentials = PlexBackgroundCredentialStore.read(getApplicationContext());
        String expectedUidHash = getInputData().getString("ownerUidHash");
        if (credentials == null || expectedUidHash == null || !expectedUidHash.equals(credentials.uidHash)) {
            showNotification(false);
            return Result.success();
        }

        int tmdbId = getInputData().getInt("tmdbId", 0);
        String mediaType = getInputData().getString("mediaType");
        int season = getInputData().getInt("season", 0);
        int episode = getInputData().getInt("episode", 0);
        if (tmdbId <= 0 || (!"movie".equals(mediaType) && !"tv".equals(mediaType))) {
            return Result.failure();
        }

        try {
            if (isAvailable(credentials.token, tmdbId, mediaType, season, episode)) {
                showNotification(true);
                return Result.success();
            }
        } catch (Exception ignored) {
            // Une panne réseau/Plex ne devient jamais une preuve d'indisponibilité.
        }

        if (getRunAttemptCount() + 1 < MAX_ATTEMPTS) return Result.retry();

        showNotification(false);
        return Result.success();
    }

    private boolean isAvailable(String token, int tmdbId, String mediaType, int season, int episode) throws Exception {
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
                    if (isAvailableOnServer(uri, serverToken, tmdbId, mediaType, season, episode)) return true;
                } catch (Exception ignored) {
                    // Essayer la connexion Plex suivante sans transformer une panne en absence.
                }
            }
        }
        return false;
    }

    private boolean isAvailableOnServer(
        String serverUri,
        String token,
        int tmdbId,
        String mediaType,
        int season,
        int episode
    ) throws Exception {
        String guid = URLEncoder.encode("tmdb://" + tmdbId, StandardCharsets.UTF_8);
        JSONObject search = fetchJsonObject(
            serverUri + "/library/all?guid=" + guid + "&includeGuids=1",
            token
        );

        for (JSONObject item : extractItems(search)) {
            String type = item.optString("type", "").toLowerCase();
            if ("movie".equals(mediaType)) {
                if ("movie".equals(type) && hasExactTmdbGuid(item, tmdbId)) return true;
                continue;
            }

            if (!("show".equals(type) || "series".equals(type)) || !hasExactTmdbGuid(item, tmdbId)) continue;
            if (season <= 0 || episode <= 0) return true;

            String ratingKey = item.optString("ratingKey", "").trim();
            if (ratingKey.isEmpty()) continue;

            JSONObject leaves = fetchJsonObject(
                serverUri + "/library/metadata/" + URLEncoder.encode(ratingKey, StandardCharsets.UTF_8) + "/allLeaves?includeGuids=1",
                token
            );
            for (JSONObject leaf : extractItems(leaves)) {
                if (!"episode".equalsIgnoreCase(leaf.optString("type", "episode"))) continue;
                if (leaf.optInt("parentIndex", -1) == season && leaf.optInt("index", -1) == episode) return true;
            }
        }
        return false;
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

    private void showNotification(boolean available) {
        Context context = getApplicationContext();
        ensureChannel(context);

        String mediaType = getInputData().getString("mediaType");
        int tmdbId = getInputData().getInt("tmdbId", 0);
        int season = getInputData().getInt("season", 0);
        int episode = getInputData().getInt("episode", 0);
        String title = clean(getInputData().getString("title"), 180);
        if (title.isEmpty()) title = "Votre média";
        String episodeSuffix = season > 0 && episode > 0 ? " (S" + season + "E" + episode + ")" : "";

        Uri.Builder deepLink = new Uri.Builder()
            .scheme("com.seenit.app")
            .authority("media")
            .appendQueryParameter("tmdbId", String.valueOf(tmdbId))
            .appendQueryParameter("mediaType", "movie".equals(mediaType) ? "movie" : "tv");
        if (season > 0 && episode > 0) {
            deepLink.appendQueryParameter("season", String.valueOf(season));
            deepLink.appendQueryParameter("episode", String.valueOf(episode));
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, deepLink.build(), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int requestCode = Math.abs(clean(getInputData().getString("eventKey"), 128).hashCode());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String notificationTitle = available ? "Disponible dans Plex 🍿" : "Import terminé 🍿";
        String body = available
            ? "\"" + title + episodeSuffix + "\" est maintenant disponible dans Plex. Touchez pour ouvrir sa fiche."
            : "\"" + title + episodeSuffix + "\" a été importé, mais Plex n’a pas encore confirmé sa disponibilité.";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_seenit)
            .setContentTitle(notificationTitle)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS);

        try {
            NotificationManagerCompat.from(context).notify(
                1_300_000_000 + Math.abs(requestCode % 300_000_000),
                builder.build()
            );
        } catch (SecurityException ignored) {
            // La permission Android reste sous le contrôle de l'utilisateur.
        }
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
