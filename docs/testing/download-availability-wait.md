# Attente de disponibilité — #664

Le retour téléphone du 04/10 reste incertain : le film est oublié, aucune erreur
n'a été observée, et la disparition semblait suivre une recherche puis un redémarrage.
Ce terrain précis n'est pas déclaré reproduit.

Le chemin de disparition est confirmé dans le code : TTL optimiste de 120 s,
conversion persistée en transfert restauré puis retrait après 10 s de file saine vide.
Le runtime de production reproduit désormais une demande sans transfert conservée
au-delà du TTL, après restart via le stockage réel UID et à réception d'un snapshot partagé.

`downloadAvailabilityRuntime.test.ts` couvre la recherche Radarr et son lifecycle,
la preuve surveillance + RSS, le scope Sonarr S00E02, le changement de compte,
la panne sans fausse promesse, une attente de trois jours, le transfert exact tardif,
l'ancien transfert/deux hashes ambigus, l'annulation sans suppression de queue/fichier
et la substitution par une seule nouvelle intention manuelle.

Terrain à refaire sur l'APK officielle :

1. Choisir un film exact sans release actuellement disponible ; conserver son titre.
2. Vérifier En attente / En attente de disponibilité, sans 0 % ni spinner de téléchargement.
3. Confirmer le message automatique seulement si surveillance et RSS sont actifs ;
   avec RSS désactivé, le message reste « surveillance automatique à vérifier ».
4. Fermer/redémarrer, attendre plus de dix minutes : même attente, même demande.
5. Faire apparaître une release compatible dans le flux Arr : un seul transfert,
   puis import et confirmation Plex ; SeenIt ne lance aucune recherche supplémentaire.
6. Tester une panne/timeout : erreur ou attente de vérification conservée,
   jamais une fausse absence ni une promesse automatique.
7. Annuler une attente surveillée : scope exact désactivé, carte retirée seulement après
   confirmation, fichiers existants et autres épisodes/transferts conservés.
8. Ouvrir Chercher une autre release : consultation/annulation sans POST,
   choix confirmé remplaçant l'attente par une seule demande.

La restriction du compte GitHub bloque la CI/publication au moment du diagnostic.
Les tests locaux ne constituent ni une preuve de livraison ni un terrain téléphone.
