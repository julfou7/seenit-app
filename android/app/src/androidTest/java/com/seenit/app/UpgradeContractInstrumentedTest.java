package com.seenit.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Instrumentation;
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
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
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
    public void verifyLoginWebViewSemantics() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        PackageManager packageManager = targetContext().getPackageManager();
        Intent launcherIntent = packageManager.getLaunchIntentForPackage(PACKAGE_ID);
        assertNotNull("Intent launcher SeenIt absent.", launcherIntent);
        launcherIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        MainActivity activity = (MainActivity) instrumentation.startActivitySync(launcherIntent);
        instrumentation.waitForIdleSync();
        WebView webView = activity.getBridge().getWebView();
        assertNotNull("WebView SeenIt absente.", webView);

        String semanticProbe =
            "(function() {" +
            "const candidates=Array.from(document.querySelectorAll('button,[role=\\"button\\"]'));" +
            "const target=candidates.find((element)=>(element.textContent||'').includes('Continuer avec Google'));" +
            "if(!target)return false;" +
            "const rect=target.getBoundingClientRect();" +
            "const style=window.getComputedStyle(target);" +
            "const role=(target.getAttribute('role')||target.tagName||'').toLowerCase();" +
            "const semanticButton=role==='button';" +
            "const active=!target.disabled&&target.getAttribute('aria-disabled')!=='true';" +
            "const opacity=Number.parseFloat(style.opacity||'1');" +
            "const visible=style.display!=='none'&&style.visibility!=='hidden'&&opacity>0&&rect.width>0&&rect.height>0;" +
            "return semanticButton&&active&&visible&&rect.width>=44&&rect.height>=44;" +
            "})();";

        long deadline = SystemClock.elapsedRealtime() + 15_000L;
        boolean semanticContractSatisfied = false;

        while (SystemClock.elapsedRealtime() < deadline && !semanticContractSatisfied) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> result = new AtomicReference<>();

            instrumentation.runOnMainSync(() ->
                webView.evaluateJavascript(semanticProbe, value -> {
                    result.set(value);
                    latch.countDown();
                })
            );

            assertTrue(
                "La sonde sémantique WebView n'a pas répondu dans le délai borné.",
                latch.await(2, TimeUnit.SECONDS)
            );
            semanticContractSatisfied = "true".equals(result.get());

            if (!semanticContractSatisfied) {
                SystemClock.sleep(250L);
            }
        }

        assertTrue(
            "Le CTA « Continuer avec Google » n'est pas un bouton WebView visible, actif et >=44 px.",
            semanticContractSatisfied
        );
        System.out.println(
            "SEENIT_WEBVIEW_SEMANTICS_OK: Continuer avec Google semantic=true visible=true active=true target>=44px"
        );
    }

}
