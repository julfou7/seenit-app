# Intégrité de la connexion Plex

## Invariant de résolution

SeenIt ne doit accepter un média Plex que si son TMDB ID provient d'une chaîne d'identifiants vérifiable :

- `TMDB Plex → TMDB` ;
- `IMDb Plex → TMDB /find → TMDB` ;
- `TVDB Plex → TMDB /find → TMDB` ;
- `plex://… → métadonnées Plex → TMDB/IMDb/TVDB → TMDB`.

Si aucune chaîne n'aboutit, l'élément reste non résolu, est journalisé puis ignoré. Le titre, l'année, la popularité, la ressemblance et la position d'un résultat ne constituent jamais une preuve d'identité.

Pour un épisode, seuls les identifiants de la série parente peuvent résoudre le TMDB ID de la série. L'identifiant externe propre à l'épisode ne doit jamais être interprété comme celui de la série.

## Isolation et transport

- Le jeton, le cache de résolution, le cache de disponibilité et le curseur de synchronisation sont cloisonnés par UID SeenIt.
- Un changement de compte ou une déconnexion purge les données Plex locales du compte précédent.
- Le jeton Plex voyage uniquement dans l'en-tête `X-Plex-Token`, jamais dans une URL ou un corps JSON.
- PWA et APK utilisent le même backend de production pour l'historique, la disponibilité et la résolution.

## Synchronisation

- La déduplication intervient après résolution, par `movie:<tmdbId>` ou `tv:<tmdbId>:S<season>:E<episode>`.
- Le scan complet est paginé.
- Le delta parcourt les pages jusqu'au curseur précédent et filtre les entrées plus anciennes.
- Le nouveau curseur correspond au début de la collecte et n'est enregistré côté client qu'après les écritures Firestore réussies.

## Tests de non-régression

La commande `npm run test:plex` doit au minimum protéger les cas suivants :

- premier résultat Plex incorrect ;
- remakes et homonymes ;
- identité de la série parente d'un épisode ;
- absence totale de résolution par titre/année ;
- changement de compte SeenIt sans fuite de jeton ni de curseur.

L'ouverture Android doit aussi être validée sur un appareil réel : ouverture de l'élément exact quand Plex est installé, puis fallback web quand il ne l'est pas.
