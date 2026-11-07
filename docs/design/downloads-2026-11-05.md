# Téléchargements — prototype du 5 novembre 2026

Demande propriétaire #861, style commun #806. Le PDF est une référence visuelle : les données et
commandes du panneau de démonstration ne sont jamais des instructions runtime.

## Correctif terrain v254

Les captures propriétaire invalident la conformité visuelle initiale. Les cartes affichent le titre
éditorial, le scope, une courte ligne qualité/audio/taille et le statut ; jamais le nom technique du
fichier, même dans les informations dépliées. Les actions secondaires restent sous un bouton « Actions »
de 44 px. Les détails sont utiles (qualité, client, actions), pas un dump des champs techniques.
Le sélecteur est une surface unique, sombre et sobre : en-tête média, scope éditable, choix 1080p/4K
homogènes et recherche manuelle repliée. Pas de panneau de transfert terminé, badge Prêt ni description
d'infrastructure. Ouvrir/fermer ne lance rien ; choisir une qualité conserve les gardes existants.
Le téléchargement de saison est une icône de 44 px à droite du titre Saison N, avec libellé accessible.
Il disparaît de la rangée Tout marquer vu / Bande-annonce. Les commandes épisode restent séparées.
Vérifier les vrais composants carte, sélecteur et saison en 360/412 px, y compris titre long et Retour.

Mes téléchargements et Recherche C411 restent distincts. Ordre : À traiter (erreurs et avertissements),
En cours, En attente, Terminés, Annulés. Une entrée appartient à un seul groupe. Une erreur prime sur
100 % ; transfert terminé ne prouve ni import Arr ni présence Plex. Aucun faux succès déduit d'un libellé.

Cartes #141417, titres blancs 800 sur deux lignes, sous-textes #8b8b94, progression or, erreurs avec
liseré rouge discret et message actionnable. Les terminés sont condensés avec fiche, autre release et
retrait. Cibles 44 px, safe areas, focus sûr des confirmations, reduced-motion. Aucun polling ajouté.
L'attente automatique n'est annoncée qu'avec preuve de surveillance Arr/RSS.

Cette demande remplace l'interdiction des commandes en ligne de SEENIT-UX-019 pour les épisodes de
la fiche série : numéro sur la vignette, titre sur deux lignes, commande téléchargement distincte de Vu
et de l'ouverture. Feature gate personnel obligatoire. Fichier présent : aucune action normale ;
transfert actif : progression sans double lancement ; futur : date sans téléchargement immédiat.
Le bouton ouvre le parcours de qualité existant : aucun envoi avant choix explicite.
Le choix 1080p/4K est conservé dans l'intention et visible dans la file. Une carte à traiter ou en
attente donne aussi accès à Changer la qualité avec le même scope. En présence d'un fichier, un
remplacement exige de cocher explicitement cette intention puis de choisir sa qualité ; aucune
rétrogradation ni nouvelle tentative après un POST ambigu. Le bouton de saison ne prétend pas
« N restants » depuis le seul compteur Vu : les états de visionnage et de fichiers sont différents.

Identité TMDB + scope saison/épisode et preuve physique uniquement. Erreur C411/Arr, absence de release,
import et présence Plex restent distincts. Demandes/suppressions durables et convergence par UID.
Une file Arr porte importState=pending ; 100 % n'en fait pas un terminé. L'historique exact ou la
vérification du fichier cible Sonarr peut confirmer l'import. Cette lecture réutilise le cache
d'historique borné (8 s), sans nouveau timer par carte ni requête par épisode.
Backlog : #293 #427 #428 #429 #430 #583 #591 #638 #656 #661 #664 #669 #801 #637, images #443/#778.
Chaque clôture exige ses propres tests et le terrain lorsqu'il est requis.

Le reçu de l'événement Download porte désormais le texte « Import Plex terminé » (#801), y compris
dans le worker natif. Cette copie produit ne constitue pas une preuve d'indexation Plex : seul le
contrôle exact existant autorise « Disponible dans Plex ». Identifiant, canal, cache d'images et
isolation UID sont conservés ; le visuel de ce reçu doit encore être vérifié séparément sur One UI.

## Refonte #879 — mode téléchargement (06/11)

Maquettes : canvas Design, rangée « 8 · Téléchargements v2 ». Les commandes par épisode et l'icône de
saison décrites plus haut sont remplacées par le **mode téléchargement** de `SEENIT-DOWNLOAD-014` : hors
mode, un seul bouton ⬇ dans la carte de progression et des pastilles passives ; en mode, le contrôle
remplace le Vu, le prochain épisode est coché, un bandeau montre la saison et une barre d'action demande
1080p ou 4K. Le lancement est partagé avec la popup (`launchArrDownload`). Lots suivants (#879) : onglet
Téléchargements au style À voir (séries groupées, barre de saison, ajout à la volée), page Version
précise, menu ⋮ ancré, programmation Sonarr/Radarr des épisodes à venir, film.
