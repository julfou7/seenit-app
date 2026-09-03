# TNR — Diagnostic Plex DELTA

## Objectif

Quand un passage **vu → non vu** ne produit pas la réconciliation attendue, le journal SeenIt doit permettre de localiser le blocage sans exposer de secret.

## Séquence terrain

1. Publier le DEV depuis le `main` contenant l'instrumentation.
2. Lancer une DELTA de référence et conserver le bloc `[Plex Delta Debug]`.
3. Marquer un média **vu** dans Plex puis relancer une DELTA.
4. Marquer exactement ce média **non vu** dans Plex puis relancer une DELTA.
5. Copier les blocs `[Plex Delta Debug]` des deux derniers passages.

## Lecture attendue

Le bloc doit exposer :

- taille de la baseline précédente et du snapshot courant ;
- écart brut entre les deux ;
- serveurs scannés, ignorés et incomplets ;
- état de la garde destructive de complétude ;
- médias vus non résolus ;
- candidats backend, candidats bloqués, rechecks exacts et `watched=false` produits ;
- liste technique des `library-watched` courants avec `ratingKey` et identifiant provider/TMDB ;
- liste des états `watched=false` réellement reçus côté client.

Si `précédent > courant` mais que `candidats backend=0`, le journal doit afficher une alerte explicite afin de distinguer un blocage avant recheck d'un échec de preuve PMS.

## Confidentialité

Le diagnostic ne doit jamais contenir :

- URL Plex ;
- token Plex/Firebase ou en-tête Authorization ;
- UID utilisateur complet ;
- payload personnel complet.

Les identifiants serveur éventuellement utiles au rapprochement technique sont abrégés.
