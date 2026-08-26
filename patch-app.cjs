const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Add requestNotificationPermission import if not there
if (!code.includes('requestNotificationPermission')) {
  code = code.replace(
    "import { auth, db } from './lib/firebase';",
    "import { auth, db, requestNotificationPermission } from './lib/firebase';"
  );
}

// Save token on auth state change
const hookCode = `
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Enregistrer automatiquement le token FCM pour les webhooks
        try {
          const token = await requestNotificationPermission();
          if (token && token !== 'web-notification-granted') {
            await setDoc(doc(db, 'users', currentUser.uid), { fcmToken: token }, { merge: true });
          }
        } catch (e) {
          console.error("Erreur FCM Init", e);
        }
      }
      setLoading(false);
`;

code = code.replace(
  "    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {\n      setUser(currentUser);\n      setLoading(false);",
  hookCode
);

fs.writeFileSync('src/App.tsx', code);
