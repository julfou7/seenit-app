# Processus de livraison SeenIt

Statut : **source de vérité opérationnelle pour la CI/CD et les releases**.

Ce document décrit la mécanique de livraison. La SPEC produit conserve les invariants fonctionnels,
de sécurité, de données et d'identité ; elle ne doit plus recopier chaque détail de pipeline. En cas
de conflit entre une ancienne description procédurale de `docs/specifications/seenit.md` et ce fichier,
ce document prévaut pour les déclencheurs CI, la classification de livraison et la cadence des releases.

## Objectif

Un push doit prouver rapidement que le dépôt reste sain. Il ne doit pas être transformé automatiquement
en nouvelle release APK. Les releases Android restent explicites, avec deux usages distincts : la release
complète pour les changements qui exigent les smokes d'installation, et la **release terrain rapide** pour
mettre un correctif déjà validé sur le téléphone du propriétaire sans repayer les mêmes validations.

Pour une boucle terrain demandée avec le correctif, la cible est **correctif prêt/mergé → mise à jour
intégrée installable en ≤ 10 minutes**, sans téléchargement manuel et sans seconde demande « publie APK ».

## GitHub, Cloud Run et AI Studio

GitHub `main` est l'unique source de production. Le workflow `Deploy Canonical Backend` construit une
image Cloud Run complète — serveur et frontend PWA — puis ne bascule le trafic qu'après validation et
smoke. Le workflow de release GitHub construit et publie séparément l'APK signée.

AI Studio reste facultatif : sa synchronisation Git native peut charger GitHub pour éditer ou prévisualiser
SeenIt, mais elle n'est jamais un prérequis de déploiement. Les changements voulus reviennent par une
branche/PR GitHub. Aucun script de pull/refresh intégré à SeenIt ne doit être réintroduit.

Le bouton `Publish` d'AI Studio ne fait pas partie du parcours normal de production et ne doit jamais être
proposé comme raccourci. Pour une modification exclusivement frontend que la détection d'impact backend
diffère, lancer manuellement `Deploy Canonical Backend` sur `main` afin de forcer la reconstruction de
l'image complète, ou attendre la prochaine reconstruction canonique. Une publication AI Studio vers la
production exige une demande explicite du propriétaire, un blocage prouvé du chemin GitHub et un plan de
réconciliation/rollback ; elle est alors retracée comme intervention non canonique.

## Trois classes de changement

### `light`

Aucun binaire Android n'est affecté. Cela couvre notamment :

- documentation et audits ;
- tests ;
- `.github/**` ;
- scripts de CI, validation ou gouvernance ;
- changements de texte d'interface reconnus comme pure copie.

La validation exécute les tests rapides et le build, sans bump Android, Gradle, émulateur ni release.

### `backend`

Le runtime serveur change, mais pas le bundle embarqué par Capacitor. `server.ts`,
`src/lib/firebase-admin.ts`, `src/features/runtime/**`, `src/backend/**` et `src/server/**` sont les
zones explicitement reconnues comme backend-only.

La validation exécute les tests et le build serveur/Web. Aucun bump APK ni smoke Android n'est requis
pour un changement exclusivement backend.

### `apk`

Tout changement du frontend embarqué, d'Android, de Capacitor, des dépendances ou d'une configuration
applicative reste `apk`. Le doute reste conservateur et choisit `apk`.

La classe `apk` signifie seulement « devra entrer dans la prochaine APK ». Elle ne signifie plus
« publier une APK sur ce push ».

## Validation continue

### Commande locale canonique

Pendant la mise au point, les tests ciblés peuvent être exécutés autant que nécessaire. **Avant le premier
push d'un arbre Git modifié, `npm run validate:change` doit être vert sur cet arbre exact**, hors fallback
sans egress défini dans `AGENTS.md` §0.3. Cette commande constitue la validation complète canonique : elle
dérive la baseline PR/`main`, contrôle les workflows et la SPEC, rematérialise Android, classe le changement,
vérifie le contrat de changement, TypeScript et les tests unitaires, ajoute le contrat Android si la classe
est `apk`, exécute l'audit de dépendances lorsqu'il est requis puis construit les assets Web/serveur.

GitHub Actions réutilise cette même orchestration. Le job `Validate Change` la découpe uniquement en deux
phases pour conserver le fail-fast et le cache :

1. configuration de Node sans installation applicative ;
2. installation de **actionlint v1.7.12** verrouillé par version et SHA-256 ;
3. `npm run validate:change -- --preflight`, qui exécute la politique/syntaxe des workflows puis l'intégrité SPEC ;
4. restauration éventuelle d'un cache `node_modules` exact ;
5. sur cache absent seulement, `npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund` ;
6. `npm run validate:change -- --postinstall`, qui rematérialise Android, classe `light` / `backend` / `apk`, applique le contrat de changement, le typecheck global, le strict TypeScript progressif, le garde de dette `any`/console, le formatage minimal du diff, les tests unitaires, le contrat Android conditionnel, l'audit applicable et le build ;
7. résumé du mode, du cache et des durées principales.

Les options `--preflight` et `--postinstall` ne définissent aucune logique de validation concurrente : elles
sont les deux segments du même script `scripts/validate-change.cjs`. L'exécution locale sans option appelle
successivement les deux segments. La CI confirme donc un contrat local identique au lieu de devenir une
boucle de mise au point distante.

### Politique et syntaxe des workflows

