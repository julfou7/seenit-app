# AUDIT-2026-09-10-FRAME-PACING — fluidité Android et longues listes

## État

- **Identifiant :** AUDIT-2026-09-10-FRAME-PACING
- **Date :** 2026-09-10
- **Baseline observée :** SeenIt 1.4.135, commit `158f27b`
- **Dernière vérification :** 2026-09-10
- **Statut :** audit terminé, corrections rattachées à l'issue #229 ; validation terrain 120 Hz encore ouverte
- **Issue de référence :** [#229](https://github.com/julfou7/seenit-app/issues/229)

## Périmètre et méthode

L'audit croise :

- la vidéo Android `Screen_Recording_20260910_141919_SeenIt.mp4` fournie avec le signalement ;
- l'extraction des 5 010 timestamps de présentation de sa piste H.264 variable (65,57 s, 1080 × 2340) ;
- des planches aux timestamps de démarrage, d'Explorer et de la fin Profil → Ma Liste ;
- la revue des cycles de rendu, Effects, observers, images et requêtes dans `App`, Explorer, À Regarder,
  Historique, Profil/Ma Liste, les cartes média, le cache diffuseur et la disponibilité Plex ;
- les contrats et TNR existants de `SEENIT-PERF-001`, #229, #243, #245 et #250.

La fréquence d'encodage d'une capture d'écran n'est pas un compteur GPU : l'enregistrement ajoute son
propre coût et peut omettre des images identiques. Il permet toutefois de prouver les gels de plusieurs
centaines de millisecondes et leur position dans le parcours. La certification finale doit être effectuée
sur l'appareil cible avec les métriques Android de frames lentes/jank.

## Preuves vidéo

- Les passages statiques du début contiennent jusqu'à 121 images encodées par seconde : la source sait
  représenter une cadence 120 Hz.
- Des écarts de présentation atteignent 501 ms (18,205 → 18,706 s), 493 ms (9,341 → 9,834 s), 491 ms
  (55,208 → 55,699 s), 460 ms (3,448 → 3,908 s) et 416 ms (49,298 → 49,713 s).
- Explorer, entre 32 et 47 s, reste le plus souvent entre environ 86 et 120 images encodées/s malgré des
  à-coups. Le plus gros effondrement apparaît après Profil → Ma Liste : la seconde 49 ne contient que cinq
  images, puis plusieurs trous de 300 à 491 ms accompagnent le défilement horizontal des rangées.
- « Nouvelle École » peint un premier visuel vers 3,407 s puis le remplace vers 3,908 s. Après le second
  redémarrage, la même séquence recommence vers 9,834 puis 10,324 s.

## Points solides à préserver

- Les cartes Explorer utilisent déjà des identités et callbacks stables.
- Le cache diffuseur est désérialisé une fois, déduplique les requêtes en vol, borne la concurrence à
  quatre et regroupe ses écritures hors du chemin du scroll.
- `checkPlexAvailability` est cache-only par défaut sur les cartes ; la vidéo ne prouve aucun inventaire
  Plex réseau par carte.
- React Activity suspend les Effects des onglets et sous-vues cachés sans perdre leur état.
- Les premières rangées de Ma Liste sont différées verticalement et les vues exhaustives restent paginées.

## Constats et causes racines

### FP-01 — P1 — accumulation sans borne des cartes

**Symptôme :** les FPS se dégradent pendant une longue navigation et s'effondrent en fin de vidéo dans
Ma Liste.

**Cause prouvée :** `LibraryRow` et les carrousels réduits d'À Regarder augmentaient `visibleCount` par
lots mais rendaient toujours `slice(0, visibleCount)`. Aucune carte, image décodée ou Effect sortie du
viewport n'était libérée. Explorer rendait de même toutes les pages fusionnées du scroll infini. React
Activity conservait ensuite ces arbres déjà grossis au changement d'onglet.

**Classe affectée :** toute liste verticale ou horizontale progressive conservée pendant la session.

**Critère de sortie :** une fenêtre calculée depuis le viewport borne les nœuds montés ; des espaceurs
conservent la géométrie totale, la position et l'inertie ; un TNR vérifie une liste de 200/500 éléments.

### FP-02 — P1 — source d'image remplacée après la première peinture

**Symptôme :** « Nouvelle École » charge visiblement deux images à chaque redémarrage.

**Cause prouvée :** `ContinueWatchingCard` peignait le backdrop ou poster, lançait
`tmdb.getEpisodeDetails` dans un Effect de montage, puis remplaçait `img.src` par le still reçu. Le cache
mémoire local à la carte disparaissait au redémarrage, donc la séquence était répétée.

**Classe affectée :** toute série À Regarder dont le prochain épisode ne possède pas déjà un still
persisté.

**Critère de sortie :** une carte passive utilise le still déjà connu, sinon un fallback stable, et ne
demande plus les détails d'épisode pour remplacer le visuel affiché.

### FP-03 — P1 — fan-out d'enrichissements passifs pendant les gestes

**Symptôme :** des à-coups apparaissent lors du montage de nouveaux lots, y compris hors Explorer.

**Cause prouvée :** Continue, Films, À jour, À venir, Historique et les anciennes cartes Épisode appelaient
directement `getWatchProviders` à leur montage. Les cartes Films réduites demandaient aussi leurs détails
complets ; Historique lançait jusqu'à vingt détails d'épisode en parallèle et publiait les titres un par un.
La politique viewport + période calme + idle de #230 ne s'appliquait qu'à `GridMediaCard`.

**Classe affectée :** toute carte passive spécialisée qui enrichit une métadonnée décorative.

**Critère de sortie :** politique commune proche du viewport, suspendue pendant le scroll, fournisseurs
bornés à quatre, détails Historique bornés à deux et publiés en un lot ; les cartes film réduites restent
cache-only et les détails de la vue exhaustive attendent la période calme avec une concurrence de deux.

### FP-04 — P2 — invalidation globale lors d'une synchronisation

**Symptôme :** une synchronisation terminée pendant un geste peut rerendre toutes les cartes conservées.

**Cause prouvée :** certains chemins, dont la synchronisation Plex, passaient un tableau Firestore neuf à
`setShows`. Même sans changement métier, toutes les références d'objets pouvaient être remplacées et le
cache utilisateur sérialisé.

**Classe affectée :** toute synchronisation distante qui republie une bibliothèque sémantiquement
identique.

**Critère de sortie :** préserver les références des médias dont la signature est inchangée et ne publier
ni persister aucun nouvel état lorsque toute la bibliothèque est identique.

### FP-05 — P2 — travail de direction de scroll à chaque événement Explorer

**Symptôme :** le défilement Explorer conserve des à-coups résiduels malgré les correctifs précédents.

**Cause prouvée :** le gestionnaire React examinait chaque événement de scroll et pouvait piloter l'état de
la barre de recherche dans le même chemin que le geste.

**Classe affectée :** surfaces à haute fréquence pilotant une UI secondaire depuis `scroll`.

**Critère de sortie :** consolider les événements dans `requestAnimationFrame` et ne publier que les
changements de seuil effectifs.

## Matrice exhaustive des constats

| Constat | Priorité | Impact | Traitement | Traçage |
|---|---:|---|---|---|
| FP-01 | P1 | DOM, images et Effects croissent avec la session | fenêtrage horizontal/vertical borné et espaceurs | [#229](https://github.com/julfou7/seenit-app/issues/229) |
| FP-02 | P1 | double téléchargement/décodage et flash visuel au redémarrage | source passive stable, aucun détail d'épisode au montage | [#229](https://github.com/julfou7/seenit-app/issues/229) |
| FP-03 | P1 | réseau et commits React concurrencent les gestes | hook passif commun + détail Historique borné/regroupé | [#229](https://github.com/julfou7/seenit-app/issues/229) |
| FP-04 | P2 | rerendu global à la fin d'une sync, Plex comprise | conservation des références et no-op sémantique | [#229](https://github.com/julfou7/seenit-app/issues/229) |
| FP-05 | P2 | travail synchrone récurrent dans Explorer | consolidation rAF et transitions de seuil seulement | [#229](https://github.com/julfou7/seenit-app/issues/229) |
| Certification absolue 120 Hz | Risque résiduel | dépend du matériel, du recorder, du réseau et du contenu | risque non accepté comme preuve de livraison ; #229 reste ouverte jusqu'au profil terrain Android | [#229](https://github.com/julfou7/seenit-app/issues/229) |

## Amélioration continue

Après livraison, reproduire le parcours de la vidéo sans enregistrement puis avec enregistrement, relever
les frames lentes/jank Android et comparer une session courte à une session ayant parcouru plusieurs pages
Explorer et toutes les rangées de Ma Liste. Toute régression doit être traitée dans #229 avec le timestamp,
la surface, le nombre d'éléments chargés et la présence éventuelle d'une synchronisation active.
