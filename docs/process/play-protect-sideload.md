# Distribution APK hors Play — Android Developer Verification et Play Protect

Ce runbook couvre la distribution officielle des APK SeenIt en dehors de Google Play. Il ne contourne
jamais Google Play Protect et ne modifie aucun invariant `SEENIT-APK-001..005`.

## 1. Deux mécanismes Google différents

**Android Developer Verification** sert à associer un développeur vérifié à ses packages et à leurs clés
de signature pour la distribution hors Google Play. Pour SeenIt, les identifiants canoniques sont :

- package : `com.seenit.app` ;
- certificat release SHA-256 :
  `c8f9245671c6e4e73baf55281280ada35ff80bbe7dce800b29d2bb7d7f247853` ;
- alias de clé : `seenit` ;
- source de vérité : `docs/specifications/android-contract.json`.

**Google Play Protect** analyse la sécurité et la réputation des applications installées, y compris hors
Play Store. Le message « Analyse d'appli recommandée » indique qu'une application ou un binaire n'est pas
encore suffisamment connu de Play Protect ; l'utilisateur peut envoyer l'application à Google pour
analyse avant de poursuivre l'installation.

Ces mécanismes se complètent mais ne sont pas équivalents : l'enregistrement du développeur/package ne
garantit pas que chaque nouveau binaire sera déjà connu de Play Protect.

Références officielles :

- https://developer.android.com/developer-verification/guides
- https://developer.android.com/developer-verification/guides/android-developer-console
- https://developers.google.com/android/play-protect/warning-dev-guidance
- https://support.google.com/googleplay/answer/2812853

## 2. Enregistrement initial hors Play

Le canal SeenIt normal reste une distribution directe. Pour conserver ce canal sans invitation par
appareil, utiliser l'option de **distribution complète** de l'Android Developer Console.

1. Ouvrir l'Android Developer Console avec le compte propriétaire de SeenIt et créer/activer le compte
   développeur hors Play.
2. Effectuer la vérification d'identité demandée par Google. Cette validation appartient au propriétaire
   du compte et n'est jamais automatisée par SeenIt.
3. Dans les packages, enregistrer `com.seenit.app`.
4. Déclarer l'empreinte SHA-256 du certificat release canonique :
   `c8f9245671c6e4e73baf55281280ada35ff80bbe7dce800b29d2bb7d7f247853`.
5. Si la console demande une preuve de propriété d'un package existant, suivre son challenge officiel :
   elle fournit une chaîne à placer dans `assets/adi-registration.properties`, puis demande une APK
   signée par la clé release correspondante. Cette APK sert uniquement à la preuve demandée par la
   console ; elle ne change ni la clé ni le package et ne devient pas automatiquement une release SeenIt.
6. Attendre l'état **Registered / Enregistré** dans la console.
7. Conserver dans l'issue #167 uniquement la date, le mode de distribution, le package, l'empreinte
   publique du certificat et le statut. Ne jamais enregistrer de document d'identité ou secret Google
   dans GitHub.

L'option de distribution limitée peut convenir à un projet très restreint mais impose une liste
d'appareils/invitations et n'est pas le canal canonique SeenIt.

## 3. Procédure pour chaque nouvelle APK

La release SeenIt continue d'être construite et publiée par le workflow GitHub canonique avec la même
signature. Aucune étape Play Protect ne remplace les contrôles de signature, de version et de SHA-256.

Pour un test de réputation Play Protect :

1. utiliser un appareil de test propre ou un profil sur lequel l'APK cible n'a pas déjà été analysée ;
2. laisser Play Protect activé et noter la version Android et la version de Google Play Protect ;
3. télécharger l'asset APK officiel de la release SeenIt et vérifier son SHA-256 ;
4. lancer l'installation et consigner le premier résultat :
   - aucun dialogue d'analyse ;
   - « Analyse d'appli recommandée » ;
   - avertissement bloquant / application potentiellement dangereuse ;
5. si « Analyse d'appli recommandée » apparaît, choisir **Analyser l'appli** et laisser le contrôle
   système arriver à son résultat ; ne jamais désactiver Play Protect pour poursuivre ;
6. sur le même binaire exact, effectuer ensuite une nouvelle installation propre sur le dispositif de
   test adapté et consigner si le dialogue est encore présent ;
7. enregistrer dans #167 : version/tag, SHA-256 de l'APK, appareil/Android, résultat avant analyse,
   résultat de l'analyse et résultat après analyse.

Un test terrain réussi prouve le comportement observé de cette version. Il ne promet pas que la version
suivante sera reconnue sans nouvelle analyse.

## 4. Quand utiliser l'appel Play Protect

Le simple message « Analyse d'appli recommandée » n'est pas une accusation de logiciel malveillant et ne
justifie pas un appel de faux positif. Si Play Protect classe réellement SeenIt comme potentiellement
dangereuse ou bloque l'installation alors que le binaire officiel est sain, suivre le parcours d'appel
officiel indiqué dans la documentation Google, avec le package et le certificat canoniques.

## 5. Critère de fin de #167

L'issue peut être fermée lorsque :

- le compte développeur requis est vérifié ;
- `com.seenit.app` et le certificat canonique sont enregistrés par la voie officielle ;
- ce runbook est fusionné ;
- un test terrain avant/après analyse est consigné sur une APK officielle ;
- aucun invariant `SEENIT-APK-001..005` n'a changé.

La disparition permanente du dialogue n'est volontairement pas un critère : Google peut demander
l'analyse d'un nouveau binaire.
