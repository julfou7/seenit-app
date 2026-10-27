# SeenIt TV — accueil V4 et connexion du compte

Décision du 27 octobre 2026, #295 ; Sport #738. Le paquet V4 est une référence
d'idées et de rendu, pas du code à exécuter ni une liste de données réelles.
Cible vérifiée : QE55Q6FNA 2018, Tizen 4.0, compatibilité widget 3.0 minimum.

## Accueil et profils

Trois destinations visuelles TV, Films et Sport remplacent les quatre raccourcis V2.
Supprimer salutation et titres superflus. En-tête : horloge, compte et roue des réglages.
Les réglages TV et SeenIt occupent la partie basse ; la roue y mène directement.
Retour remonte d'abord l'accueil, puis propose de quitter. Réglages Samsung : handler
réellement découvert, sinon alternative explicite avec la télécommande.

Favoris, Ajouter et Toutes restent génériques : huit favoris maximum, bibliothèque
paginée, ordre et dernière app par profil, mémoire de focus par rangée. Préserver les
préférences existantes à la migration ; Invité éphémère. Milo conserve une sélection
locale sans code, configurée depuis un mode parent explicite, sans compte enfant.
L'appui long OK permet organisation/retrait ; Retour annule une modification non validée.

Conserver ES5, DOM borné, fonds statiques graphite, absence de framework, blur et vidéo
de fond. Préserver les choix Brume/Crépuscule/Auto et mouvements. Films et Sport utilisent
des données réelles ou une illustration neutre ; pas de titre/score/diffuseur de maquette
présenté comme réel. Au masquage, images inutiles et requêtes/timers sont suspendus.

## Sources et apps : identité native

L'inventaire complet getAppsInfo est la seule source des apps disponibles. Conserver IDs
et variantes pour diagnostic. Une marque ne sert jamais à inventer une présence ou un ID.
Les suggestions automatiques n'incluent que les marques reconnues réellement présentes ;
les autres apps utilisateur s'ajoutent explicitement. Les utilitaires org.tizen restent
inventoriés en Système, sans devenir des suggestions d'accueil.
CANAL+ est confirmé dans l'inventaire du 27 octobre : prévoir sa présentation sans
l'imposer sur une autre TV. Toute nouvelle application utilisateur reste ajoutable.

Un callback accepté ne prouve pas l'ouverture physique. Conserver erreur native, méthode
et état observé ; distinguer acceptation, passage en arrière-plan et échec. Ne tester une
variante que si elle est inventoriée pour la même app, sans lancer un autre service.

HDMI : setSource reçoit le descripteur natif VIDEOSOURCE, jamais un objet reconstruit.
Cause confirmée sur 0.2.2 : TypeMismatchError de conversion en SystemInfoVideoSourceInfo.
Préserver type et numéro exacts. « Connecté » signifie détection native du signal, pas
présence physique garantie. Alias/masquage configurables ; Box/Console ne sont pas des
équipements supposés. Aucun root, Home/startup, firmware ou service système modifié.

## SEENIT-TV-002 — association QR explicite

1. Le backend HTTPS canonique crée un identifiant aléatoire, un secret de 256 bits et
   un code lisible. Le QR contient URL canonique, identifiant public et code, jamais le secret.
2. Le téléphone ouvre `/tv/connect`, utilise Firebase Auth existant, montre appareil,
   profil et code puis demande « Associer la TV ». Le scan seul n'approuve rien.
3. Approbation par ID token Firebase valide uniquement ; UID issu du token vérifié.
   Refuser code/secret incorrects, expiration et reprise par un autre compte.
4. Collection serveur `tvDeviceLinks`, Firestore `default` Standard, inaccessible aux
   SDK clients selon le refus par défaut existant. Stocker seulement hash de secret/code.
   Attente : dix minutes ; session approuvée : trente jours. Vérifier les échéances
   côté serveur, indépendamment d'un nettoyage TTL. Aucun jeton Firebase sur la TV.
5. Le secret donne accès uniquement au statut, bootstrap borné en lecture et dissociation
   de cette association. Il n'autorise aucune API Plex ni écriture de progression.
6. Statut toutes les cinq secondes seulement sur l'écran d'association visible ; arrêt
   au masquage, départ, expiration/succès ; annuler requêtes et ignorer réponses obsolètes.
7. Seul le profil local explicitement associé consulte le compte lié. Les autres restent
   locaux ; un lancement Netflix partagé ne crée jamais un visionnage SeenIt.
8. Dissocier demande confirmation, révoque côté serveur puis retire secret et cache
   personnel local. Après refus/expiration, proposer un nouveau code ; pas de faux « synchronisé ».
9. Pas de QR externe, secret en URL/log/fixture/Git, ni lecture de compte arbitraire.
   Réponses personnelles no-store, quotas et entrées bornés. TNR : deux comptes, expiration,
   révocation, concurrence, erreurs, restrictions de session et QR décodable.

## Sport et livraison

Les références Flix-Home, Luma et Free My TV sont suivies dans
`docs/audits/tv-v4-references-2026-10-27.md`. Retenir leur sobriété, organisation
des apps et suspension hors premier plan, sans transposer les APIs Android à Tizen.
Pour Netflix, ne préférer une variante qu'après preuve terrain ou choix explicite ;
un callback de lancement accepté n'est pas une confirmation d'image affichée.

Conserver événement → diffuseur vérifié → app/entrée réellement disponible. Source
football-data configurable derrière le backend, aucune clé dans le WGT ni souscription
payante implicite. Sans source : information courte et préférences, pas de faux matchs.
Hub, match, équipes et sans-spoiler partagent les données normalisées et le cache daté.
Pas de requête en arrière-plan ; rafraîchissement visible regroupé et borné.

Valider à 1920×1080 et 1280×720, télécommande, inventaire réel, QR/approbation, erreurs
et cycle mémoire. Chromium ne prouve pas le matériel : distinguer callback, premier plan
et retour physique. WGT avec identité auteur/distributeur existante, sans désinstallation.
