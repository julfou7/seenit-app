# Terrain229 — gel de l’accueil et historique lent

Date :27octobre2026. Suivi[#729](https://github.com/julfou7/seenit-app/issues/729).
Baseline : `main`0c4bd8a25c44f79d2dc745ba813d238c455b88f0, APK1.4.229.
Le propriétaire confirme cette version et précise que l’app reste ouverte mais bloquée.
Ce constat invalide une résolution complète par la seule conservation des panneaux de229.

## Cause et portée

Le composant réel `HistoryFeed` reparcourait toutes ses lignes pour chaque période visible
à chaque rendu, même lorsque dix lignes seulement étaient affichées. `historyPeriod`
créait un formateur natif français par appel via `toLocaleDateString`. Les nouvelles props
du parent pouvaient répéter ce travail pendant les bascules conservées par `Activity`.
Chaque résumé lisait aussi le cache de détail TV, même lorsque sa durée ne l’utilisait pas.
La tuile Afficher plus matérialisait tous les médias restants pour n’afficher que trois images.

La classe affectée est toute grande bibliothèque historique, sans dépendance à un titre,
à Plex ou à un compte. Aucun nouveau scan distant ni changement Firestore n’est nécessaire.

## Correction

- Index des périodes en une passe, classification d’une date locale une seule fois ; index et
  résumés mémorisés. Totaux calculés sur toutes les lignes de la période, pagination conservée.
- Formateurs français partagés ; les champs calendaires locaux sont formatés en UTC pour
  préserver leur date après changement du fuseau de l’appareil. Heures locales explicites.
- Durée déjà connue prioritaire ; aucun détail TV lu inutilement pour calculer une durée.
- Aperçu d’Afficher plus limité à trois médias, compteur restant complet conservé.
- `HistoryFeed` mémorisé, callback d’ouverture d’épisode stabilisé, groupes À venir mémorisés.
  Conservation229 et suspension des effets via `Activity` maintenues.
- Navigation basse légèrement réduite : îlot60px, boutons48×68px, glyphes26px,
  libellés10–11px. Safe area, gestes, clarté et cibles tactiles au-dessus de44px préservés.

## Preuves

Le scénario navigateur passe par `WatchListView`, `HistoryFeed` et les cartes de production.
Seuls les ports externes sont simulés ; aucune donnée personnelle ni écriture distante.
Il injecte6300visionnages, affiche dix puis vingt lignes et effectue trente bascules entre
les trois onglets sous ralentissement CPU×4. Enfin, un retrait Vu via les vrais dialogues
doit actualiser le compteur complet : les index ne doivent pas masquer une mutation.

| Mesure | Baseline229 | Correctif |
|---|---:|---:|
| Classements de période pour la première page |12 666|1 000|
| Nouveaux classements après pagination et trente bascules|TNR rouge dès la première page|0|
| Lignes rendues après pagination / bascules|10 initiales|20 conservées|
| Erreurs navigateur sur le scénario corrigé|—|0|

Le TNR échoue sur les trois modules de production prélevés exactement depuis0c4bd8a ; il
passe sur les modules corrigés, sans remplacer leur politique par une implémentation de test.
Le benchmark isolé6300appels `historyPeriod` passe de257ms à13ms sur ce PC ; ce nombre
n’est pas une mesure du téléphone et ne suffit pas à annoncer un gain FPS matériel.

Les tests unitaires couvrent aussi6300lignes, absence de perte/doublon, totaux complets,
absence de création de formateurs pendant le parcours, dates/heures et historique existant.
Les contrôles navigateur de navigation vérifient60px, cibles48px, centrage, texte agrandi,
safe area et les autres gestes existants.

## Livraison et limite

Changement classé APK. La validation canonique et les scénarios Chromium doivent être verts
avant push, puis la CI du SHA exact avant merge. La boucle terrain reste dans#729.
Le gel est reproduit dans le navigateur par son coût bloquant ; aucun diagnostic de crash
natif ni mesure RAM/FPS physique n’est inventé. Le téléphone du propriétaire reste le
critère d’acceptation de cette correction.
