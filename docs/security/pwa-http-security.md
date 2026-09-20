# Sécurité HTTP de la PWA SeenIt

## Portée

Ce contrat s'applique aux réponses servies par le serveur Express canonique SeenIt et donc à la PWA.
L'APK Capacitor charge ses assets applicatifs depuis la WebView embarquée : il ne reçoit pas ces en-têtes
HTTP et n'enregistre pas le service worker PWA. Les notifications natives continuent d'utiliser les plugins
Capacitor `LocalNotifications` et `PushNotifications`.

## En-têtes

La PWA reçoit en production :

- `Content-Security-Policy` ;
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`, afin de conserver Google Auth en popup ;
- `Permissions-Policy` désactivant caméra, micro, géolocalisation, paiement et USB non utilisés ;
- `Referrer-Policy: strict-origin-when-cross-origin` ;
- `X-Content-Type-Options: nosniff` ;
- `X-Frame-Options: DENY` ;
- `Strict-Transport-Security: max-age=31536000`.

Le mode Vite de développement garde la même base sans HSTS et ajoute uniquement `'unsafe-eval'` et
`ws:/wss:`, nécessaires à l'outillage/HMR. Ces exceptions n'existent pas en production.

## Exceptions CSP nécessaires

| Directive | Exception | Justification |
| --- | --- | --- |
| `script-src` | `https://apis.google.com`, `https://www.gstatic.com` | Firebase/Google Auth. Aucun `unsafe-inline` ni `unsafe-eval` en production. |
| `style-src` | `'unsafe-inline'`, `https://fonts.googleapis.com` | styles React/écran de démarrage existants et feuilles Google Fonts. |
| `font-src` | `https://fonts.gstatic.com`, `data:` | fontes Inter/Plus Jakarta Sans. |
| `img-src` | `https:`, `data:`, `blob:` | posters/backdrops TMDB, images Plex, avatar Google et visuels de notifications. |
| `media-src` | `https:`, `blob:` | médias distants éventuellement exposés par les fiches. |
| `connect-src` | `https:` | Firebase/TMDB et surtout URLs Plex HTTPS configurées dynamiquement par utilisateur ; une liste d'hôtes statique ne peut pas couvrir ce besoin. Cette ouverture ne permet pas l'exécution de scripts. |
| `frame-src` | Firebase Auth, Google Accounts, YouTube/YouTube-nocookie | popup/iframe d'authentification et bandes-annonces. |
| `worker-src` | `'self'`, `blob:` | service worker SeenIt et workers navigateur locaux. |

Les objets sont interdits, l'application ne peut pas être encadrée par un autre site, les formulaires et
la base URL restent same-origin.

## Service worker / FCM

`/firebase-messaging-sw.js` est l'unique worker SeenIt pour le shell PWA et Firebase Cloud Messaging.

- l'enregistrement applicatif passe uniquement par `ensureSeenItServiceWorkerRegistration` ;
- plusieurs appelants partagent la même Promise d'enregistrement ;
- `updateViaCache: 'none'` évite qu'un contrôle de mise à jour réutilise le cache HTTP du script/imports ;
- `registration.update()` est tenté une fois par session ; un échec réseau ne détruit pas l'enregistrement valide ;
- un échec d'enregistrement réinitialise la Promise pour permettre une tentative ultérieure ;
- la WebView Capacitor retourne avant tout enregistrement ;
- la réponse du worker est `no-cache, no-store, must-revalidate`, avec `Service-Worker-Allowed: /` ;
- sa CSP dédiée autorise les scripts uniquement depuis SeenIt et `www.gstatic.com`, où les deux scripts
  Firebase compat sont épinglés en version `10.12.0` ;
- le handler `fetch` ignore toute méthode non-GET, toute origine distante et toute route `/api/` ;
- les navigations restent network-first avec fallback du shell ; les assets statiques same-origin restent
  cache-first avec rafraîchissement réseau.

Les TNR `serviceWorkerIntegration` couvrent installation, activation/remplacement d'ancien cache,
offline, exclusion API/origines distantes, notification background et clic de notification.
