# SeenIt TV — Samsung Tizen prototype V1

Prototype borné de l'issue #295 pour Samsung QE55Q6F / Tizen 3.0.

## Ce que la V1 fait

- choix de profil au démarrage : Julian, Camille, Milo, Invité ;
- Home adulte stable : TV / Films / Sport / Réglages ;
- applications installées détectées via `tizen.application.getAppsInfo()` et favorites visibles directement ;
- lancement d'une application via `tizen.application.launch()` ;
- `TV` tente d'ouvrir le viewer Samsung pour revenir au tuner/antenne ;
- HDMI 1/2 tentent une commutation via `VIDEOSOURCE` + `tizen.tvwindow.setSource()` ;
- Sport local de démonstration avec Monaco prioritaire, sans dépendre d'un diffuseur ;
- Home enfant Milo simplifiée ;
- navigation télécommande, Retour, fonctionnement local sans réseau ;
- écran diagnostic et concept Ambiance statique.

## Ce que la V1 ne fait pas encore

- aucun appairage Firebase/foyer ;
- aucune mutation `Vu` ;
- aucune donnée Sport réseau réelle ;
- aucun deep link exact Netflix/DAZN/CANAL+ ;
- aucune automatisation SDR/HDR ;
- aucune réassignation native du bouton Home Samsung ;
- aucune garantie avant test terrain que `org.tizen.tv-viewer`, les sources HDMI ou les apps exposées se comportent
  exactement comme attendu sur cette Q6F.

## Performance

Le runtime est volontairement ES5 et sans framework : aucun React/Babel, aucune iframe, aucun CSS Grid, aucun blur
temps réel, pas de polling réseau permanent et un DOM borné. La maquette Claude Design n'est pas exécutée sur la TV.

## Build

```bash
python3 tv-samsung/build.py
```

Produit `SeenItTV-tizen.wgt` non signé.

Pour signer ensuite :

```bash
python3 tv-samsung/build.py --sign MON_PROFIL_TIZEN
```

Le certificat reste personnel et n'est jamais commité.

## Installation sur la Q6F — étape terrain

Ne rien changer sur la TV sans accord explicite du propriétaire.

Quand le propriétaire veut tester :

1. TV Samsung : `Apps` puis `1 2 3 4 5`, activer Developer Mode ;
2. saisir l'IP du PC hôte et redémarrer la TV ;
3. créer une fois un profil de certificat Tizen compatible 2017-2022 ;
4. signer le `.wgt` ;
5. installer avec les outils Tizen/SDB ;
6. vérifier d'abord seulement : démarrage, focus télécommande, apps détectées, TV tuner, HDMI, Retour ;
7. ne tester le takeover Home natif qu'après le probe read-only documenté dans #295.

Référence de compatibilité et de procédure : Free My TV (`simbasjungles/free-my-tv`).
