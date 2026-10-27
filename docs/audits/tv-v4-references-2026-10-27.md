# Références externes — SeenIt TV V4

Demande du propriétaire : s'inspirer de Flix-Home, Luma et Free My TV pour le
launcher SeenIt, sans reprendre leurs instructions d'installation ni inventer des
capacités Samsung. Lecture des sources le 27 octobre 2026, sans exécution de leurs
scripts sur le PC ou la TV.

## Flix-Home

[Source](https://github.com/schadogamer127-sys/Flix-Home), arbre
`d95e144920ed0c05694ef11612312eaff35dc485`.
Référence proche du matériel : Samsung 2018 / Tizen 4. Son adapter appelle
`tizen.application.launch(appId)` ; aucun traitement Netflix particulier trouvé.
Son README distingue validation YouTube, HDMI non confirmé et remplacement Home
encore ouvert. Ne pas transformer une capture de focus Netflix en preuve de lancement.

Idées retenues : contraste neutre, lumière limitée à la carte active, mouvements
courts et arrêtables, pas de flou animé permanent. Les trois destinations et la
surcouche SeenIt/Sport restent celles de la V4 fournie par le propriétaire.

## Luma

[Source](https://github.com/0xProbabillity/luma-tv), arbre
`8ce68387cb690786445ffde8d1d1776d07fb6997`.
Android TV / Google TV, Java natif. Les intents Android, la ligne « reprendre » et
les accès HDMI-CEC ne sont pas des APIs Tizen. Ils ne prouvent ni l'accès à Netflix
ni l'identité du spectateur sur la Q6FN.

Idées retenues : apps réellement installées, appui long pour organiser, réglages
accessibles, thème clair/sombre, navigation lisible et animations suspendues lorsque
le launcher quitte le premier plan. Aucun historique Netflix partagé attribué
automatiquement à Julian, Camille ou Milo ; aucune domotique ajoutée par défaut.

## Free My TV et Netflix

[Adapter Samsung](https://github.com/simbasjungles/free-my-tv/blob/fa471834534b66b2323f98e79ada424306aadef4/web/tv.js),
arbre `fa471834534b66b2323f98e79ada424306aadef4`.
Il utilise également `tizen.application.launch`, préfère la variante store quand
elle est inventoriée, et transmet le descripteur VIDEO SOURCE natif à `setSource`.
Le correctif SeenIt conserve ce descripteur natif, perdu auparavant par normalisation.

Le [ticket ouvert #257](https://github.com/simbasjungles/free-my-tv/issues/257)
décrit Netflix noir depuis leur launcher mais fonctionnel depuis Smart Hub. La
variante `org.tizen.netflixlowmem` est une hypothèse de l'auteur, pas un correctif
confirmé. Ne supprimer aucune variante sous prétexte de doublon.

Sur la Q6FN du propriétaire, les chemins direct et app-control/main vers la variante
store ont été acceptés par l'API, mais l'écran est resté noir. Le propriétaire confirme
Netflix fonctionnel depuis Samsung. La variante low-memory présente dans l'inventaire
est donc testée séparément. Résultat du propriétaire : aucun effet visible, malgré
un callback accepté. Cette piste ne justifie aucune préférence automatique.
Le callback accepté ne prouve pas qu'une image Netflix s'est affichée.

## Limites et vérification

Ne reprendre ni identifiants universels, ni autodémarrage, ni désactivation système
depuis ces projets. Inventaire matériel complet conservé, choix locaux explicites,
signature SeenIt existante et rollback préservés. Mesures Android de RAM/FPS non
transposables à Samsung. Validation navigateur distincte de la validation sur TV.

Le propriétaire demande ensuite de poursuivre uniquement en local et de s'arrêter
à l'étape de test, car Milo utilise la TV. Aucun autre lancement, probe HDMI,
installation ou changement de réglage n'est autorisé pendant cette attente.
