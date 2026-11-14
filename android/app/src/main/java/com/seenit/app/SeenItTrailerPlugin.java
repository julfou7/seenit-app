package com.seenit.app;

import android.content.pm.ActivityInfo;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Immersion de la WebView existante : conserve l'iframe, ses contrôles et la pile Retour. */
@CapacitorPlugin(name = "SeenItTrailer")
public class SeenItTrailerPlugin extends Plugin {
    private boolean active = false;
    private boolean orientationLocked = false;
    private int previousBehavior;
    private int previousOrientation;
    private boolean statusVisible;
    private boolean navigationVisible;
    private boolean playbackRequiresGesture;

    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                // #672 : immersion sur tout appareil (le plein écran Web est refermé par la WebView Capacitor) ;
                // le paysage n'est imposé qu'aux téléphones, une tablette garde son orientation.
                if (!active) {
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
                    orientationLocked = getActivity().getResources().getConfiguration().smallestScreenWidthDp < 600;
                    if (orientationLocked) getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                }
                // Le Web n'affiche le rendu immersif que si l'immersion est réellement active.
                JSObject result = new JSObject();
                result.put("immersive", active);
                call.resolve(result);
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
        // Une tablette n'a jamais été tournée : son orientation n'est pas touchée à la sortie.
        if (orientationLocked) {
            getActivity().setRequestedOrientation(previousOrientation == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : previousOrientation);
        }
        orientationLocked = false;
    }

    @Override
    protected void handleOnDestroy() {
        restore();
        super.handleOnDestroy();
    }
}
