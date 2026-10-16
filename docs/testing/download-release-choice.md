# Terrain téléchargement — #661, #583 et #430

Baseline de reproduction : v1.4.208. Captures utilisateur du 04/10/2026 : reçu
« Import terminé · Vérification de Plex… », intention 4K en recherche et import 1080p terminé,
audio MULTI VFQ. Les captures ne prouvent pas à elles seules deux transferts physiques.

Causes reproduites dans les entrées de production : l'historique perdait le hash et le nom de release ;
une relance pouvait essayer un deuxième candidat après timeout ; le fallback C411 → ajout Radarr
démarrait une recherche automatique en parallèle du push choisi. Le cas privé exact reste à confirmer.

## Contrôles automatisés

- `downloadStoreReconciliationRuntime.test.ts` exécute le store central et l'hydratation partagée :
  import 1080p avec hash exact + intention 4K → une carte ; hash différents → cartes distinctes ;
  ancien import → demande récente conservée ; double appui → requestId/hash/progression conservés.
- `downloadLaunchGuardRuntime.test.ts` exécute les services réels : une commande par double appui,
  aucun deuxième candidat après grab ambigu, C411 film nouveau → ajout sans recherche puis un push exact.
- `arrManualReleases.test.ts` exécute recherche et grab réels avec transports simulés : consultation
  sans mutation, TMDB/TVDB/scope exacts, compte changé, refus de mapping, sélection unique après timeout.
- `downloadInteractiveTransport.test.ts` vérifie les transports PWA/Android, leur clé stable et l'absence
  de rejeu ambigu ; GET/POST release disposent de 30 secondes côté client natif/proxy.
- `releaseAudio.test.ts` distingue VFF/VFQ/MULTI et vérifie le blocage d'un autre envoi sur un scope actif.
- Rendu des composants réels avec ports fictifs : Chromium 360×640, 393×852 et 1280×800 ; badge audio,
  filtre VFF, choix, fermeture sans envoi, envoi unique, absence de débordement horizontal et CTA visible.
  Cela ne certifie pas le rendu Android natif de la notification.

## Téléphone et services privés

1. Installer l'APK officielle du lot ; noter sa version et fermer complètement SeenIt.
2. Lancer un film depuis une fiche canonique : un seul transfert physique doit apparaître dans le client.
   Après import, vérifier « ✅ Import terminé », puis « ✅ Disponible dans Plex » uniquement après
   confirmation Plex ; tap → fiche exacte et action Plex existante.
3. Laisser Arr importer/déplacer le fichier entre deux polls, puis rouvrir SeenIt. Un même hash ne doit
   pas produire une carte terminée plus une intention en recherche. Deux hash différents restent distincts.
4. Vérifier les badges avec une release MULTI VFQ et une MULTI VFF ; MULTI seul ne doit pas devenir VFF.
5. Depuis la carte terminée : ouvrir « Chercher une autre release », filtrer VFF, fermer/Retour → aucun
   transfert. Rouvrir, sélectionner une autre release et confirmer → seul ce candidat est envoyé.
6. Vérifier le refus d'une version actuelle reconnue par hash et le blocage si une demande du même scope
   est déjà active. Vérifier une saison TV et un épisode spécial S0 sans élargissement implicite du scope.
7. Depuis la fiche, choisir une release C411 d'un film absent de Radarr : ajout sans commande MoviesSearch,
   un seul push choisi. Un parse différent ou un timeout doit rester un échec visible, sans autre release.

La restriction du compte GitHub empêche actuellement CI distante, merge et publication. Aucun résultat
local ne vaut une preuve de release ou de terrain sur les services privés.
