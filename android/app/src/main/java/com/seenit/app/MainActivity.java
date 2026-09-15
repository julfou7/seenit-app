package com.seenit.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SeenItAuthPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15/16 impose l'edge-to-edge. On le rend explicite aussi sur les versions
        // précédentes afin que la WebView occupe réellement la zone de la status bar.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        insetsController.setAppearanceLightStatusBars(false);
        
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                // Pitch black background to eliminate any white flash during initial rendering
                webView.setBackgroundColor(Color.parseColor("#040406"));
                configureSafeAreaInsets(webView);
                WebSettings settings = webView.getSettings();
                settings.setJavaScriptCanOpenWindowsAutomatically(true);
                settings.setSupportMultipleWindows(true);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void configureSafeAreaInsets(WebView webView) {
        View insetView = (View) webView.getParent();
        ViewCompat.setOnApplyWindowInsetsListener(insetView, (view, windowInsets) -> {
            Insets safeArea = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;
            injectSafeAreaCss(
                webView,
                Math.round(safeArea.top / density),
                Math.round(safeArea.right / density),
                Math.round(safeArea.bottom / density),
                Math.round(safeArea.left / density)
            );

            // Ne jamais convertir ces insets en padding natif : le contenu doit rester derrière
            // les barres système, les classes CSS SeenIt appliquant elles-mêmes les safe areas.
            return windowInsets;
        });

        this.getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    super.onPageCommitVisible(view, url);
                    View parent = (View) view.getParent();
                    ViewCompat.requestApplyInsets(parent);
                }
            }
        );
        ViewCompat.requestApplyInsets(insetView);
    }

    private void injectSafeAreaCss(WebView webView, int top, int right, int bottom, int left) {
        String script =
            "try {" +
            "document.documentElement.style.setProperty('--seenit-safe-area-top', '" + top + "px');" +
            "document.documentElement.style.setProperty('--seenit-safe-area-right', '" + right + "px');" +
            "document.documentElement.style.setProperty('--seenit-safe-area-bottom', '" + bottom + "px');" +
            "document.documentElement.style.setProperty('--seenit-safe-area-left', '" + left + "px');" +
            "} catch (_) {}";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
