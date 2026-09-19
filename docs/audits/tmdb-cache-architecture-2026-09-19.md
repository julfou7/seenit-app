# Audit final #410 — cache et appels TMDB

Date : 19 septembre 2026  
Baseline code : `main` `a65e7a69fad71b18c6540712e0a931319a2ba9fa` avant le lot de clôture.

## Conclusion

SeenIt utilise désormais un **working set public borné**, pas un miroir TMDB. Les familles à forte
réutilisation générale (détails, Discover, saisons) sont persistées dans IndexedDB ; Search reste
mémoire-only pour ne pas persister le texte saisi. Deux familles restent volontairement spécialisées :
diffuseurs et classification parentale. Les familles rares ou à faible signal terrain conservent le
cache backend générique de 5 minutes et, lorsqu'il existe, un petit cache mémoire client.

Aucun cache public générique n'ajoute de lecture Firestore. Le seul index public Firestore de cette
architecture reste la preuve parentale déjà existante, bornée à 40 identités par lot et à 7 jours.

## Inventaire complet des familles

Le proxy classe tous les appels TMDB dans les familles ci-dessous. Son cache commun backend s'applique
à toutes : succès 5 minutes, au plus 200 entrées et 16 Mio, avec single-flight et rotation LRU.

| Famille | Endpoints / surface | Cache client | Fraîcheur / stale | Persistance | Volatilité / décision |
| --- | --- | --- | --- | --- | --- |
| `details` | `/{movie,tv}/:id` + append credits, ratings, IDs, images, keywords ; fiches | couche commune | 24 h / 30 j stale-if-error transitoire | IndexedDB, ≤120 mémoire | moyenne ; payload lourd, >1 Mio reste mémoire-only |
| `discover` | `/discover/{movie,tv}` ; Explorer canonique, filtres et pages | couche commune | 2 min / 30 min | IndexedDB, ≤96 mémoire | forte ; ordre/popularité évoluent vite |
| `search` | `/search/movie|tv|multi|person` ; recherche | couche commune | 5 min / 30 min | **mémoire seulement**, ≤80 | forte ; le texte utilisateur n'est jamais persisté |
| `season` | `/tv/:id/season/:n` ; liste d'épisodes d'une saison | couche commune | 2 h / 24 h | IndexedDB, ≤80 mémoire | moyenne ; saison en cours susceptible d'évoluer |
| `episode` | `/tv/:id/season/:n/episode/:n` ; ouverture épisode | cache LRU dédié | 30 min, pas de stale | mémoire seulement, **≤120** | moyenne ; aucune répétition observée dans la baseline, donc pas de persistance |
| `watch_providers` | `/{movie,tv}/:id/watch/providers` ; badges et « Où regarder » | spécialisé | mémoire 30 min ; local 6 h / 7 j stale | localStorage compact FR, 120 découverte + 240 bibliothèque | forte ; deux priorités de rétention indispensables |
| `parental` | release_dates / content_ratings + batch `/api/media/parental-ratings` ; filtre âge | spécialisé | client 7 j / 30 j stale ; backend 7 j | localStorage ≤1 500 + Firestore public 7 j, max 40 identités/lot | sensible ; preuve/batch/fail-closed distincts |
| `collection` | `/collection/:id` ; saga/collection | LRU dédié + single-flight | session ; backend 5 min | aucune | faible ; LRU 40 côté client, pas de signal justifiant IndexedDB |
| `find` | `/find/:externalId` ; résolution d'identité exacte | backend générique | 5 min backend | aucune | faible ; appel ponctuel, identité technique |
| `person` | personne, crédits combinés, popularité personne | backend générique | 5 min backend | aucune | moyenne ; surface ponctuelle, pas de signal terrain |
| `trending` | `/trending/*` et helpers historiques de découverte | backend générique | 5 min backend | aucune | très forte ; le chemin Explorer canonique préfère Discover normalisé |
| `metadata` | keywords/recommendations/similar/external_ids/credits/images/videos | détails lorsque déjà appendus, sinon backend | détails 24 h ou backend 5 min | via snapshot détail quand présent | variable ; éviter un second appel quand le détail contient déjà la slice |

### Relations TVDB

Les relations de franchise/univers ne sont pas une famille TMDB. Elles gardent leur manifeste local et
le cache TVDB backend dédié (120 entrées / 5 min), sans lecture par titre et sans mélange avec ce cache.

## Politique TTL et stale

La règle est **par donnée, jamais universelle** :