`npm run validate:workflows` est inclus dans le préflight. Il impose une allowlist exacte des workflows
canoniques, refuse tout workflow temporaire non déclaré, interdit les commandes/actions qui modifient,
commitent ou poussent du code et borne chaque permission `write` au workflow qui en a explicitement besoin.
La syntaxe des YAML GitHub Actions est ensuite vérifiée par **actionlint v1.7.12**. Une autre version est
refusée afin que le résultat local et le résultat CI restent déterministes.

Ajouter ou renommer un workflow, introduire une nouvelle permission d'écriture ou changer la version de
l'outil est donc une évolution explicite de la politique : le script, les TNR et cette documentation sont
mis à jour dans le même changement. Un workflow correctif temporaire auto-modifiant n'est jamais un moyen
autorisé de réparer la CI.

Le contrôleur exceptionnel `firestore-default-migration.yml` est borné à l’issue #23, au propriétaire du
dépôt, au projet GCP canonique et au SHA `main` exact écrit dans la commande. Ses seules permissions GitHub
en écriture sont `id-token` pour WIF et `issues` pour son checkpoint ; il ne peut ni écrire le dépôt ni se
déclencher sur un push. Sa topologie préflight rend toute réexécution inopérante après la migration unique.

Le préflight conserve également le garde des imports ESM des TNR Node sans dépendances, qui inspecte uniquement les TNR
`tests/**/*.test.ts` exécutés directement par `node --test`. Lorsqu'un import relatif local cible un
module TypeScript existant, son extension (`.ts`, `.tsx`, etc.) doit être explicite ; les imports de
packages et le code applicatif bundlé par Vite restent hors de ce garde. L'erreur indique fichier, ligne,
import fautif et chemin attendu, avant restauration du cache `node_modules` ou installation npm.

L'intégrité SPEC est volontairement exécutée avant le cache et l'installation : son validateur utilise
uniquement Node et les fichiers du dépôt. Une erreur de catalogue, de version ou de référence de test
échoue ainsi avant tout coût npm. La classification sûre des changements de pure copie s'appuie en
revanche sur l'analyseur TypeScript. Elle s'exécute donc sans installation lorsque le cache exact est
trouvé ; lors du bootstrap exceptionnel d'un cache absent, l'installation déterministe précède ce
contrôle sans le supprimer ni l'assouplir.

Le cache `node_modules` est strictement exact. Sa clé comprend le système, l'architecture, la version
Node réellement résolue, `package.json`, `package-lock.json`, le patch des notifications locales et
le matérialiseur Android. Aucun préfixe de restauration approximatif n'est autorisé. Les PR peuvent
lire le cache de la branche par défaut selon les règles de portée GitHub Actions, mais ne le sauvegardent
jamais. Seul un push vert sur `main` ou `master` peut créer le cache de référence, après tous les
tests et le build. Le fichier `android/app/google-services.json` reste hors cache et est régénéré à
chaque validation depuis le contrat suivi.

Le cache npm de téléchargement de `actions/setup-node` reste actif comme secours d'une installation
froide. `npm audit` n'est jamais mélangé à `npm ci` : il conserve son étape conditionnelle et son
niveau bloquant existant.

Le lint canonique ne dépend d'aucun outil externe supplémentaire : il réutilise le compilateur TypeScript
installé pour compter les `any` explicites et les appels directs à `console.*`. La baseline historique
est figée dans `docs/specifications/typescript-quality-baseline.json` ; chaque fichier de production
modifié est comparé à sa version du merge-base et ne peut augmenter sa propre dette. Les nouvelles
frontières critiques sont à zéro, tandis qu'un `tsconfig.strict-boundaries.json` avec `strict=true` et
`allowJs=false` étend progressivement le typage fort sur des modules autonomes API, Firestore, Plex,
téléchargements et transport natif. `npm run format:check` bloque les erreurs de whitespace du diff et
`npm run format` fournit la normalisation minimale correspondante sans reformatage global.

Le build canonique exécute aussi le budget bundle défini dans
`docs/specifications/quality-gates.json` et publie son rapport. Dans GitHub Actions, un smoke Chromium
sans dépendance navigateur supplémentaire rend ensuite la vraie PWA en 360/412/desktop, bloque les
origines externes, vérifie clavier/arbre d'accessibilité/cible 44 px et joint rapports + captures dans
un artefact `SeenIt-Quality-Gates-*`. La quarantaine distante exécute le même smoke avant de déclarer
un SHA exact promouvable. Ces contrôles restent séparés du TNR humain TalkBack.

Le job `Validate Change` possède un plafond dur de 10 minutes. Ce plafond n'est pas le budget nominal :
la cible reste une médiane maximale de 45 secondes et un p95 maximal de 90 secondes sur 20 validations
consécutives. Un cache froid après changement de lockfile peut dépasser cette cible ponctuellement ;
il doit être visible comme `miss` dans le résumé puis alimenter le cache de référence depuis
`main`. Une installation qui approche le plafond est traitée comme un incident d'infrastructure :
ne pas retirer de test, vérifier le statut GitHub/npm, relancer une seule fois sur le même commit et
ouvrir/actualiser une issue si la dérive se répète.

Le smoke Android de release réutilise le même contrat qualité : cold start ≤ 9 000 ms et reprise
≤ 2 500 ms, avec rapport `performance.txt` et preuve instrumentée du nœud d'accessibilité système.
Le bouton « Continuer avec Google » doit être visible dans la racine `UiAutomation` et lui-même, ou l'un
de ses ancêtres, doit être cliquable. Un dépassement ou l'absence de cette action est bloquant ; ces plafonds
gardent une marge sur les baselines Android 36 observées afin de détecter une régression majeure sans
transformer la variabilité émulateur en flake.

