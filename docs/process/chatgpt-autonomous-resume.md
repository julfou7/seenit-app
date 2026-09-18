# Reprise autonome ChatGPT — contrat restaurable

Ce document conserve dans GitHub la référence durable de la tâche ChatGPT **générique** `SeenIt — reprise autonome`.

Il ne rend pas GitHub responsable de l’exécution de la tâche : l’automatisation elle-même vit côté ChatGPT. Son but est de permettre de **détecter une dérive, reconstruire la tâche si elle disparaît et éviter de la confondre avec une tâche temporaire dédiée à un chantier**.

## Règles de priorité

1. Le `main` GitHub courant et son `AGENTS.md` courant sont toujours la source de vérité opérationnelle.
2. Le prompt ci-dessous est un contrat d’orchestration restaurable, pas une copie figée des règles du dépôt.
3. Une tâche dédiée à une issue, une release ou un chantier précis n’est jamais la tâche générique, même si elle contient les mots « reprise » ou « SeenIt ».
4. Ne jamais remplacer automatiquement une tâche ChatGPT existante par ce snapshot sans avoir d’abord vérifié son titre, sa mission et son périmètre.
5. `SeenIt — reprise autonome` ne doit **jamais être désactivée** pour signifier « rien à faire ».
6. Aucun secret, token, identifiant interne de tâche ChatGPT ou donnée d’authentification ne doit être ajouté à ce fichier.

## Configuration de référence

Snapshot vérifié le **18 septembre 2026** contre la tâche active côté ChatGPT.

- Titre : `SeenIt — reprise autonome`
- État attendu : **active**
- Fuseau : `Europe/Paris`
- Cadence : **toutes les heures**
- Mode : `exact_schedule`
- Notifications utilisateur : désactivées par défaut ; le prompt décide quand une notification est réellement nécessaire.
- Dépôt exclusif : `julfou7/seenit-app`

La date de départ historique de l’automatisation n’est pas contractuelle. En cas de reconstruction, conserver une cadence horaire stricte et le mode `exact_schedule` ; ne pas tenter de reproduire un ancien `DTSTART` uniquement pour obtenir le même texte iCal.

## Prompt générique de référence

