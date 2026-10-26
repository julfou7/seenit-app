# Terrain223 et marque v3

Baseline : main 79a1fad1ae385e46aa3a11ec43fc9bd1a8ed73e3, APK1.4.223. Chantier #729, bilan Plex #741. Aucun test sur téléphone physique par l’agent.

| Retour | Frontière fautive / correction | Preuve |
|---|---|---|
| Has Fallen 2 diffusés contre7/8, Knight ?, Madison1 | Le cache de fiche ne convergeait pas vers la preuve persistée de la carte ; preuve inconnue v4 et cache chaud pouvaient rester figés. Schéma5 avec dates compactes, réparation automatique et fraîcheur forcée lors de la synchronisation. Total déclaré distinct de la liste. | terrain223SeasonFacade.test.ts passe par tmdb.ts et ses vrais adapters, fournisseurs aux seules frontières ; Has Fallen/Knight/Madison/témoin/placeholder. |
| Sortie sans ouverture de fiche | Le cooldown worker12h pouvait ignorer une échéance. Exception sur frontière connue au scheduler existant, garde en cours ; rendu par dates locales reçues. | plexResumeWorker.test.ts exécute le vrai hook avant/après la date sans ouvrir la fiche ; états future→unseen avec Show identique. |
| Afficher plus déplace le rail | Ancien scrollLeft calculé pour aligner la première nouvelle carte. Position capturée avant la mutation, snap suspendu jusqu’au prochain geste, dernier lot sans clamp. | Trois lots séries/films à360/412/1280 dans home-terrain222-browser-checks.cjs, même scroll et carte à la place de la tuile. |
| Ce soir / ×2 / ruban coupé | Ternaire de présentation contredisant la SPEC ; badge rond et diagonale trop près du bord. Date réelle, bandeau commun, géométrie repositionnée. | Composants réels dans home-terrain223-browser-checks.cjs ; texte des rubans contenu dans l’affiche et groupe×2. |
| Marque / Plex | Actifs v3 réutilisés, icônes et hashes Android explicitement remplacés. Glyphes navigation/Vu, pré-rendu connexion/splash et anneau partagé ; logo Plex bbox centrée ; dialogue long centré et défilable. | brandV3.test.ts, contratAndroid ; captures navigateur aux trois largeurs, dix serveurs pour la hauteur. |

Les nouveaux scénarios navigateur et les régressions terrain221/222 sont verts à360/412/1280, captures inspectées. La validation canonique de la classe APK, la CI et la publication officielle restent des gardes requis avant livraison ; preuves définitives dans la PR et le checkpoint stable #729.

Limites : pas d’accès au compte Plex privé ni aux réponses fournisseur réellement reçues sur le téléphone. Les fixtures rejouent les formes de données connues et les véritables façades ; aucun titre n’entre dans une condition de production. Les dates inconnues restent inconnues ; pas de total déduit d’un nombre de lignes. Le terrain KO223 invalide l’ancienne prétention globale, sans annuler la correction distincte de la course Plex. Aucune réécriture d’horaires ou progression utilisateur.
