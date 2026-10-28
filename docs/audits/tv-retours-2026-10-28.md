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

## Validation

22 TNR ciblés adapter/modèle/compatibilité et harnais navigateur 1920×1080 / 1280×720 :
fiches remplies, filtres/pagination, focus/Retour, calendrier six cartes, contraste,
sources réelles simulées, cycles de masquage/reprise sans accumulation. Les preuves
matérielles et le digest signé final sont consignés dans le checkpoint stable #295
après installation. Le repli officiel France déjà préparé est conservé dans PR783.
L'association QR et l'inventaire sont lus sans écrire d'historique personnel.
