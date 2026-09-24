package com.seenit.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class UpgradeContractInstrumentedTest {
    private static final String PACKAGE_ID = "com.seenit.app";
    private static final String PROBE_FILE = "seenit-upgrade-private-data-probe";
    private static final String PROBE_VALUE = "seenit-private-data-v1";
    private static final String PREFS = "seenit_upgrade_contract";
    private static final String SESSION_PROBE = "firebase_auth_session_probe";
    private static final String SESSION_VALUE = "seenit-session-v1";

    private Context targetContext() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    private void assertNativeContracts(Context context) throws Exception {
        PackageManager packageManager = context.getPackageManager();
        PackageInfo packageInfo = packageManager.getPackageInfo(
            PACKAGE_ID,
            PackageManager.GET_PERMISSIONS
        );

        assertEquals(PACKAGE_ID, context.getPackageName());

        ApplicationInfo applicationInfo = packageManager.getApplicationInfo(PACKAGE_ID, 0);
        assertEquals("SeenIt", packageManager.getApplicationLabel(applicationInfo).toString());
        Drawable launcherIcon = packageManager.getApplicationIcon(applicationInfo);
        assertNotNull(launcherIcon);

        Intent launcherIntent = packageManager.getLaunchIntentForPackage(PACKAGE_ID);
        assertNotNull(launcherIntent);
        assertNotNull(launcherIntent.getComponent());
        assertEquals(PACKAGE_ID, launcherIntent.getComponent().getPackageName());

        Intent deepLink = new Intent(Intent.ACTION_VIEW, Uri.parse("com.seenit.app://upgrade-smoke"));
        deepLink.addCategory(Intent.CATEGORY_BROWSABLE);
        assertNotNull(packageManager.resolveActivity(deepLink, PackageManager.MATCH_DEFAULT_ONLY));

        assertNotNull(packageInfo.requestedPermissions);
        assertTrue(Arrays.asList(packageInfo.requestedPermissions)
            .contains(Manifest.permission.POST_NOTIFICATIONS));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            assertEquals(
                PackageManager.PERMISSION_GRANTED,
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            );
        }
    }

    @Test
    public void seedUpgradeState() throws Exception {
        Context context = targetContext();
        PackageInfo packageInfo = context.getPackageManager().getPackageInfo(PACKAGE_ID, 0);
        try (FileOutputStream output = context.openFileOutput(PROBE_FILE, Context.MODE_PRIVATE)) {
            output.write(PROBE_VALUE.getBytes(StandardCharsets.UTF_8));
        }
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        assertTrue(preferences.edit()
            .putString(SESSION_PROBE, SESSION_VALUE)
            .putLong("baseline_version_code", packageInfo.getLongVersionCode())
            .putString("baseline_version_name", packageInfo.versionName)
            .commit());
    }

    @Test
    public void verifyUpgradeStateAndNativeContracts() throws Exception {
        Context context = targetContext();
        PackageManager packageManager = context.getPackageManager();
        PackageInfo packageInfo = packageManager.getPackageInfo(PACKAGE_ID, PackageManager.GET_PERMISSIONS);
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        assertTrue(packageInfo.getLongVersionCode() > preferences.getLong("baseline_version_code", -1));
        assertTrue(!packageInfo.versionName.equals(preferences.getString("baseline_version_name", "")));
        assertEquals(SESSION_VALUE, preferences.getString(SESSION_PROBE, null));

        byte[] persisted = new byte[PROBE_VALUE.getBytes(StandardCharsets.UTF_8).length];
        try (FileInputStream input = context.openFileInput(PROBE_FILE)) {
            assertEquals(persisted.length, input.read(persisted));
        }
        assertEquals(PROBE_VALUE, new String(persisted, StandardCharsets.UTF_8));

        assertNativeContracts(context);
    }

    @Test
    public void verifyLoginAccessibility() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        PackageManager packageManager = targetContext().getPackageManager();
        Intent launcherIntent = packageManager.getLaunchIntentForPackage(PACKAGE_ID);
        assertNotNull("Intent launcher SeenIt absent.", launcherIntent);
        launcherIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        instrumentation.startActivitySync(launcherIntent);
        instrumentation.waitForIdleSync();

        UiAutomation uiAutomation = instrumentation.getUiAutomation();
        long deadline = SystemClock.elapsedRealtime() + 15_000L;
        boolean loginActionFound = false;

        while (SystemClock.elapsedRealtime() < deadline && !loginActionFound) {
            AccessibilityNodeInfo root = uiAutomation.getRootInActiveWindow();
            if (root != null) {
                List<AccessibilityNodeInfo> matches =
                    root.findAccessibilityNodeInfosByText("Continuer avec Google");
                for (AccessibilityNodeInfo node : matches) {
                    if (isNodeOrAncestorClickable(node)) {
                        loginActionFound = true;
                        break;
                    }
                }
            }

            if (!loginActionFound) {
                SystemClock.sleep(250L);
            }
        }

        assertTrue(
            "Le bouton « Continuer avec Google » n'est pas exposé comme action cliquable à Android.",
            loginActionFound
        );
        System.out.println("SEENIT_ACCESSIBILITY_OK: Continuer avec Google clickable=true");
    }

    private boolean isNodeOrAncestorClickable(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = node;
        for (int depth = 0; current != null && depth < 8; depth += 1) {
            if (current.isClickable()) {
                return true;
            }
            current = current.getParent();
        }
        return false;
    }
}
