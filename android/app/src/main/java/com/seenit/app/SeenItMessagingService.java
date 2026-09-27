package com.seenit.app;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class SeenItMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (PlexAvailabilityWorker.PUSH_TYPE.equals(data.get("type"))) {
            PlexAvailabilityDiagnosticStore.record(
                this,
                data.get("ownerUidHash"),
                data.get("traceId"),
                "fcm_received",
                "received",
                0
            );
            PlexAvailabilityWorker.enqueue(this, data);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }
}
