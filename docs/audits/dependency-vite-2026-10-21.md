# Mise à jour Vite — 21 octobre 2026

Identifiant : **AUDIT-2026-10-21-VITE**. Date et dernière vérification : **21 octobre 2026**.
Statut : **audit ciblé terminé, correction validée dans PR #696, merge à suivre dans #695**.
Baseline exacte : SeenIt **1.4.211**, `main` `bbe88b67fc6ef86d909e2e48bcf10005e16e9652`.
Candidate échouée : **1.4.212**, `ef6fcecde76849e42e377a819cca5cfc173f5bcd`.
Arbre corrigé contrôlé : `93edcfe0d09025fbdca9e1836b2cca27eed9a42f`, SeenIt **1.4.211**.
Suivi [#695](https://github.com/julfou7/seenit-app/issues/695), découvert pendant la livraison #690.

Périmètre : version Vite résolue, trois avis launch-editor rapportés par l'audit npm production,
blocage de préparation et garde du runtime natif embarqué. Limites : aucun audit global du code,
aucun pentest ni preuve d'exploitabilité APK/Cloud Run ; les autres dépendances de développement
ne sont pas couvertes par `--omit=dev`. Les conclusions décrivent ces versions et cette date.

La candidate v1.4.212 a échoué au garde d'audit production : run `39640543997`,
job `119362588592`. Le lock résolvait Vite 6.4.3. Les avis launch-editor actualisés
le 20 octobre couvrent cette version Vite ; le correctif de la branche 6 commence à 6.4.4 :

- [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv)
- [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw)
- [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)

`npm update vite` avec npm 10.9.3 met uniquement Vite à jour vers 6.4.5, dans la
plage de version déjà autorisée, et ajoute URL/intégrité au lock. Aucune migration majeure,
aucun abaissement de l'audit, aucun changement d'identité ou de signature Android.
`npm audit --omit=dev` retourne zéro vulnérabilité ; l'audit du runtime natif ne trouve
aucun avis high/critical. Validation canonique, build et navigateur restent les gardes de livraison.

La présence dans le graphe classé production ne prouve pas une exposition SeenIt à ces exploits :
le serveur compilé utilise déjà `vite-production-stub.ts`. Le test de démarrage production
et le smoke du serveur construit conservent ce contrat.

Preuves reproductibles sur l'arbre corrigé : `npm audit --omit=dev --json` (zéro vulnérabilité),
`node scripts/audit-native-dependencies.cjs` (aucun high/critical embarqué),
`npm run validate:change` (983 tests, contrats, build et budgets verts), puis
`node scripts/pwa-browser-smoke.cjs` avec Chromium (360/412/1280, interactions réelles vertes).
La CI de PR `39642685076` confirme aussi la validation avant ce complément documentaire.

Points solides à conserver : audit bloquant, lock déterministe avec intégrité npm, patch dans la
même majeure et stub Vite du serveur de production. Décision : mettre à jour le lock ; conserver
tous les gardes, aucun risque ouvert accepté pour contourner la release.

Matrice exhaustive des constats de ce périmètre (priorité SeenIt P2, blocage de livraison réel) :

| Constat | Sévérité avis / impact | Disposition et critère de sortie |
|---|---|---|
| GHSA-698v-4r3x-3vcv | Moderate ; échappement Windows, Vite <=6.4.3 signalé | [#695](https://github.com/julfou7/seenit-app/issues/695), PR #696 : 6.4.5 ; avis absent de l'audit corrigé |
| GHSA-r825-w8mm-5pxw | Moderate ; arguments d'éditeur, Vite <=6.4.3 signalé | #695 / PR #696 : 6.4.5 ; avis absent de l'audit corrigé |
| GHSA-587h-7wmj-h5pm | High ; contrôle de chemin Windows, bloque la candidate | #695 / PR #696 : 6.4.5 ; audit production zéro, nouvelle candidate à valider avant publication |
| Registre et champs du rapport initial incomplets | Traçabilité du diagnostic inaccessible depuis l'index | #695 / PR #696 : identifiant, baseline, limites, preuves et présente matrice ajoutés ; index README relié |