Le contrat Android exécuté en validation continue contrôle l'identité et le contrat de signature sans
exiger le fichier privé de keystore : les secrets de signature ne sont jamais exposés aux PR ni aux
pushes ordinaires. Si `android/app/seenit-release.p12` est présent localement, son empreinte est toutefois
vérifiée et toute divergence est bloquée.

`npm audit --omit=dev --audit-level=high` n'est exécuté que :

- lorsqu'un manifeste/lockfile de dépendances change ;
- lors d'une release APK complète ;
- lors du contrôle périodique hebdomadaire.

Un push sur `main` **ne publie jamais automatiquement une APK**. La poursuite automatique vers
`/release-terrain` vient du mandat du chantier utilisateur, pas d'un déclencheur aveugle à chaque merge.

### TNR du chemin rapide

Le test `tests/ciValidationPerformance.test.ts` bloque automatiquement toute régression de l'ordre
fail-fast, de la clé de cache exacte, de la confiance d'écriture, des options d'installation, de la
rematérialisation Android, de l'orchestration `validate:change`, du résumé et du plafond. Le test
`tests/workflowPolicy.test.ts` verrouille l'allowlist, les permissions d'écriture et les mutations Git
interdites ; `tests/changeValidationOrchestrator.test.ts` protège les sorties et la classification de
l'orchestrateur. Le test `tests/testEsmImportsGuard.test.ts` verrouille le garde ESM : imports statiques,
side-effect et dynamiques, extensions explicites, packages ignorés et absence d'impact sur le code Vite.
`tests/terrainReleaseFastPath.test.ts` protège la commande `/release-terrain`, la réutilisation de la
validation exacte de `main`, les étapes indispensables de construction/signature/publication et
l'exclusion des validations redondantes/smokes émulateur du chemin critique terrain.

La preuve du SLO de validation continue est maintenue dans l'issue #84 à partir de 20 validations réelles
consécutives. La preuve du SLO terrain est maintenue dans #368 à partir de releases réelles ; aucune mesure
synthétique n'est fabriquée.

## Gouvernance proportionnée

Un changement comportemental doit rester couvert par un test automatisé ciblé.

La SPEC complète + `requirements.json` sont obligatoires lorsqu'une règle durable est créée/modifiée
ou quand le changement touche une zone sensible : sécurité/authentification, données/Firestore,
identité Plex/média, identité APK/Firebase Android, configuration native critique.

Une correction visuelle ordinaire ou un ajustement local sans nouvelle règle durable ne doit plus
produire artificiellement une nouvelle exigence, une entrée catalogue et plusieurs fichiers
administratifs. Le test ciblé et l'issue éventuelle suffisent.

Les décisions de processus sont tracées ici, dans les audits et les issues d'architecture plutôt que
d'être dupliquées dans chaque fiche produit.

## Capture proactive des améliorations sans ralentir le chantier

Pendant un développement, `SEENIT-QUALITY-004` traite une opportunité d'amélioration comme un élément de
backlog à **capturer**, pas comme un sous-chantier à exécuter immédiatement. Le déclencheur couvre à la fois
une difficulté corrigeable réellement rencontrée et un axe d'amélioration concret/actionnable observé sans
incident.

Le chemin rapide est : recherche GitHub ciblée pour éviter un doublon → mise à jour/réouverture de l'issue
existante ou création d'une issue d'amélioration continue courte → retour immédiat à la prochaine action du chantier principal.
La capture minimale contient l'observation et son contexte, le bénéfice attendu, la piste de traitement si
elle est déjà évidente, un critère de fin et le lien vers le chantier révélateur. Aucune recherche large,
reproduction supplémentaire, analyse de cause racine, implémentation ou validation n'est lancée uniquement
pour enrichir cette issue. Une cause/hypothèse déjà connue peut être notée sans investigation additionnelle.

L'amélioration n'entre dans le périmètre courant que si elle est nécessaire pour terminer correctement la
demande en cours ou si l'utilisateur l'a explicitement demandée. Cette règle vise à **réduire le travail
évitable et accélérer les interventions**, pas à ajouter une étape administrative lourde.

## Acquisition du workspace et reprise d'intervention

La vérification du `main` GitHub canonique et la matérialisation d'un dépôt local sont deux opérations
distinctes. `SEENIT-QUALITY-004` impose la première à chaque intervention ; elle n'impose pas la seconde.

1. **Préflight API-first.** Lire `main`, l'issue, la PR, les commits et les fichiers nécessaires via le
   connecteur/API GitHub tant qu'aucune commande locale n'est nécessaire. Une demande read-only se
   traite sans clone, checkout local ou installation de dépendances.
2. **Réutiliser avant d'acquérir.** Rechercher le workspace SeenIt dans les surfaces réellement accessibles
   du runtime, pas seulement à un chemin supposé. Contrôler son état, sa branche/HEAD et son rapport au SHA
   canonique, puis le réutiliser. Un nouveau prompt, une reprise conversationnelle ou une nouvelle phase du
   même chantier n'est jamais, à lui seul, une raison de recloner le dépôt. Avant toute commande de clone ou
   d'acquisition locale, publier dans l'issue concernée le reçu auditable suivant :
   ```
<!-- seenit-workspace-acquisition -->
workspace existant recherché : oui
résultat : trouvé et réutilisé | absent/inexploitable — <racines/surfaces vérifiées>
exécution locale nécessaire : <commande/test exact> — API-first insuffisant : <raison factuelle>
acquisition minimale : <mode retenu et borne> | sans objet
   ```
   Le champ `absent/inexploitable` doit citer les racines/surfaces réellement vérifiées ; vérifier seulement
   `/mnt/data/seenit-app` ou un autre chemin attendu ne suffit pas. Si API-first, une branche déjà existante,
   un Codespace ou le fallback distant couvrent encore le besoin, l'acquisition locale est interdite.
