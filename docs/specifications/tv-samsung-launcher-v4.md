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

## Films & séries — correction terrain du28octobre

La destination et son écran s'appellent « Films & séries ». La référence V3-06 fournie
le28/10 guide la composition : grand visuel de fond du contenu sélectionné, titre lisible,
métadonnées réelles, onglets Pour toi/Séries/Films et rail de contenus en bas. Retirer les
rangées d'apps de cet écran : elles restent dans la Home et Toutes les apps. Le HTML/React
du ZIP est une maquette, pas le runtime Tizen à embarquer.

Les images persistées par le mobile existent en chemins TMDB et URLs HTTPS TMDB complètes.
Le bootstrap normalise les deux formes vers un chemin sûr ; refuser hôtes arbitraires,
identifiants dans l'URL, query/fragment et chemins traversants. Aucun nouveau fetch de
métadonnées nécessaire pour réutiliser les visuels déjà enregistrés. Le rail garde au
maximum quatre cartes paysage par page ; focus actualise le hero sans reconstruire le rail,
pagination explicite, filtres locaux et focus restauré au retour. Un seul hero + quatre
images visibles, tailles réduites, libération hors écran. Si une image manque, conserver
un visuel neutre de taille stable et le titre ; jamais une carte réduite au texte.

Montrer statut, saison/épisode et nom de reprise seulement lorsqu'ils existent. OK ouvre
un détail en lecture seule ; aucun « Reprendre »/« Épisodes » promettant une lecture exacte
non implémentée. Ne copier ni pourcentage fictif ni question « terminé ? » de maquette.
Sans compte associé à ce profil, inviter à l'association, sans exposer un autre profil.
TNR : bootstrap de production avec images absolues/relatives, faux hôtes, propriété du compte,
hero/rail/filtres/pagination/détail, aucune app et limites DOM à1920/1280.

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
gratuite configurable derrière le backend, aucune clé dans le WGT ni souscription
payante. Sans source : information courte et préférences, pas de faux matchs.
Hub, match, équipes et sans-spoiler partagent les données normalisées et le cache daté.
Pas de requête en arrière-plan ; rafraîchissement visible regroupé et borné.

### Calendrier réel — SEENIT-TV-003, 28 octobre (#738)

Le premier connecteur public lit les calendriers officiels AS Monaco et France A masculine
(FFF), sans clé ni compte payant. Ce sont des sources de calendrier, pas des preuves de
diffusion : ne déduire aucune app/diffuseur d'une compétition. Les deux sources sont fixes
côté serveur ; aucune URL fournie par la TV n'est téléchargée. Réponse normalisée bornée
à 24 matchs futurs, sans score. Conserver lien officiel, date de collecte et disponibilité
de chaque source ; une panne partielle ne masque pas la source saine.

Contrainte ferme : aucun abonnement, aucune API payante ni nouveau service payant récurrent.
Privilégier un fournisseur structuré dans les limites vérifiées de son offre gratuite,
notamment football-data.org si couverture/clé disponibles. La première source exploitable
sans clé est le repli officiel Monaco/FFF. Les adaptateurs restent indépendants du diffuseur.
Le backend SeenIt existant normalise les réponses : pas de parseur fournisseur dans le WGT,
pas de nouveau service provisionné, pas de clé secrète ni compte fournisseur requis sur TV.

Cache serveur partagé par source : six heures, requêtes concurrentes regroupées, retry
après trente minutes en erreur, dernier calendrier conservé au maximum 48 heures et signalé
comme ancien. Deux téléchargements simultanés maximum, timeout huit secondes et HTML
limité à un Mio ; aucune écriture Firestore. Horaires FFF interprétés en Europe/Paris
avec changements été/hiver ; Monaco fournit son décalage explicite. Une programmation
« non définitive » garde uniquement sa date indicative et « Horaire à confirmer ».

Sur la TV : sélection Monaco/France indépendante par profil, Julian initialisé avec les
deux, les autres sans sélection héritée. Milo reste configurable sans code. La Home
montre le prochain rendez-vous dans sa tuile Sport ; le calendrier affiche six cartes
par page, logos de la source (initiales ou drapeau fourni en secours), heure locale,
compétition et source. Le détail ne propose pas de lecture non prouvée. Les sélections
et le cache public sont locaux, sans association implicite avec un compte SeenIt.

Client ES5 : chargement sur Home/Sport visibles seulement, cache six heures, annulation
au masquage, aucune boucle de polling ni travail en arrière-plan ; un retour utilise
le cache et les matchs expirés sont filtrés sans attendre un nouveau téléchargement.
Les erreurs gardent la navigation utilisable et offrent Actualiser. TNR : fixtures
officielles expurgées, identité de source, provisoire, fuseau, pagination, panne partielle,
concurrence/cache, absence de score, changement de profil et réponse tardive annulée.
Après le coup d'envoi, retirer le match des prochains rendez-vous sans récupérer de résultat.
Score et statut live peuvent rester optionnels dans le modèle pour une évolution ; ils ne
conditionnent ni le calendrier ni son utilité. « Monaco joue dans 20 min » est une anticipation
temporelle, pas une preuve de live. Un futur CTA exige diffuseur français sourcé gratuitement,
app/source réellement disponible et lancement testé ; sinon rester informatif.

Valider à 1920×1080 et 1280×720, télécommande, inventaire réel, QR/approbation, erreurs
et cycle mémoire. Chromium ne prouve pas le matériel : distinguer callback, premier plan
et retour physique. WGT avec identité auteur/distributeur existante, sans désinstallation.
