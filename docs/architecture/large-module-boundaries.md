# Frontières des grands modules SeenIt

Date de référence : 13 septembre 2026
Issue : [#14](https://github.com/julfou7/seenit-app/issues/14)
Exigence : `SEENIT-QUALITY-001`

Ce découpage est une extraction structurelle sans changement visuel ou métier. Les points d’entrée
publics restent stables et les écrans continuent d’être chargés paresseusement depuis `App.tsx`.

## Répartition

| Cible | Avant sur `main` | Modules après extraction |
|---|---:|---|
| Fiche média | `ShowDetailScreen.tsx` 180 + cœur 1 273 | point d’entrée 180, contrôleur 986, vue 232, présentation 148 |
| Sonarr / Radarr | 2 434 | façade 37, transport 790, recherche/envoi 879, file live 809 |
| Explorer | 2 024 | contrôleur 993, vue 646, hero 326, présentation 177 |
| Synchronisation Plex | 1 990 | façade 19, résolution 650, liens 346, orchestrateur 1 134 |
| Ma Liste | 1 643 | contrôleur 615, vue 627, présentation/cartes 489 |

Les TNR source lisent désormais les fichiers constitutifs de chaque feature avec
`tests/featureSource.ts`. Ils continuent donc de vérifier le comportement réellement déplacé au lieu
de dépendre artificiellement d’un unique fichier monolithique.

## Exception bornée

Exception bornée : `plexSyncEngine.ts` peut atteindre **1 150 lignes** au maximum. Il contient encore
1 134 lignes parce que l’orchestration `performPlexSync` porte une transaction cohérente : verrou de
synchronisation, collecte full/delta, convergence Firestore, curseur et notifications. La couper au
milieu de cette extraction pure augmenterait le risque de modifier l’ordre, l’atomicité ou
l’idempotence de la synchronisation.

La résolution d’identité Plex, les appels d’historique, les liens externes et la purge ont toutefois
été retirés de cet orchestrateur. Toute croissance au-delà de 1 150 lignes est bloquée par le TNR de
#14. Une réduction supplémentaire devra d’abord caractériser séparément les phases collecte,
réconciliation et commit Firestore.

## Garde-fous

- Les façades `sonarrRadarr.ts` et `syncPlex.ts` conservent leurs exports publics historiques.
- Les modules internes n’importent jamais leur façade, afin d’éviter les cycles.
- `ShowDetailScreen`, `DiscoverScreen` et `WatchListScreen` restent les points d’entrée lazy de
  `App.tsx`.
- Les 588 TNR existants étaient verts avant extraction ; le TNR #14 fige en plus les frontières,
  exports, bornes et sens des dépendances.
- La mesure du bundle avant/après est réalisée avec le build de production Vite et reportée dans la
  PR ainsi que dans le checkpoint de l’issue.

## Mesure du bundle de production

Les deux mesures utilisent le même SHA de base, les mêmes dépendances et `vite build` :

| Chunk | Avant | Après | Écart |
|---|---:|---:|---:|
| Initial `index` | 816,51 kB / 256,70 kB gzip | 779,67 kB / 246,02 kB gzip | −36,84 kB / −10,68 kB gzip |
| Explorer | 54,36 kB / 15,29 kB gzip | 56,83 kB / 15,93 kB gzip | +2,47 kB / +0,64 kB gzip |
| Ma Liste | 91,75 kB / 22,53 kB gzip | 92,99 kB / 22,75 kB gzip | +1,24 kB / +0,22 kB gzip |
| Fiche média | 92,70 kB / 23,39 kB gzip | 96,71 kB / 25,27 kB gzip | +4,01 kB / +1,88 kB gzip |
| Firebase | 838,82 kB / 205,93 kB gzip | 838,82 kB / 205,93 kB gzip | stable |

Le découpage retire donc **36,84 kB (4,5 %) du chunk initial** et **10,68 kB gzip (4,2 %)** en
isolant notamment 18,66 kB de service Sonarr/Radarr dans son propre chunk paresseux. Les légères
hausses des chunks d’écran correspondent aux façades de vue explicites ; elles n’altèrent pas leurs
frontières lazy.