3. **Acquisition minimale.** Seulement si le reçu conclut `absent/inexploitable` et nomme une commande/test
   local réellement nécessaire, acquérir une seule fois par environnement la branche/SHA utile. Préférer le
   mode minimal compatible (`git clone --depth 1`, clone partiel ou checkout partiel) à l'historique complet,
   sauf si le diagnostic exige cet historique. `git clone` n'est jamais utilisé comme simple test d'egress.
4. **Dépendances conditionnelles.** Réutiliser `node_modules` ou un cache exact lorsqu'il correspond à
   la version Node et au `package-lock.json` du chantier. Ne lancer `npm ci` que lorsque les dépendances
   sont absentes ou incompatibles ; un nouveau prompt ne déclenche jamais à lui seul une réinstallation.
5. **Reprise déterministe.** Commencer par l'issue, la PR ou la branche existante et par le dernier jalon
   qui donne la prochaine action exacte. Ne relire que les sections canoniques nécessaires à cette action ;
   ne pas reconstruire l'historique complet déjà capturé par l'issue/PR.
6. **Checkpoint unique.** Chaque issue active conserve un commentaire stable marqué exactement
   `<!-- seenit-resume -->`. Il est créé une fois puis **mis à jour en place** à chaque jalon/handoff au lieu
   d'empiler des résumés concurrents. Il contient SHA/branche/PR, surfaces modifiées, tests déjà verts,
   validations rouges utiles, dernier résultat terrain, blocage éventuel, prochaine action exacte et
   critère de fin. Les baux et preuves CI/release restent dans leurs commentaires dédiés ; une reprise lit
   d'abord ce checkpoint stable.
7. **Travail distant.** CI, release et déploiement sont exécutés par GitHub Actions. L'agent n'occupe pas
   sa fenêtre d'exécution avec des polls rapprochés ; il suit synchroniquement uniquement sur demande
   explicite, pour une livraison qui fait partie de la demande en cours, ou pour diagnostiquer un échec précis.

Cette politique ne promet aucune persistance du sandbox. Lorsqu'un environnement neuf est réellement
fourni, l'acquisition locale peut devoir être répétée ; elle reste minimale et n'entraîne pas une
reconstruction du contexte déjà présent dans GitHub.

La métrique de pilotage est **« prompt de reprise → première action utile »** (lecture canonique ciblée,
modification, test, commit/PR ou blocage précis). La cible est **moins de 2 minutes**, hors téléchargement
initial réellement nécessaire. Les preuves réelles sont consignées dans #195 et les chantiers qui
mesurent ce délai ; aucune mesure synthétique n'est fabriquée pour fermer le critère.

### Exclusion mutuelle entre conversations

Le workspace et le worktree isolent les fichiers locaux ; GitHub reste partagé. Toute session interactive
ou planifiée acquiert donc le bail décrit dans la section 0.4 de `AGENTS.md` avant la première écriture.
Le commentaire `<!-- seenit-agent-lease -->` rend visibles le propriétaire, le périmètre, le SHA attendu,
l'expiration nominale à 90 minutes et la prochaine action. Un bail concurrent `ACTIVE` rend seulement son
périmètre non actionnable : l'automatisation peut poursuivre un sujet indépendant, mais ne modifie, ne
fusionne, ne ferme et ne livre jamais le travail d'une autre conversation.

L'acquisition est relue après écriture ; en cas de course, le plus petit identifiant de commentaire GitHub
gagne. Le propriétaire rafraîchit le bail aux jalons, revérifie bail + tête distante avant toute opération
irréversible et le termine en `HANDOFF_READY`, `WAITING` ou `DONE` avec le checkpoint persistant. Ce
protocole complète les worktrees : il empêche les collisions distantes que Git seul ne peut prévenir.

#### Quota Codex : reprise par le propriétaire

Un arrêt provoqué uniquement par le **quota Codex** ne constitue ni un handoff ni une libération du bail.
Les chantiers Codex sont marqués `Origine: CODEX` dans leur lease ; les identifiants historiques
`codex-*` et `codex-interactive-*` restent reconnus. Tant que le dernier checkpoint Codex n'est pas
`HANDOFF_READY` ou qu'aucun transfert utilisateur explicite n'a été demandé, une tâche ChatGPT planifiée
ne reprend ni l'issue, ni la PR, ni la branche, ni la release associée, **même après l'expiration nominale
des 90 minutes** et même après merge pendant des contrôles post-merge encore possédés par Codex.

Avant de rendre la main pour quota, Codex conserve `Statut: ACTIVE` et écrit un checkpoint indiquant la
raison « quota Codex », la prochaine action exacte et l'heure de reset lorsqu'elle est connue. Si le
produit Codex utilisé expose une fonction **Automation/Schedule**, le propriétaire programme sa reprise
dans le **même thread** : une exécution unique juste après le reset connu ; si l'heure n'est pas connue,
une vérification périodique au plus une fois par heure. Tant que le quota reste indisponible, cette reprise
ne modifie rien et laisse le chantier réservé. Si la fonction d'automatisation n'est pas disponible dans
l'environnement Codex courant, le checkpoint le signale et exige une reprise manuelle Codex sans transférer
le périmètre. `WAITING` reste non actionnable, `DONE` est terminal et seul `HANDOFF_READY` exprime un
transfert autonome vers une autre exécution.

