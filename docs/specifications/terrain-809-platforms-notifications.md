# #809 — Plateformes et « Tout marquer lu »

Date : 2026-10-31. Source : retour terrain propriétaire sur Android / One UI.

## Plateformes

SeenIt conserve les identifiants de préférence historiques déjà enregistrés afin de ne pas réinterpréter les choix utilisateurs. Ils sont distincts, lorsque nécessaire, des identifiants TMDB utilisés pour les requêtes de disponibilité.

| Service | ID préférence SeenIt | ID fournisseur TMDB FR |
| --- | ---: | ---: |
| Netflix | 8 | 8 |
| HBO | 118 | 118 |
| Prime Video | 119 | 119 |
| Disney+ | 337 | 337 |
| Apple TV+ | 350 | 350 |
| Canal+ | 381 | 381 |
| Max | 1899 | 1899 |
| Paramount+ | 531 | 531 |
| France TV | 234 | 236 |
| ARTE | 239 | 234 |

Les surfaces Réglages et Explorer utilisent la même correspondance sémantique et la même source de présentation. Les logos chargés depuis le catalogue TMDB FR sont réindexés vers les IDs de préférence SeenIt ; un ancien cache ne doit donc jamais transformer France TV en ARTE.

### Logos de marque validés terrain

À la suite de la vérification visuelle de la v1.4.240, quatre plateformes utilisent une variante de marque compacte et stable commune à toutes les surfaces : **Netflix, HBO, Canal+ et France TV**. Ces variantes priment sur le cache TMDB et sont utilisées dans Réglages → Mes plateformes, Explorer → Filtres → Plateformes et les badges de fournisseur sur les cartes lorsque le fournisseur est identifié par son nom.

Explorer ne possède plus de chemins de logo locaux pour ces plateformes : la grille résout systématiquement le logo depuis le catalogue canonique indexé par ID de préférence. Netflix doit rester net, Canal+ entièrement visible dans une tuile carrée, HBO utiliser sa variante sombre compacte et France TV afficher la marque france.tv plutôt qu'un fallback `FTV`.

Les requêtes TMDB et les liens directs utilisent l’ID fournisseur courant, jamais l’ID de préférence lorsqu’ils divergent. Les choix déjà stockés `234` (France TV) et `239` (ARTE) restent valides sans migration destructive.

## Notifications — action de masse

Dans la feuille Notifications, **Tout marquer lu** est une action de masse : toutes les notifications actuellement visibles deviennent lues ; elles sont masquées en une seule mise à jour de l’état local ; le badge non-lu retombe à zéro ; aucun retrait individuel ni rafale de toasts n’est déclenché ; le retrait individuel avec annulation reste inchangé.

## TNR

Le lot couvre : correspondance préférence ↔ fournisseur pour France TV/ARTE, source canonique unique des logos Netflix/HBO/Canal+/France TV, absence de variantes locales dans Explorer, cohérence des badges de cartes, liens directs France TV/ARTE, sélection de fournisseur de notification avec les IDs historiques et comportement atomique de `Tout marquer lu`.
