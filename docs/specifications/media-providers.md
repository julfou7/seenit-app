# Façade métadonnées — #12

Contrat SEENIT-SECURITY-001 ; baseline main `374b931`, 1.4.120. Cette migration est en PR #182,
pas encore prouvée en production. Les valeurs serveur valides/renouvelées restent un prérequis.

## Inventaire et portée

| Consommateur | Opérations | Destination |
|---|---|---|
| tmdbClient.ts | Recherche, find par ID, fiches, saisons/épisodes, collections, fournisseurs, mots-clés, personnes, discover/trending | GET /api/media/tmdb/… |
| tmdb.ts | Discover cinéma France, décorations âge/cinéma conservées | Même façade TMDB |
| lib/recommendations.ts | Discover genres/personnes et fallback populaire | Même façade TMDB ; scoring inchangé |
| omdbService.ts | Notes IMDb par ID exact, saison et épisodes incomplets | GET /api/media/omdb?i=tt…&Season=… |
| services/tvdb.ts legacy | Aucun appelant runtime ; ancien matching par titre/liste interdit | Module supprimé, aucune route TVDB |
| Runtime Plex | Aucun déplacement ni changement des preuves de visionnage | Runtime existant indépendant de Firebase au chargement |

Les métadonnées publiques Wikipedia/Wikidata des recherches de personnages sont hors migration des
secrets ; elles ne deviennent pas des preuves d'univers ni d'identité Plex. Les affiches publiques
TMDB restent chargées directement sans secret.

## Réseau et sécurité

- PWA/APK utilisent authenticatedFetch et la résolution d'origine SeenIt existante. Le token Firebase
  n'est transmis qu'au backend SeenIt. Le middleware Firebase existant est injecté à l'installation
  des routes ; le module de politique et le runtime pur n'importent pas Firebase Admin.
- GET uniquement ; chemins et paramètres exacts nécessaires à l'inventaire autorisés. Ni URL cible,
  chemin arbitraire, clé client, paramètre dupliqué/structuré ou endpoint compte/auth fournisseur.
- Hôtes HTTPS constants, redirections refusées, timeout 10 s incluant lecture ; réponse JSON bornée
  à 4 Mio, aucune réponse HTML/erreur brute fournisseur relayée. Secret ou token reconnu dans une
  réponse entraîne un échec fermé. Statuts 400/401/404/429/502/503/504 explicites et messages neutres.
- Limite par UID et fournisseur : 240 TMDB / 90 OMDb par minute, mémoire bornée, Retry-After sur 429.
  Limites locales à chaque instance Cloud Run, pas un quota distribué garanti.
- Cache serveur des seuls succès publics : 5 min, 200 entrées/16 Mio maximum, requêtes en cours
  dédupliquées. Clé provider + chemin + paramètres triés, aucun token utilisateur ni clé fournisseur.
  Authentification et limitation restent appliquées avant consultation du cache. Une rotation invalide
  l'état de cache ; les erreurs ne sont pas cachées. Les caches clients historiques restent inchangés.

## Configuration et livraison

TMDB_API_KEY et OMDB_API_KEY sont des variables serveur uniquement (pas VITE). Aucun secret TVDB
n'est requis par le runtime sans opération TVDB utilisée. Ne pas recopier les anciennes clés exposées.

1. Provisionner les valeurs renouvelées via le gestionnaire de secrets/variables Cloud Run, sans
   les copier dans Git, un ticket, un export de logs ou une commande visible.
2. Vérifier leur présence et un appel fournisseur valide dans un environnement serveur autorisé.
3. Déployer d'abord le backend canonique avec le frontend PWA compatible ; vérifier avec un compte
   la recherche, une fiche Film/Série, une saison et les notes IMDb, puis publier l'APK groupée.
4. Pour une rotation future : changer la version de secret serveur et déployer une révision, vérifier
   les deux opérations ; aucune nouvelle APK n'est requise. Les anciennes APK contenant une clé
   exposée doivent être mises à jour avant sa révocation pour éviter leur panne ; ne pas différer
   indéfiniment la révocation d'une clé compromise (#30).

Ne pas merger la bascule si les secrets runtime ne sont pas prouvés : un health-check seul ne prouve
pas l'accès TMDB/OMDb. Ne pas affaiblir le backend ni réintroduire la clé client pour contourner ce verrou.

## Preuves automatisées attendues

Tests HTTP avec authentification injectée et fournisseur simulé : refus avant appel, allowlist,
absence de fuite, HTTP/JSON malformé, timeout, quota, cache borné/déduplication et séparation des UID.
Tests de caractérisation du client : même identité movie/tv, cache chaud/déduplication, recherche,
notes et erreurs. Scanner tous les fichiers JS du build Web (embarqué inchangé dans Capacitor) ; le
bundle serveur est généré hors de `dist/` afin de ne jamais être copié dans l'APK. Scanner notamment
les éventuelles sourcemaps pour les signatures de secrets interdits. Le scan d'un bundle
ne constitue pas un test tactile ni un contrôle d'une APK ancienne déjà installée.