### Relais d'une APK explicitement déléguée

Un changement `apk` mergé et sain sur `main` n'est pas, à lui seul, un ordre de publication. Quand
l'utilisateur demande une APK **et** confie sa publication à une autre tâche, le propriétaire du
chantier code transmet une opération release indépendante sur #102 selon `AGENTS.md` §0.4a. Il publie
un checkpoint `<!-- seenit-apk-release-handoff -->` et un bail final `HANDOFF_READY`, avec preuve de
l'autorisation, SHA `main`, dernière release officielle, lot APK non publié, prochain patch, état
candidate/runs, destinataire et prochaine action canonique. L'issue code peut demeurer `WAITING Terrain`
pour les tests sur appareil ; ce statut ne suspend pas le relais #102 lorsqu'aucun événement externe
n'est requis pour la publication. À l'inverse, un simple commentaire « une autre tâche s'en chargera »
ou une CI `main` verte ne met aucune release en file.

La tâche destinataire traite ce relais avant un nouveau chantier produit, acquiert le bail #102 puis
revalide `main`, la dernière release, les baux concurrents et l'autorisation si `main` a avancé. Une
release déjà publiée clôt le relais sans nouveau dispatch ; sinon elle reprend
`/prepare-release-apk` → PR verte/merge → `/release-apk` via le contrôleur. La tâche à horaire fixe
ne s'éveille pas au merge : elle verra ce relais à sa **prochaine exécution**. Cette règle ne rétablit
pas une APK automatique sur chaque push ou merge et ne contourne aucun garde d'immuabilité ou smoke.

Cette section de délégation ne s'applique pas lorsqu'une **validation terrain fait partie du chantier
interactif courant** : dans ce cas, `AGENTS.md` §0.0t ordonne au même agent de poursuivre directement vers
`/release-terrain` sans créer un relais artificiel ni attendre une tâche planifiée.

## Cause racine et portée d'un correctif

Un exemple reproductible prouve un symptôme, pas la portée du correctif. Avant toute implémentation,
l'issue ou la PR sépare le symptôme, la cause racine prouvée, la classe complète affectée et le risque
résiduel. Le cas utilisateur devient un TNR ; au moins un invariant générique et, lorsque pertinent, un
cas voisin ou négatif prouvent que le changement dépasse cet exemple.

Une correction de donnée, de manifeste ou de configuration limitée à une entrée est annoncée comme
**locale**. Elle peut être livrée si elle est exacte et sûre, mais elle ne ferme jamais à elle seule une
issue systémique. Si aucune généralisation fiable n'est possible, l'issue racine reste ouverte avec la
limite des sources et la prochaine étape architecturale. Une heuristique incertaine n'est pas une solution
globale acceptable.

Les modèles GitHub demandent ces informations pour les changements comportementaux. Documentation,
copie d'interface et maintenance sans anomalie peuvent répondre « sans objet » et garder le chemin light.

### Après un premier terrain rouge

Un terrain KO invalide la preuve de correction, même si les tests précédents sont verts. À partir du
**premier échec terrain** d'un même symptôme, le chantier quitte la succession de micro-patches isolés :

- reconstruire le chemin de production réel de bout en bout, jusqu'au provider ou à la couche native ;
- identifier la frontière réellement fautive avec logs/mesures ou instrumentation bornée si nécessaire ;
- transformer le cas terrain en TNR au **point d'entrée de production réellement utilisé** — façade,
  singleton, adapter, route, wiring ou API native — plutôt qu'en testant seulement une fonction interne ;
- couvrir l'invariant générique et un cas voisin/négatif pertinent ;
- enregistrer dans `<!-- seenit-resume -->` le dernier résultat terrain, l'hypothèse invalidée et la
  prochaine preuve recherchée avant de modifier à nouveau.

Cette escalade ne signifie pas audit global : elle élargit le diagnostic uniquement au chemin de
production de la classe affectée et empêche de brûler plusieurs versions sur la même hypothèse incomplète.

## Fast path de correctif ciblé

Ce chemin s'applique à une issue existante dont la cause racine est confirmée et le périmètre borné.
Il ne s'applique pas à un audit global, une migration, une refonte transverse ou un désaccord entre la
SPEC et la décision produit.

1. Vérifier `main`, puis lire l'issue, ses commentaires, la carte fonctionnelle et uniquement les
   sections de SPEC, fichiers et tests utiles au changement. Les documents canoniques restent la
   connaissance complète consultable ; ils ne sont pas tous relus lorsqu'un index et une exigence
   identifient sans ambiguïté le périmètre.
2. Pour une règle durable ou une zone sensible, modifier SPEC et catalogue avant le code, dans le même
   workspace et la même livraison. Aucun commit ou push administratif intermédiaire n'est requis.
3. Développer avec les tests ciblés. Quand ils sont verts, exécuter une seule fois la validation complète
   applicable avant le premier push. Un échec local reproductible est corrigé localement ; la CI distante
   ne devient pas une boucle de mise au point.
