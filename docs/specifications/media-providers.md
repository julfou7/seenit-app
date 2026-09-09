# Façade métadonnées — #12, #130 et #217

Contrats `SEENIT-SECURITY-001`, `SEENIT-RELATION-001` et `SEENIT-RATING-001`. Les valeurs serveur
valides restent un prérequis de production ; aucune clé fournisseur ne doit être embarquée dans la
PWA ou l'APK.

## Inventaire et portée

| Consommateur | Opérations | Destination |
|---|---|---|
| `tmdbClient.ts` | Recherche, find par ID, fiches, saisons/épisodes, collections, fournisseurs, mots-clés, personnes, discover/trending | `GET /api/media/tmdb/…` |
| `tmdb.ts` | Cinéma France, notes, collection film exacte, hydratation des relations TVDB | Façade TMDB + client TVDB sécurisé |
| `lib/recommendations.ts` | Discover genres/personnes et fallback populaire d'Explorer | Même façade TMDB ; scoring Explorer inchangé |
| `services/tvdb.ts` | Franchise/univers depuis TVDB ID ou IMDb ID exact | `GET /api/media/tvdb/franchise` |
| Runtime Plex | Aucun déplacement ni changement des preuves de visionnage | Runtime existant indépendant des notes |

**OMDb n'est plus un fournisseur SeenIt.** La route `/api/media/omdb`, les caches dédiés et
`OMDB_API_KEY` sont retirés. Les notes affichées proviennent exclusivement de TMDB. Les identifiants
IMDb issus de TMDB restent autorisés uniquement comme identifiants techniques exacts, notamment pour
les ponts Plex/TVDB ; ils ne déclenchent aucun appel IMDb/OMDb.

Le client TVDB est une façade SeenIt minimale : il ne connaît ni hôte TVDB, ni jeton, ni clé et ne
transmet jamais de titre. Le backend est seul responsable du login TVDB et des appels à
`api4.thetvdb.com`. Les métadonnées publiques Wikipedia/Wikidata de la recherche de personnes restent
hors de cette façade et ne deviennent aucune preuve de relation ou d'identité Plex.

## Réseau et sécurité

- PWA/APK utilisent `authenticatedFetch` et la résolution d'origine SeenIt existante. Le token Firebase
  n'est transmis qu'au backend SeenIt. Le middleware Firebase existant est injecté à l'installation
  des routes ; le module de politique et le runtime pur n'importent pas Firebase Admin.
- TMDB reste un proxy GET à allowlist stricte. La route TVDB n'est **pas** un proxy générique : elle
  accepte uniquement `mediaType`, un `tvdbId` positif et/ou un IMDb ID exact `tt…` pour résoudre une
  franchise/univers selon `SEENIT-RELATION-001`.
- Aucun titre, année, popularité, mot-clé ou URL fournisseur ne peut être fourni à la route TVDB. Une
  absence de TVDB ID utilise uniquement l'IMDb ID exact avec `search/remoteid/{id}` côté serveur.
- Le résolveur TVDB n'examine que les listes déjà rattachées au média exact, retient exactement une
  liste officielle explicitement qualifiable `franchise` ou `universe`, refuse les ambiguïtés et
  remappe chaque membre vers un TMDB ID + type exact avant de répondre.
- Hôtes HTTPS fournisseurs constants, redirections refusées, timeout 10 s incluant lecture ; réponse
  JSON bornée à 4 Mio. Aucun secret, token ou erreur brute fournisseur n'est relayé au client.
- La limitation par UID distingue le trafic vers SeenIt des départs réels fournisseur. Les plafonds
  anti-abus sont de 1 800 requêtes TMDB et 120 TVDB par minute et par UID. Le quota fournisseur n'est
  consommé que lorsqu'un cache miss crée effectivement un nouvel appel upstream : 600 TMDB et 30
  résolutions TVDB par minute et par UID. Un hit du cache ou une requête dédupliquée déjà en vol ne
  consomme pas ce quota fournisseur. Les compteurs restent locaux à chaque instance Cloud Run et toute
  limitation renvoie `Retry-After` avec un HTTP 429.
