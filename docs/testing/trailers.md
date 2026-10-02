# Bandes-annonces — TNR #447

## Sources et limites

TMDB `/movie/{id}/videos`, `/tv/{id}/videos` et les saisons fournissent `key`, `name`, `site`,
`type`, `official`, `iso_639_1`, `iso_3166_1` et `published_at`. Aucun champ de ces réponses ne
certifie une langue audio ni une piste de sous-titres. SeenIt conserve des noms source explicitement
VF/VOSTFR/VO, neutralise leurs contradictions et n'utilise pas le code langue comme preuve de version.
Un nom fournisseur erroné reste une limite de source, à vérifier à l'écoute en terrain.

- [TMDB vidéos](https://developer.themoviedb.org/reference/movie-videos).
- [YouTube paramètres du lecteur](https://developers.google.com/youtube/player_parameters) :
  `cc_lang_pref` et `cc_load_policy` sont des préférences, pas une interrogation de pistes.
- [YouTube captions.list](https://developers.google.com/youtube/v3/docs/captions/list) exige OAuth
  et consomme 50 unités ; aucun accès supplémentaire n'est introduit pour ce chantier.
- [Capacitor Android](https://capacitorjs.com/docs/plugins/android) : bridge local enregistré dans
  MainActivity, sans nouvelle permission. Le `BridgeWebChromeClient` Capacitor 8.5 ferme immédiatement
  `onShowCustomView` : l'APK utilise donc les vraies barres système natives de la WebView existante.
- [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) :
  activation utilisateur transitoire obligatoire sur le Web ; le plein écran manuel reste disponible.

## Automatisé

`node --test tests/trailerPolicy.test.ts tests/trailerPresentation.test.ts tests/trailerPlatform.test.ts`
couvre les langues connues/inconnues, VO sans preuve FR, VF explicite malgré code anglais, VOST seul,
contradictions, plusieurs montages, priorité officielle dans le snapshot borné, préférences CC,
refus API, fermeture pendant ouverture, remontage StrictMode et adaptateur PWA de production.

## Téléphone réel — preuve encore nécessaire

Consigner modèle Android, version APK, WebView et identité exacte de chaque vidéo testée :

1. Fiche Film : un tap ouvre un trailer VF explicitement nommé ; vérifier audio, paysage, lecture,
   contrôles YouTube, sélecteur et Fermer. Retour portrait et fiche au même endroit.
2. Fiche Série : VO explicite sans sous-titres FR prouvés. Vérifier libellé VO, aucune promesse VOSTFR,
   son/lecture puis Retour Android : lecteur fermé avant la fiche et barres système restaurées.
3. Saison/actualité : vidéo anglaise sans preuve FR et teaser/extrait. Vérifier type/langue/nom distincts,
   sélection de plusieurs vidéos, rotation physique et fermeture immédiate pendant l'ouverture.
4. Refus/absence du bridge ou verrouillage d'orientation : lecteur utilisable et fermeture possible,
   aucun blocage en portrait. Une vidéo refusée par YouTube conserve un bouton Fermer accessible.
5. PWA : modal desktop au clavier, plein écran manuel puis Échap ; navigateur mobile avec et sans
   API d'orientation. Aucun plein écran extérieur au lecteur n'est quitté par son nettoyage.

Les tests Node et la compilation ne certifient ni l'autoplay YouTube ni l'audio réel d'un nom TMDB.
