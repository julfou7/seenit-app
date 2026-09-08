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
- La limitation par UID distingue le trafic vers SeenIt des départs réels fournisseur. Les plafonds
  anti-abus sont de 1 800 requêtes TMDB, 360 OMDb et 120 TVDB par minute et par UID. Le quota
  fournisseur n'est consommé que lorsqu'un cache miss crée effectivement un nouvel appel upstream :
  600 TMDB, 90 OMDb et 30 résolutions TVDB par minute et par UID. Un hit du cache ou une requête
  dédupliquée déjà en vol ne consomme pas ce quota fournisseur. Les compteurs restent locaux à chaque
  instance Cloud Run et toute limitation renvoie `Retry-After` avec un HTTP 429.
- Cache serveur des succès TMDB/OMDb : 5 min, 200 entrées/16 Mio maximum avec déduplication des requêtes
  en vol. Les relations TVDB ont un cache borné à 120 entrées pendant 5 min ; le token TVDB reste
  uniquement côté serveur et est renouvelé indépendamment des clients.
- Une rotation de secret invalide les caches fournisseur. Les erreurs ne sont jamais transformées en
  succès ni cachées comme relations valides.

## Configuration et livraison

`TMDB_API_KEY`, `OMDB_API_KEY` et `TVDB_API_KEY` sont des variables **serveur uniquement**. Il n'existe
aucune variante `VITE_*`. Les anciennes valeurs qui ont pu être exposées dans un client ne doivent
jamais être recopiées depuis Git, un ticket ou des logs.

TMDB, OMDb et TVDB sont obligatoires au démarrage d'une nouvelle révision du backend canonique. Une
candidate à laquelle manque l'un de ces trois secrets est refusée avant promotion. Les trois variables
sont injectées depuis Secret Manager par référence de secret ; aucune valeur fournisseur n'est copiée
dans GitHub, le workflow ou l'export Cloud Run. Une panne fournisseur après démarrage reste fail-closed.

1. Provisionner/renouveler les trois secrets dans Secret Manager, sans exposer leurs valeurs.
2. Accorder au compte de service runtime Cloud Run le rôle `Secret Manager Secret Accessor` sur chacun
   des trois secrets. Le rôle projet `Editor` ne donne pas accès au payload d'un secret.
3. Le préparateur de candidate remplace toute ancienne variable en clair par une référence
   `secretKeyRef` vers `TMDB_API_KEY`, `OMDB_API_KEY` et `TVDB_API_KEY`, version `latest`.
4. Vérifier les appels serveur TMDB/OMDb et une résolution TVDB exacte dans un environnement autorisé.
5. Déployer le backend canonique avant l'APK qui dépend de ces routes ; la candidate doit réussir sa
   readiness et ses smokes avant de recevoir du trafic.
6. Publier ensuite l'APK groupée. Une rotation future de secret ne nécessite pas de nouvelle APK.

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