4. Produire un commit cohérent et une PR ; un second commit est réservé à une correction réelle. Toute
   réécriture mécanique hors périmètre est retirée avant push. Le contrat de changement refuse notamment
   un churn massif de `requirements.json` disproportionné aux exigences réellement modifiées.
5. Si dix minutes ne produisent ni artefact concret ni blocage précis, publier un jalon sur l'issue et
   cibler le blocage avant de continuer.
6. Après merge, une publication déjà demandée reprend directement le fast path APK ci-dessous ; une
   validation téléphone demandée reprend le fast path terrain sans nouvelle demande utilisateur.

Ce raccourci porte sur l'orchestration de l'agent, pas sur les preuves : tests, protections de branche,
contrats Plex/identité/données/APK et validations terrain nécessaires restent inchangés.

## Fast path de publication APK

Lorsqu'une demande porte **uniquement** sur la publication d'une APK déjà décidée, le fast path de
`AGENTS.md` est prioritaire. Il remplace la reconstruction manuelle du contexte de release par trois
commandes bornées ; il ne remplace aucun contrôle de GitHub Actions.

### 1. Lire l'état canonique

```bash
npm run release:status -- --json
```

La commande récupère `origin/main` et expose dans un JSON stable :

- SHA et version du `main` canonique ;
- dernière release GitHub publiée ;
- prochaine version attendue ;
- branche/PR candidate éventuelle ;
- compatibilité de la candidate avec le `main` courant ;
- état agrégé des checks (`none`, `pending`, `green`, `failed`) ;
- action suivante exacte (`prepare`, `wait_checks`, `fix_checks`, `merge_then_dispatch`, `dispatch`…).

Une candidate existante est toujours réutilisée lorsqu'elle est compatible. Une candidate non basée
sur le `main` courant ou dont les checks échouent provoque une action de correction ciblée, jamais une
seconde branche parallèle. Le fast path n'effectue ni audit global, ni recherche fonctionnelle, ni
recherche Web/plugin.

### 2. Préparer la version si nécessaire

Depuis un workspace **propre**, sur la branche locale `main` exactement égale à `origin/main` :

```bash
npm run release:prepare -- 1.4.113
```

La commande :

1. vérifie que la version demandée est exactement la prochaine version attendue et qu'aucun tag/release
   identique n'existe ;
2. refuse un workspace sale ou un `HEAD` différent du `main` GitHub canonique ;
3. réutilise une branche/PR `release/vX.Y.Z` compatible si elle existe ;
4. sinon crée cette unique branche, modifie uniquement `android/app/build.gradle`, puis exécute
   `npm run version:sync` pour aligner toutes les surfaces canoniques ;
5. refuse tout fichier modifié hors de l'allowlist des surfaces de version ;
6. produit **exactement un commit** `chore: préparer la release APK X.Y.Z`, pousse la branche et ouvre
   une seule PR vers `main`.

Les surfaces autorisées sont celles synchronisées par `version:sync` : Gradle, `updateStore`, en-tête
Plex serveur, `package.json`, `package-lock.json`, catalogue SPEC, contrat Android et version de la SPEC.
Aucun écran, composant, store métier ou autre code fonctionnel ne peut être modifié par cette commande.
`requirements.json` reste dans son format canonique JSON à deux espaces avec fin de ligne terminale ;
la validation SPEC refuse une autre sérialisation. Les champs de version sont remplacés sans toucher
aux autres octets. Une candidate qui reformate massivement le catalogue est invalide.

### 3. Fusionner puis déclencher le workflow

Une fois les checks requis de la PR verts, fusionner selon les protections du dépôt puis relancer
`release:status`. L'état attendu est alors `dispatch`.

Une demande explicite « Publie l'APK », « Lance la release » ou équivalent vaut mandat opérationnel pour
une release complète. Un correctif explicitement destiné au terrain vaut mandat opérationnel pour
`/release-terrain` une fois le correctif mergé et `main` vert. L'agent ne se contente pas de fournir un
bouton ou une commande à exécuter par l'utilisateur.

Pour créer le `workflow_dispatch`, l'ordre canonique est :

1. depuis une conversation disposant du connecteur GitHub, publier sur #102 la commande exacte :
   `/release-terrain` pour la boucle téléphone déjà validée, `/release-apk` pour une release complète ou
   `/release-apk android12_smoke=true` lorsqu'Android 12 doit être ajouté ;
2. **outil GitHub direct** de déclenchement de workflow s'il est réellement disponible dans la session,
   avec ref `main` et les inputs équivalents ;
3. sinon fallback local borné avec `release:dispatch`/`gh` pour la release complète documentée ci-dessous.

```bash
npm run release:dispatch
```

Ce wrapper historique exécute l'équivalent canonique complet :

```bash
gh workflow run build-apk.yml --repo julfou7/seenit-app --ref main -f release_apk=true -f android12_smoke=false -f fast_terrain=false
```

Le chemin connector-only #102 reste prioritaire et couvre le fast terrain sans dépendre du shell.
L'absence de `gh`, de `GH_TOKEN` ou de `GITHUB_TOKEN` dans le shell n'est donc pas un blocage tant que
le contrôleur #102 ou une action GitHub dédiée est disponible. Une intervention humaine n'est demandée
que pour un blocage concret d'accès, d'authentification ou d'autorisation après épuisement des voies
canoniques.

