# Façade métadonnées — #12 et #130

Contrats `SEENIT-SECURITY-001` et `SEENIT-RELATION-001`. Les valeurs serveur valides restent un
prérequis de production ; aucune clé fournisseur ne doit être embarquée dans la PWA ou l'APK.

## Inventaire et portée

| Consommateur | Opérations | Destination |
|---|---|---|
| `tmdbClient.ts` | Recherche, find par ID, fiches, saisons/épisodes, collections, fournisseurs, mots-clés, personnes, discover/trending | `GET /api/media/tmdb/…` |
| `tmdb.ts` | Cinéma France, collection film exacte, hydratation des relations TVDB | Façade TMDB + client TVDB sécurisé |
| `lib/recommendations.ts` | Discover genres/personnes et fallback populaire d'Explorer | Même façade TMDB ; scoring Explorer inchangé |
| `omdbService.ts` | Notes IMDb par ID exact, saison et épisodes incomplets | `GET /api/media/omdb?i=tt…&Season=…` |
| `services/tvdb.ts` | Franchise/univers depuis TVDB ID ou IMDb ID exact | `GET /api/media/tvdb/franchise` |
| Runtime Plex | Aucun déplacement ni changement des preuves de visionnage | Runtime existant indépendant de Firebase au chargement |

Le client TVDB est une façade SeenIt minimale : il ne connaît ni hôte TVDB, ni jeton, ni clé et ne
transmet jamais de titre. Le backend est seul responsable du login TVDB et des appels à
`api4.thetvdb.com`. Les métadonnées publiques Wikipedia/Wikidata de la recherche de personnes restent
hors de cette façade et ne deviennent aucune preuve de relation ou d'identité Plex.

## Réseau et sécurité

- PWA/APK utilisent `authenticatedFetch` et la résolution d'origine SeenIt existante. Le token Firebase
  n'est transmis qu'au backend SeenIt. Le middleware Firebase existant est injecté à l'installation
  des routes ; le module de politique et le runtime pur n'importent pas Firebase Admin.
- TMDB/OMDb restent des proxys GET à allowlist stricte. La route TVDB n'est **pas** un proxy générique :
  elle accepte uniquement `mediaType`, un `tvdbId` positif et/ou un IMDb ID exact `tt…` pour résoudre
  une franchise/univers selon `SEENIT-RELATION-001`.
- Aucun titre, année, popularité, mot-clé ou URL fournisseur ne peut être fourni à la route TVDB. Une
  absence de TVDB ID utilise uniquement l'IMDb ID exact avec `search/remoteid/{id}` côté serveur.
- Le résolveur TVDB n'examine que les listes déjà rattachées au média exact, retient exactement une
  liste officielle explicitement qualifiable `franchise` ou `universe`, refuse les ambiguïtés et
  remappe chaque membre vers un TMDB ID + type exact avant de répondre.
- Hôtes HTTPS fournisseurs constants, redirections refusées, timeout 10 s incluant lecture ; réponse
  JSON bornée à 4 Mio. Aucun secret, token ou erreur brute fournisseur n'est relayé au client.
- Limites par UID : 240 TMDB / 90 OMDb / 30 TVDB par minute. Les limites sont locales à chaque instance
  Cloud Run, avec `Retry-After` sur 429.
- Cache serveur des succès TMDB/OMDb : 5 min, 200 entrées/16 Mio maximum avec déduplication des requêtes
  en vol. Les relations TVDB ont un cache borné à 120 entrées pendant 5 min ; le token TVDB reste
  uniquement côté serveur et est renouvelé indépendamment des clients.
- Une rotation de secret invalide les caches fournisseur. Les erreurs ne sont jamais transformées en
  succès ni cachées comme relations valides.

## Configuration et livraison

`TMDB_API_KEY`, `OMDB_API_KEY` et `TVDB_API_KEY` sont des variables **serveur uniquement**. Il n'existe
aucune variante `VITE_*`. Les anciennes valeurs qui ont pu être exposées dans un client ne doivent
jamais être recopiées depuis Git, un ticket ou des logs.

TMDB et OMDb restent obligatoires au démarrage du backend canonique. TVDB est requis pour que la section
franchise/univers fonctionne ; si sa configuration est absente ou indisponible, la route relationnelle
échoue fermée et la fiche masque seulement cette section. Pour considérer #130 déployée, la révision
production doit néanmoins être validée avec TVDB configuré.

1. Provisionner/renouveler les trois secrets via l'infrastructure Cloud Run autorisée, sans les exposer
   dans GitHub ou une commande visible.
2. Vérifier les appels serveur TMDB/OMDb et une résolution TVDB exacte dans un environnement autorisé.
3. Déployer le backend canonique avant l'APK qui dépend de ces routes ; la révision candidate doit
   réussir sa readiness avant de recevoir du trafic.
4. Publier ensuite l'APK groupée. Une rotation future de secret ne nécessite pas de nouvelle APK.

Ne pas contourner un échec de déploiement en réintroduisant une clé ou un hôte fournisseur dans le
frontend. Une ancienne révision Cloud Run reste préférable à une candidate incomplète, mais une APK
qui dépend de la nouvelle façade n'est publiée qu'après disponibilité réelle du backend requis.

## Preuves automatisées attendues

Les tests HTTP couvrent authentification, allowlists, absence de fuite, JSON malformé, timeout, quotas,
caches bornés/déduplication et séparation des UID. Les TNR TVDB couvrent l'IMDb `remoteid` exact, le
type movie/tv, l'absence de recherche par titre, l'unicité d'une liste officielle et le remapping TMDB
exact. Les tests client vérifient que PWA/APK n'appellent que SeenIt.

Tous les fichiers JS/sourcemaps du build Web embarqué dans Capacitor sont scannés. Ils ne doivent
contenir ni `VITE_TMDB_API_KEY`, ni `VITE_OMDB_API_KEY`, ni `VITE_TVDB_API_KEY`, ni les hôtes API
fournisseurs. Le bundle serveur reste hors de `dist/`, donc hors APK.
