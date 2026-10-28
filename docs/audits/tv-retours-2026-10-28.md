# Retours TV du 28 octobre — #295, #738

Cible réellement interrogée : QE55Q6FNA / Tizen 4.0, widget 0.4.2.

## Causes et corrections

- Le dispatcher ouvre `screenFilmDetail` sans rendre la fiche. Le TNR navigateur
  contrôle maintenant le titre et les métadonnées dès OK, sans nouveau bootstrap.
- Sur la TV, les deux calques `.film-backdrop` / `.film-scrim` mesurent 0 × 0 lorsque
  Films est visible. Remplacement du raccourci CSS `inset` par quatre bords explicites.
- Brume hérite d'un texte sombre sur toast sombre et ne couvre pas Films/profils.
  Palettes complétées, police Jakarta locale statique, profils et avatars alignés,
  en-tête réduit à heure/profil/réglages. Les images restent bornées et libérées.
- Le prochain match est calculé mais masqué en CSS sur Home. Texte et horaire visibles
  directement sur la tuile, sans nouveau rail caché ni polling.
- Le focus Sport dépassait le conteneur rogné : marge dédiée et agrandissement réduit.
- AmbientSupport, CSAccount/OOBE, Apps et composants techniques visibles classés USER.
  Reclassement vers Système sans perte d'ID ; Apple TV réelle conservée (dummy système),
  Paramount+ ajoutable, variantes préservées. CANAL+ épinglé reste inchangé.
- YouTube garde un nom lisible ; Plex utilise le wordmark local avec libellé court.

## Capacités natives et limites

`findAppControl(operation/setting)` retourne réellement `NotFoundError`. Les quatre
fausses destinations Image/Son/Réseau/Général ne sont plus annoncées ; l'accès Samsung
propose un écran clair avec le chemin télécommande et retour/accueil Samsung. Sources
et état de la TV restent des destinations SeenIt fonctionnelles.

Netflix reste non validé : l'ID réellement inventorié est accepté par Tizen mais
SmartView indique `visible:false`. Le service DIAL local expose Netflix `stopped` ;
les POST locaux et LAN expirent sans lancement. Aucun de ces probes ne démontre un
lancement réussi et aucune tentative DIAL/SmartView n'est ajoutée au runtime. Pas de
table universelle d'IDs, désinstallation de variantes, root ou changement Home natif.
Le retour physique du dernier essai avec restitution de surface est demandé séparément.

Mise à jour terrain : le propriétaire est revenu devant la TV et a ouvert Netflix
depuis Samsung. Le contexte actif révèle la variante native réellement installée.
Un nouveau lancement de cette cible depuis SeenIt est ensuite confirmé explicitement
par le propriétaire (« Oui, Netflix s’affiche »), et DIAL passe de stopped à running.
Les essais précédents ne constituent pas une preuve du contraire : l'écran était entre
temps revenu sur Arte et les évaluations asynchrones du widget masqué expiraient.
La 0.4.4 ajoute donc un choix de version générique, local au téléviseur, entre IDs USER
de même nom inventoriés ; il est partagé entre profils sans changer leurs épingles.
Milo/Invité ne peuvent pas modifier ce choix global. Le test du clic sur la tuile utilise
la cible choisie, et les TNR refusent cible système, autre nom, retrait et cache invalide.
La variante Netflix terrain reste une configuration locale, jamais une table d'IDs du WGT.
Cette confirmation porte sur la TV en cours d'utilisation, pas sur un redémarrage à froid.

## Validation

22 TNR ciblés adapter/modèle/compatibilité et harnais navigateur 1920×1080 / 1280×720 :
fiches remplies, filtres/pagination, focus/Retour, calendrier six cartes, contraste,
sources réelles simulées, cycles de masquage/reprise sans accumulation. Les preuves
matérielles et le digest signé final sont consignés dans le checkpoint stable #295
après installation. Le repli officiel France déjà préparé est conservé dans PR783.
L'association QR et l'inventaire sont lus sans écrire d'historique personnel.

## Mise à jour matérielle 0.4.3

`install completed`, `cmd_ret:0` et version0.4.3 relue via l'API Tizen. Compte Julian
toujours associé,18contenus, thème `mist`, épingles Netflix/CANAL+ inchangées. Les huit
logos Home chargent réellement, dont Apple TV/Paramount+ détectés ; quatre HDMI remontés.
La police locale est reconnue et l'en-tête ne garde que trois éléments visibles.
Films : calques désormais1920×1080, image hero1280px et cartes500px chargées ; OK remplit
la fiche Vaiana immédiatement. Ce sont des lectures DOM/API, pas une validation visuelle
Netflix ni un contrôle de tous les réglages natifs.

WGT138935octets, SHA256 `5af5e7cdc8e6921e6527a6bb1fc641c7c403fe4b6220502e596f26a327f54e63`.
Auteur et distributeur legacy vérifiés identiques à la baseline installée. Aucun
effacement de compte/préférences et aucune publication APK mobile. La CI du runtime
ed6900f est verte (40702379838) ;1 117tests sans échec en validation canonique locale.
