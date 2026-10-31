package com.seenit.app;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SeenItNotificationSettings")
public class SeenItNotificationSettingsPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Impossible d’ouvrir les réglages Android des notifications.");
        }
    }

    /** Ouvre le canal SeenIt demandé (Android 8+), sinon les réglages de notification de l’app. */
    @PluginMethod
    public void openChannel(PluginCall call) {
        String channelId = call.getString("channelId");
        if (channelId == null || !channelId.matches("seenit_[a-z]{2,20}") || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            open(call);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            open(call);
        }
    }
}
