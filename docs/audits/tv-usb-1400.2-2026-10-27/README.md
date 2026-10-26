# Samsung Q6FN — bilan des vérifications hors TV

Date : 27 octobre 2026. Suivi : [#295](https://github.com/julfou7/seenit-app/issues/295),
PR TV [#760](https://github.com/julfou7/seenit-app/pull/760).
Matériel : **QE55Q6FNA, génération2018, Tizen4.0**, logiciel **T-KTM2DEUC-1400.2, BT-S**
confirmé par la photo du propriétaire. Widget installé0.2.2 ; code produit inchangé.

Ce dossier conserve sur GitHub le bilan, les sources exactes et les preuves d'intégrité
précédemment transmises localement. Le [manifeste JSON](./verifications.json) contient les
tailles, empreintes et contrôles effectués. Le [bilan RAM et services](../tv-ram-services-2026-10-26.md)
reste la référence pour les mesures matérielles.

## Résultat établi

Le firmware officiel correspondant à la famille installée a été téléchargé pour une
analyse hors TV. Son empreinte et celle de `uImage` correspondent aux références publiées.
La table MSDU11 a été lue ; les CRC du noyau et de la partition système ont été vérifiés.

| Artefact vérifié | Taille | Résultat |
|---|---:|---|
| Archive Samsung | 1 375 406 746 octets | SHA-256 conforme à la référence publiée |
| `uImage` | 6 506 176 octets | SHA-256 de référence, CRC32 de section, d'en-tête et de données conformes |
| Corps du noyau | 6 505 800 octets | Linux4.1.10 ; empreinte locale conservée |
| `platform.img` | 1 362 239 488 octets | Taille et CRC32 conformes à la table ; empreinte locale conservée |

Ces contrôles attestent les fichiers analysés. Ils ne prouvent ni un accès root sur la TV,
ni la compatibilité d'une chaîne complète. Le pilote exFAT n'a pas été extrait et vérifié
indépendamment ; aucun test complet n'a été réalisé.

## Compatibilité et limites

La matrice amont classe **Kant-M2 / T-KTM2DEUC1400.2** comme candidat statique nécessitant
une adaptation propre à cette génération. Son représentant2018 est une Q8FN de la même
famille logicielle ; ce n'est pas une preuve matérielle sur cette Q6FN.

Le résultat matériel publié pour le Q70T concerne une autre génération et une autre famille
de firmware. Aucun profil2019, patch de démarrage Q70T ou fichier de firmware n'a été
installé sur la Q6FN. Aucune image USB prête à utiliser n'a été produite.

Le propriétaire dispose d'une clé de32Go. Au dernier inventaire PC, seule l'unité NVMe
système était présente : aucune clé formatée et aucun disque brut modifié.

Le propriétaire a ensuite signalé un refus d'affichage cybersécurité de la plateforme.
La préparation de l'exploit a été arrêtée. Cette publication est limitée à la documentation
et aux contrôles d'intégrité : elle ne contient ni payload, ni chaîne d'exploitation,
ni clé, ni firmware propriétaire, ni identifiant personnel. Elle ne lève pas cette restriction.

## Sources figées

- [Matrice de compatibilité USB](https://github.com/Luminger/samsung-tv-usb-root/blob/223f1cd6cca185f93fe7db53ef71eb52963a7086/docs/FIRMWARE-COMPATIBILITY.md),
  source `Luminger/samsung-tv-usb-root`, commit `223f1cd6cca185f93fe7db53ef71eb52963a7086`.
- [Format et extraction MSD](https://github.com/theubusu/unixtract/tree/3310492cf19c56617acfe84f2f36f14aaab0df5b),
  source `theubusu/unixtract`, commit `3310492cf19c56617acfe84f2f36f14aaab0df5b`.
- [Référence matérielle Q70T distincte](https://github.com/cfloinc/samsung-q70t-tizen-root/tree/a160316e70c00b4b83342cfe4bbc8036473533bc),
  commit `a160316e70c00b4b83342cfe4bbc8036473533bc`.
- [Source VDFS consultée, non exécutée](https://github.com/gtors/vdfs-unpack/tree/0bc1e65b74016fbd59d5d68f09ab7920044be1f9),
  commit `0bc1e65b74016fbd59d5d68f09ab7920044be1f9`.
- [Paquet officiel Samsung analysé](https://org.downloadcenter.samsung.com/content/FM/202607/20260729103150980/T-KTM2DEUC.zip).
  Ce lien documente la provenance ; la TV possède déjà cette version.

## RAM et fonctions déjà vérifiées

AirPlay et HbbTV ont été désactivés par le propriétaire. Aucun interrupteur de réveil vocal
utilisable n'a été trouvé ; sa désactivation n'est pas confirmée.

Dernière médiane observée : **372,8MiB disponibles**, contre331,0MiB pour la référence
précédente. L'écart de41,8MiB est ponctuel : variations des caches et relance du widget
empêchent d'attribuer un gain durable aux services. Aucun service système n'a été arrêté.

## Prochaine action et critère de fin

Les travaux SeenIt sans root restent actionnables : appairage foyer/profil, calendrier réel
suivi dans[#738](https://github.com/julfou7/seenit-app/issues/738) et mesures RAM comparables.
La recherche root reste incomplète et dépend de la résolution de la restriction signalée.

Le lot documentaire est terminé lorsque ce dossier et ses preuves sont accessibles sur
GitHub. Cela ne clôture pas[#295](https://github.com/julfou7/seenit-app/issues/295) et ne
constitue ni une nouvelle installation TV, ni une release mobile.
