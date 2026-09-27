package com.seenit.app;

import android.content.Context;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

final class PlexAvailabilityDiagnosticStore {
    private static final String FILE_NAME = "seenit-plex-availability-diagnostics.jsonl";
    private static final int MAX_EVENTS = 120;

    static final class Snapshot {
        final List<JSONObject> events;
        final long beforeTimestamp;

        Snapshot(List<JSONObject> events, long beforeTimestamp) {
            this.events = events;
            this.beforeTimestamp = beforeTimestamp;
        }
    }

    private PlexAvailabilityDiagnosticStore() {}

    static synchronized void record(Context context, String ownerUidHash, String traceId, String stage, String outcome, int attempt) {
        if (!isUidHash(ownerUidHash) || !isTraceId(traceId) || !isSafeWord(stage) || !isSafeWord(outcome)) return;
        try {
            List<JSONObject> entries = readAll(context);
            JSONObject event = new JSONObject();
            event.put("ownerUidHash", ownerUidHash);
            event.put("traceId", traceId);
            event.put("stage", stage);
            event.put("outcome", outcome);
            event.put("attempt", Math.max(0, Math.min(12, attempt)));
            event.put("timestamp", System.currentTimeMillis());
            entries.add(event);
            if (entries.size() > MAX_EVENTS) entries = new ArrayList<>(entries.subList(entries.size() - MAX_EVENTS, entries.size()));
            writeAll(context, entries);
        } catch (Exception ignored) {
            // Le diagnostic ne doit jamais perturber le traitement de la notification.
        }
    }

    static synchronized Snapshot readForUid(Context context, String uid) {
        List<JSONObject> safe = new ArrayList<>();
        long beforeTimestamp = 0L;
        if (isBlank(uid)) return new Snapshot(safe, beforeTimestamp);
        String uidHash = PlexBackgroundCredentialStore.hashUid(uid);
        try {
            for (JSONObject entry : readAll(context)) {
                if (!uidHash.equals(entry.optString("ownerUidHash", ""))) continue;
                JSONObject output = new JSONObject();
                output.put("traceId", entry.optString("traceId", ""));
                output.put("stage", entry.optString("stage", ""));
                output.put("outcome", entry.optString("outcome", ""));
                output.put("attempt", entry.optInt("attempt", 0));
                long timestamp = entry.optLong("timestamp", 0L);
                output.put("timestamp", timestamp);
                safe.add(output);
                beforeTimestamp = Math.max(beforeTimestamp, timestamp);
            }
        } catch (Exception ignored) {
            return new Snapshot(new ArrayList<>(), 0L);
        }
        return new Snapshot(safe, beforeTimestamp);
    }

    static synchronized void clearForUidBefore(Context context, String uid, long beforeTimestamp) {
        if (isBlank(uid) || beforeTimestamp <= 0L) return;
        String uidHash = PlexBackgroundCredentialStore.hashUid(uid);
        try {
            List<JSONObject> retained = new ArrayList<>();
            for (JSONObject entry : readAll(context)) {
                boolean acknowledged = uidHash.equals(entry.optString("ownerUidHash", ""))
                    && entry.optLong("timestamp", Long.MAX_VALUE) <= beforeTimestamp;
                if (!acknowledged) retained.add(entry);
            }
            writeAll(context, retained);
        } catch (Exception ignored) {
            // Un échec d'acquittement conserve les événements pour une reprise ultérieure.
        }
    }

    private static List<JSONObject> readAll(Context context) throws Exception {
        List<JSONObject> entries = new ArrayList<>();
        File file = new File(context.getNoBackupFilesDir(), FILE_NAME);
        if (!file.isFile()) return entries;
        try (FileInputStream stream = new FileInputStream(file);
             BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.length() > 2048) continue;
                try {
                    JSONObject entry = new JSONObject(line);
                    if (isUidHash(entry.optString("ownerUidHash", ""))
                        && isTraceId(entry.optString("traceId", ""))
                        && isSafeWord(entry.optString("stage", ""))
                        && isSafeWord(entry.optString("outcome", ""))
                        && entry.optLong("timestamp", 0L) > 0L) {
                        entries.add(entry);
                    }
                } catch (Exception ignored) {
                    // Une ligne corrompue est ignorée sans invalider le reste du journal.
                }
            }
        }
        if (entries.size() <= MAX_EVENTS) return entries;
        return new ArrayList<>(entries.subList(entries.size() - MAX_EVENTS, entries.size()));
    }

    private static void writeAll(Context context, List<JSONObject> entries) throws Exception {
        File file = new File(context.getNoBackupFilesDir(), FILE_NAME);
        if (entries.isEmpty()) {
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            return;
        }
        try (FileOutputStream output = new FileOutputStream(file, false)) {
            int start = Math.max(0, entries.size() - MAX_EVENTS);
            for (int index = start; index < entries.size(); index++) {
                output.write(entries.get(index).toString().getBytes(StandardCharsets.UTF_8));
                output.write('\n');
            }
            output.getFD().sync();
        }
    }

    private static boolean isUidHash(String value) {
        return value != null && value.matches("^[a-f0-9]{16}$");
    }

    private static boolean isTraceId(String value) {
        return value != null && value.matches("^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-5][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$");
    }

    private static boolean isSafeWord(String value) {
        return value != null && value.matches("^[a-z][a-z0-9_]{0,31}$");
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
