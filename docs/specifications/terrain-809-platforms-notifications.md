# #809 — Plateformes et « Tout marquer lu »

Date : 2026-10-31. Source : retour terrain propriétaire sur Android / One UI.

## Plateformes

SeenIt conserve les identifiants de préférence historiques déjà enregistrés afin de ne pas réinterpréter les choix utilisateurs. Ils sont distincts, lorsque nécessaire, des identifiants TMDB utilisés pour les requêtes de disponibilité.

| Service | ID préférence SeenIt | ID fournisseur TMDB FR |
| --- | ---: | ---: |
| Netflix | 8 | 8 |
| Prime Video | 119 | 119 |
| Disney+ | 337 | 337 |
| Apple TV+ | 350 | 350 |
| Canal+ | 381 | 381 |
| Max | 1899 | 1899 |
| Paramount+ | 531 | 531 |
| France TV | 234 | 236 |
| ARTE | 239 | 234 |

Les surfaces Réglages, Explorer et les badges de fournisseur sur les cartes doivent utiliser la même correspondance sémantique. Les logos chargés depuis le catalogue TMDB FR sont réindexés vers les IDs de préférence SeenIt ; un ancien cache ne doit donc jamais transformer France TV en ARTE. Explorer affiche le logo de Paramount+ lorsqu’il est disponible, comme Réglages.

### Identité visuelle canonique terrain

Le retour terrain du 31/10 impose quatre assets locaux fournis par le propriétaire et utilisés en priorité sur toute surface qui reconnaît la plateforme :

- Netflix : `/brand/providers/netflix.webp` ;
- Canal+ : `/brand/providers/canalplus.webp` ;
- HBO : `/brand/providers/hbo.webp` ;
- France TV / france.tv : `/brand/providers/francetv.webp`.

Ces quatre assets remplacent les variantes TMDB, les logos synthétiques et les anciennes variantes locales pour les plateformes reconnues. La résolution centralisée doit être partagée par Réglages, Explorer et les badges affichés sur les cartes afin qu’un même service ne change jamais de logo selon l’écran. Les assets sont carrés et conservent entièrement le visuel de marque dans les tuiles et badges ; aucun crop, étirement ou fallback texte ne doit apparaître tant que l’asset local existe. ARTE reste distinct de France TV et continue d’utiliser son propre logo issu du catalogue.

Les requêtes TMDB et les liens directs utilisent l’ID fournisseur courant, jamais l’ID de préférence lorsqu’ils divergent. Les choix déjà stockés `234` (France TV) et `239` (ARTE) restent valides sans migration destructive.

## Notifications — action de masse

Dans la feuille Notifications, **Tout marquer lu** est une action de masse :

- toutes les notifications actuellement visibles deviennent lues ;
- elles sont masquées en une seule mise à jour de l’état local de la boîte de réception ;
- le badge non-lu retombe à zéro et la feuille se referme lorsqu’elle devient vide ;
- l’action n’appelle jamais le retrait individuel notification par notification et ne produit donc aucune rafale de toasts `Notification retirée` ;
- le retrait individuel avec possibilité d’annulation reste inchangé ;
- la synchronisation des IDs d’actualités avec Firestore reste conservée ; en cas d’échec, un seul message agrégé peut être affiché.

## TNR

Le lot doit couvrir : correspondance préférence ↔ fournisseur pour France TV/ARTE, identité visuelle canonique Netflix/Canal+/HBO/france.tv partagée entre Réglages/Explorer/badges, logo Paramount+, liens directs France TV/ARTE, sélection de fournisseur de notification avec les IDs de préférence historiques et comportement atomique de `Tout marquer lu`.