- 2 min : pages Discover dont le classement évolue vite ;
- 5 min : Search mémoire et cache fournisseur backend générique ;
- 30 min : épisode mémoire ; Discover stale maximum ;
- 2 h : saison fraîche ;
- 6 h : diffuseur FR frais ;
- 24 h : fiche fraîche ; saison stale maximum ;
- 7 j : diffuseur stale et preuve parentale fraîche, y compris l'index backend ;
- 30 j : fiche stale et preuve parentale stale locale.

Un stale public générique ne masque jamais 401/403/404 ; seuls réseau, 408, 425, 429 et 5xx autorisent
le repli. Pour l'âge, l'absence de preuve reste « âge à vérifier » et n'est jamais transformée en preuve
positive.

## Baseline réelle et session représentative

### Échantillon terrain

Le premier compteur post-déploiement réellement exploitable, relu dans les runs d'audit
`35398784296` puis `35422020613`, contient 25 requêtes :

| Famille | Requêtes | Hits backend | Upstream | Octets upstream |
| --- | ---: | ---: | ---: | ---: |
| details | 22 | 0 | 22 | 2 964 629 |
| season | 3 | 2 | 1 | 82 074 |
| **Total** | **25** | **2** | **23** | **3 046 703** |

Ce lot est **réel mais trop petit pour être qualifié seul de session représentative**. Il a néanmoins
justifié la phase saisons : deux réouvertures sur trois étaient déjà absorbées par le backend.

### Replay déterministe représentatif

Le TNR `tests/tmdbCacheArchitecture.test.ts` définit une session utilisateur conservatrice sur deux
ouvertures de l'application : deux pages Explorer, deux fiches, une recherche, une saison, un diffuseur
et une preuve parentale, puis la même navigation après redémarrage.

Pour ne pas surestimer le gain, le replay compte chaque miss client comme un appel fournisseur et
**ignore le cache backend 5 min** :

- baseline v1.4.166 : 14 appels potentiels sur les deux ouvertures ;
- architecture #410 : 9 appels potentiels ;
- baisse contractuelle : 5 appels, soit **35,7 %** sur l'ensemble des deux ouvertures ;
- sur la seule seconde ouverture : 6 appels potentiels deviennent 1, soit **83,3 % de baisse**.

Le seul appel volontairement répété après redémarrage est Search, car son texte ne doit pas être
persisté. Diffuseurs et âge étaient déjà persistants avant #410 ; ils ne sont donc pas comptés comme un
gain artificiel de la nouvelle couche.

## Pourquoi âge et diffuseurs restent spécialisés

### Diffuseurs

Le cache diffuseur ne doit pas être aplati dans le cache générique : il conserve uniquement le pays FR,
regroupe les écritures hors scroll et sépare la découverte (120) de la bibliothèque (240) afin qu'Explorer
ne puisse pas évincer les médias suivis. La couche commune n'a volontairement aucune notion de priorité
« bibliothèque ». Migrer aujourd'hui dupliquerait la donnée ou ferait perdre cette propriété sans gain
mesuré.

### Classification parentale

La classification pilote un filtre sensible et possède un contrat distinct : payload compact, batch de
40, budget fournisseur, fail-closed, distinction « inconnu »/preuve, cache client 7 j et index public
backend 7 j. Cet index Firestore sert précisément la réutilisation cross-device du filtre âge. Le cache
générique IndexedDB est local à un appareil et ne peut pas le remplacer ; le doubler augmenterait le
stockage sans supprimer les lectures nécessaires au batch.

Décision : **convergence d'identité et d'observabilité, pas convergence physique du stockage**.

## Bornes PWA / APK / backend

Le même bundle TypeScript de cache public est utilisé en PWA et embarqué par Capacitor pour l'APK.

- IndexedDB public : 320 entrées maximum, 32 Mio total, 1 Mio maximum par payload persistant.
- Mémoire commune : détails 120, Discover 96, Search 80, saisons 80.
- Épisodes : LRU 120, TTL 30 min.
- Diffuseurs : mémoire 80 ; persistance 120 découverte + 240 bibliothèque.
- Parentale : mémoire 240 côté client, localStorage 1 500 ; backend mémoire 5 000, TTL 7 j.
- Backend TMDB générique : 200 réponses / 16 Mio / 5 min.
- Firestore : aucune lecture/écriture générique ajoutée par #410 ; seulement l'index parental existant,
  limité à 40 identités par lecture/écriture de lot et expiré logiquement après 7 jours.

Le TNR final verrouille ces bornes et interdit qu'un import Firestore apparaisse dans
`publicMetadataCache.ts`.

## Critère de réouverture

#410 est considéré terminé tant que ces bornes et politiques restent vraies. Une future famille n'est
migrée vers IndexedDB ou Firestore que si les métriques montrent un gain mesurable ; elle ouvre alors un
nouveau chantier ciblé au lieu de réouvrir une migration globale sans signal.
