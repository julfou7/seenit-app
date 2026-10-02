package com.seenit.app;

import android.content.pm.ActivityInfo;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Immersion de la WebView existante : conserve l'iframe, ses contrôles et la pile Retour. */
@CapacitorPlugin(name = "SeenItTrailer")
public class SeenItTrailerPlugin extends Plugin {
    private boolean active = false;
    private int previousBehavior;
    private int previousOrientation;
    private boolean statusVisible;
    private boolean navigationVisible;
    private boolean playbackRequiresGesture;

    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (!active && getActivity().getResources().getConfiguration().smallestScreenWidthDp < 600) {
                    WindowInsetsControllerCompat controller = controller();
                    previousBehavior = controller.getSystemBarsBehavior();
                    previousOrientation = getActivity().getRequestedOrientation();
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
                    statusVisible = insets == null || insets.isVisible(WindowInsetsCompat.Type.statusBars());
                    navigationVisible = insets == null || insets.isVisible(WindowInsetsCompat.Type.navigationBars());
                    active = true;
                    playbackRequiresGesture = getBridge().getWebView().getSettings().getMediaPlaybackRequiresUserGesture();
                    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
                    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    controller.hide(WindowInsetsCompat.Type.systemBars());
                    getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                }
                call.resolve();
            } catch (Exception error) {
                restore();
                call.reject("TRAILER_PRESENTATION_UNAVAILABLE", error);
            }
        });
    }

    @PluginMethod
    public void leave(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            restore();
            call.resolve();
        });
    }

    private WindowInsetsControllerCompat controller() {
        return WindowCompat.getInsetsController(getActivity().getWindow(), getActivity().getWindow().getDecorView());
    }

    private void restore() {
        if (!active) return;
        active = false;
        WindowInsetsControllerCompat controller = controller();
        controller.setSystemBarsBehavior(previousBehavior);
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(playbackRequiresGesture);
        if (statusVisible) controller.show(WindowInsetsCompat.Type.statusBars());
        else controller.hide(WindowInsetsCompat.Type.statusBars());
        if (navigationVisible) controller.show(WindowInsetsCompat.Type.navigationBars());
        else controller.hide(WindowInsetsCompat.Type.navigationBars());
        getActivity().setRequestedOrientation(previousOrientation == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : previousOrientation);
    }

    @Override
    protected void handleOnDestroy() {
        restore();
        super.handleOnDestroy();
    }
}
