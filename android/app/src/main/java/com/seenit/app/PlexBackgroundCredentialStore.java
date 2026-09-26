package com.seenit.app;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Scanner;

final class PlexBackgroundCredentialStore {
    private static final String FILE_NAME = "seenit-plex-background.credentials";

    static final class Credentials {
        final String uidHash;
        final String token;

        Credentials(String uidHash, String token) {
            this.uidHash = uidHash;
            this.token = token;
        }
    }

    private PlexBackgroundCredentialStore() {}

    static void store(Context context, String uid, String token) throws Exception {
        if (uid == null || uid.isBlank() || token == null || token.isBlank()) {
            throw new IllegalArgumentException("PLEX_BACKGROUND_CREDENTIALS_MISSING");
        }
        File file = new File(context.getNoBackupFilesDir(), FILE_NAME);
        try (FileOutputStream output = new FileOutputStream(file, false)) {
            output.write((hashUid(uid) + "\n" + token.trim()).getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
    }

    static Credentials read(Context context) {
        File file = new File(context.getNoBackupFilesDir(), FILE_NAME);
        if (!file.isFile()) return null;
        try (Scanner scanner = new Scanner(file, StandardCharsets.UTF_8)) {
            if (!scanner.hasNextLine()) return null;
            String uidHash = scanner.nextLine().trim();
            if (!scanner.hasNextLine()) return null;
            String token = scanner.nextLine().trim();
            if (uidHash.length() != 16 || token.isBlank()) return null;
            return new Credentials(uidHash, token);
        } catch (Exception ignored) {
            return null;
        }
    }

    static void clearForUid(Context context, String uid) {
        if (uid == null || uid.isBlank()) return;
        Credentials current = read(context);
        if (current == null || !current.uidHash.equals(hashUid(uid))) return;
        clear(context);
    }

    static void clear(Context context) {
        File file = new File(context.getNoBackupFilesDir(), FILE_NAME);
        if (file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    static String hashUid(String uid) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(uid.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte value : bytes) hex.append(String.format("%02x", value));
            return hex.substring(0, 16);
        } catch (Exception error) {
            throw new IllegalStateException("UID_HASH_FAILED", error);
        }
    }
}
