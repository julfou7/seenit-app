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
  `onShowCustomView` : l'APK utilise donc les vraies barres système natives de la WebView existante lorsque
  l'utilisateur demande explicitement le plein écran.
- [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) :
  activation utilisateur transitoire obligatoire sur le Web ; le plein écran reste une action manuelle.

## Automatisé

`node --test tests/trailerPolicy.test.ts tests/trailerPresentation.test.ts tests/trailerPlatform.test.ts`
couvre les langues connues/inconnues, VO sans preuve FR, VF explicite malgré code anglais, VOST seul,
contradictions, plusieurs montages, priorité officielle dans le snapshot borné, préférences CC,
refus API, fermeture pendant ouverture, remontage StrictMode, adaptateur PWA de production et garde
`ouverture portrait -> plein écran explicite -> paysage réversible`.

## Téléphone réel — preuve encore nécessaire

Consigner modèle Android, version APK, WebView et identité exacte de chaque vidéo testée :

1. Fiche Film : toucher **Bande-annonce**. Vérifier que la modal s'ouvre **en portrait sans rotation forcée**,
   que l'en-tête reste compact (nom courant + type/langue, actions accessibles) et que la vidéo reste utilisable.
2. Toucher ensuite le bouton SeenIt **Plein écran** : vérifier l'immersion native et le passage en paysage,
   les contrôles YouTube, puis Fermer/Retour : portrait, barres système et fiche restaurés.
3. Fiche Série : VO explicite sans sous-titres FR prouvés. Vérifier libellé VO, aucune promesse VOSTFR,
   ouverture portrait, puis plein écran paysage uniquement après l'action explicite.
4. Saison/actualité : vidéo anglaise sans preuve FR et teaser/extrait. Vérifier type/langue/nom distincts,
   sélection de plusieurs vidéos sans nom long injecté à la place de l'en-tête, rotation physique et fermeture.
5. Refus/absence du bridge ou verrouillage d'orientation : lecteur utilisable et fermeture possible,
   aucun blocage en portrait. Une vidéo refusée par YouTube conserve un bouton Fermer accessible.
6. PWA : modal desktop/mobile sans plein écran automatique ; bouton plein écran manuel puis Échap ; navigateur
   mobile avec et sans API d'orientation. Aucun plein écran extérieur au lecteur n'est quitté par son nettoyage.

Les tests Node et la compilation ne certifient ni l'autoplay YouTube ni l'audio réel d'un nom TMDB.