Quelle que soit la voie, vérifier avant le dispatch qu'aucun run de release portant le même SHA/version
n'est déjà actif. Le contrôleur recherche pendant au plus 30 secondes le run `workflow_dispatch` portant
le même SHA et ne redéclenche jamais aveuglément. Pour `/release-terrain`, il attend auparavant jusqu'à
90 secondes la validation `push` verte du `main` exact. Dès que le run de release est identifié, le suivi
reste ciblé sur ce run ; lorsqu'il fait partie d'un chantier terrain à terminer dans la même demande,
l'agent poursuit jusqu'à la release et à la notification au lieu de rendre la main au milieu de la boucle.

### 4. Mesures

Pour une demande release-only, conserver la mesure **demande → workflow**. Pour une boucle terrain,
mesurer en plus **correctif prêt/merge → release installable/notifiée** avec une cible ≤ 10 minutes.
Consigner également le nombre de versions terrain nécessaires avant un OK, les handoffs avant fin et les
P1 apparaissant dans les 24 h suivant une release. Ces mesures servent à réduire le churn de versions ;
elles ne sont pas des barrières supplémentaires avant publication.

Le workflow publie séparément le temps actif de son chemin critique. En mode complet il inclut les smokes
requis ; en mode terrain il expose explicitement que le smoke Android 36 a été sauté et que la validation
`main` exacte a été réutilisée.

Cibles release-only : ≤ 2 minutes de travail opérateur avec candidate prête et verte ; ≤ 5 minutes hors
attente CI si la candidate doit être préparée. Cible terrain : ≤ 10 minutes du correctif prêt/mergé à la
mise à jour installable dans SeenIt.

## Préparation d'une release APK

Les changements `apk` peuvent s'accumuler sur `main` avec plusieurs commits. La version Android n'est
pas incrémentée à chaque commit.

Quand le lot est prêt pour une release complète, le chemin canonique est :

1. lire `npm run release:status -- --json` ;
2. si nécessaire, préparer le prochain patch avec `npm run release:prepare -- X.Y.Z` ;
3. attendre la validation continue verte de l'unique PR de candidate ;
4. fusionner cette candidate ;
5. vérifier que les trois secrets de dépôt `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`,
   `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD` sont présents ;
6. déclencher `Validate & Release SeenIt` avec `release_apk=true`, `fast_terrain=false` ;
7. après création de la release, le job de publication émet un `repository_dispatch` dédié ; le workflow
   `Android APK Update Notification` attend la terminaison réussie du run source, puis transmet
   uniquement son identité publique au backend canonique. Celui-ci revalide GitHub et diffuse l'alerte
   FCM Android de manière idempotente, sans rendre l'état de la release dépendant de FCM ;
8. valider sur appareil Android réel la réception et l'ouverture de l'alerte lorsque ce parcours change.

Pour une **release terrain**, les étapes de version/candidate restent identiques si elles sont nécessaires,
mais le contrôleur exige ensuite la validation `main` exacte verte et déclenche `fast_terrain=true`.
Le job ne rejoue pas classification/SPEC/lint/unit/audit déjà prouvés et ne construit pas le harness ni
les émulateurs Android 36/12. Il matérialise toujours la clé, vérifie l'immuabilité, construit les assets,
synchronise Capacitor, rejoue le contrat Android après sync, produit l'APK signée et son digest, publie la
release officielle puis notifie SeenIt. Une tentative terrain correspond donc à **une seule APK publiée**.

Avant les tests Android de release, la CI décode `SEENIT_ANDROID_RELEASE_KEYSTORE_B64` dans
`android/app/seenit-release.p12`, refuse un secret absent ou un Base64 invalide puis compare le SHA-256
aux octets verrouillés dans `docs/specifications/android-contract.json`. Le contrat exige également le
store PKCS12, l'alias `seenit`, les empreintes du certificat et la présence des deux mots de passe de
release. Le fichier généré est local au runner et n'est jamais commité. Une empreinte différente bloque
la release **avant Gradle**. Après `npx cap sync android`, le contrat Android est rejoué avec la présence
du keystore obligatoire.

Une candidate non publiée peut recevoir plusieurs commits correctifs sans consommer un nouveau numéro.
Une version déjà publiée reste immuable et exige un nouveau patch pour tout correctif ultérieur.

Le garde de release compare la candidate à la dernière release officielle publiée, pas au commit
immédiatement précédent. Ainsi, les commits intermédiaires d'un lot ne créent plus de faux échec de
version.

### Notes de version publiques

Un commit qui modifie l'expérience utilisateur sépare la synthèse publique des preuves internes :

```text
Changelog:
- La synchronisation Plex reste fiable lorsqu'un serveur est indisponible.

Détails techniques:
- Ignore le serveur en timeout et poursuit les autres collectes.
```

`Changelog: aucun` signale explicitement un commit sans effet visible. Le générateur n'utilise que cette
section explicite et ignore les détails techniques. Le préflight canonique `validate:change` vérifie en plus,
sur chaque commit non-merge entre la baseline et `HEAD`, qu'un bloc `Changelog:` existe avant toute PR/merge ;
une note non vide est soumise immédiatement aux mêmes contrôles de langue et de qualité que la publication.
Le résultat utilise un seul titre `### 🛠️ Ce qui a été fait`, avec des phrases françaises courtes, ponctuées et
orientées usage. Pour éviter de surcharger la fenêtre mobile, viser deux à cinq puces et regrouper les
changements liés ; les noms de fichiers, identifiants internes, tests, CI, commits, PR et issues restent
dans les preuves GitHub.

## Smokes Android

Pour une **release complète** :

