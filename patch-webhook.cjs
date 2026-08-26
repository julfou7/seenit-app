const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const webhookCode = `
  // Sonarr Webhook (Advanced)
  app.post('/api/webhook/sonarr', express.json(), async (req, res) => {
    try {
      const payload = req.body;
      console.log("[Sonarr Webhook] Received:", payload.eventType);
      
      let title = "Téléchargement Sonarr";
      let body = "Un téléchargement a été mis à jour.";
      
      if (payload.eventType === 'Grab') {
        title = "Téléchargement lancé";
        body = \`\${payload.series?.title || 'Une série'} a commencé le téléchargement.\`;
      } else if (payload.eventType === 'Download') {
        title = "Épisode importé";
        body = \`\${payload.series?.title || 'Série'} S\${payload.episodes?.[0]?.seasonNumber || 'X'}E\${payload.episodes?.[0]?.episodeNumber || 'X'} est disponible !\`;
      } else {
        return res.status(200).send("Ignored event type");
      }
      
      const usersSnapshot = await adminDb.collection('users').get();
      const tokens = [];
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.fcmToken) {
          tokens.push(data.fcmToken);
        }
      });
      
      if (tokens.length > 0) {
        await adminMessaging.sendEachForMulticast({
          tokens,
          notification: { title, body }
        });
        console.log("[Sonarr Webhook] Sent FCM to", tokens.length, "users");
      }
      
      return res.status(200).send("OK");
    } catch(e) {
      console.error("[Sonarr Webhook Error]", e);
      return res.status(500).send(e.toString());
    }
  });
`;

code = code.replace(
  "  // Remote Download Dispatcher",
  webhookCode + "\n  // Remote Download Dispatcher"
);

fs.writeFileSync('server.ts', code);