- Cache serveur des succès TMDB : 5 min, 200 entrées/16 Mio maximum avec déduplication des requêtes en
  vol. Les relations TVDB ont un cache borné à 120 entrées pendant 5 min ; le token TVDB reste uniquement
  côté serveur et est renouvelé indépendamment des clients.
- Une rotation de secret invalide les caches fournisseur. Les erreurs ne sont jamais transformées en
  succès ni cachées comme relations valides.

## Notes et identité IMDb

`SEENIT-RATING-001` impose une source de notation unique :

- la note globale d'un film ou d'une série utilise `vote_average` / `vote_count` TMDB ;
- la note d'un épisode utilise les mêmes champs de l'épisode TMDB ;
- aucune normalisation ou substitution IMDb/TMDB n'est effectuée ;
- aucune route, cache ou requête OMDb/IMDb n'est autorisée pour produire une note ;
- un IMDb ID peut néanmoins continuer à transiter comme **identifiant technique exact** lorsque Plex,
  TVDB ou une autre résolution déjà autorisée le requiert.

L'ancienne base locale `ShowTrackerDB`, qui ne contenait que les caches OMDb, est supprimée de façon
best-effort au démarrage. Cette suppression n'affecte ni Firestore, ni progression, ni préférences, ni
identité utilisateur.

## Configuration et livraison

`TMDB_API_KEY` et `TVDB_API_KEY` sont des variables **serveur uniquement**. Il n'existe aucune variante
`VITE_*`. `OMDB_API_KEY` est obsolète et ne doit plus être injectée dans une révision SeenIt.

TMDB et TVDB sont obligatoires au démarrage d'une nouvelle révision du backend canonique. Une candidate
à laquelle manque l'un de ces deux secrets est refusée avant promotion. Les deux variables sont injectées
depuis Secret Manager par référence de secret ; aucune valeur fournisseur n'est copiée dans GitHub, le
workflow ou l'export Cloud Run. Le préparateur de candidate supprime explicitement une ancienne variable
`OMDB_API_KEY` héritée d'une révision précédente afin qu'elle ne soit pas reconduite. Une panne fournisseur
après démarrage reste fail-closed.

1. Provisionner/renouveler `TMDB_API_KEY` et `TVDB_API_KEY` dans Secret Manager, sans exposer leurs valeurs.
2. Accorder au compte de service runtime Cloud Run le rôle `Secret Manager Secret Accessor` sur ces deux
   secrets. Le rôle projet `Editor` ne donne pas accès au payload d'un secret.
3. Le préparateur de candidate remplace toute ancienne variable en clair par une référence `secretKeyRef`
   vers `TMDB_API_KEY` et `TVDB_API_KEY`, version `latest`, et retire `OMDB_API_KEY` si elle subsiste dans
   l'export de la révision servie.
4. Vérifier les appels serveur TMDB et une résolution TVDB exacte dans un environnement autorisé.
5. Déployer le backend canonique avant une APK qui dépend d'une évolution de façade ; la candidate doit
   réussir readiness et smokes avant de recevoir du trafic.
6. Une rotation future de secret ne nécessite pas de nouvelle APK.

Ne pas contourner un échec de déploiement en réintroduisant une clé ou un hôte fournisseur dans le
frontend. Une ancienne révision Cloud Run reste préférable à une candidate incomplète.

## Preuves automatisées attendues

Les tests HTTP couvrent authentification, allowlists, absence de fuite, JSON malformé, timeout, quotas,
caches bornés/déduplication et séparation des UID. Les TNR TVDB couvrent l'IMDb `remoteid` exact, le
type movie/tv, l'absence de recherche par titre, l'unicité d'une liste officielle et le remapping TMDB
exact. Les tests client vérifient que PWA/APK n'appellent que SeenIt et que le runtime ne contient plus
aucune route ou clé OMDb.

Tous les fichiers JS/sourcemaps du build Web embarqué dans Capacitor sont scannés. Ils ne doivent
contenir ni `VITE_TMDB_API_KEY`, ni `VITE_OMDB_API_KEY`, ni `VITE_TVDB_API_KEY`, ni les hôtes API
fournisseurs. La présence de `VITE_OMDB_API_KEY` dans cette liste est un garde anti-régression historique,
pas une configuration supportée. Le bundle serveur reste hors de `dist/`, donc hors APK.