- Android cible courant (API 36 actuellement) : **bloquant** ;
- Android 12 / API 31 : **optionnel manuel** via `android12_smoke=true` et utilisable comme contrôle
  périodique ou lors d'un changement Android à risque.

Pour une **release terrain rapide d'un correctif applicatif déjà validé**, Android 36 et Android 12 sont
sautés avant le premier test réel : le téléphone du propriétaire est la validation terrain prioritaire.
Ce raccourci est interdit si le changement touche précisément la signature, l'identité/package, une
migration d'installation ou le mécanisme de mise à jour/install ; la release complète et son smoke N→N+1
sont alors requis.

Depuis la release 1.4.112, la rotation est terminée et la baseline officielle porte la signature
release active. Le smoke compare package, versions et certificats réels puis exige que **N et N+1
portent exactement cette même signature**. Il installe N, pose les sentinelles de données/session,
installe N+1 sur place avec `adb install -r`, puis prouve la conservation des données/session, de
l'icône, des notifications, du launcher et du deep link. Toute divergence de signature et toute
réinstallation par désinstallation sont bloquantes.

Le smoke Android 36 de la release complète privilégie la fiabilité à l'optimisation : chaque exécution
recrée un AVD propre (`force-avd-creation: true`) et ne réutilise aucun snapshot ou cache `~/.android/avd`.
L'AVD API 36 est plafonné explicitement à `2048M`, comme l'API 31 stable, afin de réduire la pression mémoire
hôte sans modifier les assertions du TNR. Les preuves du smoke archivent aussi `free`, les principaux RSS
et la fin de `dmesg` pour distinguer un kill QEMU sous pression d'un défaut applicatif. Le run de release
1.4.112 `33809261658` a validé ce parcours sur Android 36 et Android 12. Depuis #135, le build et ce smoke
partagent le même runner à droits de lecture ; seul le job de publication séparé conserve `contents: write`.
`npm ci` et le build Web sont ainsi exécutés une seule fois sur le même runner et ne sont plus payés deux fois.

La récidive #50 observée pendant la release 1.4.191 a montré que le binaire shell historique
`uiautomator dump` pouvait rester bloqué après un cold start pourtant réussi, avec un fichier XML vide,
puis précéder la disparition de QEMU alors que l'hôte disposait encore de mémoire et que l'installation
N → N+1, les données/session et les contrats natifs étaient déjà validés. Le smoke ne retire donc pas le
garde d'accessibilité : il l'exerce désormais directement dans le harness instrumenté via
`Instrumentation.getUiAutomation().getRootInActiveWindow()`, avec une attente bornée et sans
`UiAutomation.waitForIdle()`. Le shell `uiautomator dump` est interdit dans ce chemin de release.

### Distribution hors Play et Play Protect

SeenIt reste distribuée directement par APK. Le dialogue Android « Analyse d'appli recommandée »
signifie que Play Protect ne connaît pas encore les octets de cette APK sideloadée ; il n'est pas un
état produit par SeenIt et ne peut pas être masqué par son code. Le parcours autorisé conserve la clé
release stable, le contrôle SHA-256 et les permissions minimales, puis laisse l'utilisateur demander
l'analyse système. Aucun workflow, manifeste ou écran SeenIt ne désactive ou ne contourne Play Protect.

Pour améliorer la reconnaissance sans publier sur le Play Store, le propriétaire peut enregistrer son
identité, `com.seenit.app` et le certificat release dans l'Android Developer Console pour la distribution
hors Play, puis soumettre une demande officielle seulement si Google classe à tort l'application comme
potentiellement dangereuse. Une simple demande d'analyse d'une application inconnue n'est pas une telle
classification et aucune disparition du dialogue ne doit être promise pour chaque nouvel APK.

## Gestion et récupération des clés de signature

`android/app/seenit-release.p12` est un **artefact généré**, pas une source Git. Les sources de confiance
de la signature active sont :

- le SHA-256 du PKCS12 et les empreintes SHA-1/SHA-256 du certificat verrouillés par le contrat Android ;
- le secret `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`, qui fournit les octets au runner de release ;
- les secrets `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD` ;
- une sauvegarde opérateur privée de la clé, conservée séparément de GitHub.

Après validation terrain de 1.4.112, la fenêtre de rollback historique a été explicitement fermée dans
#9 : l'ancien secret GitHub et l'ancienne empreinte/client OAuth Android Firebase ont été supprimés.
Ils ne font plus partie du contrat ni du processus de release.

## Protections qui restent non négociables

La simplification ne réduit pas les garde-fous sur :

- `applicationId=com.seenit.app` ;
- signature APK release active et stable ;
- icônes/launcher et deep link ;
- projet Firebase Android canonique et unique client OAuth Android actif ;
- Firestore `default` et sa Delete Protection ;
- absence de secrets dans les logs ;
- immuabilité d'une release publiée ;
- GitHub comme source canonique face à AI Studio.

## Principe de décision

Le pipeline répond à trois questions séparées :

1. **Le changement est-il sain ?** → validation à chaque push.
2. **Doit-il être essayé maintenant sur le téléphone réel ?** → `/release-terrain` après validation verte du SHA exact, sans répéter les preuves déjà acquises.
3. **Le changement touche-t-il directement l'installation/invariant APK ou demande-t-on une release complète ?** → `/release-apk` avec smoke Android 36 bloquant.

Cette séparation vise à réduire le temps de retour terrain et le nombre de versions brûlées sur des hypothèses incomplètes, sans affaiblir les invariants réellement nécessaires à l'installation.
