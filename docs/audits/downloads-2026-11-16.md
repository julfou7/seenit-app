# Téléchargements — audit des améliorations, risques et manques (16/11/2026)

Baseline : main après la v1.4.332 (PR #1075), lot #661 / #1065 en cours (v1.4.333).
Demande du propriétaire : « fais une sorte d'audit des téléchargements à la recherche d'améliorations, risques, manques,
problèmes ».

## Périmètre et méthode

Parcours couverts : fiche (mode téléchargement série, bouton film), « Version précise » (C411 direct), « Autre version »
(recherche interactive Sonarr/Radarr), onglet Télécharger (En cours, À régler, Programmés, Téléchargés), suivi qBittorrent,
imports et notifications. Sources : retours terrain du 15 et 16/11 (v1.4.313 à v1.4.332), les 16 remarques Codex des
PR #1070 à #1075, lecture du code (`sonarrRadarrLive.ts`, `liveDownloadStoreCore.ts`, `AlternativeReleaseModal.tsx`,
`arrManualReleases.ts`, `sonarrRadarrTransport.ts`, `downloadMode.tsx`) et mesure des tests du domaine
(240 fichiers de test liés, 652 lectures de source contre 3 713 assertions de résultat).
Aucun essai réel n'a été rejoué pour cet audit : les constats terrain cités viennent des retours du propriétaire.

## État du backlog (validé terrain le 16/11)

Fermées après validation : #1062, #669, #427, #428, #801, #591 (et plus tôt #429, #430, #403, #664, #965).
#638 (pannes C411) : la panne HTTP/format du proxy C411 n'est plus un « aucun résultat » (v1.4.254), les indexers
en échec sont nommés en français avec « Retester les indexers » (v1.4.318) — reste ouvert jusqu'à une panne réelle
observée puis rétablie. #661 (VFF/VFQ) : traité dans ce lot (décision USR-2026-11-16-001).

## Matrice des constats

| # | Constat | Gravité | Preuve | Décision |
| --- | --- | --- | --- | --- |
| F1 | Aucune vérification d'espace disque avant de lancer une version : une release plus grosse que l'espace libre part quand même, l'import bloque ensuite. | P2 | Dexter S02E02 bloqué faute de place sur D: (15–16/11) ; aucune surface de lancement ne lit `arrDiskSpace`. | [#1076](https://github.com/julfou7/seenit-app/issues/1076) |
| F2 | Un transfert sans source (tracker muet, torrent mort) reste « En attente de sources » sans limite ni action. | P2 | Le refus explicite du tracker est traité (v1.4.329) ; aucun seuil de durée sans pair. | [#1077](https://github.com/julfou7/seenit-app/issues/1077) |
| F3 | Les TNR ajoutés au domaine lisent surtout le source (regex) : ils n'ont détecté aucune des 16 remarques Codex du jour et cassent au moindre renommage. | P2 (qualité) | PR #1070 à #1075 ; 3 tests corrigés pour un simple renommage. | [#1078](https://github.com/julfou7/seenit-app/issues/1078) |
| F4 | Le smoke navigateur ne tourne qu'en CI (Chrome cherché en chemins Linux, police) : sélecteurs obsolètes découverts après un cycle CI. | P3 (vitesse) | 3 cycles perdus le 16/11 ; #1065 rend locale la construction des harnais, pas leur exécution. | [#1079](https://github.com/julfou7/seenit-app/issues/1079) |
| F5 | Deux moteurs de versions coexistent : C411 direct (« Version précise » : âge, seeders) et recherche interactive Arr (« Autre version » : refus du profil). La « Conseillée » et les données diffèrent selon l'écran. | P3 | Même carte partagée, sources différentes. | Risque accepté : l'interface est unifiée (v1.4.325–331) ; unifier le classement seulement si un écart gêne sur le terrain. |
| F6 | Choisir une version refusée pour sa qualité change durablement le profil du titre (4K ↔ 1080p). | P3 | Bascule en un appui demandée le 16/11 (v1.4.328) ; le toast l'annonce. | Accepté (demande explicite) ; à revoir si une bascule involontaire est constatée. |
| F7 | VFF présumée pour MULTI/FRENCH sans marque québécoise : une release québécoise mal nommée serait annoncée VFF. | P3 | Convention des releases françaises (VFQ/QC toujours marqué). | Accepté par décision USR-2026-11-16-001. |
| F8 | Relecture chaque seconde de Sonarr, Radarr et qBittorrent quand l'onglet est ouvert avec un transfert actif, plus les trackers (1 lecture/min/torrent à l'arrêt, 5 max). | P3 | `liveDownloadStoreCore.ts` (1 s actif, 3 s onglet ouvert, 30 s sinon). | Accepté : charge bornée et voulue (retour « voir le 0 % puis avancer »). |
| F9 | La construction des harnais du smoke n'était vérifiée qu'en CI. | P3 | #1065. | Corrigé dans ce lot : `validate:change` construit les 10 harnais (2 s). |

## Points solides constatés

Identité média par TMDB et transfert par infohash (jamais par titre) ; envoi avant annulation lors d'un remplacement,
annulations vérifiées ; refus Sonarr/Radarr et du tracker traduits ; délais réseau bornés (lecture interactive
longue, autres appels 3 à 12 s) ; proxy PWA en liste blanche stricte, lectures seules pour les nouveaux diagnostics.

## Prochaines actions

F1 et F2 sont les deux manques les plus visibles pour l'utilisateur ; F3 et F4 réduisent les allers-retours CI.
Ordre proposé : F1, F2, F3, F4. Aucun constat n'est bloquant pour la v1.4.333.
