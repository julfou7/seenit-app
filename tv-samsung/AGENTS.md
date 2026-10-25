# SeenIt TV — règles du launcher Samsung

Ce sous-dossier cible en priorité la **Samsung QE55Q6FNA, gamme 2018, Tizen 4.0**, suivie par l'issue SeenIt #295.
Le widget conserve `required_version="3.0"` comme minimum de compatibilité ; cela ne signifie pas que le matériel terrain est Tizen 3.
La référence UX courante est `docs/specifications/tv-samsung-launcher-v2.md`.

- SeenIt TV est destiné à devenir le **Home/launcher principal**, pas une application secondaire.
- Rester compatible ES5 et vieux moteur Chromium/Tizen : pas de React, Babel, framework, CSS Grid, blur/backdrop-filter temps réel ou dépendance runtime lourde.
- La navigation est télécommande-first et doit rester utilisable sans réseau.
- `TV` désigne le tuner/antenne TNT Samsung. HDMI, box et applications restent des cibles séparées.
- Les applications sont découvertes sur la TV ; ne pas coder une table d'IDs Samsung supposée universelle.
- Une liste de 100+ packages doit être **inventoriée puis classifiée** (`USER | SYSTEM | UNKNOWN`) : ne jamais jeter silencieusement les apps système dans l'adapter. La Home n'affiche qu'un sous-ensemble utile et la bibliothèque doit paginer un DOM borné.
- Le Sport reste provider-agnostic. Un diffuseur n'est qu'une donnée résolue au moment du match.
- La télémétrie RAM/stockage est read-only et doit utiliser les APIs Tizen `systeminfo` lorsqu'elles sont disponibles ; aucun root n'est requis pour l'affichage de ces valeurs.
- Aucune mutation SeenIt, Firestore ou historique personnel tant que l'appairage foyer + profil actif certain n'est pas implémenté.
- Ne jamais écrire dans les réglages Home/startup natifs de la TV sans probe read-only, baseline de restauration et accord explicite du propriétaire.
- Ne jamais lancer de session root, installer/désinstaller, activer Developer Mode ou modifier le PC/TV de l'utilisateur sans lui annoncer l'action et obtenir son accord explicite.
- Le `.wgt` de test peut être construit non signé ; toute installation réelle exige la signature terrain adaptée. Après le premier succès, préserver l'identité auteur utilisée par `SeenItTV01.SeenItTV` pour les mises à jour.
- Sur la QE55Q6FNA terrain, le distributeur legacy `Tizen Public Distributor Signer` a permis l'installation là où `Tizen Studio Public Signer` échouait avec `118012`. Ne pas remplacer cette chaîne pour un nouveau test sans raison documentée.
