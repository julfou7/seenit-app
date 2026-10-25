# SeenIt TV — règles du prototype Samsung

Ce sous-dossier est un prototype personnel pour Samsung QE55Q6F 2017 / Tizen 3.0, suivi par l'issue SeenIt #295.

- Rester compatible ES5 et vieux moteur Chromium/Tizen : pas de React, Babel, framework, CSS Grid, blur temps réel ou dépendance runtime lourde.
- La navigation est télécommande-first et doit rester utilisable sans réseau.
- `TV` désigne le tuner/antenne TNT Samsung. HDMI, box et applications restent des cibles séparées.
- Les applications sont découvertes sur la TV ; ne pas coder une table d'IDs Samsung supposée universelle.
- Le Sport reste provider-agnostic. Un diffuseur n'est qu'une donnée résolue au moment du match.
- Aucune mutation SeenIt, Firestore ou historique personnel tant que l'appairage foyer + profil actif certain n'est pas implémenté.
- Ne jamais écrire dans les réglages Home/startup natifs de la TV sans probe read-only, baseline de restauration et accord explicite du propriétaire.
- Ne jamais installer, désinstaller, activer Developer Mode ou modifier le PC/TV de l'utilisateur sans lui annoncer l'action et obtenir son accord explicite.
- Le `.wgt` de test peut être construit non signé ; toute installation réelle exige une signature Tizen/Samsung adaptée à la TV.