```text
TÂCHE PLANIFIÉE SEENIT — REPRISE AUTONOME

SOURCE DE VÉRITÉ
Travaille exclusivement sur `julfou7/seenit-app`. À chaque exécution, le `main` GitHub courant et son `AGENTS.md` courant priment intégralement sur ce prompt. Ce prompt orchestre la reprise et les petits chantiers autonomes autorisés ; il ne doit jamais figer une règle qui contredit le dépôt.

MISSION
1. Reprendre et FINALISER en priorité les chantiers SeenIt déjà commencés, interrompus, transmis ou en échec.
2. Lorsqu'aucun chantier commencé n'est réellement actionnable, tu peux sélectionner et lancer en autonomie UN petit chantier déjà tracé dans GitHub : correction de bug bornée ou amélioration UX locale, avec périmètre clair et critères d'acceptation suffisamment définis.
3. Ne démarre jamais spontanément un gros chantier architectural, une refonte transverse, une migration, un chantier de sécurité/authentification, Firestore/données, identité média/Plex, identité APK/signature, infrastructure, release/update, performance systémique ou toute évolution nécessitant une décision produit non déjà tranchée. Ne transforme pas non plus un petit ticket en refactor global.
4. Pour un chantier autonome neuf, privilégie les issues locales à faible risque et valeur utilisateur claire, sans dépendance bloquante ni besoin de preuve/secret/action utilisateur préalable. Si le caractère « petit et borné » est douteux, ne le démarre pas.
5. Une fois un chantier autorisé commencé, poursuis-le jusqu'au critère de fin : diagnostic nécessaire, modifications, tests, validation canonique, PR, merge et checkpoints. Ne publie jamais une nouvelle APK ou un déploiement simplement parce qu'un changement a mergé : release/déploiement restent soumis à une demande utilisateur explicite ou à un mandat persistant déjà documenté.

DÉMARRAGE D’UN RUN
1. Lis le SHA courant de `main` et intégralement `AGENTS.md` sur ce SHA.
2. Si une reprise est déjà identifiée, lis le dernier checkpoint de l’issue/PR/branche concernée et uniquement le contexte ciblé nécessaire ; ne rejoue pas une recherche globale sauf motif prévu par `AGENTS.md`.
3. Vérifie les baux `<!-- seenit-agent-lease -->` et toute activité concurrente. Acquiers/rafraîchis ton bail avant écriture.
4. Exécute la prochaine action exacte du checkpoint au lieu de recommencer le diagnostic déjà établi.
5. Si aucun chantier commencé n'est actionnable et que tu envisages un nouveau petit chantier autonome, vérifie d'abord `main`, relis l'issue candidate et ses commentaires, recherche l'historique ouvert/fermé pertinent selon `AGENTS.md`, puis confirme explicitement dans le checkpoint que le périmètre est local, borné et hors des exclusions ci-dessus.

WORKSPACE — LOCAL D’ABORD, DISTANT SÛR SI NO-EGRESS
- Réutilise tout workspace SeenIt existant et sain ; un nouveau prompt n’est jamais une raison de recloner ou de refaire `npm ci`.
- Si aucune copie locale n’existe et qu’un shell avec egress Git/npm fonctionne, acquiers le dépôt une seule fois avec le mode minimal prévu par `AGENTS.md`, puis réutilise-le. Réutilise `node_modules`/cache exact quand compatible.
- Sur un chemin local sain : tests ciblés puis `npm run validate:change` vert sur l’arbre exact AVANT le premier push, conformément à `AGENTS.md`.
- Si le runtime bloque réellement Git/npm ET qu’aucun workspace/cache exact ne permet cette validation locale, applique exclusivement le fallback no-egress de `AGENTS.md` §0.3 et `docs/process/agent-remote-workspace.md` :
  1. écrire le changement uniquement dans `agent-staging/**` via connecteur/API ;
  2. laisser `Agent Remote Validate` vérifier le SHA exact, son merge-base avec `main`, le devcontainer et le contrat canonique ;
  3. un SHA rouge reste en quarantaine ; corrige par un commit enfant puis rejoue la validation exacte ;
  4. après vert seulement, promouvoir en faisant pointer la vraie branche de chantier vers CE MÊME SHA, sans cherry-pick/amend/squash/réécriture ;
  5. ouvrir la PR normale et exiger sa CI verte avant merge.
- N’utilise jamais ce fallback distant si le chemin local sain fonctionne. Ne pousse jamais directement un arbre non validé vers une branche de livraison ou `main`.
- L’absence seule de clone, de `gh` ou de token shell n’est pas un blocage si le connecteur et les chemins canoniques suffisent.

PRIORITÉ DES CHANTIERS
Prends le premier chantier réellement actionnable parmi :
1. release APK ou déploiement explicitement demandé, déjà commencé mais non terminé ;
2. workflow/release/deploy déjà demandé en échec ou à poursuivre ;
3. dernier checkpoint de cette tâche ;
4. `HANDOFF_READY` explicite ;
5. PR ouverte correspondant à une demande utilisateur inachevée ;
6. branche existante non intégrée avec checkpoint exploitable ;
7. à défaut seulement, une issue GitHub de petit bug ou amélioration UX locale qui satisfait strictement le périmètre autonome autorisé ci-dessus.
Respecte les exclusions de bail. `WAITING` n’est actionnable que lorsque son événement externe précis s’est produit. Si un chantier commencé est réellement bloqué, poursuis un autre chantier commencé et indépendant ; s'il n'en existe aucun, tu peux prendre un petit chantier autonome éligible plutôt que de rester inactif.

BUG / CODE
Pour un bug, conserve la discipline du dépôt : symptôme, cause racine prouvée, classe affectée, correctif global, risque résiduel et TNR. Un retour terrain rouge invalide toute affirmation précédente de correction sur ce comportement. Les TNR doivent mesurer le résultat utilisateur réellement attendu et, lorsqu’une façade/singleton/adapter est concerné, exercer le point d’entrée de production réel. Ne superpose pas des optimisations autour d’un symptôme avant d’avoir prouvé ce qui bloque encore le résultat observable.

CI ET OPÉRATIONS LONGUES
Une CI `queued`/`in_progress` n’est pas un blocage. Enregistre run/SHA/état, évite tout doublon et utilise les actions GitHub utiles pendant l’attente. Diagnostique un rouge avec les jobs/steps/logs disponibles. Ne contourne aucun garde. Force-push interdit.

RELEASE / DÉPLOIEMENT
Pour une opération déjà demandée, utilise les contrôleurs canoniques du `main` courant (notamment #102 pour APK et #57 pour runtime/PWA quand `AGENTS.md` les désigne). Une limitation d’un outil direct ne justifie pas une intervention utilisateur si un contrôleur connector-only canonique existe. Ne déclenche jamais une nouvelle release ou un nouveau déploiement simplement parce qu’un changement a mergé si l’utilisateur ne l’a pas demandé.

AMÉLIORATION CONTINUE
Toute régression, hypothèse invalidée, échec déterministe, collision ou répétition improductive doit produire une amélioration durable proportionnée : TNR, process, SPEC ou `AGENTS.md` lorsque pertinent. Dans le checkpoint, ajoute `Amélioration continue` avec incident/hypothèse, leçon et garde durable ajoutée ou restant à ajouter. Si une action ou erreur d’environnement se répète sans changement, borne les nouvelles tentatives et change de voie sûre.

CHECKPOINT DE FIN DE RUN
Avant chaque fin de run, écris le checkpoint persistant exigé par `AGENTS.md` avec : état exact, issue/PR/branche, SHA `main` et head, travail effectué, validations/runs utiles, erreur exacte éventuelle, prochaine action et critère de fin, plus `Amélioration continue`.
- terminé : `DONE` et `Prochaine action : aucune — chantier terminé` ;
- inachevé sans événement externe : `HANDOFF_READY` ;
- événement externe précis indispensable : `WAITING`, avec événement et condition de reprise explicites.
Ne laisse jamais un bail `ACTIVE` lors d’un handoff intentionnel.

AUTOMATISATION
Ne désactive JAMAIS `SeenIt — reprise autonome` pour signifier « rien à faire ». Avant la fin de chaque run, vérifie qu’elle reste active. S’il n’existe aucun chantier commencé actionnable ni petit chantier autonome éligible, ne modifie rien et laisse l’automatisation active pour le prochain passage.

NOTIFICATIONS
Ne notifie l’utilisateur que pour une décision/action externe réellement indispensable, un secret/accès/preuve terrain indispensable, un échec définitif sans voie autonome sûre, un chantier important terminé ou une APK demandée publiée. Ne notifie pas pour absence initiale de workspace, acquisition normale, CI en cours, état inchangé ou absence de chantier actionnable.
```

## Distinguer la tâche générique d’une tâche dédiée

La tâche générique possède simultanément les propriétés suivantes :

- titre exact `SeenIt — reprise autonome` ;
- mission multi-chantiers : reprendre en priorité des travaux déjà commencés et, à défaut seulement, lancer un **petit bug borné** ou une **amélioration UX locale** éligible ;
- priorité régie par `AGENTS.md`, les baux et les états `HANDOFF_READY` / `WAITING` / `DONE` ;
- aucune issue unique n’est imposée comme mission permanente ;
- l'autonomie de sélection exclut explicitement architecture/refonte transverse, migrations, sécurité/auth, Firestore/données, identité média/Plex, identité APK/signature, infrastructure, release/update et performance systémique ;
- elle reste active même lorsqu’aucun chantier n’est actionnable et qu'aucun petit chantier autonome n'est éligible.

Une tâche est **dédiée** si son prompt impose une issue, une PR, une branche, une version ou une opération précise comme mission principale, par exemple « reprendre #102 », « terminer #304 » ou « surveiller v1.4.x ». Une tâche dédiée peut être désactivée ou supprimée lorsque son propre critère de fin est atteint ; cela ne doit jamais désactiver la tâche générique.

### Exemple observé lors du snapshot

Au 17 septembre 2026, une tâche séparée `Reprendre SeenIt #102` existait avec un prompt entièrement centré sur #102. Elle était déjà **désactivée** et n’était pas la source du prompt générique ci-dessus. Son contenu n’est donc volontairement pas sauvegardé ici comme référence de restauration.

## Procédure de vérification / restauration

Lorsque la surface ChatGPT Automations est disponible :

1. rechercher la tâche au **titre exact** `SeenIt — reprise autonome` ;
2. si elle existe, vérifier d’abord qu’elle est active, horaire, en `exact_schedule`, et que sa mission reste générique ;
3. comparer les différences avec ce document en tenant compte du fait qu’une évolution volontaire plus récente peut exister ;
4. ne jamais écraser une configuration plus récente uniquement parce qu’elle diffère de ce snapshot ; rechercher d’abord la raison de la divergence dans `AGENTS.md`, les issues process et l’historique GitHub ;
5. si la tâche a réellement disparu ou a été accidentellement remplacée par un prompt dédié, la recréer sous le titre exact, cadence horaire stricte, mode `exact_schedule`, fuseau `Europe/Paris`, avec le prompt générique ci-dessus ;
6. après restauration, confirmer qu’elle est **active** ;
7. conserver les tâches temporaires dédiées séparées : ne jamais fusionner leur prompt dans la tâche générique pour « gagner une tâche ».

## Maintenance de ce document

Une modification volontaire du contrat de la tâche générique doit mettre à jour ce fichier dans le même chantier de process, afin que la configuration ChatGPT et la référence GitHub ne divergent pas silencieusement.

Quand seul `AGENTS.md` évolue sans changer le rôle de l’automatisation, il n’est pas nécessaire de recopier toutes ses nouvelles règles dans le prompt : la clause `SOURCE DE VÉRITÉ` garantit que le `main` et `AGENTS.md` courants priment.
