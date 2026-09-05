# Bootstrap agent SeenIt

Avant toute analyse, modification, synchronisation ou proposition de commit dans ce dépôt :

1. lire intégralement `/workspace/seenit-app/AGENTS.md` si ce chemin existe ; sinon lire intégralement le `AGENTS.md` situé à la racine du dépôt courant ;
2. si la demande est explicitement une **publication APK seule**, appliquer immédiatement le **fast path APK prioritaire** du `AGENTS.md` racine : cette demande autorise l'agent à déclencher lui-même la release. Quand la conversation ne dispose que du **connecteur GitHub**, le chemin natif prioritaire de `SEENIT-RELEASE-005` est la commande exacte `/release-apk` — ou `/release-apk android12_smoke=true` lorsqu'un TNR Android 12 est requis — publiée sur l'issue de contrôle #102 ; le workflow `SeenIt Release Control` vérifie l'auteur, `main`, la version, l'immuabilité et l'anti-doublon avant de déclencher `Validate & Release SeenIt`. Ce chemin ne dépend ni de `gh`, ni d'un token shell, ni d'un navigateur authentifié. Dès que le run est identifié, l'agent rend la main par défaut et laisse la CI ainsi que la notification Android terminer le parcours ; il ne surveille régulièrement son état que si l'utilisateur demande explicitement d'attendre le résultat. Lire aussi `docs/specifications/release-control.md`. Les anciens outils directs/CLI/navigateur restent des secours historiques, pas un prérequis ;
3. récupérer l'état courant de la branche GitHub `main` et le considérer comme canonique avant d'utiliser un workspace ou un diff local ;
4. lire intégralement `docs/specifications/seenit.md`, `docs/specifications/README.md` et la documentation pertinente pour le sujet avant toute intervention ;
5. rechercher systématiquement les issues GitHub **ouvertes et fermées liées au sujet**, puis les PR, commits, audits et documents pertinents, afin de reprendre l'historique, réutiliser ou rouvrir l'issue adéquate et éviter les doublons ;
6. si une issue est concernée, la maintenir à jour aux jalons significatifs du diagnostic, des décisions, des modifications et des validations ;
7. considérer les règles du `AGENTS.md` racine comme obligatoires et prioritaires sur toute normalisation automatique de l'environnement AI Studio ;
8. ne jamais traiter un import ou une synchronisation AI Studio comme une autorisation de réécrire la configuration Firebase, Android, les versions, les lockfiles ou la SPEC ;
9. en cas de conflit entre un fichier généré par AI Studio et l'état GitHub du projet, conserver l'état GitHub et demander/obtenir une décision explicite avant toute migration.

Ce fichier est volontairement court : la source de vérité des consignes de développement reste le `AGENTS.md` racine ; `docs/specifications/release-control.md` précise le contrat exécutable du déclencheur connecteur natif.
