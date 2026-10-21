# Mise à jour Vite — 21 octobre 2026

Suivi #695, découvert pendant la livraison de la carte 8f (#690).

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
