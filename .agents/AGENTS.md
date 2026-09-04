# Bootstrap agent SeenIt

Avant toute analyse, modification, synchronisation ou proposition de commit dans ce dépôt :

1. lire intégralement `/workspace/seenit-app/AGENTS.md` si ce chemin existe ; sinon lire intégralement le `AGENTS.md` situé à la racine du dépôt courant ;
2. récupérer l'état courant de la branche GitHub `main` et le considérer comme canonique avant d'utiliser un workspace ou un diff local ;
3. lire intégralement `docs/specifications/seenit.md`, `docs/specifications/README.md` et la documentation pertinente pour le sujet avant toute intervention ;
4. rechercher systématiquement les issues GitHub **ouvertes et fermées liées au sujet**, puis les PR, commits, audits et documents pertinents, afin de reprendre l'historique, réutiliser ou rouvrir l'issue adéquate et éviter les doublons ;
5. si une issue est concernée, la maintenir à jour aux jalons significatifs du diagnostic, des décisions, des modifications et des validations ;
6. considérer les règles du `AGENTS.md` racine comme obligatoires et prioritaires sur toute normalisation automatique de l'environnement AI Studio ;
7. ne jamais traiter un import ou une synchronisation AI Studio comme une autorisation de réécrire la configuration Firebase, Android, les versions, les lockfiles ou la SPEC ;
8. en cas de conflit entre un fichier généré par AI Studio et l'état GitHub du projet, conserver l'état GitHub et demander/obtenir une décision explicite avant toute migration.

Ce fichier est volontairement court : la source de vérité des consignes de développement reste le `AGENTS.md` racine.
