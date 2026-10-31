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

Les surfaces Réglages et Explorer doivent utiliser la même correspondance sémantique. Les logos chargés depuis le catalogue TMDB FR sont réindexés vers les IDs de préférence SeenIt ; un ancien cache ne doit donc jamais transformer France TV en ARTE. Explorer affiche le logo de Paramount+ lorsqu’il est disponible, comme Réglages.

Pour **Netflix, CANAL+, HBO et france.tv**, les assets de marque fournis par le propriétaire sont embarqués dans l’application et constituent la source visuelle canonique. Ils sont prioritaires sur les logos TMDB, les anciens assets générés et les caches distants dans **Mes plateformes**, **Explorer > Filtres** et les badges de fournisseurs affichés sur les cartes. Le rendu conserve l’image entière (`contain`) et ne doit ni rogner ni reconstruire le logo en texte.

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

Le lot doit couvrir : correspondance préférence ↔ fournisseur pour France TV/ARTE, présence et priorité des assets embarqués Netflix/CANAL+/HBO/france.tv sur les trois surfaces d’affichage, logo Paramount+, liens directs France TV/ARTE, sélection de fournisseur de notification avec les IDs de préférence historiques et comportement atomique de `Tout marquer lu`.
